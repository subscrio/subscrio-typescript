import { TransactionHooks } from "../hooks/TransactionHooks.js";
import { sql } from "drizzle-orm";
import {
  DatabaseSession,
  fingerprint,
  idempotencyKey,
  key,
  paging,
  iso,
  type Row,
} from "../../infrastructure/database/DatabaseSession.js";
import {
  safeAmount,
  utcDate,
  anchoredMonth,
} from "../../domain/services/AccountingArithmetic.js";
import { ValidationError, ConflictError } from "../errors/index.js";
import {
  InsufficientCreditsError,
  IdempotencyConflictError,
} from "../errors/AccountingErrors.js";
import { systemClock, type Clock } from "../utils/Clock.js";
import {
  type CreditCurrencyDto,
  type PlanCreditGrantInput,
  type CreditGrantInput,
  type CreditGrantDto,
  type CreditBalanceDto,
  type CreditActionDto,
  type CreditCheckDto,
  type CreditConsumeInput,
  type CreditConsumeDto,
  type CreditAdjustInput,
} from "../dtos/CreditDto.js";
import { type PageFilter } from "../dtos/PaginationDto.js";

export class CreditManagementService {
  constructor(
    private readonly store: DatabaseSession,
    private readonly clock: Clock = systemClock,
    private readonly mutationHooks = new TransactionHooks(),
  ) {}
  async getPlanGrant(planKey: string, currencyKey: string) {
    return (
      (await this.listPlanGrants(planKey)).find(
        (g) => g.currencyKey === currencyKey,
      ) ?? null
    );
  }
  async getConsumptionRule(featureKey: string, currencyKey: string) {
    return (
      (await this.listConsumptionRules(featureKey)).find(
        (r) => r.currencyKey === currencyKey,
      ) ?? null
    );
  }
  async adjust(input: CreditAdjustInput) {
    const balance = await this.adjustBalance(input);
    const op = await this.getOperation(input.customerKey, input.idempotencyKey);
    return {
      operationId: op!.id,
      idempotencyKey: input.idempotencyKey,
      balance,
    };
  }
  async issueDuePlanGrants(options: { subscriptionKey: string }) {
    const s = await this.store.require(
      sql`SELECT s.*,c.key customer_key FROM subscrio.subscriptions s JOIN subscrio.customers c ON c.id=s.customer_id WHERE s.key=${options.subscriptionKey}`,
      "Subscription",
    );
    return this.store.transaction(async (st) => {
      await st.lockCustomer(s.customer_key);
      const before = new Set(
        (
          await st.rows(
            sql`SELECT id FROM subscrio.credit_grants WHERE subscription_id=${s.id}`,
          )
        ).map((r) => String(r.id)),
      );
      await this.reconcile(
        st,
        s.customer_id,
        this.clock.now(),
        options.subscriptionKey,
      );
      const issued = (
        await st.rows(
          sql`SELECT g.*,c.key currency_key,s.key subscription_key FROM subscrio.credit_grants g JOIN subscrio.credit_wallets w ON w.id=g.wallet_id JOIN subscrio.credit_currencies c ON c.id=w.credit_currency_id JOIN subscrio.subscriptions s ON s.id=g.subscription_id WHERE s.id=${s.id} ORDER BY g.id`,
        )
      )
        .filter((r) => !before.has(String(r.id)))
        .map((r) => this.grantDto(r));
      const state = await st.one(
        sql`SELECT MIN(next_due_at) next_due_at FROM subscrio.subscription_credit_grant_states WHERE subscription_id=${s.id}`,
      );
      return {
        issued,
        nextDueAt: state?.next_due_at ? iso(state.next_due_at) : null,
        hasMore: false,
      };
    });
  }
  private currency(r: Row): CreditCurrencyDto {
    return {
      key: r.key,
      displayName: r.display_name,
      status: r.status,
      metadata: r.metadata,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    };
  }
  async createCurrency(input: {
    key: string;
    displayName: string;
    metadata?: Record<string, unknown>;
  }): Promise<CreditCurrencyDto> {
    key(input.key);
    if (!input.displayName?.trim())
      throw new ValidationError("Display name is required");
    if (await this.getCurrency(input.key))
      throw new ConflictError("Currency key already exists");
    return this.currency(
      await this.store.require(
        sql`INSERT INTO subscrio.credit_currencies(key,display_name,metadata) VALUES(${input.key},${input.displayName},${JSON.stringify(input.metadata ?? null)}::jsonb) RETURNING *`,
        "Currency",
      ),
    );
  }
  async getCurrency(k: string): Promise<CreditCurrencyDto | null> {
    const r = await this.store.one(
      sql`SELECT * FROM subscrio.credit_currencies WHERE key=${k}`,
    );
    return r ? this.currency(r) : null;
  }
  async listCurrencies(filter: PageFilter = {}): Promise<CreditCurrencyDto[]> {
    const [limit, offset] = paging(filter);
    return (
      await this.store.rows(
        sql`SELECT * FROM subscrio.credit_currencies WHERE (${filter.status ?? null}::text IS NULL OR status=${filter.status ?? null}) ORDER BY key LIMIT ${limit} OFFSET ${offset}`,
      )
    ).map((r) => this.currency(r));
  }
  async updateCurrency(
    k: string,
    input: { displayName?: string; metadata?: Record<string, unknown> },
  ): Promise<CreditCurrencyDto> {
    const old = await this.store.require(
      sql`SELECT * FROM subscrio.credit_currencies WHERE key=${k}`,
      "Currency",
    );
    if (input.displayName !== undefined && !input.displayName.trim())
      throw new ValidationError("Display name is required");
    return this.currency(
      await this.store.require(
        sql`UPDATE subscrio.credit_currencies SET display_name=${input.displayName ?? old.display_name},metadata=${JSON.stringify(input.metadata ?? old.metadata)}::jsonb,updated_at=NOW() WHERE id=${old.id} RETURNING *`,
        "Currency",
      ),
    );
  }
  async archiveCurrency(k: string): Promise<void> {
    await this.store.require(
      sql`UPDATE subscrio.credit_currencies SET status='archived',updated_at=NOW() WHERE key=${k} RETURNING id`,
      "Currency",
    );
  }
  async unarchiveCurrency(k: string): Promise<void> {
    await this.store.require(
      sql`UPDATE subscrio.credit_currencies SET status='active',updated_at=NOW() WHERE key=${k} RETURNING id`,
      "Currency",
    );
  }
  async deleteCurrency(k: string): Promise<void> {
    await this.store.transaction(async (st) => {
      const c = await st.require(
        sql`SELECT * FROM subscrio.credit_currencies WHERE key=${k} FOR UPDATE`,
        "Currency",
      );
      if (
        c.status !== "archived" ||
        (await st.one(
          sql`SELECT id FROM subscrio.credit_wallets WHERE credit_currency_id=${c.id} UNION ALL SELECT id FROM subscrio.plan_credit_grants WHERE credit_currency_id=${c.id} UNION ALL SELECT id FROM subscrio.credit_consumption_rules WHERE credit_currency_id=${c.id}`,
        ))
      )
        throw new ConflictError(
          "Currency must be archived and have no references",
        );
      await st.rows(
        sql`DELETE FROM subscrio.credit_currencies WHERE id=${c.id}`,
      );
    });
  }
  async setPlanGrant(
    planKey: string,
    currencyKey: string,
    input: PlanCreditGrantInput,
  ): Promise<void> {
    safeAmount(input.amount, "amount", 1);
    if (
      !["once", "monthly", "yearly", "billing_period"].includes(
        input.cadence,
      ) ||
      !["none", "grant_period_end"].includes(input.expiryPolicy ?? "none") ||
      !["retain", "expire"].includes(input.cancellationPolicy ?? "retain")
    )
      throw new ValidationError("Invalid grant policy");
    if (input.cadence === "once" && input.expiryPolicy === "grant_period_end")
      throw new ValidationError("Once grants have no grant period end");
    await this.store.transaction(async (st) => {
      const p = await st.require(
          sql`SELECT id FROM subscrio.plans WHERE key=${planKey}`,
          "Plan",
        ),
        c = await st.require(
          sql`SELECT id FROM subscrio.credit_currencies WHERE key=${currencyKey} AND status='active'`,
          "Active currency",
        );
      await this.settlePlan(st, p.id);
      await st.rows(
        sql`INSERT INTO subscrio.plan_credit_grants(plan_id,credit_currency_id,amount,cadence,expiry_policy,cancellation_policy) VALUES(${p.id},${c.id},${input.amount},${input.cadence},${input.expiryPolicy ?? "none"},${input.cancellationPolicy ?? "retain"}) ON CONFLICT(plan_id,credit_currency_id) DO UPDATE SET amount=EXCLUDED.amount,cadence=EXCLUDED.cadence,expiry_policy=EXCLUDED.expiry_policy,cancellation_policy=EXCLUDED.cancellation_policy,is_active=TRUE,updated_at=NOW()`,
      );
    });
  }
  private async settlePlan(st: DatabaseSession, planId: string): Promise<void> {
    const customers = await st.rows(
      sql`SELECT DISTINCT c.id,c.key FROM subscrio.customers c JOIN subscrio.subscriptions s ON s.customer_id=c.id WHERE s.plan_id=${planId} ORDER BY c.id`,
    );
    for (const customer of customers) {
      await st.lockCustomer(customer.key);
      await this.reconcile(st, customer.id, this.clock.now());
    }
  }
  async removePlanGrant(p: string, c: string): Promise<void> {
    await this.store.transaction(async (st) => {
      const plan = await st.require(
        sql`SELECT id FROM subscrio.plans WHERE key=${p}`,
        "Plan",
      );
      await this.settlePlan(st, plan.id);
      await st.rows(
        sql`UPDATE subscrio.plan_credit_grants SET is_active=FALSE,updated_at=NOW() WHERE plan_id=${plan.id} AND credit_currency_id=(SELECT id FROM subscrio.credit_currencies WHERE key=${c})`,
      );
    });
  }
  async listPlanGrants(
    p: string,
  ): Promise<Array<PlanCreditGrantInput & { currencyKey: string }>> {
    return (
      await this.store.rows(
        sql`SELECT g.*,c.key currency_key FROM subscrio.plan_credit_grants g JOIN subscrio.plans p ON p.id=g.plan_id JOIN subscrio.credit_currencies c ON c.id=g.credit_currency_id WHERE p.key=${p} AND g.is_active ORDER BY c.key`,
      )
    ).map((r) => ({
      currencyKey: r.currency_key,
      amount: safeAmount(r.amount),
      cadence: r.cadence,
      expiryPolicy: r.expiry_policy,
      cancellationPolicy: r.cancellation_policy,
    }));
  }
  async setConsumptionRule(
    featureKey: string,
    currencyKey: string,
    creditsPerUnit: number,
  ): Promise<void> {
    safeAmount(creditsPerUnit, "creditsPerUnit", 1);
    const f = await this.store.require(
        sql`SELECT id,value_type FROM subscrio.features WHERE key=${featureKey}`,
        "Feature",
      ),
      c = await this.store.require(
        sql`SELECT id FROM subscrio.credit_currencies WHERE key=${currencyKey} AND status='active'`,
        "Active currency",
      );
    if (f.value_type === "metered")
      throw new ValidationError(
        "Metered features cannot have credit consumption rules",
      );
    await this.store.rows(
      sql`INSERT INTO subscrio.credit_consumption_rules(feature_id,credit_currency_id,credits_per_unit) VALUES(${f.id},${c.id},${creditsPerUnit}) ON CONFLICT(feature_id,credit_currency_id) DO UPDATE SET credits_per_unit=EXCLUDED.credits_per_unit,updated_at=NOW()`,
    );
  }
  async removeConsumptionRule(f: string, c: string): Promise<void> {
    await this.store.rows(
      sql`DELETE FROM subscrio.credit_consumption_rules WHERE feature_id=(SELECT id FROM subscrio.features WHERE key=${f}) AND credit_currency_id=(SELECT id FROM subscrio.credit_currencies WHERE key=${c})`,
    );
  }
  async listConsumptionRules(
    f: string,
  ): Promise<Array<{ currencyKey: string; creditsPerUnit: number }>> {
    return (
      await this.store.rows(
        sql`SELECT c.key,r.credits_per_unit FROM subscrio.credit_consumption_rules r JOIN subscrio.features f ON f.id=r.feature_id JOIN subscrio.credit_currencies c ON c.id=r.credit_currency_id WHERE f.key=${f} ORDER BY c.key`,
      )
    ).map((r) => ({
      currencyKey: r.key,
      creditsPerUnit: safeAmount(r.credits_per_unit),
    }));
  }
  private async wallet(
    st: DatabaseSession,
    customerId: string,
    currencyId: string,
  ): Promise<Row> {
    await st.rows(
      sql`INSERT INTO subscrio.credit_wallets(customer_id,credit_currency_id) VALUES(${customerId},${currencyId}) ON CONFLICT DO NOTHING`,
    );
    return st.require(
      sql`SELECT * FROM subscrio.credit_wallets WHERE customer_id=${customerId} AND credit_currency_id=${currencyId} FOR UPDATE`,
      "Wallet",
    );
  }
  private async operation(
    st: DatabaseSession,
    customerId: string,
    k: string,
    type: string,
    hash: string,
  ): Promise<Row> {
    return st.require(
      sql`INSERT INTO subscrio.credit_operations(customer_id,idempotency_key,operation_type,request_hash,result_snapshot) VALUES(${customerId},${k},${type},${hash},'{}') RETURNING *`,
      "Operation",
    );
  }
  private async saveResult(
    st: DatabaseSession,
    operationId: string,
    result: unknown,
  ): Promise<void> {
    await st.rows(
      sql`UPDATE subscrio.credit_operations SET result_snapshot=${JSON.stringify(result)}::jsonb WHERE id=${operationId}`,
    );
  }
  private async replay(
    st: DatabaseSession,
    customerId: string,
    k: string,
    hash: string,
  ): Promise<Row | undefined> {
    const o = await st.one(
      sql`SELECT * FROM subscrio.credit_operations WHERE customer_id=${customerId} AND idempotency_key=${k}`,
    );
    if (o && o.request_hash !== hash) throw new IdempotencyConflictError();
    return o;
  }
  private async ledger(
    st: DatabaseSession,
    operationId: string,
    grant: Row,
    amount: number,
    reason: string,
    featureId: string | null = null,
    metadata: unknown = null,
  ): Promise<void> {
    await st.rows(
      sql`INSERT INTO subscrio.credit_ledger_entries(operation_id,wallet_id,credit_grant_id,amount,reason,feature_id,metadata) VALUES(${operationId},${grant.wallet_id},${grant.id},${amount},${reason},${featureId},${JSON.stringify(metadata)}::jsonb)`,
    );
  }
  private async createGrant(
    st: DatabaseSession,
    customerId: string,
    currencyId: string,
    amount: number,
    type: string,
    operation: Row,
    options: {
      subscriptionId?: string;
      ruleId?: string;
      sourceKey?: string;
      priority?: number;
      expiresAt?: Date | null;
      periodStart?: Date;
      periodEnd?: Date | null;
      cancellationPolicy?: string;
      metadata?: unknown;
    } = {},
  ): Promise<Row> {
    const wallet = await this.wallet(st, customerId, currencyId);
    const g = await st.require(
      sql`INSERT INTO subscrio.credit_grants(wallet_id,subscription_id,plan_credit_grant_id,source_key,grant_type,original_amount,remaining_amount,priority,expires_at,grant_period_start,grant_period_end,cancellation_policy) VALUES(${wallet.id},${options.subscriptionId ?? null},${options.ruleId ?? null},${options.sourceKey ?? null},${type},${amount},${amount},${options.priority ?? 0},${options.expiresAt?.toISOString() ?? null},${options.periodStart?.toISOString() ?? null},${options.periodEnd?.toISOString() ?? null},${options.cancellationPolicy ?? "retain"}) RETURNING *`,
      "Grant",
    );
    await this.ledger(
      st,
      operation.id,
      g,
      amount,
      "grant",
      null,
      options.metadata ?? null,
    );
    return g;
  }
  private grantDto(r: Row): CreditGrantDto {
    return {
      id: String(r.id),
      currencyKey: r.currency_key,
      subscriptionKey: r.subscription_key ?? null,
      grantType: r.grant_type,
      originalAmount: safeAmount(r.original_amount),
      remainingAmount: safeAmount(r.remaining_amount),
      priority: r.priority,
      expiresAt: r.expires_at ? iso(r.expires_at) : null,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    };
  }
  private async balance(
    st: DatabaseSession,
    customerId: string,
    currencyKey: string,
    at: Date,
  ): Promise<CreditBalanceDto> {
    const grants = await st.rows(
      sql`SELECT g.*,c.key currency_key,s.key subscription_key FROM subscrio.credit_grants g JOIN subscrio.credit_wallets w ON w.id=g.wallet_id JOIN subscrio.credit_currencies c ON c.id=w.credit_currency_id LEFT JOIN subscrio.subscriptions s ON s.id=g.subscription_id WHERE w.customer_id=${customerId} AND c.key=${currencyKey} AND g.remaining_amount>0 AND (g.expires_at IS NULL OR g.expires_at>${at.toISOString()}) ORDER BY g.priority,g.expires_at NULLS LAST,g.id`,
    );
    return {
      currencyKey,
      available: safeAmount(
        grants.reduce((n, g) => n + safeAmount(g.remaining_amount), 0),
        "wallet balance",
      ),
      grants: grants.map((g) => this.grantDto(g)),
    };
  }
  async grant(input: CreditGrantInput): Promise<CreditGrantDto> {
    safeAmount(input.amount, "amount", 1);
    idempotencyKey(input.idempotencyKey);
    if (!["manual", "promotional", "prepaid"].includes(input.grantType))
      throw new ValidationError("Invalid manual grant type");
    if (
      input.priority !== undefined &&
      (!Number.isInteger(input.priority) ||
        Math.abs(input.priority) > 2147483647)
    )
      throw new ValidationError("Invalid priority");
    let expiry = input.expiresAt ? utcDate(input.expiresAt) : null;
    const hash = fingerprint({
      type: "grant",
      ...input,
      priority: input.priority ?? 0,
      expiresAt: expiry?.toISOString() ?? null,
    });
    let replay = false;
    const result = await this.store.transaction(async (st) => {
      const c = await st.lockCustomer(input.customerKey),
        old = await this.replay(st, c.id, input.idempotencyKey, hash);
      if (old) {
        replay = true;
        return old.result_snapshot;
      }
      input = await this.mutationHooks.before("credit.granted", input, [
        "amount",
        "priority",
        "expiresAt",
        "metadata",
      ]);
      safeAmount(input.amount, "amount", 1);
      expiry = input.expiresAt ? utcDate(input.expiresAt) : null;
      if (
        input.priority !== undefined &&
        (!Number.isInteger(input.priority) ||
          Math.abs(input.priority) > 2147483647)
      )
        throw new ValidationError("Invalid priority");
      const at = this.clock.now();
      if (expiry && expiry <= at)
        throw new ValidationError("Grant expiry must be in the future");
      const currency = await st.require(
        sql`SELECT * FROM subscrio.credit_currencies WHERE key=${input.currencyKey} AND status='active'`,
        "Active currency",
      );
      const sub = input.subscriptionKey
        ? await st.require(
            sql`SELECT id FROM subscrio.subscriptions WHERE key=${input.subscriptionKey} AND customer_id=${c.id}`,
            "Customer subscription",
          )
        : null;
      const op = await this.operation(
          st,
          c.id,
          input.idempotencyKey,
          "grant",
          hash,
        ),
        g = await this.createGrant(
          st,
          c.id,
          currency.id,
          input.amount,
          input.grantType,
          op,
          {
            subscriptionId: sub?.id,
            priority: input.priority,
            expiresAt: expiry,
            metadata: input.metadata,
          },
        );
      const result = this.grantDto({
        ...g,
        currency_key: currency.key,
        subscription_key: input.subscriptionKey,
      });
      await this.saveResult(st, op.id, result);
      return result;
    });
    if (!replay)
      await this.mutationHooks.after("credit.granted", input, result);
    return result;
  }
  /** @internal Coordinates accounting with a subscription save. */
  /** @internal */
  async prepareSubscriptionChange(
    customerKey: string,
    subscriptionKey: string,
    isArchived: boolean,
    cancellationDate?: Date,
    expirationDate?: Date,
  ): Promise<void> {
    await this.store.transaction(async (st) => {
      const customer = await st.lockCustomer(customerKey);
      const old = await st.one(
        sql`SELECT * FROM subscrio.subscriptions WHERE key=${subscriptionKey}`,
      );
      if (!old) return;
      const at = this.clock.now();
      if (old.is_archived && !isArchived) {
        const rules = await st.rows(
          sql`SELECT * FROM subscrio.plan_credit_grants WHERE plan_id=${old.plan_id} AND is_active`,
        );
        const anchor = new Date(
          Math.max(
            new Date(old.activation_date ?? old.created_at).getTime(),
            old.trial_end_date ? new Date(old.trial_end_date).getTime() : 0,
          ),
        );
        for (const rule of rules)
          await st.rows(
            sql`INSERT INTO subscrio.subscription_credit_grant_states(subscription_id,credit_currency_id,anchor_at,next_due_at,rule_snapshot) VALUES(${old.id},${rule.credit_currency_id},${anchor.toISOString()},${at.toISOString()},${JSON.stringify(rule)}::jsonb) ON CONFLICT DO NOTHING`,
          );
        const states = await st.rows(
          sql`SELECT * FROM subscrio.subscription_credit_grant_states WHERE subscription_id=${old.id}`,
        );
        for (const state of states) {
          const snapshot = state.rule_snapshot;
          if (snapshot.cadence === "once") continue;
          if (snapshot.cadence === "billing_period") {
            const next = new Date(
              Math.max(
                at.getTime(),
                old.current_period_end
                  ? new Date(old.current_period_end).getTime()
                  : 0,
              ),
            );
            await st.rows(
              sql`UPDATE subscrio.subscription_credit_grant_states SET next_due_at=${next.toISOString()} WHERE id=${state.id}`,
            );
            continue;
          }
          const anchor = new Date(state.anchor_at),
            stride = snapshot.cadence === "yearly" ? 12 : 1;
          let months =
            Math.floor(
              ((at.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
                at.getUTCMonth() -
                anchor.getUTCMonth()) /
                stride,
            ) * stride;
          let due = anchoredMonth(anchor, months);
          if (due <= at) due = anchoredMonth(anchor, months + stride);
          await st.rows(
            sql`UPDATE subscrio.subscription_credit_grant_states SET next_due_at=${due.toISOString()} WHERE id=${state.id}`,
          );
        }
      }
      const stop = new Date(
        Math.min(
          cancellationDate?.getTime() ?? 8640000000000000,
          expirationDate?.getTime() ?? 8640000000000000,
        ),
      );
      await this.reconcile(st, customer.id, at, subscriptionKey, stop);
    });
  }
  private async reconcile(
    st: DatabaseSession,
    customerId: string,
    at: Date,
    subscriptionKey?: string,
    stopBefore?: Date,
  ): Promise<number> {
    let issued = 0;
    const subscriptions = await st.rows(
      sql`SELECT * FROM subscrio.subscriptions WHERE customer_id=${customerId} ORDER BY id`,
    );
    for (const sub of subscriptions) {
      if (
        (subscriptionKey && sub.key !== subscriptionKey) ||
        sub.is_archived ||
        (sub.activation_date && new Date(sub.activation_date) > at) ||
        (sub.trial_end_date && new Date(sub.trial_end_date) > at)
      )
        continue;
      const stop = Math.min(
        stopBefore?.getTime() ?? Infinity,
        sub.cancellation_date
          ? new Date(sub.cancellation_date).getTime()
          : Infinity,
        sub.expiration_date
          ? new Date(sub.expiration_date).getTime()
          : Infinity,
      );
      const rules = await st.rows(
        sql`SELECT r.* FROM subscrio.plan_credit_grants r JOIN subscrio.credit_currencies c ON c.id=r.credit_currency_id WHERE r.plan_id=${sub.plan_id} AND r.is_active AND c.status='active' ORDER BY r.credit_currency_id`,
      );
      for (const rule of rules) {
        const anchor = new Date(
          Math.max(
            new Date(sub.activation_date ?? sub.created_at).getTime(),
            sub.trial_end_date ? new Date(sub.trial_end_date).getTime() : 0,
          ),
        );
        await st.rows(
          sql`INSERT INTO subscrio.subscription_credit_grant_states(subscription_id,credit_currency_id,anchor_at,next_due_at,rule_snapshot) VALUES(${sub.id},${rule.credit_currency_id},${anchor.toISOString()},${anchor.toISOString()},${JSON.stringify(rule)}::jsonb) ON CONFLICT DO NOTHING`,
        );
        const state = await st.require(
          sql`SELECT * FROM subscrio.subscription_credit_grant_states WHERE subscription_id=${sub.id} AND credit_currency_id=${rule.credit_currency_id} FOR UPDATE`,
          "Grant state",
        );
        const savedAnchor = new Date(state.anchor_at);
        let due = state.next_due_at ? new Date(state.next_due_at) : null;
        if (rule.cadence === "once" && state.once_issued_at) continue;
        if (!due) due = at;
        if (rule.cadence === "billing_period") {
          if (
            !sub.current_period_start ||
            !sub.current_period_end ||
            new Date(sub.current_period_end) <=
              new Date(sub.current_period_start)
          )
            throw new ValidationError(
              "Recurring billing period grant requires current subscription boundaries",
            );
          due = new Date(sub.current_period_start);
          if (
            state.next_due_at &&
            new Date(state.next_due_at).getTime() !== savedAnchor.getTime() &&
            due < new Date(state.next_due_at)
          )
            continue;
        }
        for (let count = 0; due && due <= at && due.getTime() < stop; count++) {
          if (count >= 240)
            throw new ValidationError(
              "Credit schedule exceeds 240 catch-up periods; reconcile a smaller time range",
            );
          let end: Date | null = null;
          if (rule.cadence === "billing_period")
            end = new Date(sub.current_period_end);
          else if (rule.cadence !== "once") {
            const stride = rule.cadence === "yearly" ? 12 : 1;
            let months =
              (due.getUTCFullYear() - savedAnchor.getUTCFullYear()) * 12 +
              due.getUTCMonth() -
              savedAnchor.getUTCMonth();
            end = anchoredMonth(savedAnchor, months + stride);
            if (end <= due)
              end = anchoredMonth(savedAnchor, months + 2 * stride);
          }
          const source = `schedule:${sub.id}:${rule.credit_currency_id}:${rule.cadence === "once" ? "once" : due.toISOString()}`;
          if (
            !(await st.one(
              sql`SELECT id FROM subscrio.credit_grants WHERE source_key=${source}`,
            ))
          ) {
            const customer = await st.require(
              sql`SELECT key FROM subscrio.customers WHERE id=${customerId}`,
              "Customer",
            );
            const currency = await st.require(
              sql`SELECT key FROM subscrio.credit_currencies WHERE id=${rule.credit_currency_id}`,
              "Currency",
            );
            const input = await this.mutationHooks.before(
              "credit.granted",
              {
                customerKey: customer.key,
                currencyKey: currency.key,
                subscriptionKey: sub.key,
                amount: safeAmount(rule.amount),
                grantType: "recurring",
                idempotencyKey: source,
                priority: 0,
                expiresAt:
                  rule.expiry_policy === "grant_period_end"
                    ? end?.toISOString()
                    : undefined,
              },
              ["amount", "priority", "metadata"],
            );
            safeAmount(input.amount, "amount", 1);
            if (
              !Number.isInteger(input.priority) ||
              Math.abs(input.priority) > 2147483647
            )
              throw new ValidationError("Invalid priority");
            const op = await this.operation(
              st,
              customerId,
              source,
              "scheduled_grant",
              fingerprint({ source }),
            );
            const g = await this.createGrant(
              st,
              customerId,
              rule.credit_currency_id,
              input.amount,
              "recurring",
              op,
              {
                subscriptionId: sub.id,
                ruleId: rule.id,
                sourceKey: source,
                periodStart: due,
                periodEnd: end,
                expiresAt:
                  rule.expiry_policy === "grant_period_end" ? end : null,
                cancellationPolicy: rule.cancellation_policy,
                priority: input.priority,
                metadata: (input as { metadata?: unknown }).metadata,
              },
            );
            await this.saveResult(st, op.id, { grantId: String(g.id) });
            await this.mutationHooks.after(
              "credit.granted",
              input,
              this.grantDto({
                ...g,
                currency_key: currency.key,
                subscription_key: sub.key,
              }),
            );
            issued++;
          }
          if (rule.cadence === "once")
            await st.rows(
              sql`UPDATE subscrio.subscription_credit_grant_states SET once_issued_at=${at.toISOString()} WHERE id=${state.id}`,
            );
          due = end;
          await st.rows(
            sql`UPDATE subscrio.subscription_credit_grant_states SET next_due_at=${due?.toISOString() ?? null},rule_snapshot=${JSON.stringify(rule)}::jsonb,updated_at=${at.toISOString()} WHERE id=${state.id}`,
          );
          if (rule.cadence === "billing_period" || rule.cadence === "once")
            break;
        }
      }
    }
    const ending = await st.rows(
      sql`SELECT g.*,s.cancellation_date,s.expiration_date,s.is_archived FROM subscrio.credit_grants g JOIN subscrio.credit_wallets w ON w.id=g.wallet_id LEFT JOIN subscrio.subscriptions s ON s.id=g.subscription_id WHERE w.customer_id=${customerId} AND g.remaining_amount>0 ORDER BY g.id`,
    );
    for (const g of ending) {
      const expired = g.expires_at && new Date(g.expires_at) <= at;
      const cancelled =
        g.cancellation_policy === "expire" &&
        g.subscription_id &&
        (g.is_archived ||
          (g.cancellation_date && new Date(g.cancellation_date) <= at) ||
          (g.expiration_date && new Date(g.expiration_date) <= at));
      if (!expired && !cancelled) continue;
      const reason = expired ? "expiry" : "cancellation",
        source = `${reason}:${g.id}`,
        op = await this.operation(
          st,
          customerId,
          source,
          reason,
          fingerprint({ source }),
        );
      await this.ledger(st, op.id, g, -safeAmount(g.remaining_amount), reason);
      await st.rows(
        sql`UPDATE subscrio.credit_grants SET remaining_amount=0,updated_at=${at.toISOString()} WHERE id=${g.id}`,
      );
      await this.saveResult(st, op.id, { grantId: String(g.id), reason });
    }
    return issued;
  }
  async processScheduledGrants(
    customerKey?: string,
  ): Promise<{ issued: number; customers: number }> {
    const customers = customerKey
      ? [{ key: customerKey }]
      : await this.store.rows(
          sql`SELECT key FROM subscrio.customers ORDER BY id`,
        );
    let issued = 0;
    for (const c of customers)
      issued += await this.store.transaction(async (st) => {
        const customer = await st.lockCustomer(c.key);
        return this.reconcile(st, customer.id, this.clock.now());
      });
    return { issued, customers: customers.length };
  }
  async getBalance(
    customerKey: string,
    currencyKey: string,
  ): Promise<CreditBalanceDto> {
    return this.store.transaction(async (st) => {
      const c = await st.lockCustomer(customerKey);
      await st.require(
        sql`SELECT id FROM subscrio.credit_currencies WHERE key=${currencyKey}`,
        "Currency",
      );
      const at = this.clock.now();
      await this.reconcile(st, c.id, at);
      return this.balance(st, c.id, currencyKey, at);
    });
  }
  async listBalances(customerKey: string): Promise<CreditBalanceDto[]> {
    return this.store.transaction(async (st) => {
      const c = await st.lockCustomer(customerKey),
        at = this.clock.now();
      await this.reconcile(st, c.id, at);
      const currencies = await st.rows(
        sql`SELECT c.key FROM subscrio.credit_wallets w JOIN subscrio.credit_currencies c ON c.id=w.credit_currency_id WHERE w.customer_id=${c.id} ORDER BY c.key`,
      );
      return Promise.all(
        currencies.map((cu) => this.balance(st, c.id, cu.key, at)),
      );
    });
  }
  private async costs(
    st: DatabaseSession,
    customerId: string,
    action: CreditActionDto,
    at: Date,
  ): Promise<Array<Row & { cost: number; balance: CreditBalanceDto }>> {
    const rules = await st.rows(
      sql`SELECT r.*,c.key currency_key,c.status currency_status FROM subscrio.credit_consumption_rules r JOIN subscrio.features f ON f.id=r.feature_id JOIN subscrio.credit_currencies c ON c.id=r.credit_currency_id WHERE f.key=${action.featureKey} ORDER BY c.key`,
    );
    if (!rules.length)
      throw new ValidationError("Feature has no credit consumption rules");
    return Promise.all(
      rules.map(async (r) => ({
        ...r,
        cost: safeAmount(
          safeAmount(r.credits_per_unit) * action.units,
          "total credit cost",
        ),
        balance: await this.balance(st, customerId, r.currency_key, at),
      })),
    );
  }
  async canConsume(action: CreditActionDto): Promise<CreditCheckDto> {
    safeAmount(action.units, "units", 1);
    return this.store.transaction(async (st) => {
      const c = await st.lockCustomer(action.customerKey),
        at = this.clock.now();
      await this.reconcile(st, c.id, at);
      const rules = await this.costs(st, c.id, action, at),
        inactive = rules.some((r) => r.currency_status !== "active"),
        enough = rules.every((r) => r.balance.available >= r.cost);
      return {
        hasAccess: !inactive && enough,
        costs: rules.map((r) => ({
          currencyKey: r.currency_key,
          cost: r.cost,
          available: r.balance.available,
        })),
        ...(inactive
          ? { accessDeniedReason: "currency_inactive" as const }
          : !enough
            ? { accessDeniedReason: "insufficient_credits" as const }
            : {}),
      };
    });
  }
  private async burn(
    st: DatabaseSession,
    op: Row,
    balance: CreditBalanceDto,
    amount: number,
    reason: string,
    featureId: string | null,
    metadata: unknown,
  ): Promise<Array<{ currencyKey: string; grantId: string; amount: number }>> {
    let remaining = amount;
    const allocations = [];
    for (const dto of balance.grants) {
      if (!remaining) break;
      const g = await st.require(
          sql`SELECT * FROM subscrio.credit_grants WHERE id=${dto.id} FOR UPDATE`,
          "Grant",
        ),
        take = Math.min(safeAmount(g.remaining_amount), remaining);
      if (!take) continue;
      await st.rows(
        sql`UPDATE subscrio.credit_grants SET remaining_amount=remaining_amount-${take},updated_at=NOW() WHERE id=${g.id}`,
      );
      await this.ledger(st, op.id, g, -take, reason, featureId, metadata);
      allocations.push({
        currencyKey: balance.currencyKey,
        grantId: String(g.id),
        amount: take,
      });
      remaining -= take;
    }
    if (remaining)
      throw new InsufficientCreditsError([
        {
          currencyKey: balance.currencyKey,
          cost: amount,
          available: balance.available,
        },
      ]);
    return allocations;
  }
  async consume(input: CreditConsumeInput): Promise<CreditConsumeDto> {
    safeAmount(input.units, "units", 1);
    idempotencyKey(input.idempotencyKey);
    const hash = fingerprint({ type: "consume", ...input });
    let replay = false;
    const result = await this.store.transaction(async (st) => {
      const c = await st.lockCustomer(input.customerKey),
        old = await this.replay(st, c.id, input.idempotencyKey, hash);
      if (old) {
        replay = true;
        return old.result_snapshot;
      }
      input = await this.mutationHooks.before("credit.consumed", input, [
        "units",
        "metadata",
      ]);
      safeAmount(input.units, "units", 1);
      const at = this.clock.now();
      await this.reconcile(st, c.id, at);
      const costs = await this.costs(st, c.id, input, at);
      if (
        costs.some(
          (r) => r.currency_status !== "active" || r.balance.available < r.cost,
        )
      )
        throw new InsufficientCreditsError(
          costs.map((r) => ({
            currencyKey: r.currency_key,
            cost: r.cost,
            available: r.balance.available,
          })),
        );
      const op = await this.operation(
          st,
          c.id,
          input.idempotencyKey,
          "consume",
          hash,
        ),
        result: CreditConsumeDto = {
          operationId: String(op.id),
          idempotencyKey: input.idempotencyKey,
          allocations: [],
          balances: [],
        };
      for (const r of costs) {
        result.allocations.push(
          ...(await this.burn(
            st,
            op,
            r.balance,
            r.cost,
            "consumption",
            r.feature_id,
            input.metadata ?? null,
          )),
        );
        result.balances.push({
          currencyKey: r.currency_key,
          available: r.balance.available - r.cost,
        });
      }
      await this.saveResult(st, op.id, result);
      return result;
    });
    if (!replay)
      await this.mutationHooks.after("credit.consumed", input, result);
    return result;
  }
  private async adjustBalance(
    input: CreditAdjustInput,
  ): Promise<CreditBalanceDto> {
    if (!Number.isSafeInteger(input.amount) || !input.amount)
      throw new ValidationError("Adjustment must be a nonzero safe integer");
    if (!input.reason?.trim())
      throw new ValidationError("Adjustment reason is required");
    idempotencyKey(input.idempotencyKey);
    const hash = fingerprint({ type: "adjust", ...input });
    let replay = false;
    const result = await this.store.transaction(async (st) => {
      const c = await st.lockCustomer(input.customerKey),
        old = await this.replay(st, c.id, input.idempotencyKey, hash);
      if (old) {
        replay = true;
        return old.result_snapshot;
      }
      input = await this.mutationHooks.before("credit.adjusted", input, [
        "amount",
        "reason",
      ]);
      if (
        !Number.isSafeInteger(input.amount) ||
        !input.amount ||
        !input.reason?.trim()
      )
        throw new ValidationError("Invalid adjustment");
      const currency = await st.require(
          sql`SELECT * FROM subscrio.credit_currencies WHERE key=${input.currencyKey} AND status='active'`,
          "Active currency",
        ),
        at = this.clock.now();
      await this.reconcile(st, c.id, at);
      const op = await this.operation(
        st,
        c.id,
        input.idempotencyKey,
        "adjust",
        hash,
      );
      if (input.amount > 0)
        await this.createGrant(
          st,
          c.id,
          currency.id,
          input.amount,
          "manual",
          op,
          { metadata: { reason: input.reason } },
        );
      else
        await this.burn(
          st,
          op,
          await this.balance(st, c.id, input.currencyKey, at),
          -input.amount,
          "adjustment",
          null,
          { reason: input.reason },
        );
      const result = await this.balance(st, c.id, input.currencyKey, at);
      await this.saveResult(st, op.id, result);
      return result;
    });
    if (!replay)
      await this.mutationHooks.after("credit.adjusted", input, result);
    return result;
  }
  async listGrants(
    customerKey: string,
    currencyKey: string,
    filter: PageFilter = {},
  ): Promise<CreditGrantDto[]> {
    const [limit, offset] = paging(filter);
    return (
      await this.store.rows(
        sql`SELECT g.*,cu.key currency_key,s.key subscription_key FROM subscrio.credit_grants g JOIN subscrio.credit_wallets w ON w.id=g.wallet_id JOIN subscrio.customers c ON c.id=w.customer_id JOIN subscrio.credit_currencies cu ON cu.id=w.credit_currency_id LEFT JOIN subscrio.subscriptions s ON s.id=g.subscription_id WHERE c.key=${customerKey} AND cu.key=${currencyKey} ORDER BY g.id DESC LIMIT ${limit} OFFSET ${offset}`,
      )
    ).map((r) => this.grantDto(r));
  }
  async getOperation(
    customerKey: string,
    k: string,
  ): Promise<{
    id: string;
    type: string;
    result: unknown;
    createdAt: string;
  } | null> {
    const r = await this.store.one(
      sql`SELECT o.* FROM subscrio.credit_operations o JOIN subscrio.customers c ON c.id=o.customer_id WHERE c.key=${customerKey} AND o.idempotency_key=${k}`,
    );
    return r
      ? {
          id: String(r.id),
          type: r.operation_type,
          result: r.result_snapshot,
          createdAt: iso(r.created_at),
        }
      : null;
  }
  async listLedgerEntries(
    customerKey: string,
    currencyKey: string,
    filter: PageFilter = {},
  ): Promise<
    Array<{
      id: string;
      operationId: string;
      grantId: string;
      amount: number;
      reason: string;
      createdAt: string;
      metadata: unknown;
    }>
  > {
    const [limit, offset] = paging(filter);
    return (
      await this.store.rows(
        sql`SELECT l.* FROM subscrio.credit_ledger_entries l JOIN subscrio.credit_wallets w ON w.id=l.wallet_id JOIN subscrio.customers c ON c.id=w.customer_id JOIN subscrio.credit_currencies cu ON cu.id=w.credit_currency_id WHERE c.key=${customerKey} AND cu.key=${currencyKey} ORDER BY l.created_at DESC,l.id DESC LIMIT ${limit} OFFSET ${offset}`,
      )
    ).map((r) => ({
      id: String(r.id),
      operationId: String(r.operation_id),
      grantId: String(r.credit_grant_id),
      amount: Number(r.amount),
      reason: r.reason,
      createdAt: iso(r.created_at),
      metadata: r.metadata,
    }));
  }
}

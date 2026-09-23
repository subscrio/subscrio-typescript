import { TransactionHooks } from "../hooks/TransactionHooks.js";
import { sql } from "drizzle-orm";
import {
  DatabaseSession,
  fingerprint,
  idempotencyKey,
  paging,
} from "../../infrastructure/database/DatabaseSession.js";
import { FeatureResolutionQuery } from "./FeatureResolutionQuery.js";
import {
  safeAmount,
  calendarPeriod,
} from "../../domain/services/AccountingArithmetic.js";
import { ValidationError } from "../errors/index.js";
import {
  UsageLimitExceededError,
  IdempotencyConflictError,
  MeteringPeriodError,
} from "../errors/AccountingErrors.js";
import { systemClock, type Clock } from "../utils/Clock.js";
import {
  type UsageDto,
  type UsageOptions,
  type UsageReportOptions,
  type UsageReportDto,
  type UsageHistoryFilter,
} from "../dtos/MeteringDto.js";

export class MeteringService {
  constructor(
    private readonly store: DatabaseSession,
    private readonly clock: Clock = systemClock,
    private readonly mutationHooks = new TransactionHooks(),
  ) {}
  private async state(
    st: DatabaseSession,
    customerKey: string,
    productKey: string,
    featureKey: string,
    options: UsageOptions,
    at: Date,
  ) {
    const row = await st.require(
      sql`SELECT m.*,f.default_value,p.id product_id,c.id customer_id FROM subscrio.metered_feature_config m JOIN subscrio.features f ON f.id=m.feature_id JOIN subscrio.product_features pf ON pf.feature_id=f.id JOIN subscrio.products p ON p.id=pf.product_id CROSS JOIN subscrio.customers c WHERE c.key=${customerKey} AND p.key=${productKey} AND f.key=${featureKey} AND f.value_type='metered'`,
      "Metered feature configuration",
    );
    if ((row.scope === "subscription") !== !!options.subscriptionKey)
      throw new ValidationError(
        row.scope === "subscription"
          ? "subscriptionKey is required"
          : "Customer scoped usage must not specify subscriptionKey",
      );
    const s = options.subscriptionKey
      ? await st.require(
          sql`SELECT s.* FROM subscrio.subscriptions s JOIN subscrio.plans pl ON pl.id=s.plan_id WHERE s.key=${options.subscriptionKey} AND s.customer_id=${row.customer_id} AND pl.product_id=${row.product_id}`,
          "Subscription",
        )
      : null;
    let period: { start: Date; end: Date };
    if (row.reset_period === "billing_period") {
      if (!s?.current_period_start || !s.current_period_end)
        throw new MeteringPeriodError("Billing period bounds are required");
      period = {
        start: new Date(s.current_period_start),
        end: new Date(s.current_period_end),
      };
      if (at < period.start || at >= period.end)
        throw new MeteringPeriodError(
          "Billing period is stale; update the subscription period",
        );
    } else {
      const [start, end] = calendarPeriod(at, row.reset_period);
      period = { start, end };
    }
    const explanation = await new FeatureResolutionQuery(
      st,
      this.clock,
    ).explain(
      customerKey,
      productKey,
      featureKey,
      options.subscriptionKey,
      at,
      true,
    );
    const limit = safeAmount(explanation.effectiveValue, "limit");
    const balance = await st.one(
      sql`SELECT * FROM subscrio.usage_balances WHERE customer_id=${row.customer_id} AND product_id=${row.product_id} AND feature_id=${row.feature_id} AND subscription_id IS NOT DISTINCT FROM ${s?.id ?? null}::bigint AND period_start=${period.start.toISOString()}`,
    );
    return {
      row,
      s,
      period,
      limit,
      consumed: safeAmount(balance?.consumed ?? 0),
      balance,
      active: explanation.subscriptions.length > 0,
    };
  }
  private result(
    state: Awaited<ReturnType<MeteringService["state"]>>,
    requested: number,
    subscriptionKey?: string,
  ): UsageDto {
    const projected = safeAmount(state.consumed + requested, "projected usage"),
      over = projected > state.limit,
      hasAccess = state.active && (!over || state.row.enforcement === "soft");
    return {
      hasAccess,
      limit: state.limit,
      consumed: state.consumed,
      remaining: Math.max(0, state.limit - state.consumed),
      requestedUsage: requested,
      projectedConsumed: projected,
      isOverage: over,
      enforcement: state.row.enforcement,
      usageScope: state.row.scope,
      ...(subscriptionKey ? { subscriptionKey } : {}),
      periodStart: state.period.start.toISOString(),
      periodEnd: state.period.end.toISOString(),
      ...(!hasAccess
        ? {
            accessDeniedReason: state.active
              ? ("limit_exceeded" as const)
              : ("no_active_subscription" as const),
          }
        : {}),
    };
  }
  async getUsage(
    customerKey: string,
    productKey: string,
    featureKey: string,
    options: UsageOptions = {},
  ): Promise<UsageDto> {
    const requested = safeAmount(options.requestedUsage ?? 1, "requestedUsage");
    return this.result(
      await this.state(
        this.store,
        customerKey,
        productKey,
        featureKey,
        options,
        this.clock.now(),
      ),
      requested,
      options.subscriptionKey,
    );
  }
  async reportUsage(
    customerKey: string,
    productKey: string,
    featureKey: string,
    quantity: number,
    options: UsageReportOptions,
  ): Promise<UsageReportDto> {
    safeAmount(quantity, "quantity", 1);
    idempotencyKey(options.idempotencyKey);
    const hash = fingerprint({
      customerKey: customerKey,
      productKey: productKey,
      featureKey: featureKey,
      quantity,
      subscriptionKey: options.subscriptionKey ?? null,
      metadata: options.metadata ?? null,
    });
    let replay = false;
    const result = await this.store.transaction(async (st) => {
      const customer = await st.lockCustomer(customerKey);
      const old = await st.one(
        sql`SELECT * FROM subscrio.usage_events WHERE customer_id=${customer.id} AND idempotency_key=${options.idempotencyKey}`,
      );
      if (old) {
        if (old.request_hash !== hash) throw new IdempotencyConflictError();
        replay = true;
        return old.result_snapshot as UsageReportDto;
      }
      const proposed = await this.mutationHooks.before(
        "usage.reported",
        {
          customerKey: customerKey,
          productKey: productKey,
          featureKey: featureKey,
          quantity,
          ...options,
        },
        ["quantity", "metadata"],
      );
      quantity = safeAmount(proposed.quantity, "quantity", 1);
      options = { ...options, metadata: proposed.metadata };
      const at = this.clock.now(),
        state = await this.state(
          st,
          customerKey,
          productKey,
          featureKey,
          options,
          at,
        );
      if (state.row.aggregation === "count" && quantity !== 1)
        throw new ValidationError("Count aggregation requires quantity one");
      const check = this.result(state, quantity, options.subscriptionKey);
      if (!check.hasAccess) throw new UsageLimitExceededError(check);
      const consumed = safeAmount(state.consumed + quantity);
      let balance = state.balance;
      if (balance)
        await st.rows(
          sql`UPDATE subscrio.usage_balances SET consumed=${consumed},limit_value=${state.limit},updated_at=${at.toISOString()} WHERE id=${balance.id}`,
        );
      else
        balance = await st.require(
          sql`INSERT INTO subscrio.usage_balances(customer_id,product_id,feature_id,subscription_id,period_start,period_end,consumed,limit_value,updated_at) VALUES(${customer.id},${state.row.product_id},${state.row.feature_id},${state.s?.id ?? null},${state.period.start.toISOString()},${state.period.end.toISOString()},${consumed},${state.limit},${at.toISOString()}) RETURNING id`,
          "Usage balance",
        );
      const event = await st.require(
        sql`INSERT INTO subscrio.usage_events(idempotency_key,request_hash,usage_balance_id,customer_id,product_id,feature_id,subscription_id,quantity,recorded_at,metadata,result_snapshot) VALUES(${options.idempotencyKey},${hash},${balance.id},${customer.id},${state.row.product_id},${state.row.feature_id},${state.s?.id ?? null},${quantity},${at.toISOString()},${JSON.stringify(options.metadata ?? null)}::jsonb,'{}') RETURNING id`,
        "Usage event",
      );
      const result: UsageReportDto = {
        eventId: String(event.id),
        idempotencyKey: options.idempotencyKey,
        quantity,
        recordedAt: at.toISOString(),
        usage: this.result({ ...state, consumed }, 0, options.subscriptionKey),
      };
      await st.rows(
        sql`UPDATE subscrio.usage_events SET result_snapshot=${JSON.stringify(result)}::jsonb WHERE id=${event.id}`,
      );
      return result;
    });
    if (!replay)
      await this.mutationHooks.after(
        "usage.reported",
        {
          customerKey: customerKey,
          productKey: productKey,
          featureKey: featureKey,
          quantity,
          ...options,
        },
        result,
      );
    return result;
  }
  async listUsageEvents(
    customerKey: string,
    productKey: string,
    featureKey: string,
    filter: UsageHistoryFilter = {},
  ): Promise<UsageReportDto[]> {
    const [limit, offset] = paging(filter);
    return (
      await this.store.rows(
        sql`SELECT e.result_snapshot FROM subscrio.usage_events e JOIN subscrio.customers c ON c.id=e.customer_id JOIN subscrio.products p ON p.id=e.product_id JOIN subscrio.features f ON f.id=e.feature_id LEFT JOIN subscrio.subscriptions s ON s.id=e.subscription_id WHERE c.key=${customerKey} AND p.key=${productKey} AND f.key=${featureKey} AND (${filter.subscriptionKey ?? null}::text IS NULL OR s.key=${filter.subscriptionKey ?? null}) AND (${filter.from ?? null}::timestamptz IS NULL OR e.recorded_at>=${filter.from ?? null}::timestamptz) AND (${filter.to ?? null}::timestamptz IS NULL OR e.recorded_at<${filter.to ?? null}::timestamptz) ORDER BY e.recorded_at DESC,e.id DESC LIMIT ${limit} OFFSET ${offset}`,
      )
    ).map((r) => r.result_snapshot);
  }
}

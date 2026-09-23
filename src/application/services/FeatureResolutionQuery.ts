import { sql } from "drizzle-orm";
import {
  DatabaseSession,
  eligible,
  iso,
} from "../../infrastructure/database/DatabaseSession.js";
import { ValidationError } from "../errors/index.js";
import { safeAmount } from "../../domain/services/AccountingArithmetic.js";
import { systemClock, type Clock } from "../utils/Clock.js";
import {
  type FeatureValueExplanationDto,
  type FeatureValueSourceDto,
} from "../dtos/FeatureResolutionDto.js";

/** Internal evaluator used by existing feature checks and accounting services. */
export class FeatureResolutionQuery {
  constructor(
    readonly store: DatabaseSession,
    readonly clock: Clock = systemClock,
  ) {}
  async explain(
    customerKey: string,
    productKey: string,
    featureKey: string,
    subscriptionKey?: string,
    at = this.clock.now(),
    accounting = false,
  ): Promise<FeatureValueExplanationDto> {
    const f = await this.store.require(
      sql`SELECT f.*,p.id product_id,pf.composition_rule,pf.cross_subscription_rule FROM subscrio.features f JOIN subscrio.product_features pf ON pf.feature_id=f.id JOIN subscrio.products p ON p.id=pf.product_id WHERE p.key=${productKey} AND f.key=${featureKey}`,
      "Associated feature",
    );
    const c = await this.store.require(
      sql`SELECT id FROM subscrio.customers WHERE key=${customerKey}`,
      "Customer",
    );
    const all = await this.store.rows(
      sql`SELECT s.*,p.key plan_key,pf.value plan_value FROM subscrio.subscriptions s JOIN subscrio.plans p ON p.id=s.plan_id LEFT JOIN subscrio.plan_features pf ON pf.plan_id=p.id AND pf.feature_id=${f.id} WHERE s.customer_id=${c.id} AND p.product_id=${f.product_id} AND (${subscriptionKey ?? null}::text IS NULL OR s.key=${subscriptionKey ?? null}) ORDER BY s.created_at,s.id`,
    );
    if (subscriptionKey && !all.length)
      throw new ValidationError(
        "Subscription does not belong to this customer and product",
      );
    const legacy = f.cross_subscription_rule === "legacy";
    if (legacy) all.reverse();
    const subs = all.filter((s) =>
      subscriptionKey && !accounting
        ? true
        : eligible(
            {
              ...s,
              is_archived: legacy && !accounting ? false : s.is_archived,
            },
            at,
          ) &&
          (!legacy || accounting || !s.cancellation_date),
    );
    const result: FeatureValueExplanationDto = {
      evaluatedAt: at.toISOString(),
      effectiveValue: f.default_value,
      resolution: {
        addonRule: f.composition_rule,
        subscriptionRule:
          f.cross_subscription_rule === "legacy"
            ? undefined
            : f.cross_subscription_rule,
      },
      subscriptions: [],
    };
    const allAddons = await this.store.rows(
      sql`SELECT sa.subscription_id,a.key,a.composition_mode,a.priority,sa.quantity,af.value FROM subscrio.subscription_addons sa JOIN subscrio.addons a ON a.id=sa.addon_id JOIN subscrio.addon_features af ON af.addon_id=a.id JOIN subscrio.subscriptions s ON s.id=sa.subscription_id JOIN subscrio.plans p ON p.id=s.plan_id WHERE s.customer_id=${c.id} AND p.product_id=${f.product_id} AND sa.status='active' AND af.feature_id=${f.id} ORDER BY a.priority,a.key`,
    );
    const allOverrides = await this.store.rows(
      sql`SELECT o.* FROM subscrio.subscription_feature_overrides o JOIN subscrio.subscriptions s ON s.id=o.subscription_id JOIN subscrio.plans p ON p.id=s.plan_id WHERE s.customer_id=${c.id} AND p.product_id=${f.product_id} AND o.feature_id=${f.id}`,
    );
    for (const s of subs) {
      const sources: FeatureValueSourceDto[] = [
        {
          kind: s.plan_value == null ? "default" : "plan",
          key: s.plan_value == null ? f.key : s.plan_key,
          value: s.plan_value ?? f.default_value,
          applied: true,
        },
      ];
      const additions = allAddons.filter((a) => a.subscription_id === s.id);
      let value = s.plan_value ?? f.default_value;
      const replacement = additions.find(
        (a) => a.composition_mode === "override",
      );
      if (replacement) {
        sources[0].applied = false;
        sources[0].reason = "Replaced by addon";
        value = replacement.value;
      }
      for (const a of additions) {
        const applied = a.composition_mode === "additive" || a === replacement;
        sources.push({
          kind: "addon",
          key: a.key,
          value: a.value,
          quantity: a.quantity,
          applied,
          reason: applied ? undefined : "Lower replacement priority",
        });
      }
      const additive = additions
        .filter((a) => a.composition_mode === "additive")
        .map((a) => this.scale(a.value, a.quantity, f.value_type));
      value = this.combine(
        [value, ...additive],
        f.composition_rule,
        f.value_type,
      );
      const o = allOverrides.find((o) => o.subscription_id === s.id);
      if (o) {
        const active = !o.expires_at || new Date(o.expires_at) > at;
        if (active) {
          for (const source of sources) {
            source.applied = false;
            source.reason = "Replaced by subscription override";
          }
          value = o.value;
        }
        sources.push({
          kind: "override",
          key: s.key,
          value: o.value,
          expiresAt: o.expires_at ? iso(o.expires_at) : null,
          applied: active,
          reason: active ? undefined : "Expired",
        });
      }
      result.subscriptions.push({ subscriptionKey: s.key, value, sources });
    }
    if (legacy) {
      for (const s of result.subscriptions) {
        if (s.sources.some((x) => x.kind === "override" && x.applied)) {
          result.effectiveValue = s.value;
          break;
        }
        if (
          result.effectiveValue === f.default_value &&
          s.sources.some((x) => x.kind !== "default" && x.applied)
        )
          result.effectiveValue = s.value;
      }
    } else if (result.subscriptions.length)
      result.effectiveValue = this.combine(
        result.subscriptions.map((s) => s.value),
        f.cross_subscription_rule,
        f.value_type,
      );
    return result;
  }
  private scale(value: string, quantity: number, type: string): string {
    if (type === "numeric" || type === "metered") {
      const n = Number(value) * quantity;
      if (!Number.isFinite(n))
        throw new ValidationError("Composed value overflow");
      if (type === "metered") safeAmount(n);
      return String(n);
    }
    return value;
  }
  private combine(values: string[], rule: string, type: string): string {
    if (rule === "override_wins") return values[0];
    if (type === "toggle")
      return String(values.some((v) => v.toLowerCase() === "true"));
    if (type === "text") return values[0];
    const nums = values.map(Number),
      n =
        rule === "additive"
          ? nums.reduce((a, b) => a + b, 0)
          : Math.max(...nums);
    if (!Number.isFinite(n))
      throw new ValidationError("Composed value overflow");
    if (type === "metered") safeAmount(n);
    return String(n);
  }
}

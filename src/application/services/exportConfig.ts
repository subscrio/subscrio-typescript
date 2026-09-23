import type { Subscrio } from "../../Subscrio.js";
import type {
  ConfigSyncDto,
  ConfigSyncReport,
  FeatureConfig,
  BillingCycleConfig,
} from "../dtos/ConfigSyncDto.js";
import { loadAllPages } from "../utils/PagedListLoader.js";

// Canonical configuration values exclude timestamps and normalize object key order.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}
export async function captureAccountingConfig(
  app: Subscrio,
  config: ConfigSyncDto,
) {
  const result = new Map<string, string>();
  const add = (kind: string, key: string, value: unknown) => {
    if (value != null) result.set(kind + ":" + key, canonical(value));
  };
  for (const c of config.creditCurrencies ?? []) {
    const old = await app.credits.getCurrency(c.key);
    if (old)
      add("currency", c.key, {
        displayName: old.displayName,
        status: old.status,
        metadata: old.metadata ?? null,
      });
  }
  for (const f of config.features) {
    if (f.meteredConfig)
      add(
        "meter",
        f.key,
        (await app.features.getFeature(f.key))?.meteredConfig,
      );
    if (f.creditConsumptionRules !== undefined)
      for (const r of await app.credits.listConsumptionRules(f.key))
        add("cost", f.key + "/" + r.currencyKey, r);
  }
  if (config.creditConsumptionRules !== undefined)
    for (const f of await loadAllPages((offset, limit) =>
      app.features.listFeatures({ offset, limit }),
    ))
      for (const r of await app.credits.listConsumptionRules(f.key))
        add("cost", f.key + "/" + r.currencyKey, r);
  for (const p of config.products) {
    if (await app.products.getProduct(p.key))
      for (const f of Object.keys(p.featureResolution ?? {})) {
        if (
          (await app.features.getFeaturesByProduct(p.key)).some(
            (x) => x.key === f,
          )
        )
          add(
            "composition",
            p.key + "/" + f,
            (await app.products.getProduct(p.key))!.features.find(
              (association) => association.featureKey === f,
            )!.resolution,
          );
      }
    for (const a of p.addons ?? []) {
      const old = await app.addons.getAddon(a.key);
      if (old)
        add("addon", a.key, {
          displayName: old.displayName,
          description: old.description ?? null,
          compositionMode: old.compositionMode,
          priority: old.priority,
          status: old.status,
          metadata: old.metadata ?? null,
          featureValues: (await app.addons.getAddon(a.key))!.featureValues,
        });
    }
    for (const plan of p.plans ?? [])
      if (plan.creditGrants !== undefined)
        for (const g of await app.credits.listPlanGrants(plan.key))
          add("planGrant", plan.key + "/" + g.currencyKey, g);
  }
  for (const s of config.subscriptions ?? []) {
    const old = await app.subscriptions.getSubscription(s.key);
    for (const o of s.featureOverrides) {
      const v = old?.featureOverrides?.find(
        (f) => f.featureKey === o.featureKey,
      );
      if (v)
        add("override", s.key + "/" + o.featureKey, {
          value: v.value,
          type: v.type,
          expiresAt: v.expiresAt ?? null,
        });
    }
  }
  return result;
}
export function compareAccountingConfig(
  before: Map<string, string>,
  after: Map<string, string>,
): NonNullable<ConfigSyncReport["details"]> {
  const result: NonNullable<ConfigSyncReport["details"]> = {
    created: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    changes: [],
  };
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const action = !before.has(key)
      ? "created"
      : !after.has(key)
        ? "removed"
        : before.get(key) === after.get(key)
          ? "unchanged"
          : "updated";
    result[action]++;
    const split = key.indexOf(":");
    result.changes.push({
      entityType: key.slice(0, split),
      key: key.slice(split + 1),
      action,
    });
  }
  return result;
}
/** Export catalog configuration and only explicitly requested existing subscription overrides. */
export async function exportConfig(
  app: Subscrio,
  subscriptionKeys: string[],
): Promise<ConfigSyncDto> {
  const features = await loadAllPages((offset, limit) =>
    app.features.listFeatures({ offset, limit }),
  );
  const products = await loadAllPages((offset, limit) =>
    app.products.listProducts({ offset, limit, sortOrder: "asc" }),
  );
  const plans = await loadAllPages((offset, limit) =>
    app.plans.listPlans({ offset, limit }),
  );
  const cycles = await loadAllPages((offset, limit) =>
    app.billingCycles.listBillingCycles({ offset, limit }),
  );
  const currencies = await loadAllPages((offset, limit) =>
    app.credits.listCurrencies({ offset, limit }),
  );
  const config: ConfigSyncDto = {
    version: "1.0",
    features: features.map((f) => ({
      key: f.key,
      displayName: f.displayName,
      description: f.description ?? undefined,
      valueType: f.valueType as FeatureConfig["valueType"],
      defaultValue: f.defaultValue,
      groupName: f.groupName ?? undefined,
      validator: f.validator ?? undefined,
      metadata: f.metadata ?? undefined,
      archived: f.status === "archived",
      meteredConfig: f.meteredConfig ?? undefined,
    })),
    products: [],
    creditCurrencies: currencies.map((c) => ({
      key: c.key,
      displayName: c.displayName,
      metadata: c.metadata ?? undefined,
      archived: c.status === "archived",
    })),
    creditConsumptionRules: [],
  };
  for (const f of features)
    for (const rule of await app.credits.listConsumptionRules(f.key))
      config.creditConsumptionRules!.push({ featureKey: f.key, ...rule });
  for (const p of products) {
    const associated = await app.features.getFeaturesByProduct(p.key);
    const addons = await loadAllPages((offset, limit) =>
      app.addons.listAddons(p.key, { offset, limit }),
    );
    const out: ConfigSyncDto["products"][number] = {
      key: p.key,
      displayName: p.displayName,
      description: p.description ?? undefined,
      metadata: p.metadata ?? undefined,
      archived: p.status === "archived",
      features: associated.map((f) => f.key),
      featureResolution: {},
      addons: [],
      plans: [],
    };
    for (const f of associated)
      out.featureResolution![f.key] = (await app.products.getProduct(
        p.key,
      ))!.features.find(
        (association) => association.featureKey === f.key,
      )!.resolution;
    for (const a of addons)
      out.addons!.push({
        key: a.key,
        displayName: a.displayName,
        description: a.description ?? undefined,
        compositionMode: a.compositionMode,
        priority: a.priority,
        metadata: a.metadata ?? undefined,
        archived: a.status === "archived",
        featureValues: (await app.addons.getAddon(a.key))!.featureValues,
      });
    for (const plan of plans.filter((x) => x.productKey === p.key))
      out.plans!.push({
        key: plan.key,
        displayName: plan.displayName,
        description: plan.description ?? undefined,
        metadata: plan.metadata ?? undefined,
        archived: plan.status === "archived",
        onExpireTransitionToBillingCycleKey:
          plan.onExpireTransitionToBillingCycleKey ?? undefined,
        featureValues: Object.fromEntries(
          (await app.plans.getPlanFeatures(plan.key)).map((f) => [
            f.featureKey,
            f.value,
          ]),
        ),
        creditGrants: await app.credits.listPlanGrants(plan.key),
        billingCycles: cycles
          .filter((x) => x.planKey === plan.key)
          .map((c) => ({
            key: c.key,
            displayName: c.displayName,
            description: c.description ?? undefined,
            durationUnit: c.durationUnit as BillingCycleConfig["durationUnit"],
            durationValue: c.durationValue ?? undefined,
            externalProductId: c.externalProductId ?? undefined,
            archived: c.status === "archived",
          })),
      });
    config.products.push(out);
  }
  if (subscriptionKeys.length) {
    config.subscriptions = [];
    for (const key of subscriptionKeys) {
      const s = await app.subscriptions.getSubscription(key);
      if (!s) throw new Error("Subscription not found: " + key);
      config.subscriptions.push({
        key,
        featureOverrides: (s.featureOverrides ?? []).map((o) => ({
          featureKey: o.featureKey,
          value: o.value,
          type: o.type as "permanent" | "temporary" | "timed",
          expiresAt: o.expiresAt ?? null,
        })),
      });
    }
  }
  return config;
}

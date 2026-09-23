import type { Subscrio } from "../../Subscrio.js";
import type { ConfigSyncDto } from "../dtos/ConfigSyncDto.js";
import { ValidationError } from "../errors/index.js";
import { FeatureValueValidator } from "../utils/FeatureValueValidator.js";
import { FeatureValueType } from "../../domain/value-objects/FeatureValueType.js";

/** Validate all entitlement references before the first catalog write. */
export async function validateAccountingConfig(
  app: Subscrio,
  config: ConfigSyncDto,
  now = new Date(),
): Promise<void> {
  const fail = (message: string): never => {
    throw new ValidationError(message);
  };
  function unique(keys: string[], label: string) {
    if (new Set(keys).size !== keys.length) fail(`Duplicate ${label}`);
  }
  unique(
    (config.creditCurrencies ?? []).map((c) => c.key),
    "currency key",
  );
  unique(
    config.products.flatMap((p) => (p.addons ?? []).map((a) => a.key)),
    "add-on key",
  );
  unique(
    (config.subscriptions ?? []).map((s) => s.key),
    "subscription key",
  );
  const features = new Map(config.features.map((f) => [f.key, f]));
  const feature = async (key: string) =>
    features.get(key) ??
    (await app.features.getFeature(key)) ??
    fail(`Unknown feature: ${key}`);
  async function currency(key: string) {
    const c =
      config.creditCurrencies?.find((c) => c.key === key) ??
      (await app.credits.getCurrency(key));
    if (!c) fail(`Unknown currency: ${key}`);
  }
  const costs = [
    ...(config.creditConsumptionRules ?? []),
    ...config.features.flatMap((f) =>
      (f.creditConsumptionRules ?? []).map((r) => ({
        ...r,
        featureKey: f.key,
      })),
    ),
  ];
  unique(
    costs.map((c) => c.featureKey + "\0" + c.currencyKey),
    "feature/currency cost",
  );
  for (const rule of costs) {
    await currency(rule.currencyKey);
    if ((await feature(rule.featureKey)).valueType === "metered")
      fail("Metered features cannot have credit consumption rules");
  }
  for (const f of config.features) {
    if (f.valueType === "metered" && !f.meteredConfig)
      fail(`Metered config required: ${f.key}`);
    if (f.valueType !== "metered" && f.meteredConfig)
      fail(`Only metered features accept metered config: ${f.key}`);
  }
  for (const p of config.products) {
    const associated =
      p.features ??
      ((await app.products.getProduct(p.key))
        ? (await app.features.getFeaturesByProduct(p.key)).map((f) => f.key)
        : []);
    for (const key of Object.keys(p.featureResolution ?? {})) {
      if (!associated.includes(key))
        fail(`Composition feature ${key} is not associated with ${p.key}`);
      await feature(key);
    }
    for (const addon of p.addons ?? []) {
      const old = await app.addons.getAddon(addon.key);
      if (old && old.productKey !== p.key) fail("Addon product cannot change");
      for (const [key, value] of Object.entries(addon.featureValues ?? {})) {
        if (!associated.includes(key))
          fail(`Add-on feature ${key} is not associated with ${p.key}`);
        const f = await feature(key);
        if (
          !FeatureValueValidator.isValid(value, f.valueType as FeatureValueType)
        )
          fail(`Invalid add-on value: ${key}`);
      }
    }
    for (const plan of p.plans ?? []) {
      unique(
        (plan.creditGrants ?? []).map((g) => g.currencyKey),
        "plan/currency grant",
      );
      for (const grant of plan.creditGrants ?? []) {
        await currency(grant.currencyKey);
        if (
          grant.cadence === "once" &&
          grant.expiryPolicy === "grant_period_end"
        )
          fail("Once grants have no period end");
      }
    }
  }
  for (const sub of config.subscriptions ?? []) {
    const existing = await app.subscriptions.getSubscription(sub.key);
    if (!existing)
      fail(`Config sync only updates existing subscriptions: ${sub.key}`);
    unique(
      sub.featureOverrides.map((o) => o.featureKey),
      "subscription override",
    );
    const associated = (
      await app.features.getFeaturesByProduct(existing!.productKey)
    ).map((f) => f.key);
    for (const override of sub.featureOverrides) {
      if (!associated.includes(override.featureKey))
        fail("Override feature must belong to the subscription product");
      if (override.remove) continue;
      const f = await feature(override.featureKey);
      if (
        !FeatureValueValidator.isValid(
          override.value,
          f.valueType as FeatureValueType,
        )
      )
        fail("Invalid override value");
      const old = existing!.featureOverrides?.find(
        (o) => o.featureKey === override.featureKey,
      );
      const same =
        old?.type === override.type &&
        old.value === override.value &&
        (old.expiresAt ?? null) ===
          (override.expiresAt
            ? new Date(override.expiresAt).toISOString()
            : null);
      if (!same && override.expiresAt && new Date(override.expiresAt) <= now)
        fail("Changed timed override requires future expiration");
      if (override.type === "timed" && !override.expiresAt)
        fail("Timed override requires expiration");
      if (override.type !== "timed" && override.expiresAt)
        fail("Only timed overrides accept expiration");
    }
  }
}

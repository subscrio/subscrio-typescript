import { afterEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { Subscrio, ValidationError } from "../../src/index.js";
import { getTestConnectionString } from "../setup/get-connection.js";

const apps: Subscrio[] = [];
test("configuration sync creates a new metered catalog and preserves it on export and replay", async () => {
  const { app } = await setup();
  const key = "sync-" + randomUUID();
  const config = {
    version: "1.0",
    features: [{ key, displayName: key, valueType: "metered" as const, defaultValue: "0",
      meteredConfig: { resetPeriod: "monthly" as const, enforcement: "hard" as const, aggregation: "sum" as const, usageScope: "customer" as const } }],
    products: [{ key, displayName: key, features: [key], featureResolution: { [key]: { addonRule: "additive" as const } },
      addons: [{ key, displayName: key, featureValues: { [key]: "5" } }],
      plans: [{ key, displayName: key, featureValues: { [key]: "10" } }] }]
  };
  expect((await app.configSync.syncFromJson(config)).errors).toEqual([]);
  expect((await app.features.getFeature(key))?.meteredConfig?.usageScope).toBe("customer");
  expect((await app.plans.getPlan(key))?.addons[0].featureValues[key]).toBe("5");
  const replay = await app.configSync.syncFromJson(await app.configSync.exportConfig());
  expect(replay.errors).toEqual([]);
  expect(replay.details).toMatchObject({ created: 0, updated: 0, removed: 0 });
});
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function setup() {
  const app = new Subscrio({
    database: { connectionString: getTestConnectionString() },
  });
  apps.push(app);
  const id = "api-" + randomUUID(),
    p = id + "-p",
    f = id + "-f",
    plan = id + "-plan",
    c = id + "-c",
    s = id + "-s";
  await app.products.createProduct({ key: p, displayName: p });
  await app.features.createFeature({
    key: f,
    displayName: f,
    valueType: "numeric",
    defaultValue: "0",
  });
  await app.products.associateFeature(p, f);
  await app.plans.createPlan({ key: plan, productKey: p, displayName: plan });
  await app.plans.setFeatureValue(plan, f, "20");
  await app.billingCycles.createBillingCycle({
    key: plan + "-cycle",
    planKey: plan,
    displayName: "Forever",
    durationUnit: "forever",
  });
  await app.customers.createCustomer({ key: c });
  await app.subscriptions.createSubscription({
    key: s,
    customerKey: c,
    billingCycleKey: plan + "-cycle",
    activationDate: new Date("2020-01-01"),
  });
  return { app, p, f, plan, c, s, addon: id + "-addon" };
}

test("add-on definitions own atomic contribution patches and related DTOs include their values", async () => {
  const t = await setup();
  const second = t.f + "-second";
  await t.app.features.createFeature({
    key: second,
    displayName: second,
    valueType: "numeric",
    defaultValue: "0",
  });
  await t.app.products.associateFeature(t.p, second);
  const created = await t.app.addons.createAddon({
    key: t.addon,
    productKey: t.p,
    displayName: "Expansion",
    featureValues: { [t.f]: "10", [second]: "100" },
  });
  expect(created.featureValues).toEqual({ [t.f]: "10", [second]: "100" });
  await t.app.addons.updateAddon(t.addon, { displayName: "Renamed" });
  expect((await t.app.addons.getAddon(t.addon))!.featureValues).toEqual(
    created.featureValues,
  );
  await t.app.addons.updateAddon(t.addon, { featureValues: { [t.f]: "15" } });
  expect((await t.app.addons.getAddon(t.addon))!.featureValues[second]).toBe(
    "100",
  );
  await expect(
    t.app.addons.updateAddon(t.addon, {
      displayName: "Must roll back",
      featureValues: { [t.f]: "30", [second]: "invalid" },
    }),
  ).rejects.toThrow();
  expect((await t.app.addons.getAddon(t.addon))!.displayName).toBe("Renamed");
  expect((await t.app.addons.getAddon(t.addon))!.featureValues[t.f]).toBe("15");
  const attached = await t.app.subscriptions.attachAddon(t.s, t.addon, 2);
  expect(attached.addon.featureValues[t.f]).toBe("15");
  const views = [
    await t.app.products.getProduct(t.p),
    await t.app.plans.getPlan(t.plan),
    await t.app.features.getFeature(t.f),
  ];
  for (const view of views)
    expect(view!.addons[0].featureValues[t.f]).toBe("15");
  expect(
    (await t.app.subscriptions.getSubscription(t.s))!.addons[0].quantity,
  ).toBe(2);
  expect(
    (await t.app.subscriptions.listSubscriptions({ customerKey: t.c }))[0]
      .addons[0].addon.key,
  ).toBe(t.addon);
  expect((await t.app.plans.getPlansByProduct(t.p))[0].addons[0].key).toBe(
    t.addon,
  );
  expect(
    (await t.app.features.getFeaturesByProduct(t.p)).find((f) => f.key === t.f)!
      .addons[0].key,
  ).toBe(t.addon);
  await t.app.addons.updateAddon(t.addon, {
    featureValues: { [second]: null },
  });
  expect((await t.app.features.getFeature(second))!.addons).toEqual([]);
  expect((await t.app.addons.getAddon(t.addon))!.featureValues).toEqual({
    [t.f]: "15",
  });
  expect(await t.app.featureChecker.getValueForSubscription(t.s, t.f)).toBe(
    "50",
  );
});

test("invalid add-on creation rolls back the catalog definition and contributions", async () => {
  const t = await setup();
  await expect(
    t.app.addons.createAddon({
      key: t.addon,
      productKey: t.p,
      displayName: "Invalid",
      featureValues: { [t.f]: "10", missing: "5" },
    }),
  ).rejects.toThrow();
  expect(await t.app.addons.getAddon(t.addon)).toBeNull();
});

test("resolution rules are configured on associations and are returned without a legacy option", async () => {
  const t = await setup();
  await t.app.products.associateFeature(t.p, t.f, {
    addonRule: "most_generous",
    subscriptionRule: "additive",
  });
  await t.app.products.associateFeature(t.p, t.f);
  const product = await t.app.products.getProduct(t.p);
  expect(product!.features[0].resolution).toEqual({
    addonRule: "most_generous",
    subscriptionRule: "additive",
  });
  await t.app.products.associateFeature(t.p, t.f, { subscriptionRule: null });
  expect(
    (await t.app.products.getProduct(t.p))!.features[0].resolution
      .subscriptionRule,
  ).toBeUndefined();
  const other = t.f + "-other";
  await t.app.features.createFeature({
    key: other,
    displayName: other,
    valueType: "numeric",
    defaultValue: "0",
  });
  await expect(
    t.app.products.associateFeature(t.p, other, {
      subscriptionRule: "legacy",
    } as any),
  ).rejects.toThrow(ValidationError);
  expect(
    (await t.app.products.getProduct(t.p))!.features.some(
      (f) => f.featureKey === other,
    ),
  ).toBe(false);
  const explained = await t.app.featureChecker.explainForCustomer(
    t.c,
    t.p,
    t.f,
  );
  expect(explained.effectiveValue).toBe(
    await t.app.featureChecker.getValueForCustomer(t.c, t.p, t.f),
  );
  expect(JSON.stringify(explained)).not.toContain("legacy");
});

test("feature CRUD owns metering settings while getUsage reports counters without recording usage", async () => {
  const t = await setup(),
    meter = t.f + "-meter";
  const config = {
    resetPeriod: "monthly",
    enforcement: "hard",
    aggregation: "sum",
    usageScope: "customer",
  } as const;
  const feature = await t.app.features.createFeature({
    key: meter,
    displayName: meter,
    valueType: "metered",
    defaultValue: "0",
    meteredConfig: config,
  });
  expect(feature.meteredConfig).toEqual(config);
  await t.app.products.associateFeature(t.p, meter);
  await t.app.plans.setFeatureValue(t.plan, meter, "10");
  expect(
    (
      await t.app.features.updateFeature(meter, {
        meteredConfig: { ...config, enforcement: "soft" },
      })
    ).meteredConfig!.enforcement,
  ).toBe("soft");
  const report = await t.app.metering.reportUsage(t.c, t.p, meter, 3, {
    idempotencyKey: "three",
  });
  expect(report.usage.consumed).toBe(3);
  expect(
    (await t.app.metering.getUsage(t.c, t.p, meter, { requestedUsage: 8 }))
      .isOverage,
  ).toBe(true);
  expect(await t.app.metering.listUsageEvents(t.c, t.p, meter)).toHaveLength(1);
  await expect(
    t.app.features.updateFeature(meter, {
      meteredConfig: { ...config, usageScope: "subscription" },
    }),
  ).rejects.toThrow();
  expect(
    (await t.app.features.getFeature(meter))!.meteredConfig!.usageScope,
  ).toBe("customer");
  expect("setMeteredConfig" in t.app.features).toBe(false);
  expect("getEntitlement" in t.app.metering).toBe(false);
  expect("setFeatureValue" in t.app.addons).toBe(false);
  expect("attachAddon" in t.app.addons).toBe(false);
  expect("creditManagement" in t.app).toBe(false);
});

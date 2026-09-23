import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  Subscrio,
  OverrideType,
  UsageLimitExceededError,
  InsufficientCreditsError,
} from "../src/index.js";
import type { SubscrioConfig } from "../src/config/types.js";

/** Run after the original console walkthrough. Every displayed result is asserted. */
export async function runCatalogAccountingDemo(config: SubscrioConfig) {
  let now = new Date("2026-01-31T12:00:00Z");
  const app = new Subscrio({ ...config, clock: { now: () => new Date(now) } });
  const prefix = "demo-" + randomUUID().slice(0, 8);
  const p = prefix + "-studio",
    seats = prefix + "-seats",
    meter = prefix + "-requests",
    action = prefix + "-render",
    plan = prefix + "-pro",
    cycle = prefix + "-monthly",
    c = prefix + "-customer",
    s = prefix + "-subscription",
    addon = prefix + "-seat-pack",
    currency = prefix + "-credits";
  const pass = (message: string) =>
    console.log("CAPABILITIES PASS: " + message);
  console.log("\nAdd-ons, period quotas, shared credits, and timed overrides");
  await app.products.createProduct({ key: p, displayName: "Creative studio" });
  for (const [key, valueType, defaultValue] of [
    [seats, "numeric", "0"],
    [meter, "metered", "0"],
    [action, "toggle", "true"],
  ] as const) {
    await app.features.createFeature({
      key,
      displayName: key,
      valueType,
      defaultValue,
      ...(valueType === "metered"
        ? {
            meteredConfig: {
              resetPeriod: "monthly",
              usageScope: "customer",
              aggregation: "sum",
              enforcement: "hard",
            } as const,
          }
        : {}),
    });
    await app.products.associateFeature(p, key, {
      subscriptionRule: "most_generous",
    });
  }
  await app.addons.createAddon({
    key: addon,
    productKey: p,
    displayName: "Three extra seats",
    featureValues: { [seats]: "3" },
  });
  await app.plans.createPlan({ key: plan, productKey: p, displayName: "Pro" });
  await app.plans.setFeatureValue(plan, seats, "5");
  await app.plans.setFeatureValue(plan, meter, "10");
  await app.billingCycles.createBillingCycle({
    key: cycle,
    planKey: plan,
    displayName: "Monthly",
    durationUnit: "months",
    durationValue: 1,
  });
  await app.customers.createCustomer({ key: c });
  await app.subscriptions.createSubscription({
    key: s,
    customerKey: c,
    billingCycleKey: cycle,
    activationDate: now,
    currentPeriodStart: now,
    currentPeriodEnd: new Date("2026-02-28T12:00:00Z"),
  });

  await app.subscriptions.attachAddon(s, addon, 2);
  assert.equal(
    await app.featureChecker.getValueForSubscription(s, seats),
    "11",
  );
  assert.equal(
    (await app.features.getFeature(seats))!.addons[0].featureValues[seats],
    "3",
  );
  assert.equal((await app.plans.getPlan(plan))!.addons[0].key, addon);
  assert.equal(
    (await app.subscriptions.getSubscription(s))!.addons[0].quantity,
    2,
  );
  pass("Nested feature, plan and subscription DTOs include add-ons");
  pass("Add-on quantity 2: 5 base seats + 2 × 3 = 11");
  await app.subscriptions.createSubscription({
    key: s + "-second",
    customerKey: c,
    billingCycleKey: cycle,
    activationDate: now,
  });
  assert.equal(await app.featureChecker.getValueForCustomer(c, p, seats), "11");
  await app.products.associateFeature(p, seats, {
    addonRule: "additive",
    subscriptionRule: "additive",
  });
  assert.equal(await app.featureChecker.getValueForCustomer(c, p, seats), "16");
  pass("Across subscriptions: most-generous 11; explicit additive 16");
  await app.subscriptions.addFeatureOverride(
    s,
    seats,
    "20",
    OverrideType.Timed,
    "2026-02-01T00:00:00Z",
  );
  assert.equal(
    await app.featureChecker.getValueForSubscription(s, seats),
    "20",
  );
  const explanation = await app.featureChecker.explainForSubscription(s, seats);
  assert.ok(
    explanation.subscriptions[0].sources.some(
      (source) => source.kind === "override" && source.applied,
    ),
  );
  now = new Date("2026-02-01T00:00:00Z");
  assert.equal(
    await app.featureChecker.getValueForSubscription(s, seats),
    "11",
  );
  assert.equal(
    (await app.subscriptions.getSubscription(s))?.featureOverrides?.[0]
      .isActive,
    false,
  );
  pass(
    "Timed override: 20 before expiry; 11 exactly at expiry, retained in administration",
  );

  const request = { idempotencyKey: prefix + "-usage" };
  const usage = await app.metering.reportUsage(c, p, meter, 7, request);
  assert.equal(usage.usage.remaining, 3);
  assert.deepEqual(
    await app.metering.reportUsage(c, p, meter, 7, request),
    usage,
  );
  await assert.rejects(
    app.metering.reportUsage(c, p, meter, 4, {
      idempotencyKey: prefix + "-hard",
    }),
    UsageLimitExceededError,
  );
  pass("Hard quota: 7 used, 3 remaining; replay unchanged; 4 more rejected");
  await app.features.updateFeature(meter, {
    meteredConfig: {
      resetPeriod: "monthly",
      usageScope: "customer",
      aggregation: "sum",
      enforcement: "soft",
    },
  });
  assert.equal(
    (
      await app.metering.reportUsage(c, p, meter, 4, {
        idempotencyKey: prefix + "-soft",
      })
    ).usage.isOverage,
    true,
  );
  now = new Date("2026-03-01T00:00:00Z");
  assert.equal((await app.metering.getUsage(c, p, meter)).consumed, 0);
  assert.deepEqual(
    await app.metering.reportUsage(c, p, meter, 7, request),
    usage,
  );
  pass(
    "Soft quota records 11 used; March resets to 0; February replay keeps its original result",
  );

  await app.credits.createCurrency({
    key: currency,
    displayName: "Render credits",
  });
  await app.credits.setConsumptionRule(action, currency, 3);
  const promo = await app.credits.grant({
    customerKey: c,
    currencyKey: currency,
    amount: 10,
    grantType: "promotional",
    priority: 0,
    expiresAt: "2026-03-02T00:00:00Z",
    idempotencyKey: prefix + "-promo",
  });
  await app.credits.grant({
    customerKey: c,
    currencyKey: currency,
    amount: 20,
    grantType: "prepaid",
    priority: 1,
    idempotencyKey: prefix + "-paid",
  });
  const spend = {
    customerKey: c,
    featureKey: action,
    units: 4,
    idempotencyKey: prefix + "-spend",
  };
  const burn = await app.credits.consume(spend);
  assert.equal(burn.allocations[0].grantId, promo.id);
  assert.equal(burn.allocations[0].amount, 10);
  assert.equal(burn.balances[0].available, 18);
  assert.deepEqual(await app.credits.consume(spend), burn);
  await assert.rejects(
    app.credits.consume({
      ...spend,
      units: 7,
      idempotencyKey: prefix + "-too-much",
    }),
    InsufficientCreditsError,
  );
  pass(
    "Credits: 4 renders × 3 = 12; promotion burns before prepaid; 18 remain; retries do not spend twice",
  );
  await app.credits.grant({
    customerKey: c,
    currencyKey: currency,
    amount: 5,
    grantType: "promotional",
    expiresAt: "2026-03-02T00:00:00Z",
    idempotencyKey: prefix + "-expiry",
  });
  now = new Date("2026-03-02T00:00:00Z");
  assert.equal((await app.credits.getBalance(c, currency)).available, 18);
  pass("Credit expiry removes the unused promotion and posts a ledger debit");
  await app.credits.setPlanGrant(plan, currency, {
    amount: 10,
    cadence: "monthly",
    cancellationPolicy: "expire",
  });
  const scheduled = await app.credits.issueDuePlanGrants({
    subscriptionKey: s,
  });
  assert.equal(scheduled.issued.length, 2);
  assert.equal(scheduled.nextDueAt, "2026-03-31T12:00:00.000Z");
  await app.subscriptions.updateSubscription(s, { cancellationDate: now });
  await app.subscriptions.updateSubscription(s + "-second", {
    cancellationDate: now,
  });
  const balance = await app.credits.getBalance(c, currency);
  assert.equal(balance.available, 18);
  const ledger = await app.credits.listLedgerEntries(c, currency, {
    limit: 500,
  });
  assert.equal(
    ledger.reduce((sum, row) => sum + row.amount, 0),
    18,
  );
  assert.ok(ledger.some((row) => row.reason === "cancellation"));
  pass(
    "Monthly grants anchor Jan 31 → Feb 28 → Mar 31; cancellation expires only subscription grants; prepaid 18 remains",
  );
  assert.equal((await app.metering.listUsageEvents(c, p, meter)).length, 2);
  pass(
    "Ledger total equals wallet balance; rejected operations created no usage events",
  );
  console.log("CAPABILITIES DEMO VERIFIED");
}

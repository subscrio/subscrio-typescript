import { describe, test, expect } from "vitest";
import {
  Subscrio,
  OverrideType,
  UsageLimitExceededError,
  InsufficientCreditsError,
  IdempotencyConflictError,
} from "../../src/index.js";
import { getTestConnectionString } from "../setup/get-connection.js";
import { getDatabase } from "../../src/infrastructure/database/drizzle.js";
import { sql } from "drizzle-orm";
import {
  calendarPeriod,
  anchoredMonth,
} from "../../src/domain/services/AccountingArithmetic.js";

let sequence = 0;
async function fixture(
  type: "numeric" | "metered" = "metered",
  options: Record<string, string> = {},
) {
  const prefix = `ent-${++sequence}`;
  let at = new Date("2026-01-31T12:00:00Z");
  const app = new Subscrio({
    database: { connectionString: getTestConnectionString() },
    clock: { now: () => new Date(at) },
  });
  const p = `${prefix}-product`,
    f = `${prefix}-feature`,
    plan = `${prefix}-plan`,
    cycle = `${prefix}-cycle`,
    c = `${prefix}-customer`,
    s = `${prefix}-subscription`;
  await app.products.createProduct({ key: p, displayName: p });
  await app.features.createFeature({
    key: f,
    displayName: f,
    valueType: type,
    defaultValue: "0",
    ...(type === "metered"
      ? {
          meteredConfig: {
            resetPeriod: "monthly",
            enforcement: "hard",
            aggregation: "sum",
            usageScope: "customer",
            ...options,
          } as any,
        }
      : {}),
  });
  await app.products.associateFeature(p, f);
  await app.plans.createPlan({ key: plan, productKey: p, displayName: plan });
  await app.plans.setFeatureValue(plan, f, "10");
  await app.billingCycles.createBillingCycle({
    key: cycle,
    planKey: plan,
    displayName: cycle,
    durationUnit: "months",
    durationValue: 1,
  });
  await app.customers.createCustomer({ key: c });
  await app.subscriptions.createSubscription({
    key: s,
    customerKey: c,
    planKey: plan,
    billingCycleKey: cycle,
    activationDate: "2026-01-31T12:00:00Z",
    currentPeriodStart: "2026-01-31T12:00:00Z",
    currentPeriodEnd: "2026-02-28T12:00:00Z",
  });
  return {
    app,
    p,
    f,
    plan,
    cycle,
    c,
    s,
    prefix,
    setTime: (value: string) => {
      at = new Date(value);
    },
  };
}
describe("Entitlements against PostgreSQL", () => {
  test("migrations are repeatable and install all accounting tables", async () => {
    const t = await fixture();
    expect(await t.app.verifySchema()).toBe("1.4.0");
    expect(await t.app.migrate()).toBe(0);
    const tables = await getDatabase().execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema='subscrio'`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        "addons",
        "usage_events",
        "credit_grants",
        "credit_ledger_entries",
        "subscription_credit_grant_states",
      ]),
    );
  });
  test("additive quantity, replacement priority, override and expiry share the public getter", async () => {
    const t = await fixture("numeric"),
      a = t.prefix + "-addon";
    await t.app.addons.createAddon({ key: a, productKey: t.p, displayName: a });
    await t.app.addons.updateAddon(a, { featureValues: { [t.f]: "3" } });
    await t.app.subscriptions.attachAddon(t.s, a, 2);
    expect(await t.app.featureChecker.getValueForSubscription(t.s, t.f)).toBe(
      "16",
    );
    await t.app.subscriptions.attachAddon(t.s, a, 3);
    expect(await t.app.featureChecker.getValueForCustomer(t.c, t.p, t.f)).toBe(
      "19",
    );
    await t.app.subscriptions.addFeatureOverride(
      t.s,
      t.f,
      "7",
      OverrideType.Timed,
      "2026-02-01T00:00:00Z",
    );
    expect(await t.app.featureChecker.getValueForCustomer(t.c, t.p, t.f)).toBe(
      "7",
    );
    await t.app.subscriptions.clearTemporaryOverrides(t.s);
    expect(
      (await t.app.subscriptions.getSubscription(t.s))?.featureOverrides?.[0]
        .expiresAt,
    ).toBe("2026-02-01T00:00:00.000Z");
    t.setTime("2026-02-01T00:00:00Z");
    expect(await t.app.featureChecker.getValueForCustomer(t.c, t.p, t.f)).toBe(
      "19",
    );
    expect(
      (
        await t.app.featureChecker.explainForSubscription(t.s, t.f)
      ).subscriptions[0].sources.some((x) => x.reason === "Expired"),
    ).toBe(true);
    await t.app.addons.archiveAddon(a);
    expect(await t.app.featureChecker.getValueForSubscription(t.s, t.f)).toBe(
      "19",
    );
    await expect(t.app.subscriptions.attachAddon(t.s, a)).rejects.toThrow();
    await t.app.subscriptions.detachAddon(t.s, a);
    expect(await t.app.featureChecker.getValueForSubscription(t.s, t.f)).toBe(
      "10",
    );
    await expect(t.app.addons.deleteAddon(a)).rejects.toThrow("history");
  });
  test("replacement addons are deterministic and require quantity one", async () => {
    const t = await fixture("numeric");
    for (const [suffix, priority, value] of [
      ["b", 5, "40"],
      ["a", 1, "20"],
    ] as const) {
      const k = t.prefix + suffix;
      await t.app.addons.createAddon({
        key: k,
        productKey: t.p,
        displayName: k,
        compositionMode: "override",
        priority,
      });
      await t.app.addons.updateAddon(k, { featureValues: { [t.f]: value } });
      await t.app.subscriptions.attachAddon(t.s, k);
      await expect(t.app.subscriptions.attachAddon(t.s, k, 2)).rejects.toThrow(
        "quantity one",
      );
    }
    expect(await t.app.featureChecker.getValueForSubscription(t.s, t.f)).toBe(
      "20",
    );
  });
  test("cross subscription max defaults and explicit additive are distinct", async () => {
    const t = await fixture("numeric");
    await t.app.subscriptions.createSubscription({
      key: t.s + "-2",
      customerKey: t.c,
      planKey: t.plan,
      billingCycleKey: t.cycle,
      activationDate: "2026-01-01T00:00:00Z",
    });
    expect(await t.app.featureChecker.getValueForCustomer(t.c, t.p, t.f)).toBe(
      "10",
    );
    await t.app.products.associateFeature(t.p, t.f, {
      addonRule: "additive",
      subscriptionRule: "additive",
    });
    expect(await t.app.featureChecker.getValueForCustomer(t.c, t.p, t.f)).toBe(
      "20",
    );
  });
  test("timed expiry validation rejects ambiguous and nonfuture times", async () => {
    const t = await fixture();
    for (const expiry of [
      undefined,
      "2026-01-31T12:00:00Z",
      "2027-01-01T00:00:00",
      "bad",
    ])
      await expect(
        t.app.subscriptions.addFeatureOverride(
          t.s,
          t.f,
          "1",
          OverrideType.Timed,
          expiry,
        ),
      ).rejects.toThrow();
    await expect(
      t.app.subscriptions.addFeatureOverride(
        t.s,
        t.f,
        "1",
        OverrideType.Permanent,
        "2027-01-01T00:00:00Z",
      ),
    ).rejects.toThrow("Only timed");
  });
  test("hard usage is atomic under contention; rejected requests do not claim keys", async () => {
    const t = await fixture();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        t.app.metering.reportUsage(t.c, t.p, t.f, 1, {
          idempotencyKey: "request-" + i,
        }),
      ),
    );
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(10);
    expect((await t.app.metering.getUsage(t.c, t.p, t.f)).consumed).toBe(10);
    expect(await t.app.metering.listUsageEvents(t.c, t.p, t.f)).toHaveLength(
      10,
    );
    await expect(
      t.app.metering.reportUsage(t.c, t.p, t.f, 1, {
        idempotencyKey: "retry-rejected",
      }),
    ).rejects.toBeInstanceOf(UsageLimitExceededError);
    await t.app.plans.setFeatureValue(t.plan, t.f, "12");
    expect(
      (
        await t.app.metering.reportUsage(t.c, t.p, t.f, 1, {
          idempotencyKey: "retry-rejected",
        })
      ).usage.consumed,
    ).toBe(11);
  });
  test("identical usage retries return original snapshot across resets; conflicts fail", async () => {
    const t = await fixture();
    const options = { idempotencyKey: "same", metadata: { source: "test" } };
    const result = await t.app.metering.reportUsage(t.c, t.p, t.f, 3, options);
    const replays = await Promise.all(
      Array.from({ length: 8 }, () =>
        t.app.metering.reportUsage(t.c, t.p, t.f, 3, options),
      ),
    );
    for (const replay of replays) expect(replay).toEqual(result);
    t.setTime("2026-02-01T00:00:00Z");
    expect((await t.app.metering.getUsage(t.c, t.p, t.f)).consumed).toBe(0);
    expect(await t.app.metering.reportUsage(t.c, t.p, t.f, 3, options)).toEqual(
      result,
    );
    await expect(
      t.app.metering.reportUsage(t.c, t.p, t.f, 4, options),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
  test("soft limit records overage and live plan changes preserve consumption", async () => {
    const t = await fixture("metered", { enforcement: "soft" });
    expect(
      (
        await t.app.metering.reportUsage(t.c, t.p, t.f, 15, {
          idempotencyKey: "over",
        })
      ).usage.isOverage,
    ).toBe(true);
    await t.app.plans.setFeatureValue(t.plan, t.f, "20");
    expect(await t.app.metering.getUsage(t.c, t.p, t.f)).toMatchObject({
      limit: 20,
      consumed: 15,
      remaining: 5,
    });
    await expect(
      t.app.features.updateFeature(t.f, {
        meteredConfig: {
          resetPeriod: "daily",
          usageScope: "customer",
          aggregation: "sum",
          enforcement: "hard",
        },
      }),
    ).rejects.toThrow("cannot change");
  });
  test("count aggregation and fixed scope reject bypasses", async () => {
    const t = await fixture("metered", { aggregation: "count" });
    await expect(
      t.app.metering.reportUsage(t.c, t.p, t.f, 2, { idempotencyKey: "count" }),
    ).rejects.toThrow("quantity one");
    await expect(
      t.app.metering.getUsage(t.c, t.p, t.f, { subscriptionKey: t.s }),
    ).rejects.toThrow("must not");
    for (const n of [-1, 0, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      await expect(
        t.app.metering.reportUsage(t.c, t.p, t.f, n, {
          idempotencyKey: "invalid",
        }),
      ).rejects.toThrow();
  });
  test("billing period scope rejects stale boundaries and foreign subscriptions", async () => {
    const t = await fixture("metered", {
      usageScope: "subscription",
      resetPeriod: "billing_period",
    });
    await expect(t.app.metering.getUsage(t.c, t.p, t.f)).rejects.toThrow(
      "required",
    );
    expect(
      (
        await t.app.metering.getUsage(t.c, t.p, t.f, {
          subscriptionKey: t.s,
        })
      ).periodEnd,
    ).toBe("2026-02-28T12:00:00.000Z");
    t.setTime("2026-02-28T12:00:00Z");
    await expect(
      t.app.metering.getUsage(t.c, t.p, t.f, { subscriptionKey: t.s }),
    ).rejects.toThrow("stale");
  });
  test("credits burn priority then expiry; concurrent spending cannot overdraw", async () => {
    const t = await fixture("numeric"),
      cu = t.prefix + "-credits";
    await t.app.credits.createCurrency({ key: cu, displayName: cu });
    await t.app.credits.setConsumptionRule(t.f, cu, 3);
    const g = await t.app.credits.grant({
      customerKey: t.c,
      currencyKey: cu,
      amount: 10,
      grantType: "promotional",
      priority: 0,
      expiresAt: "2026-02-01T00:00:00Z",
      idempotencyKey: "promo",
    });
    await t.app.credits.grant({
      customerKey: t.c,
      currencyKey: cu,
      amount: 20,
      grantType: "prepaid",
      priority: 1,
      idempotencyKey: "paid",
    });
    const r = await t.app.credits.consume({
      customerKey: t.c,
      featureKey: t.f,
      units: 4,
      idempotencyKey: "first",
    });
    expect(r.allocations).toEqual([
      { currencyKey: cu, grantId: g.id, amount: 10 },
      expect.objectContaining({ amount: 2 }),
    ]);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        t.app.credits.consume({
          customerKey: t.c,
          featureKey: t.f,
          units: 1,
          idempotencyKey: "burn-" + i,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(6);
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(0);
    const ledger = await t.app.credits.listLedgerEntries(t.c, cu);
    expect(ledger.reduce((n, e) => n + e.amount, 0)).toBe(0);
    expect(
      await t.app.credits.consume({
        customerKey: t.c,
        featureKey: t.f,
        units: 4,
        idempotencyKey: "first",
      }),
    ).toEqual(r);
  });
  test("multi-currency spending rolls back every wallet on failure", async () => {
    const t = await fixture("numeric");
    for (const [cu, amount] of [
      [t.prefix + "a", 10],
      [t.prefix + "b", 2],
    ] as const) {
      await t.app.credits.createCurrency({ key: cu, displayName: cu });
      await t.app.credits.setConsumptionRule(t.f, cu, 3);
      await t.app.credits.grant({
        customerKey: t.c,
        currencyKey: cu,
        amount,
        grantType: "manual",
        idempotencyKey: cu,
      });
    }
    await expect(
      t.app.credits.consume({
        customerKey: t.c,
        featureKey: t.f,
        units: 1,
        idempotencyKey: "multi",
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(
      (await t.app.credits.getBalance(t.c, t.prefix + "a")).available,
    ).toBe(10);
    expect(await t.app.credits.getOperation(t.c, "multi")).toBeNull();
  });
  test("expiry posts a single ledger debit and does not spend expired grants", async () => {
    const t = await fixture(),
      cu = t.prefix + "credit";
    await t.app.credits.createCurrency({ key: cu, displayName: cu });
    const input = {
      customerKey: t.c,
      currencyKey: cu,
      amount: 10,
      grantType: "manual" as const,
      expiresAt: "2026-02-01T00:00:00Z",
      idempotencyKey: "grant",
    };
    const first = await t.app.credits.grant(input);
    t.setTime("2026-02-01T00:00:00Z");
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(0);
    expect(await t.app.credits.grant(input)).toEqual(first);
    await t.app.credits.getBalance(t.c, cu);
    expect(
      (await t.app.credits.listLedgerEntries(t.c, cu)).filter(
        (x) => x.reason === "expiry",
      ),
    ).toHaveLength(1);
  });
  test("monthly grants clamp from original anchor and catch up without duplicates", async () => {
    const t = await fixture(),
      cu = t.prefix + "credit";
    await t.app.credits.createCurrency({ key: cu, displayName: cu });
    await t.app.credits.setPlanGrant(t.plan, cu, {
      amount: 10,
      cadence: "monthly",
      expiryPolicy: "grant_period_end",
    });
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(10);
    t.setTime("2026-03-31T12:00:00Z");
    await Promise.all(
      Array.from({ length: 4 }, () =>
        t.app.credits.processScheduledGrants(t.c),
      ),
    );
    const grants = await t.app.credits.listGrants(t.c, cu);
    expect(grants).toHaveLength(3);
    expect(grants.map((g) => g.expiresAt)).toEqual([
      "2026-04-30T12:00:00.000Z",
      "2026-03-31T12:00:00.000Z",
      "2026-02-28T12:00:00.000Z",
    ]);
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(10);
  });
  test("once grants are not repeated and adjustments preserve the ledger", async () => {
    const t = await fixture(),
      cu = t.prefix + "credit";
    await t.app.credits.createCurrency({ key: cu, displayName: cu });
    await t.app.credits.setPlanGrant(t.plan, cu, {
      amount: 10,
      cadence: "once",
    });
    await t.app.credits.processScheduledGrants(t.c);
    t.setTime("2026-12-01T00:00:00Z");
    await t.app.credits.processScheduledGrants(t.c);
    expect(await t.app.credits.listGrants(t.c, cu)).toHaveLength(1);
    await t.app.credits.adjust({
      customerKey: t.c,
      currencyKey: cu,
      amount: -3,
      reason: "correction",
      idempotencyKey: "adjust",
    });
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(7);
    expect(
      (await t.app.credits.listLedgerEntries(t.c, cu)).reduce(
        (n, e) => n + e.amount,
        0,
      ),
    ).toBe(7);
  });
  test("history prevents deletion of customers and subscriptions", async () => {
    const t = await fixture("metered", { usageScope: "subscription" });
    await t.app.metering.reportUsage(t.c, t.p, t.f, 1, {
      idempotencyKey: "history",
      subscriptionKey: t.s,
    });
    await expect(t.app.subscriptions.deleteSubscription(t.s)).rejects.toThrow();
  });
});
describe("Accounting lifecycle and hook guarantees", () => {
  test("metered features cannot also charge credits", async () => {
    const t = await fixture(),
      cu = t.prefix + "credit";
    await t.app.credits.createCurrency({ key: cu, displayName: cu });
    await expect(t.app.credits.setConsumptionRule(t.f, cu, 1)).rejects.toThrow(
      "Metered",
    );
  });
  test("before-hook veto rolls back usage and permits an identical retry", async () => {
    const t = await fixture();
    const off = t.app.hooks.on("usage.reported.before", () => {
      throw new Error("veto");
    });
    await expect(
      t.app.metering.reportUsage(t.c, t.p, t.f, 2, { idempotencyKey: "veto" }),
    ).rejects.toThrow("veto");
    expect(await t.app.metering.listUsageEvents(t.c, t.p, t.f)).toHaveLength(0);
    off();
    expect(
      (
        await t.app.metering.reportUsage(t.c, t.p, t.f, 2, {
          idempotencyKey: "veto",
        })
      ).usage.consumed,
    ).toBe(2);
  });
  test("after-hook failure identifies the committed result and replay does not emit again", async () => {
    const t = await fixture();
    let calls = 0;
    t.app.hooks.on("usage.reported.after", () => {
      calls++;
      throw new Error("delivery failed");
    });
    await expect(
      t.app.metering.reportUsage(t.c, t.p, t.f, 2, { idempotencyKey: "after" }),
    ).rejects.toMatchObject({
      name: "CommittedOperationHookError",
      result: { quantity: 2 },
    });
    expect(
      (
        await t.app.metering.reportUsage(t.c, t.p, t.f, 2, {
          idempotencyKey: "after",
        })
      ).quantity,
    ).toBe(2);
    expect(calls).toBe(1);
  });
  test("hooks cannot change identity or replace amounts with unsafe values", async () => {
    const t = await fixture();
    let off = t.app.hooks.on("usage.reported.before", (event) => {
      event.input.customerKey = "another";
    });
    await expect(
      t.app.metering.reportUsage(t.c, t.p, t.f, 1, {
        idempotencyKey: "identity",
      }),
    ).rejects.toThrow("cannot change");
    off();
    off = t.app.hooks.on("usage.reported.before", (event) => {
      event.input.quantity = -1;
    });
    await expect(
      t.app.metering.reportUsage(t.c, t.p, t.f, 1, {
        idempotencyKey: "identity",
      }),
    ).rejects.toThrow();
    expect(await t.app.metering.listUsageEvents(t.c, t.p, t.f)).toHaveLength(0);
    off();
  });
  test("catalog edits settle old windows before applying the new amount", async () => {
    const t = await fixture(),
      cu = t.prefix + "credit";
    await t.app.credits.createCurrency({ key: cu, displayName: cu });
    await t.app.credits.setPlanGrant(t.plan, cu, {
      amount: 10,
      cadence: "monthly",
    });
    t.setTime("2026-03-31T12:00:00Z");
    await t.app.credits.setPlanGrant(t.plan, cu, {
      amount: 20,
      cadence: "monthly",
    });
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(30);
    t.setTime("2026-04-30T12:00:00Z");
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(50);
  });
  test("backdated cancellation settles only earlier periods", async () => {
    const t = await fixture(),
      cu = t.prefix + "credit";
    await t.app.credits.createCurrency({ key: cu, displayName: cu });
    await t.app.credits.setPlanGrant(t.plan, cu, {
      amount: 10,
      cadence: "monthly",
    });
    t.setTime("2026-04-30T12:00:00Z");
    await t.app.subscriptions.updateSubscription(t.s, {
      cancellationDate: "2026-03-01T00:00:00Z",
    });
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(20);
  });
  test("archived periods are not granted when a subscription resumes", async () => {
    const t = await fixture(),
      cu = t.prefix + "credit";
    await t.app.credits.createCurrency({ key: cu, displayName: cu });
    await t.app.credits.setPlanGrant(t.plan, cu, {
      amount: 10,
      cadence: "monthly",
    });
    await t.app.subscriptions.archiveSubscription(t.s);
    t.setTime("2026-04-01T00:00:00Z");
    await t.app.subscriptions.unarchiveSubscription(t.s);
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(10);
    t.setTime("2026-04-30T12:00:00Z");
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(20);
  });
  test("billing-period renewal settles old and new grants in one lifecycle transaction", async () => {
    const t = await fixture(),
      cu = t.prefix + "credit";
    await t.app.credits.createCurrency({ key: cu, displayName: cu });
    await t.app.credits.setPlanGrant(t.plan, cu, {
      amount: 10,
      cadence: "billing_period",
    });
    let committed = 0;
    t.app.hooks.on("credit.granted.after", async (event) => {
      if (event.input.grantType === "recurring") {
        expect(
          await t.app.credits.getOperation(
            t.c,
            event.input.idempotencyKey as string,
          ),
        ).not.toBeNull();
        committed++;
      }
    });
    t.setTime("2026-02-28T12:00:00Z");
    await t.app.subscriptions.updateSubscription(t.s, {
      currentPeriodStart: "2026-02-28T12:00:00Z",
      currentPeriodEnd: "2026-03-31T12:00:00Z",
    });
    expect(committed).toBe(2);
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(20);
  });
  test("scheduler veto rolls back the enclosing subscription change", async () => {
    const t = await fixture(),
      cu = t.prefix + "credit";
    await t.app.credits.createCurrency({ key: cu, displayName: cu });
    await t.app.credits.setPlanGrant(t.plan, cu, {
      amount: 10,
      cadence: "monthly",
    });
    const off = t.app.hooks.on("credit.granted.before", () => {
      throw new Error("grant veto");
    });
    await expect(
      t.app.subscriptions.updateSubscription(t.s, {
        metadata: { changed: true },
      }),
    ).rejects.toThrow("grant veto");
    expect(
      (await t.app.subscriptions.getSubscription(t.s))?.metadata?.changed,
    ).toBeUndefined();
    expect(await t.app.credits.listGrants(t.c, cu)).toHaveLength(0);
    off();
    await t.app.subscriptions.updateSubscription(t.s, {
      metadata: { changed: true },
    });
    expect(await t.app.credits.listGrants(t.c, cu)).toHaveLength(1);
  });
});
describe("UTC entitlement periods", () => {
  test.each([
    ["hourly", "2026-03-08T07:00:00.000Z", "2026-03-08T08:00:00.000Z"],
    ["daily", "2026-03-08T00:00:00.000Z", "2026-03-09T00:00:00.000Z"],
    ["weekly", "2026-03-02T00:00:00.000Z", "2026-03-09T00:00:00.000Z"],
    ["monthly", "2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z"],
    ["yearly", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
  ])("%s is UTC and half-open", (period, start, end) => {
    expect(
      calendarPeriod(new Date("2026-03-08T07:23:11Z"), period as any).map((d) =>
        d.toISOString(),
      ),
    ).toEqual([start, end]);
  });
  test("leap-day annual anchor returns to leap day", () => {
    const anchor = new Date("2024-02-29T12:00:00Z");
    expect(anchoredMonth(anchor, 12).toISOString()).toBe(
      "2025-02-28T12:00:00.000Z",
    );
    expect(anchoredMonth(anchor, 48).toISOString()).toBe(
      "2028-02-29T12:00:00.000Z",
    );
  });
});

describe("Entitlement configuration round trips", () => {
  test("sync exports all settings, counts no-ops, and removes only named overrides", async () => {
    const t = await fixture("numeric");
    const cu = t.prefix + "sync-credit",
      addon = t.prefix + "sync-addon";
    const config = {
      version: "1.0",
      features: [
        {
          key: t.f,
          displayName: t.f,
          valueType: "numeric" as const,
          defaultValue: "0",
        },
      ],
      creditCurrencies: [{ key: cu, displayName: cu }],
      creditConsumptionRules: [
        { featureKey: t.f, currencyKey: cu, creditsPerUnit: 2 },
      ],
      products: [
        {
          key: t.p,
          displayName: t.p,
          features: [t.f],
          addons: [
            { key: addon, displayName: addon, featureValues: { [t.f]: "3" } },
          ],
          plans: [
            {
              key: t.plan,
              displayName: t.plan,
              creditGrants: [
                { currencyKey: cu, amount: 10, cadence: "once" as const },
              ],
            },
          ],
        },
      ],
      subscriptions: [
        {
          key: t.s,
          featureOverrides: [
            {
              featureKey: t.f,
              value: "8",
              type: "timed" as const,
              expiresAt: "2026-02-01T00:00:00Z",
            },
          ],
        },
      ],
    };
    const first = await t.app.configSync.syncFromJson(config);
    expect(first.errors).toEqual([]);
    expect(first.details!.created).toBeGreaterThanOrEqual(5);
    t.setTime("2026-02-02T00:00:00Z");
    const again = await t.app.configSync.syncFromJson(config);
    expect(again.errors).toEqual([]);
    expect(again.details).toMatchObject({
      created: 0,
      updated: 0,
      removed: 0,
    });
    const exported = await t.app.configSync.exportConfig([t.s]);
    expect(exported.creditCurrencies).toContainEqual(
      expect.objectContaining({ key: cu }),
    );
    expect(
      exported.products.find((p) => p.key === t.p)?.addons?.[0].featureValues,
    ).toEqual({ [t.f]: "3" });
    const roundTrip = await t.app.configSync.syncFromJson(exported);
    expect(roundTrip.errors).toEqual([]);
    expect(roundTrip.details).toMatchObject({
      created: 0,
      updated: 0,
      removed: 0,
    });
    const removal = {
      version: "1.0",
      features: [],
      products: [],
      subscriptions: [
        {
          key: t.s,
          featureOverrides: [{ featureKey: t.f, remove: true as const }],
        },
      ],
    };
    expect(
      (await t.app.configSync.syncFromJson(removal)).details!.removed,
    ).toBe(1);
    expect((await t.app.configSync.syncFromJson(removal)).errors).toEqual([]);
  });
  test("invalid future expiry and invalid removal reject before any catalog write", async () => {
    const t = await fixture("numeric");
    const currency = {
      key: t.prefix + "bad-credit",
      displayName: "Must not be created",
    };
    for (const override of [
      {
        featureKey: t.f,
        type: "timed",
        value: "2",
        expiresAt: "2026-01-01T00:00:00Z",
      },
      { featureKey: t.f, remove: true, type: "timed", value: "2" },
    ]) {
      await expect(
        t.app.configSync.syncFromJson({
          version: "1.0",
          features: [],
          products: [],
          creditCurrencies: [currency],
          subscriptions: [{ key: t.s, featureOverrides: [override] }],
        } as any),
      ).rejects.toThrow();
      expect(await t.app.credits.getCurrency(currency.key)).toBeNull();
    }
  });
});

describe("Integrated entitlement boundaries", () => {
  test("add-ons and timed meter overrides change limits without resetting consumption", async () => {
    const t = await fixture(),
      a = t.prefix + "pack";
    await t.app.addons.createAddon({ key: a, productKey: t.p, displayName: a });
    await t.app.addons.updateAddon(a, { featureValues: { [t.f]: "3" } });
    await t.app.subscriptions.attachAddon(t.s, a, 2);
    await t.app.metering.reportUsage(t.c, t.p, t.f, 12, {
      idempotencyKey: "before",
    });
    await t.app.subscriptions.addFeatureOverride(
      t.s,
      t.f,
      "20",
      OverrideType.Timed,
      "2026-01-31T13:00:00Z",
    );
    await t.app.metering.reportUsage(t.c, t.p, t.f, 5, {
      idempotencyKey: "during",
    });
    t.setTime("2026-01-31T13:00:00Z");
    expect(await t.app.metering.getUsage(t.c, t.p, t.f)).toMatchObject({
      limit: 16,
      consumed: 17,
      remaining: 0,
      hasAccess: false,
    });
    expect(
      (await t.app.featureChecker.getAllFeaturesForCustomer(t.c, t.p)).get(t.f),
    ).toBe("16");
    expect(
      (
        await t.app.featureChecker.getFeatureUsageSummary(t.c, t.p)
      ).meteredFeatures.get(t.f),
    ).toBe(16);
  });
  test("trials delay recurring grants and preserve the eligible-start anchor", async () => {
    const t = await fixture(),
      cu = t.prefix + "trial-credit";
    await t.app.subscriptions.updateSubscription(t.s, {
      trialStartDate: "2026-01-31T12:00:00Z",
      trialEndDate: "2026-02-05T12:00:00Z",
    });
    await t.app.credits.createCurrency({ key: cu, displayName: cu });
    await t.app.credits.setPlanGrant(t.plan, cu, {
      amount: 10,
      cadence: "monthly",
    });
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(0);
    t.setTime("2026-02-05T12:00:00Z");
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(10);
    t.setTime("2026-03-05T12:00:00Z");
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(20);
  });
  test("rules added during archival do not backfill archived calendar periods", async () => {
    const t = await fixture(),
      cu = t.prefix + "archive-credit";
    await t.app.subscriptions.archiveSubscription(t.s);
    await t.app.credits.createCurrency({ key: cu, displayName: cu });
    await t.app.credits.setPlanGrant(t.plan, cu, {
      amount: 10,
      cadence: "monthly",
    });
    t.setTime("2026-04-01T00:00:00Z");
    await t.app.subscriptions.unarchiveSubscription(t.s);
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(0);
    t.setTime("2026-04-30T12:00:00Z");
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(10);
  });
  test("a usage insert failure rolls back the already changed balance", async () => {
    const t = await fixture();
    await t.app.metering.reportUsage(t.c, t.p, t.f, 2, {
      idempotencyKey: "seed",
    });
    const db = getDatabase();
    await db.execute(
      sql.raw(
        "CREATE FUNCTION subscrio.fail_usage_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.idempotency_key = 'injected-failure' THEN RAISE EXCEPTION 'injected usage failure'; END IF; RETURN NEW; END $$",
      ),
    );
    await db.execute(
      sql.raw(
        "CREATE TRIGGER fail_usage_test BEFORE INSERT ON subscrio.usage_events FOR EACH ROW EXECUTE FUNCTION subscrio.fail_usage_test()",
      ),
    );
    try {
      await expect(
        t.app.metering.reportUsage(t.c, t.p, t.f, 3, {
          idempotencyKey: "injected-failure",
        }),
      ).rejects.toThrow();
      expect((await t.app.metering.getUsage(t.c, t.p, t.f)).consumed).toBe(2);
      expect(await t.app.metering.listUsageEvents(t.c, t.p, t.f)).toHaveLength(
        1,
      );
    } finally {
      await db.execute(
        sql.raw("DROP TRIGGER fail_usage_test ON subscrio.usage_events"),
      );
      await db.execute(sql.raw("DROP FUNCTION subscrio.fail_usage_test()"));
    }
    expect(
      (
        await t.app.metering.reportUsage(t.c, t.p, t.f, 3, {
          idempotencyKey: "injected-failure",
        })
      ).usage.consumed,
    ).toBe(5);
  });
  test("ledger insert failure rolls back grant remainders and the operation key", async () => {
    const t = await fixture("numeric"),
      cu = t.prefix + "fault-credit";
    await t.app.credits.createCurrency({ key: cu, displayName: cu });
    await t.app.credits.setConsumptionRule(t.f, cu, 2);
    await t.app.credits.grant({
      customerKey: t.c,
      currencyKey: cu,
      amount: 10,
      grantType: "manual",
      idempotencyKey: "fund",
    });
    const db = getDatabase();
    await db.execute(
      sql.raw(
        "CREATE FUNCTION subscrio.fail_ledger_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason = 'consumption' THEN RAISE EXCEPTION 'injected ledger failure'; END IF; RETURN NEW; END $$",
      ),
    );
    await db.execute(
      sql.raw(
        "CREATE TRIGGER fail_ledger_test BEFORE INSERT ON subscrio.credit_ledger_entries FOR EACH ROW EXECUTE FUNCTION subscrio.fail_ledger_test()",
      ),
    );
    try {
      await expect(
        t.app.credits.consume({
          customerKey: t.c,
          featureKey: t.f,
          units: 3,
          idempotencyKey: "fault",
        }),
      ).rejects.toThrow();
      expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(10);
      expect(await t.app.credits.getOperation(t.c, "fault")).toBeNull();
      expect(await t.app.credits.listLedgerEntries(t.c, cu)).toHaveLength(1);
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER fail_ledger_test ON subscrio.credit_ledger_entries",
        ),
      );
      await db.execute(sql.raw("DROP FUNCTION subscrio.fail_ledger_test()"));
    }
    expect(
      (
        await t.app.credits.consume({
          customerKey: t.c,
          featureKey: t.f,
          units: 3,
          idempotencyKey: "fault",
        })
      ).balances[0].available,
    ).toBe(4);
  });
  test("catch-up bound fails atomically instead of issuing a partial history", async () => {
    const t = await fixture(),
      cu = t.prefix + "bound";
    await t.app.credits.createCurrency({ key: cu, displayName: cu });
    await t.app.credits.setPlanGrant(t.plan, cu, {
      amount: 1,
      cadence: "monthly",
    });
    t.setTime("2047-01-31T12:00:00Z");
    await expect(t.app.credits.processScheduledGrants(t.c)).rejects.toThrow(
      "240",
    );
    expect(await t.app.credits.listGrants(t.c, cu)).toHaveLength(0);
    t.setTime("2026-02-28T12:00:00Z");
    expect((await t.app.credits.getBalance(t.c, cu)).available).toBe(2);
  });
});
test("converting a numeric feature to text preserves an exportable composition policy", async () => {
  const t = await fixture("numeric");
  await t.app.products.associateFeature(t.p, t.f, {
    addonRule: "additive",
    subscriptionRule: undefined,
  });
  await t.app.features.updateFeature(t.f, {
    valueType: "text",
    defaultValue: "standard",
  });
  expect(
    (await t.app.products.getProduct(t.p))!.features.find(
      (f) => f.featureKey === t.f,
    )!.resolution,
  ).toEqual({
    addonRule: "override_wins",
    subscriptionRule: undefined,
  });
  const exported = await t.app.configSync.exportConfig();
  expect((await t.app.configSync.syncFromJson(exported)).errors).toEqual([]);
  await t.app.close();
});

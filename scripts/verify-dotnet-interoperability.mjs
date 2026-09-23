import { Subscrio } from "../dist/index.js";
import { Client } from "pg";
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
const core = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
config({ path: path.join(core, "typescript/.env"), quiet: true });
const base = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
base.pathname = "/postgres";
const admin = new Client({ connectionString: base.toString() });
await admin.connect();
const name = "subscrio_interop_" + randomBytes(6).toString("hex");
assert.match(name, /^subscrio_interop_[a-f0-9]{12}$/);
await admin.query('CREATE DATABASE "' + name + '"');
const target = new URL(base);
target.pathname = "/" + name;
const app = new Subscrio({
  database: { connectionString: target.toString() },
  clock: { now: () => new Date("2026-01-31T12:00:00Z") },
});
const metadata = {
  emoji: "🧪",
  unicode: "café",
  fraction: 0.0000001,
  nested: { b: 2, a: null },
  units: [1, true],
};
try {
  await app.installSchema();
  await app.products.createProduct({ key: "studio", displayName: "Studio" });
  await app.features.createFeature({
    key: "requests",
    displayName: "Requests",
    valueType: "metered",
    defaultValue: "0",
    meteredConfig: {
      resetPeriod: "monthly",
      usageScope: "customer",
      aggregation: "sum",
      enforcement: "hard",
    },
  });
  await app.features.createFeature({
    key: "render",
    displayName: "Render",
    valueType: "toggle",
    defaultValue: "true",
  });
  for (const f of ["requests", "render"])
    await app.products.associateFeature("studio", f);
  await app.plans.createPlan({
    key: "pro",
    productKey: "studio",
    displayName: "Pro",
  });
  await app.plans.setFeatureValue("pro", "requests", "100");
  await app.billingCycles.createBillingCycle({
    key: "monthly",
    planKey: "pro",
    displayName: "Monthly",
    durationUnit: "months",
    durationValue: 1,
  });
  await app.customers.createCustomer({ key: "acme" });
  await app.subscriptions.createSubscription({
    key: "acme-pro",
    customerKey: "acme",
    billingCycleKey: "monthly",
    activationDate: "2026-01-01T00:00:00Z",
  });
  await app.credits.createCurrency({ key: "credits", displayName: "Credits" });
  await app.credits.setConsumptionRule("render", "credits", 2);
  await app.metering.reportUsage("acme", "studio", "requests", 2, {
    idempotencyKey: "interop-ts",
    metadata,
  });
  await app.credits.grant({
    customerKey: "acme",
    currencyKey: "credits",
    amount: 100,
    grantType: "manual",
    idempotencyKey: "grant-ts",
    metadata,
  });
  await app.credits.consume({
    customerKey: "acme",
    featureKey: "render",
    units: 3,
    idempotencyKey: "spend-ts",
    metadata,
  });
  await app.credits.adjust({
    customerKey: "acme",
    currencyKey: "credits",
    amount: -1,
    reason: "correction",
    idempotencyKey: "adjust-ts",
  });
  const quote = (s) => "'" + s.replaceAll("'", "''") + "'";
  const result = spawnSync(
    "dotnet",
    [
      "run",
      "--no-restore",
      "--project",
      path.join(
        core,
        "dotnet/tools/InteropVerification/InteropVerification.csproj",
      ),
    ],
    {
      env: {
        ...process.env,
        SUBSCRIO_INTEROP_CONNECTION: `Host=${target.hostname};Port=${target.port || 5432};Database=${name};Username=${quote(decodeURIComponent(target.username))};Password=${quote(decodeURIComponent(target.password))}`,
      },
      encoding: "utf8",
      timeout: 120000,
    },
  );
  assert.equal(result.status, 0, (result.stdout || "") + (result.stderr || ""));
  assert.equal(
    (
      await app.metering.reportUsage("acme", "studio", "requests", 3, {
        idempotencyKey: "interop-net",
        metadata,
      })
    ).usage.consumed,
    5,
  );
  await app.credits.grant({
    customerKey: "acme",
    currencyKey: "credits",
    amount: 50,
    grantType: "prepaid",
    idempotencyKey: "grant-net",
    metadata,
  });
  assert.equal(
    (
      await app.credits.consume({
        customerKey: "acme",
        featureKey: "render",
        units: 2,
        idempotencyKey: "spend-net",
        metadata,
      })
    ).balances[0].available,
    139,
  );
  await app.credits.adjust({
    customerKey: "acme",
    currencyKey: "credits",
    amount: 3,
    reason: "correction",
    idempotencyKey: "adjust-net",
  });
  assert.equal(
    (await app.credits.getBalance("acme", "credits")).available,
    142,
  );
  assert.equal(
    (await app.metering.listUsageEvents("acme", "studio", "requests")).length,
    2,
  );
  assert.equal(
    (await app.credits.listLedgerEntries("acme", "credits")).reduce(
      (sum, e) => sum + e.amount,
      0,
    ),
    142,
  );
  console.log(
    "CROSS-LANGUAGE VERIFIED: bidirectional usage, grant, consumption and adjustment retries with Unicode and numeric metadata",
  );
} finally {
  await app.close();
  await admin.query('DROP DATABASE "' + name + '" WITH (FORCE)');
  await admin.end();
}

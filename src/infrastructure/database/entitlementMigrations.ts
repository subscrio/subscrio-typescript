import type { DatabaseDialect } from "./dialect.js";

const amount = (name: string, positive = false) =>
  `${name} BIGINT NOT NULL CHECK (${name} BETWEEN ${positive ? 1 : 0} AND 9007199254740991)`;
const timestamps =
  "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()";
const ref = (name: string, table: string, nullable = false) =>
  `${name} BIGINT ${nullable ? "" : "NOT NULL"} REFERENCES subscrio.${table}(id)`;
const table = (name: string, body: string) =>
  `CREATE TABLE IF NOT EXISTS subscrio.${name} (id BIGSERIAL PRIMARY KEY, ${body})`;

export const ENTITLEMENT_TABLES = [
  "credit_ledger_entries",
  "credit_grants",
  "credit_operations",
  "credit_wallets",
  "subscription_credit_grant_states",
  "credit_consumption_rules",
  "plan_credit_grants",
  "credit_currencies",
  "usage_events",
  "usage_balances",
  "metered_feature_config",
  "subscription_addons",
  "addon_features",
  "addons",
];

export const ENTITLEMENT_MIGRATIONS: Record<string, string[]> = {
  "1.2.0": [
    `ALTER TABLE subscrio.product_features ADD COLUMN IF NOT EXISTS composition_rule TEXT NOT NULL DEFAULT 'override_wins' CHECK (composition_rule IN ('additive','most_generous','override_wins'))`,
    `ALTER TABLE subscrio.product_features ADD COLUMN IF NOT EXISTS cross_subscription_rule TEXT NOT NULL DEFAULT 'legacy' CHECK (cross_subscription_rule IN ('legacy','additive','most_generous','override_wins'))`,
    `ALTER TABLE subscrio.subscription_feature_overrides ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
    `ALTER TABLE subscrio.product_features ADD CONSTRAINT composition_rule_valid CHECK (composition_rule IN ('additive','most_generous','override_wins'))`,
    `ALTER TABLE subscrio.product_features ADD CONSTRAINT cross_subscription_rule_valid CHECK (cross_subscription_rule IN ('legacy','additive','most_generous','override_wins'))`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='override_expiry_valid' AND conrelid='subscrio.subscription_feature_overrides'::regclass) THEN ALTER TABLE subscrio.subscription_feature_overrides ADD CONSTRAINT override_expiry_valid CHECK ((override_type='timed' AND expires_at IS NOT NULL) OR (override_type IN ('permanent','temporary') AND expires_at IS NULL)); END IF; END $$`,
    table(
      "addons",
      `${ref("product_id", "products")}, key TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')), composition_mode TEXT NOT NULL DEFAULT 'additive' CHECK(composition_mode IN ('additive','override')), priority INTEGER NOT NULL DEFAULT 0, metadata JSONB, ${timestamps}`,
    ),
    table(
      "addon_features",
      `${ref("addon_id", "addons")}, ${ref("feature_id", "features")}, value TEXT NOT NULL, ${timestamps}, UNIQUE(addon_id,feature_id)`,
    ),
    table(
      "subscription_addons",
      `${ref("subscription_id", "subscriptions")}, ${ref("addon_id", "addons")}, quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity>0), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')), ${timestamps}, UNIQUE(subscription_id,addon_id)`,
    ),
    "CREATE INDEX IF NOT EXISTS addons_product_status ON subscrio.addons(product_id,status)",
    "CREATE INDEX IF NOT EXISTS subscription_addons_status ON subscrio.subscription_addons(subscription_id,status)",
  ],
  "1.3.0": [
    table(
      "metered_feature_config",
      `${ref("feature_id", "features")} UNIQUE, reset_period TEXT NOT NULL CHECK(reset_period IN ('hourly','daily','weekly','monthly','yearly','billing_period')), enforcement TEXT NOT NULL CHECK(enforcement IN ('hard','soft')), aggregation TEXT NOT NULL CHECK(aggregation IN ('count','sum')), scope TEXT NOT NULL CHECK(scope IN ('customer','subscription')), ${timestamps}, CHECK(reset_period!='billing_period' OR scope='subscription')`,
    ),
    table(
      "usage_balances",
      `${ref("customer_id", "customers")}, ${ref("product_id", "products")}, ${ref("feature_id", "features")}, ${ref("subscription_id", "subscriptions", true)}, period_start TIMESTAMPTZ NOT NULL, period_end TIMESTAMPTZ NOT NULL, ${amount("consumed")}, ${amount("limit_value")}, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK(period_end>period_start)`,
    ),
    "CREATE UNIQUE INDEX IF NOT EXISTS usage_customer_period ON subscrio.usage_balances(customer_id,product_id,feature_id,period_start) WHERE subscription_id IS NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS usage_subscription_period ON subscrio.usage_balances(customer_id,product_id,feature_id,subscription_id,period_start) WHERE subscription_id IS NOT NULL",
    table(
      "usage_events",
      `idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, ${ref("usage_balance_id", "usage_balances")}, ${ref("customer_id", "customers")}, ${ref("product_id", "products")}, ${ref("feature_id", "features")}, ${ref("subscription_id", "subscriptions", true)}, ${amount("quantity", true)}, recorded_at TIMESTAMPTZ NOT NULL, metadata JSONB, result_snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(customer_id,idempotency_key)`,
    ),
    "CREATE INDEX IF NOT EXISTS usage_events_history ON subscrio.usage_events(customer_id,product_id,feature_id,recorded_at,id)",
    "CREATE INDEX IF NOT EXISTS usage_events_balance ON subscrio.usage_events(usage_balance_id)",
  ],
  "1.4.0": [
    table(
      "credit_currencies",
      `key TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')), metadata JSONB, ${timestamps}`,
    ),
    table(
      "plan_credit_grants",
      `${ref("plan_id", "plans")}, ${ref("credit_currency_id", "credit_currencies")}, ${amount("amount", true)}, cadence TEXT NOT NULL CHECK(cadence IN ('once','monthly','yearly','billing_period')), expiry_policy TEXT NOT NULL CHECK(expiry_policy IN ('none','grant_period_end')), cancellation_policy TEXT NOT NULL CHECK(cancellation_policy IN ('retain','expire')), is_active BOOLEAN NOT NULL DEFAULT TRUE, ${timestamps}, UNIQUE(plan_id,credit_currency_id)`,
    ),
    table(
      "subscription_credit_grant_states",
      `${ref("subscription_id", "subscriptions")}, ${ref("credit_currency_id", "credit_currencies")}, anchor_at TIMESTAMPTZ NOT NULL, next_due_at TIMESTAMPTZ, once_issued_at TIMESTAMPTZ, rule_snapshot JSONB NOT NULL, ${timestamps}, UNIQUE(subscription_id,credit_currency_id)`,
    ),
    "CREATE INDEX IF NOT EXISTS credit_grant_schedule_due ON subscrio.subscription_credit_grant_states(next_due_at)",
    table(
      "credit_wallets",
      `${ref("customer_id", "customers")}, ${ref("credit_currency_id", "credit_currencies")}, ${timestamps}, UNIQUE(customer_id,credit_currency_id)`,
    ),
    table(
      "credit_operations",
      `${ref("customer_id", "customers")}, idempotency_key TEXT NOT NULL, operation_type TEXT NOT NULL, request_hash TEXT NOT NULL, result_snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(customer_id,idempotency_key)`,
    ),
    table(
      "credit_grants",
      `${ref("wallet_id", "credit_wallets")}, ${ref("subscription_id", "subscriptions", true)}, ${ref("plan_credit_grant_id", "plan_credit_grants", true)}, source_key TEXT UNIQUE, grant_type TEXT NOT NULL CHECK(grant_type IN ('recurring','prepaid','promotional','manual')), ${amount("original_amount", true)}, ${amount("remaining_amount")}, priority INTEGER NOT NULL DEFAULT 0, expires_at TIMESTAMPTZ, grant_period_start TIMESTAMPTZ, grant_period_end TIMESTAMPTZ, cancellation_policy TEXT NOT NULL DEFAULT 'retain' CHECK(cancellation_policy IN ('retain','expire')), ${timestamps}, CHECK(remaining_amount<=original_amount)`,
    ),
    "CREATE INDEX IF NOT EXISTS credit_grants_burn_order ON subscrio.credit_grants(wallet_id,priority,expires_at,id)",
    table(
      "credit_ledger_entries",
      `${ref("operation_id", "credit_operations")}, ${ref("wallet_id", "credit_wallets")}, ${ref("credit_grant_id", "credit_grants")}, amount BIGINT NOT NULL CHECK(amount BETWEEN -9007199254740991 AND 9007199254740991 AND amount<>0), reason TEXT NOT NULL CHECK(reason IN ('grant','consumption','expiry','adjustment','cancellation')), ${ref("feature_id", "features", true)}, ${ref("product_id", "products", true)}, metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(operation_id,credit_grant_id,reason)`,
    ),
    "CREATE INDEX IF NOT EXISTS credit_ledger_history ON subscrio.credit_ledger_entries(wallet_id,created_at,id)",
    table(
      "credit_consumption_rules",
      `${ref("feature_id", "features")}, ${ref("credit_currency_id", "credit_currencies")}, ${amount("credits_per_unit", true)}, ${timestamps}, UNIQUE(feature_id,credit_currency_id)`,
    ),
  ],
};

/** Provider DDL shares the same logical tables, checks and index identities. */
export function entitlementMigrationSql(
  version: string,
  dialect: DatabaseDialect,
): string[] {
  const statements = ENTITLEMENT_MIGRATIONS[version];
  if (dialect === "postgres") return statements;
  return statements
    .map((statement) => {
      if (statement.startsWith("DO $$"))
        return `IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='override_expiry_valid') ALTER TABLE subscrio.subscription_feature_overrides ADD CONSTRAINT override_expiry_valid CHECK ((override_type='timed' AND expires_at IS NOT NULL) OR (override_type IN ('permanent','temporary') AND expires_at IS NULL))`;
      let s = statement
        .replace(/BIGSERIAL/g, "BIGINT IDENTITY(1,1)")
        .replace(/TIMESTAMPTZ/g, "DATETIMEOFFSET")
        .replace(/JSONB/g, "NVARCHAR(MAX)")
        .replace(/\bTEXT\b/g, "NVARCHAR(255)")
        .replace(/\bBOOLEAN\b/g, "BIT")
        .replace(/\bTRUE\b/g, "1")
        .replace(/NOW\(\)/g, "SYSUTCDATETIME()")
        .replace(/\bkey\b/g, "[key]");
      const create = s.match(/^CREATE TABLE IF NOT EXISTS (subscrio\.\w+)/);
      s = s.replace(
        /\b(value|description) NVARCHAR\(255\)/g,
        "$1 NVARCHAR(MAX)",
      );
      if (create)
        s =
          `IF OBJECT_ID(N'${create[1]}',N'U') IS NULL ` +
          s.replace(" IF NOT EXISTS", "");
      const alter = s.match(
        /^ALTER TABLE (subscrio\.\w+) ADD COLUMN IF NOT EXISTS (\w+)/,
      );
      if (alter)
        s =
          `IF COL_LENGTH('${alter[1]}','${alter[2]}') IS NULL ` +
          s.replace("ADD COLUMN IF NOT EXISTS", "ADD");
      const index = s.match(
        /^CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+) ON (subscrio\.\w+)/,
      );
      if (index)
        s =
          `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='${index[2]}' AND object_id=OBJECT_ID('${index[3]}')) ` +
          s.replace(" IF NOT EXISTS", "");
      // SQL Server treats NULL as a value in UNIQUE constraints; source keys are optional.
      if (create?.[1] === "subscrio.credit_grants")
        s = s.replace(
          "source_key NVARCHAR(255) UNIQUE",
          "source_key NVARCHAR(255)",
        );
      return s;
    })
    .concat(
      version === "1.4.0"
        ? [
            "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='credit_grants_source_key') CREATE UNIQUE INDEX credit_grants_source_key ON subscrio.credit_grants(source_key) WHERE source_key IS NOT NULL",
          ]
        : [],
    );
}

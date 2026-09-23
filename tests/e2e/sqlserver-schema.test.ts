import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  entitlementMigrationSql,
  ENTITLEMENT_TABLES,
} from "../../src/infrastructure/database/entitlementMigrations.js";
import { describe, expect, test } from "vitest";
import {
  INSTALL_TABLES_SQLSERVER,
  createSchemaSql,
  dropTableSql,
  dropViewSql,
  subscriptionStatusViewSql,
} from "../../src/infrastructure/database/dialect.js";

const SQLCMD =
  process.env.SQLCMD_PATH ||
  "C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC\\170\\Tools\\Binn\\SQLCMD.EXE";
const SERVER = process.env.SQLSERVER_TEST_SERVER || "localhost";
const DB_NAME = "subscrio_ts_schema_" + randomUUID().replaceAll("-", "");
const sqlServerIsConfigured = Boolean(
  process.env.SQLCMD_PATH || process.env.SQLSERVER_TEST_SERVER,
);

function runSql(database: string, query: string): string {
  try {
    return execFileSync(
      SQLCMD,
      ["-S", SERVER, "-E", "-d", database, "-b", "-I", "-Q", query],
      { encoding: "utf8", windowsHide: true },
    );
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      `sqlcmd failed on ${database}: ${err.stderr || ""} ${err.stdout || ""} ${err.message || ""}`,
    );
  }
}

describe("SQL Server schema smoke", () => {
  const sqlServerTest = sqlServerIsConfigured ? test : test.skip;

  sqlServerTest(
    "installs and drops Subscrio schema on a live SQL Server instance",
    () => {
      expect(existsSync(SQLCMD), `sqlcmd not found at ${SQLCMD}`).toBe(true);

      runSql("master", `CREATE DATABASE [${DB_NAME}];`);

      try {
        runSql(DB_NAME, createSchemaSql("sqlserver"));
        for (const statement of INSTALL_TABLES_SQLSERVER) {
          runSql(DB_NAME, statement);
        }
        for (const version of ["1.2.0", "1.3.0", "1.4.0"]) {
          for (const statement of entitlementMigrationSql(version, "sqlserver"))
            runSql(DB_NAME, statement);
        }
        runSql(DB_NAME, dropViewSql("sqlserver"));
        runSql(DB_NAME, subscriptionStatusViewSql("sqlserver"));

        const tables = runSql(
          DB_NAME,
          `SELECT COUNT(*) AS table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'subscrio' AND TABLE_TYPE = 'BASE TABLE';`,
        );
        expect(tables).toMatch(/24/);

        const view = runSql(
          DB_NAME,
          `SELECT COUNT(*) AS view_count FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = 'subscrio' AND TABLE_NAME = 'subscription_status_view';`,
        );
        expect(view).toMatch(/1/);

        runSql(DB_NAME, dropViewSql("sqlserver"));
        const dropOrder = [
          ...ENTITLEMENT_TABLES,
          "subscription_feature_overrides",
          "subscriptions",
          "plan_features",
          "product_features",
          "billing_cycles",
          "plans",
          "features",
          "products",
          "customers",
          "system_config",
        ];
        for (const table of dropOrder) {
          runSql(DB_NAME, dropTableSql("sqlserver", table));
        }
      } finally {
        runSql(
          "master",
          `IF DB_ID('${DB_NAME}') IS NOT NULL BEGIN ALTER DATABASE [${DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DB_NAME}]; END;`,
        );
      }
    },
    120_000,
  );
});

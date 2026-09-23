import { test, expect } from "vitest";
import { Pool, Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import { SchemaInstaller } from "../../src/infrastructure/database/installer.js";
import { INSTALL_TABLES_POSTGRES } from "../../src/infrastructure/database/dialect.js";
import type { DrizzleDb } from "../../src/infrastructure/database/drizzle.js";

async function legacy(
  work: (pool: Pool, installer: SchemaInstaller) => Promise<void>,
) {
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/postgres",
  );
  url.pathname = "/postgres";
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  const name = "subscrio_migration_verify_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = "/" + name;
  const pool = new Pool({ connectionString: url.toString() });
  let closing = false;
  const unexpected: string[] = [];
  pool.on("error", (error) => {
    if (!(closing && (error as { code?: string }).code === "57P01"))
      unexpected.push(error.message);
  });
  try {
    // These base installation statements are unchanged from the pre-entitlement 1.1 schema.
    await pool.query("CREATE SCHEMA subscrio");
    for (const statement of INSTALL_TABLES_POSTGRES)
      await pool.query(statement);
    await pool.query(
      "INSERT INTO subscrio.system_config(config_key,config_value,encrypted) VALUES('schema_version','1.1.0',false)",
    );
    await pool.query(
      "INSERT INTO subscrio.products(key,display_name,status) VALUES('legacy-product','Legacy','active'); INSERT INTO subscrio.features(key,display_name,value_type,default_value,status) VALUES('legacy-limit','Limit','numeric','3','active'); INSERT INTO subscrio.product_features(product_id,feature_id) SELECT p.id,f.id FROM subscrio.products p CROSS JOIN subscrio.features f",
    );
    await work(
      pool,
      new SchemaInstaller(drizzle(pool) as unknown as DrizzleDb),
    );
  } finally {
    closing = true;
    await pool.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
  expect(unexpected).toEqual([]);
}
test("populated 1.1 upgrades preserve catalog and legacy policies under concurrent migrations", async () =>
  legacy(async (pool, installer) => {
    const other = new SchemaInstaller(drizzle(pool) as unknown as DrizzleDb);
    const applied = await Promise.all([installer.migrate(), other.migrate()]);
    expect(applied.sort()).toEqual([0, 3]);
    expect(await installer.verify()).toBe("1.4.0");
    expect(
      (
        await pool.query(
          "SELECT composition_rule,cross_subscription_rule FROM subscrio.product_features",
        )
      ).rows,
    ).toEqual([
      { composition_rule: "override_wins", cross_subscription_rule: "legacy" },
    ]);
    expect(
      (
        await pool.query(
          "SELECT default_value FROM subscrio.features WHERE key='legacy-limit'",
        )
      ).rows[0].default_value,
    ).toBe("3");
    await expect(
      pool.query(
        "UPDATE subscrio.product_features SET composition_rule='invalid'",
      ),
    ).rejects.toThrow();
  }));
test("migration DDL and version roll back together on an actual database failure", async () =>
  legacy(async (pool, installer) => {
    await pool.query(
      "CREATE TABLE subscrio.credit_grants(id BIGSERIAL PRIMARY KEY)",
    );
    await expect(installer.migrate()).rejects.toThrow();
    expect(await installer.verify()).toBe("1.1.0");
    expect(
      (await pool.query("SELECT to_regclass('subscrio.addons') value")).rows[0]
        .value,
    ).toBeNull();
    expect(
      (
        await pool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='subscrio' AND table_name='product_features' AND column_name='composition_rule'",
        )
      ).rowCount,
    ).toBe(0);
    await pool.query("DROP TABLE subscrio.credit_grants");
    expect(await installer.migrate()).toBe(3);
  }));
test("install refuses a newer version before changing tables or configuration", async () =>
  legacy(async (pool, installer) => {
    await pool.query(
      "UPDATE subscrio.system_config SET config_value='99.0.0' WHERE config_key='schema_version'",
    );
    await expect(installer.install("should-not-be-written")).rejects.toThrow(
      "newer",
    );
    expect(
      (
        await pool.query(
          "SELECT config_key FROM subscrio.system_config WHERE config_key='admin_passphrase_hash'",
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (await pool.query("SELECT to_regclass('subscrio.addons') value")).rows[0]
        .value,
    ).toBeNull();
  }));

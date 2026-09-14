import { DrizzleDb } from './drizzle.js';
import { system_config } from './schema.js';
import { sql } from 'drizzle-orm';
import { now } from '../utils/date.js';
import bcrypt from 'bcryptjs';
import { ValidationError } from '../../application/errors/index.js';
import {
  type DatabaseDialect,
  createSchemaSql,
  dropViewSql,
  dropTableSql,
  subscriptionStatusViewSql,
  INSTALL_TABLES_POSTGRES,
  INSTALL_TABLES_SQLSERVER,
  isTransientDbError,
  isSchemaMissingError,
} from './dialect.js';

export class SchemaInstaller {
  readonly CURRENT_SCHEMA_VERSION = '1.1.0';

  constructor(
    private readonly db: DrizzleDb,
    private readonly dialect: DatabaseDialect = 'postgres'
  ) {}

  async install(adminPassphrase?: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.createTables();
        await this.setupInitialConfig(adminPassphrase);
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 2 || !isTransientDbError(error)) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  private async createTables(): Promise<void> {
    await this.db.execute(sql.raw(createSchemaSql(this.dialect)));

    const tables = this.dialect === 'sqlserver' ? INSTALL_TABLES_SQLSERVER : INSTALL_TABLES_POSTGRES;
    for (const statement of tables) {
      await this.db.execute(sql.raw(statement));
    }

    if (this.dialect === 'postgres') {
      await this.ensurePostgresColumns();
    }

    await this.refreshSubscriptionStatusView();
  }

  private async ensurePostgresColumns(): Promise<void> {
    await this.db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'subscrio' AND table_name = 'plans' AND column_name = 'on_expire_transition_to_billing_cycle_id'
        ) THEN
          ALTER TABLE subscrio.plans ADD COLUMN on_expire_transition_to_billing_cycle_id BIGINT;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'plans_on_expire_transition_to_billing_cycle_id_fkey'
        ) THEN
          ALTER TABLE subscrio.plans ADD CONSTRAINT plans_on_expire_transition_to_billing_cycle_id_fkey
            FOREIGN KEY (on_expire_transition_to_billing_cycle_id)
            REFERENCES subscrio.billing_cycles(id);
        END IF;
      END $$;
    `);

    await this.db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'subscrio' AND table_name = 'billing_cycles' AND column_name = 'status'
        ) THEN
          ALTER TABLE subscrio.billing_cycles ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
        END IF;
      END $$;
    `);

    await this.db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'subscrio' AND table_name = 'subscriptions' AND column_name = 'is_archived'
        ) THEN
          ALTER TABLE subscrio.subscriptions ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'subscrio' AND table_name = 'subscriptions' AND column_name = 'transitioned_at'
        ) THEN
          ALTER TABLE subscrio.subscriptions ADD COLUMN transitioned_at TIMESTAMPTZ;
        END IF;
      END $$;
    `);

    await this.db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS plans_key_global_unique ON subscrio.plans (key);
    `);
    await this.db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS billing_cycles_key_global_unique ON subscrio.billing_cycles (key);
    `);
  }

  async refreshSubscriptionStatusView(): Promise<void> {
    await this.db.execute(sql.raw(dropViewSql(this.dialect)));
    await this.db.execute(sql.raw(subscriptionStatusViewSql(this.dialect)));
  }

  async verify(): Promise<string | null> {
    try {
      return await this.getCurrentSchemaVersion();
    } catch (error) {
      if (isSchemaMissingError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async setupInitialConfig(adminPassphrase?: string): Promise<void> {
    const existing = await this.db
      .select()
      .from(system_config)
      .where(sql`${system_config.config_key} = 'admin_passphrase_hash'`)
      .limit(1);

    if (existing.length === 0 && adminPassphrase) {
      const hash = await bcrypt.hash(adminPassphrase, 10);
      await this.db.insert(system_config).values({
        config_key: 'admin_passphrase_hash',
        config_value: hash,
        encrypted: false,
        created_at: now(),
        updated_at: now()
      });
    }

    const versionCheck = await this.db
      .select()
      .from(system_config)
      .where(sql`${system_config.config_key} = 'schema_version'`)
      .limit(1);

    if (versionCheck.length === 0) {
      await this.db.insert(system_config).values({
        config_key: 'schema_version',
        config_value: this.CURRENT_SCHEMA_VERSION,
        encrypted: false,
        created_at: now(),
        updated_at: now()
      });
    }
  }

  async getCurrentSchemaVersion(): Promise<string | null> {
    try {
      const [record] = await this.db
        .select()
        .from(system_config)
        .where(sql`${system_config.config_key} = 'schema_version'`)
        .limit(1);

      return record?.config_value ?? null;
    } catch (error) {
      if (isSchemaMissingError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async updateSchemaVersion(version: string): Promise<void> {
    const existing = await this.db
      .select()
      .from(system_config)
      .where(sql`${system_config.config_key} = 'schema_version'`)
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(system_config)
        .set({
          config_value: version,
          updated_at: now()
        })
        .where(sql`${system_config.config_key} = 'schema_version'`);
    } else {
      await this.db.insert(system_config).values({
        config_key: 'schema_version',
        config_value: version,
        encrypted: false,
        created_at: now(),
        updated_at: now()
      });
    }
  }

  async migrate(): Promise<number> {
    const previousVersion = await this.verify();
    let migrationsApplied = 0;

    if (!previousVersion || this.compareVersions(previousVersion, '1.1.0') < 0) {
      await this.migrateTo_1_1_0();
      await this.updateSchemaVersion('1.1.0');
      migrationsApplied++;
    }

    await this.refreshSubscriptionStatusView();
    await this.updateSchemaVersion(this.CURRENT_SCHEMA_VERSION);

    if (migrationsApplied === 0 && previousVersion !== this.CURRENT_SCHEMA_VERSION) {
      return 1;
    }
    return migrationsApplied;
  }

  private async migrateTo_1_1_0(): Promise<void> {
    if (this.dialect === 'postgres') {
      await this.db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'subscrio' AND table_name = 'subscriptions' AND column_name = 'transitioned_at'
          ) THEN
            ALTER TABLE subscrio.subscriptions ADD COLUMN transitioned_at TIMESTAMPTZ;
          END IF;
        END $$;
      `);
      await this.db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS plans_key_global_unique ON subscrio.plans (key);
      `);
    } else {
      await this.db.execute(sql.raw(`
        IF COL_LENGTH('subscrio.subscriptions', 'transitioned_at') IS NULL
          ALTER TABLE subscrio.subscriptions ADD transitioned_at DATETIMEOFFSET NULL;
      `));
    }
  }

  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;
      if (part1 < part2) return -1;
      if (part1 > part2) return 1;
    }
    return 0;
  }

  async dropAll(adminPassphrase?: string): Promise<void> {
    await this.verifyAdminPassphrase(adminPassphrase);

    await this.db.execute(sql.raw(dropViewSql(this.dialect)));

    const tablesToDrop = [
      'subscription_feature_overrides',
      'subscriptions',
      'plan_features',
      'product_features',
      'billing_cycles',
      'plans',
      'features',
      'products',
      'customers',
      'system_config'
    ];

    for (const table of tablesToDrop) {
      await this.db.execute(sql.raw(dropTableSql(this.dialect, table)));
    }
  }

  private async verifyAdminPassphrase(adminPassphrase?: string): Promise<void> {
    let existingHash: { config_value: string } | undefined;
    try {
      const [record] = await this.db
        .select()
        .from(system_config)
        .where(sql`${system_config.config_key} = 'admin_passphrase_hash'`)
        .limit(1);
      existingHash = record;
    } catch (error) {
      if (isSchemaMissingError(error)) {
        return;
      }
      throw error;
    }

    if (!existingHash?.config_value) {
      return;
    }

    if (!adminPassphrase || !(await bcrypt.compare(adminPassphrase, existingHash.config_value))) {
      throw new ValidationError(
        'Admin passphrase is required and must match the configured passphrase to drop the schema.'
      );
    }
  }
}

import { DrizzleDb } from './drizzle.js';
import { 
  system_config 
} from './schema.js';
import { sql } from 'drizzle-orm';
import { now } from '../utils/date.js';
import bcrypt from 'bcryptjs';

/**
 * Schema installer for setting up database
 */
export class SchemaInstaller {
  constructor(private readonly db: DrizzleDb) {}

  /**
   * Install database schema
   */
  async install(adminPassphrase?: string): Promise<void> {
    // Create all tables
    await this.createTables();
    
    // Setup initial system configuration
    await this.setupInitialConfig(adminPassphrase);
  }

  /**
   * Create all database tables
   */
  private async createTables(): Promise<void> {
    // Create schema first
    await this.db.execute(sql`CREATE SCHEMA IF NOT EXISTS subscrio`);
    
    // Create tables in dependency order
    
    // Core tables (no dependencies)
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscrio.products (
        id BIGSERIAL PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscrio.features (
        id BIGSERIAL PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT,
        value_type TEXT NOT NULL,
        default_value TEXT NOT NULL,
        group_name TEXT,
        status TEXT NOT NULL,
        validator JSONB,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscrio.customers (
        id BIGSERIAL PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        display_name TEXT,
        email TEXT,
        external_billing_id TEXT UNIQUE,
        status TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscrio.system_config (
        id BIGSERIAL PRIMARY KEY,
        config_key TEXT NOT NULL UNIQUE,
        config_value TEXT NOT NULL,
        encrypted BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Junction table for products and features
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscrio.product_features (
        id BIGSERIAL PRIMARY KEY,
        product_id BIGINT NOT NULL REFERENCES subscrio.products(id) ON DELETE CASCADE,
        feature_id BIGINT NOT NULL REFERENCES subscrio.features(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(product_id, feature_id)
      )
    `);

    // Plans table (depends on products)
    // Note: on_expire_transition_to_billing_cycle_id FK added after billing_cycles table is created
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscrio.plans (
        id BIGSERIAL PRIMARY KEY,
        product_id BIGINT NOT NULL REFERENCES subscrio.products(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(product_id, key)
      )
    `);

    // Billing cycles (depends on plans)
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscrio.billing_cycles (
        id BIGSERIAL PRIMARY KEY,
        plan_id BIGINT NOT NULL REFERENCES subscrio.plans(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        duration_value INTEGER,
        duration_unit TEXT NOT NULL,
        external_product_id TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(plan_id, key)
      )
    `);
    
    // Add on_expire_transition_to_billing_cycle_id column to plans table if it doesn't exist
    // Only add FK if billing_cycles.id is BIGINT (not UUID from old schema)
    await this.db.execute(sql`
      DO $$ 
      DECLARE
        billing_cycles_id_type TEXT;
      BEGIN
        -- Add column if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'subscrio' AND table_name = 'plans' AND column_name = 'on_expire_transition_to_billing_cycle_id'
        ) THEN
          ALTER TABLE subscrio.plans ADD COLUMN on_expire_transition_to_billing_cycle_id BIGINT;
        END IF;
        
        -- Check if billing_cycles.id is BIGINT (not UUID from old schema)
        SELECT data_type INTO billing_cycles_id_type
        FROM information_schema.columns
        WHERE table_schema = 'subscrio' AND table_name = 'billing_cycles' AND column_name = 'id';
        
        -- Only add FK constraint if billing_cycles.id is BIGINT and constraint doesn't exist
        IF billing_cycles_id_type = 'bigint' AND NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE table_schema = 'subscrio' AND constraint_name = 'plans_on_expire_transition_to_billing_cycle_id_fkey'
        ) THEN
          ALTER TABLE subscrio.plans ADD CONSTRAINT plans_on_expire_transition_to_billing_cycle_id_fkey 
            FOREIGN KEY (on_expire_transition_to_billing_cycle_id) 
            REFERENCES subscrio.billing_cycles(id);
        END IF;
      END $$;
    `);
    
    // Add status column to existing billing_cycles table if it doesn't exist
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

    // Plan features (junction table)
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscrio.plan_features (
        id BIGSERIAL PRIMARY KEY,
        plan_id BIGINT NOT NULL REFERENCES subscrio.plans(id) ON DELETE CASCADE,
        feature_id BIGINT NOT NULL REFERENCES subscrio.features(id) ON DELETE CASCADE,
        value TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(plan_id, feature_id)
      )
    `);


    // Subscriptions (depends on customers and plans)
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscrio.subscriptions (
        id BIGSERIAL PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        customer_id BIGINT NOT NULL REFERENCES subscrio.customers(id) ON DELETE CASCADE,
        plan_id BIGINT NOT NULL REFERENCES subscrio.plans(id) ON DELETE CASCADE,
        billing_cycle_id BIGINT NOT NULL REFERENCES subscrio.billing_cycles(id) ON DELETE CASCADE,
        is_archived BOOLEAN NOT NULL DEFAULT FALSE,
        activation_date TIMESTAMPTZ,
        expiration_date TIMESTAMPTZ,
        cancellation_date TIMESTAMPTZ,
        trial_end_date TIMESTAMPTZ,
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        stripe_subscription_id TEXT UNIQUE,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        transitioned_at TIMESTAMPTZ
      )
    `);

    // Subscription feature overrides
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscrio.subscription_feature_overrides (
        id BIGSERIAL PRIMARY KEY,
        subscription_id BIGINT NOT NULL REFERENCES subscrio.subscriptions(id) ON DELETE CASCADE,
        feature_id BIGINT NOT NULL REFERENCES subscrio.features(id) ON DELETE CASCADE,
        value TEXT NOT NULL,
        override_type TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(subscription_id, feature_id)
      )
    `);

    // Add is_archived column to existing subscriptions table if it doesn't exist
    await this.db.execute(sql`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'subscrio' AND table_name = 'subscriptions' AND column_name = 'is_archived'
        ) THEN
          ALTER TABLE subscrio.subscriptions ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;
        END IF;
      END $$;
    `);

    // Add transitioned_at column to existing subscriptions table if it doesn't exist
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

    // Create subscription status view
    await this.db.execute(sql`
      DROP VIEW IF EXISTS subscrio.subscription_status_view CASCADE;
    `);
    
    await this.db.execute(sql`
      CREATE VIEW subscrio.subscription_status_view AS
      SELECT
        s.id,
        s.key,
        s.customer_id,
        s.plan_id,
        s.billing_cycle_id,
        s.activation_date,
        s.expiration_date,
        s.cancellation_date,
        s.trial_end_date,
        s.current_period_start,
        s.current_period_end,
        s.stripe_subscription_id,
        s.metadata,
        s.created_at,
        s.updated_at,
        s.is_archived,
        s.transitioned_at,
        CASE
          WHEN s.cancellation_date IS NOT NULL AND s.cancellation_date > NOW() THEN 'cancellation_pending'
          WHEN s.cancellation_date IS NOT NULL AND s.cancellation_date <= NOW() THEN 'cancelled'
          WHEN s.expiration_date IS NOT NULL AND s.expiration_date <= NOW() THEN 'expired'
          WHEN s.activation_date IS NOT NULL AND s.activation_date > NOW() THEN 'pending'
          WHEN s.trial_end_date IS NOT NULL AND s.trial_end_date > NOW() THEN 'trial'
          ELSE 'active'
        END AS computed_status
      FROM subscrio.subscriptions s;
    `);
  }

  /**
   * Verify schema installation
   * Returns the schema version if installed, null otherwise
   */
  async verify(): Promise<string | null> {
    // getCurrentSchemaVersion() already handles errors and returns null
    // if the schema doesn't exist or system_config table is missing
    return await this.getCurrentSchemaVersion();
  }

  /**
   * Current schema version - increment when adding migrations
   */
  private readonly CURRENT_SCHEMA_VERSION = '1.1.0';

  /**
   * Setup initial system configuration
   */
  private async setupInitialConfig(adminPassphrase?: string): Promise<void> {
    // Check if admin passphrase already exists
    const existing = await this.db
      .select()
      .from(system_config)
      .where(sql`${system_config.config_key} = 'admin_passphrase_hash'`)
      .limit(1);

    if (existing.length === 0 && adminPassphrase) {
      // Hash the admin passphrase
      const hash = await bcrypt.hash(adminPassphrase, 10);

      // Insert into system_config (id will be auto-generated by BIGSERIAL)
      await this.db.insert(system_config).values({
        config_key: 'admin_passphrase_hash',
        config_value: hash,
        encrypted: false,
        created_at: now(),
        updated_at: now()
      });
    }

    // Set initial schema version if not exists
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

  /**
   * Get current schema version from system_config
   */
  async getCurrentSchemaVersion(): Promise<string | null> {
    try {
      const [record] = await this.db
        .select()
        .from(system_config)
        .where(sql`${system_config.config_key} = 'schema_version'`)
        .limit(1);
      
      return record?.config_value ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Update schema version in system_config
   */
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

  /**
   * Run pending migrations
   * Returns the number of migrations applied
   */
  async migrate(): Promise<number> {
    const currentVersion = await this.getCurrentSchemaVersion();
    let migrationsApplied = 0;

    // Migration 1.1.0: Add transitioned_at column to subscriptions
    if (!currentVersion || this.compareVersions(currentVersion, '1.1.0') < 0) {
      await this.migrateTo_1_1_0();
      await this.updateSchemaVersion('1.1.0');
      migrationsApplied++;
    }

    return migrationsApplied;
  }

  /**
   * Migration 1.1.0: Add transitioned_at column to subscriptions
   */
  private async migrateTo_1_1_0(): Promise<void> {
    // Add transitioned_at column if it doesn't exist
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

    // Update subscription_status_view to include transitioned_at
    await this.db.execute(sql`
      DROP VIEW IF EXISTS subscrio.subscription_status_view CASCADE;
    `);
    
    await this.db.execute(sql`
      CREATE VIEW subscrio.subscription_status_view AS
      SELECT
        s.id,
        s.key,
        s.customer_id,
        s.plan_id,
        s.billing_cycle_id,
        s.activation_date,
        s.expiration_date,
        s.cancellation_date,
        s.trial_end_date,
        s.current_period_start,
        s.current_period_end,
        s.stripe_subscription_id,
        s.metadata,
        s.created_at,
        s.updated_at,
        s.is_archived,
        s.transitioned_at,
        CASE
          WHEN s.cancellation_date IS NOT NULL AND s.cancellation_date > NOW() THEN 'cancellation_pending'
          WHEN s.cancellation_date IS NOT NULL AND s.cancellation_date <= NOW() THEN 'cancelled'
          WHEN s.expiration_date IS NOT NULL AND s.expiration_date <= NOW() THEN 'expired'
          WHEN s.activation_date IS NOT NULL AND s.activation_date > NOW() THEN 'pending'
          WHEN s.trial_end_date IS NOT NULL AND s.trial_end_date > NOW() THEN 'trial'
          ELSE 'active'
        END AS computed_status
      FROM subscrio.subscriptions s;
    `);
  }

  /**
   * Compare two version strings (e.g., "1.0.0" vs "1.1.0")
   * Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
   */
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

  /**
   * Drop all tables (use with caution!)
   */
  /**
   * Drop all Subscrio tables (in reverse dependency order)
   */
  async dropAll(): Promise<void> {
    await this.db.execute(sql`DROP VIEW IF EXISTS subscrio.subscription_status_view`);

    // Drop tables in reverse dependency order to avoid foreign key constraint errors
    // Tables with foreign keys must be dropped before the tables they reference
    
    const tablesToDrop = [
      'subscription_feature_overrides',  // References subscriptions, features
      'subscriptions',                   // References customers, plans, billing_cycles
      'plan_features',                   // References plans, features
      'plans',                           // References products, billing_cycles
      'product_features',                // References products, features
      'features',                        // Referenced by product_features, plan_features
      'products',                        // Referenced by product_features, plans
      'customers',                       // Referenced by subscriptions
      'billing_cycles',                  // Referenced by plans, subscriptions
      'system_config'                    // No dependencies
    ];

    for (const table of tablesToDrop) {
      await this.db.execute(sql.raw(`DROP TABLE IF EXISTS subscrio.${table} CASCADE`));
    }
  }
}


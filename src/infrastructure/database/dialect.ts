export type DatabaseDialect = 'postgres' | 'sqlserver';

export function detectDatabaseDialect(connectionString: string): DatabaseDialect {
  const lower = connectionString.trim().toLowerCase();
  if (
    lower.startsWith('sqlserver://') ||
    lower.startsWith('mssql://') ||
    lower.startsWith('jdbc:sqlserver:') ||
    /(^|[;])\s*server\s*=/.test(lower) ||
    lower.includes('initial catalog=')
  ) {
    return 'sqlserver';
  }
  return 'postgres';
}

export function nowExpression(dialect: DatabaseDialect): string {
  return dialect === 'sqlserver' ? 'SYSUTCDATETIME()' : 'NOW()';
}

export function dropViewSql(dialect: DatabaseDialect): string {
  if (dialect === 'sqlserver') {
    return `
      IF OBJECT_ID(N'subscrio.subscription_status_view', N'V') IS NOT NULL
        DROP VIEW subscrio.subscription_status_view;
    `;
  }
  return `DROP VIEW IF EXISTS subscrio.subscription_status_view CASCADE;`;
}

export function createSchemaSql(dialect: DatabaseDialect): string {
  if (dialect === 'sqlserver') {
    return `
      IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'subscrio')
        EXEC('CREATE SCHEMA subscrio');
    `;
  }
  return `CREATE SCHEMA IF NOT EXISTS subscrio`;
}

export function dropTableSql(dialect: DatabaseDialect, table: string): string {
  if (dialect === 'sqlserver') {
    return `
      IF OBJECT_ID(N'subscrio.${table}', N'U') IS NOT NULL
        DROP TABLE subscrio.${table};
    `;
  }
  return `DROP TABLE IF EXISTS subscrio.${table} CASCADE`;
}

export function subscriptionStatusViewSql(dialect: DatabaseDialect): string {
  const nowExpr = nowExpression(dialect);
  const keyColumn = dialect === 'sqlserver' ? 's.[key]' : 's.key';
  return `
    CREATE VIEW subscrio.subscription_status_view AS
    SELECT
      s.id,
      ${keyColumn},
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
        WHEN s.cancellation_date IS NOT NULL AND s.cancellation_date > ${nowExpr} THEN 'cancellation_pending'
        WHEN s.cancellation_date IS NOT NULL AND s.cancellation_date <= ${nowExpr} THEN 'cancelled'
        WHEN s.expiration_date IS NOT NULL AND s.expiration_date <= ${nowExpr} THEN 'expired'
        WHEN s.activation_date IS NOT NULL AND s.activation_date > ${nowExpr} THEN 'pending'
        WHEN s.trial_end_date IS NOT NULL AND s.trial_end_date > ${nowExpr} THEN 'trial'
        ELSE 'active'
      END AS computed_status
    FROM subscrio.subscriptions s;
  `;
}

export function isTransientDbError(error: unknown): boolean {
  const messages: string[] = [];
  let current: unknown = error;
  while (current && typeof current === 'object') {
    const err = current as { message?: string; code?: string; cause?: unknown };
    if (err.message) messages.push(err.message);
    if (err.code) messages.push(String(err.code));
    current = err.cause;
  }
  const joined = messages.join(' ').toLowerCase();
  return (
    joined.includes('econnrefused') ||
    joined.includes('econnreset') ||
    joined.includes('etimedout') ||
    joined.includes('enotfound') ||
    joined.includes('forcibly closed') ||
    joined.includes('transient') ||
    joined.includes('timeout') ||
    joined.includes('too many connections') ||
    joined.includes('connection reset') ||
    joined.includes('deadlock') ||
    joined.includes('40001') ||
    joined.includes('08001') ||
    joined.includes('08006') ||
    joined.includes('4060') ||
    joined.includes('40197') ||
    joined.includes('40501') ||
    joined.includes('40613') ||
    joined.includes('49918') ||
    joined.includes('40540')
  );
}

export function isSchemaMissingError(error: unknown): boolean {
  const messages: string[] = [];
  let current: unknown = error;
  while (current && typeof current === 'object') {
    const err = current as { message?: string; code?: string; cause?: unknown };
    if (err.message) messages.push(err.message);
    if (err.code) messages.push(String(err.code));
    current = err.cause;
  }
  const joined = messages.join(' ').toLowerCase();
  return (
    joined.includes('does not exist') ||
    joined.includes('undefined_table') ||
    joined.includes('invalid object name') ||
    joined.includes('42p01') ||
    joined.includes('42p06') ||
    joined.includes('3f000')
  );
}

export const INSTALL_TABLES_POSTGRES = [
  `CREATE TABLE IF NOT EXISTS subscrio.products (
    id BIGSERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS subscrio.features (
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
  )`,
  `CREATE TABLE IF NOT EXISTS subscrio.customers (
    id BIGSERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    display_name TEXT,
    email TEXT,
    external_billing_id TEXT UNIQUE,
    status TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS subscrio.system_config (
    id BIGSERIAL PRIMARY KEY,
    config_key TEXT NOT NULL UNIQUE,
    config_value TEXT NOT NULL,
    encrypted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS subscrio.product_features (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES subscrio.products(id) ON DELETE CASCADE,
    feature_id BIGINT NOT NULL REFERENCES subscrio.features(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(product_id, feature_id)
  )`,
  `CREATE TABLE IF NOT EXISTS subscrio.plans (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES subscrio.products(id) ON DELETE CASCADE,
    key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(product_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS subscrio.billing_cycles (
    id BIGSERIAL PRIMARY KEY,
    plan_id BIGINT NOT NULL REFERENCES subscrio.plans(id) ON DELETE CASCADE,
    key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    duration_value INTEGER,
    duration_unit TEXT NOT NULL,
    external_product_id TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(plan_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS subscrio.plan_features (
    id BIGSERIAL PRIMARY KEY,
    plan_id BIGINT NOT NULL REFERENCES subscrio.plans(id) ON DELETE CASCADE,
    feature_id BIGINT NOT NULL REFERENCES subscrio.features(id) ON DELETE CASCADE,
    value TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(plan_id, feature_id)
  )`,
  `CREATE TABLE IF NOT EXISTS subscrio.subscriptions (
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
  )`,
  `CREATE TABLE IF NOT EXISTS subscrio.subscription_feature_overrides (
    id BIGSERIAL PRIMARY KEY,
    subscription_id BIGINT NOT NULL REFERENCES subscrio.subscriptions(id) ON DELETE CASCADE,
    feature_id BIGINT NOT NULL REFERENCES subscrio.features(id) ON DELETE CASCADE,
    value TEXT NOT NULL,
    override_type TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(subscription_id, feature_id)
  )`,
];

export const INSTALL_TABLES_SQLSERVER = [
  `IF OBJECT_ID(N'subscrio.products', N'U') IS NULL
    CREATE TABLE subscrio.products (
      id BIGINT IDENTITY(1,1) PRIMARY KEY,
      [key] NVARCHAR(255) NOT NULL UNIQUE,
      display_name NVARCHAR(255) NOT NULL,
      description NVARCHAR(MAX) NULL,
      status NVARCHAR(50) NOT NULL,
      metadata NVARCHAR(MAX) NULL,
      created_at DATETIMEOFFSET NOT NULL CONSTRAINT df_products_created DEFAULT SYSUTCDATETIME(),
      updated_at DATETIMEOFFSET NOT NULL CONSTRAINT df_products_updated DEFAULT SYSUTCDATETIME()
    )`,
  `IF OBJECT_ID(N'subscrio.features', N'U') IS NULL
    CREATE TABLE subscrio.features (
      id BIGINT IDENTITY(1,1) PRIMARY KEY,
      [key] NVARCHAR(255) NOT NULL UNIQUE,
      display_name NVARCHAR(255) NOT NULL,
      description NVARCHAR(MAX) NULL,
      value_type NVARCHAR(50) NOT NULL,
      default_value NVARCHAR(MAX) NOT NULL,
      group_name NVARCHAR(255) NULL,
      status NVARCHAR(50) NOT NULL,
      validator NVARCHAR(MAX) NULL,
      metadata NVARCHAR(MAX) NULL,
      created_at DATETIMEOFFSET NOT NULL CONSTRAINT df_features_created DEFAULT SYSUTCDATETIME(),
      updated_at DATETIMEOFFSET NOT NULL CONSTRAINT df_features_updated DEFAULT SYSUTCDATETIME()
    )`,
  `IF OBJECT_ID(N'subscrio.customers', N'U') IS NULL
    CREATE TABLE subscrio.customers (
      id BIGINT IDENTITY(1,1) PRIMARY KEY,
      [key] NVARCHAR(255) NOT NULL UNIQUE,
      display_name NVARCHAR(255) NULL,
      email NVARCHAR(255) NULL,
      external_billing_id NVARCHAR(255) NULL UNIQUE,
      status NVARCHAR(50) NOT NULL,
      metadata NVARCHAR(MAX) NULL,
      created_at DATETIMEOFFSET NOT NULL CONSTRAINT df_customers_created DEFAULT SYSUTCDATETIME(),
      updated_at DATETIMEOFFSET NOT NULL CONSTRAINT df_customers_updated DEFAULT SYSUTCDATETIME()
    )`,
  `IF OBJECT_ID(N'subscrio.system_config', N'U') IS NULL
    CREATE TABLE subscrio.system_config (
      id BIGINT IDENTITY(1,1) PRIMARY KEY,
      config_key NVARCHAR(255) NOT NULL UNIQUE,
      config_value NVARCHAR(MAX) NOT NULL,
      encrypted BIT NOT NULL CONSTRAINT df_system_config_enc DEFAULT 0,
      created_at DATETIMEOFFSET NOT NULL CONSTRAINT df_system_config_created DEFAULT SYSUTCDATETIME(),
      updated_at DATETIMEOFFSET NOT NULL CONSTRAINT df_system_config_updated DEFAULT SYSUTCDATETIME()
    )`,
  `IF OBJECT_ID(N'subscrio.product_features', N'U') IS NULL
    CREATE TABLE subscrio.product_features (
      id BIGINT IDENTITY(1,1) PRIMARY KEY,
      product_id BIGINT NOT NULL,
      feature_id BIGINT NOT NULL,
      created_at DATETIMEOFFSET NOT NULL CONSTRAINT df_product_features_created DEFAULT SYSUTCDATETIME(),
      CONSTRAINT fk_pf_product FOREIGN KEY (product_id) REFERENCES subscrio.products(id) ON DELETE CASCADE,
      CONSTRAINT fk_pf_feature FOREIGN KEY (feature_id) REFERENCES subscrio.features(id) ON DELETE CASCADE,
      CONSTRAINT uq_product_feature UNIQUE (product_id, feature_id)
    )`,
  `IF OBJECT_ID(N'subscrio.plans', N'U') IS NULL
    CREATE TABLE subscrio.plans (
      id BIGINT IDENTITY(1,1) PRIMARY KEY,
      product_id BIGINT NOT NULL,
      [key] NVARCHAR(255) NOT NULL UNIQUE,
      display_name NVARCHAR(255) NOT NULL,
      description NVARCHAR(MAX) NULL,
      status NVARCHAR(50) NOT NULL,
      on_expire_transition_to_billing_cycle_id BIGINT NULL,
      metadata NVARCHAR(MAX) NULL,
      created_at DATETIMEOFFSET NOT NULL CONSTRAINT df_plans_created DEFAULT SYSUTCDATETIME(),
      updated_at DATETIMEOFFSET NOT NULL CONSTRAINT df_plans_updated DEFAULT SYSUTCDATETIME(),
      CONSTRAINT fk_plans_product FOREIGN KEY (product_id) REFERENCES subscrio.products(id) ON DELETE CASCADE,
      CONSTRAINT uq_plans_product_key UNIQUE (product_id, [key])
    )`,
  `IF OBJECT_ID(N'subscrio.billing_cycles', N'U') IS NULL
    CREATE TABLE subscrio.billing_cycles (
      id BIGINT IDENTITY(1,1) PRIMARY KEY,
      plan_id BIGINT NOT NULL,
      [key] NVARCHAR(255) NOT NULL UNIQUE,
      display_name NVARCHAR(255) NOT NULL,
      description NVARCHAR(MAX) NULL,
      status NVARCHAR(50) NOT NULL CONSTRAINT df_bc_status DEFAULT 'active',
      duration_value INT NULL,
      duration_unit NVARCHAR(50) NOT NULL,
      external_product_id NVARCHAR(255) NULL,
      created_at DATETIMEOFFSET NOT NULL CONSTRAINT df_bc_created DEFAULT SYSUTCDATETIME(),
      updated_at DATETIMEOFFSET NOT NULL CONSTRAINT df_bc_updated DEFAULT SYSUTCDATETIME(),
      CONSTRAINT fk_bc_plan FOREIGN KEY (plan_id) REFERENCES subscrio.plans(id) ON DELETE CASCADE,
      CONSTRAINT uq_bc_plan_key UNIQUE (plan_id, [key])
    )`,
  `IF OBJECT_ID(N'subscrio.plan_features', N'U') IS NULL
    CREATE TABLE subscrio.plan_features (
      id BIGINT IDENTITY(1,1) PRIMARY KEY,
      plan_id BIGINT NOT NULL,
      feature_id BIGINT NOT NULL,
      value NVARCHAR(MAX) NOT NULL,
      created_at DATETIMEOFFSET NOT NULL CONSTRAINT df_plan_features_created DEFAULT SYSUTCDATETIME(),
      updated_at DATETIMEOFFSET NOT NULL CONSTRAINT df_plan_features_updated DEFAULT SYSUTCDATETIME(),
      CONSTRAINT fk_planf_plan FOREIGN KEY (plan_id) REFERENCES subscrio.plans(id) ON DELETE CASCADE,
      CONSTRAINT fk_planf_feature FOREIGN KEY (feature_id) REFERENCES subscrio.features(id) ON DELETE CASCADE,
      CONSTRAINT uq_plan_feature UNIQUE (plan_id, feature_id)
    )`,
  `IF OBJECT_ID(N'subscrio.subscriptions', N'U') IS NULL
    CREATE TABLE subscrio.subscriptions (
      id BIGINT IDENTITY(1,1) PRIMARY KEY,
      [key] NVARCHAR(255) NOT NULL UNIQUE,
      customer_id BIGINT NOT NULL,
      plan_id BIGINT NOT NULL,
      billing_cycle_id BIGINT NOT NULL,
      is_archived BIT NOT NULL CONSTRAINT df_sub_archived DEFAULT 0,
      activation_date DATETIMEOFFSET NULL,
      expiration_date DATETIMEOFFSET NULL,
      cancellation_date DATETIMEOFFSET NULL,
      trial_end_date DATETIMEOFFSET NULL,
      current_period_start DATETIMEOFFSET NULL,
      current_period_end DATETIMEOFFSET NULL,
      stripe_subscription_id NVARCHAR(255) NULL UNIQUE,
      metadata NVARCHAR(MAX) NULL,
      created_at DATETIMEOFFSET NOT NULL CONSTRAINT df_sub_created DEFAULT SYSUTCDATETIME(),
      updated_at DATETIMEOFFSET NOT NULL CONSTRAINT df_sub_updated DEFAULT SYSUTCDATETIME(),
      transitioned_at DATETIMEOFFSET NULL,
      CONSTRAINT fk_sub_customer FOREIGN KEY (customer_id) REFERENCES subscrio.customers(id) ON DELETE CASCADE,
      CONSTRAINT fk_sub_plan FOREIGN KEY (plan_id) REFERENCES subscrio.plans(id),
      CONSTRAINT fk_sub_cycle FOREIGN KEY (billing_cycle_id) REFERENCES subscrio.billing_cycles(id)
    )`,
  `IF OBJECT_ID(N'subscrio.subscription_feature_overrides', N'U') IS NULL
    CREATE TABLE subscrio.subscription_feature_overrides (
      id BIGINT IDENTITY(1,1) PRIMARY KEY,
      subscription_id BIGINT NOT NULL,
      feature_id BIGINT NOT NULL,
      value NVARCHAR(MAX) NOT NULL,
      override_type NVARCHAR(50) NOT NULL,
      created_at DATETIMEOFFSET NOT NULL CONSTRAINT df_sfo_created DEFAULT SYSUTCDATETIME(),
      CONSTRAINT fk_sfo_sub FOREIGN KEY (subscription_id) REFERENCES subscrio.subscriptions(id) ON DELETE CASCADE,
      CONSTRAINT fk_sfo_feature FOREIGN KEY (feature_id) REFERENCES subscrio.features(id) ON DELETE CASCADE,
      CONSTRAINT uq_sub_feature UNIQUE (subscription_id, feature_id)
    )`,
];

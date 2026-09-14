import { describe, expect, test } from 'vitest';
import {
  detectDatabaseDialect,
  nowExpression,
  dropViewSql,
  subscriptionStatusViewSql,
  isTransientDbError,
  isSchemaMissingError,
  INSTALL_TABLES_SQLSERVER,
  INSTALL_TABLES_POSTGRES,
  createSchemaSql,
  dropTableSql,
} from '../../src/infrastructure/database/dialect.js';
import { assertPostgresQueryRuntime, postgresSslOption } from '../../src/infrastructure/database/drizzle.js';
import { ConfigurationError } from '../../src/application/errors/index.js';

describe('database dialect', () => {
  test('detects postgres and sql server connection strings', () => {
    expect(detectDatabaseDialect('postgresql://localhost/db')).toBe('postgres');
    expect(detectDatabaseDialect('sqlserver://localhost;database=subscrio')).toBe('sqlserver');
    expect(detectDatabaseDialect('Server=localhost;Database=subscrio;User Id=sa;Password=x')).toBe('sqlserver');
  });

  test('uses provider-aware now() in the status view', () => {
    expect(nowExpression('postgres')).toBe('NOW()');
    expect(nowExpression('sqlserver')).toBe('SYSUTCDATETIME()');
    expect(subscriptionStatusViewSql('postgres')).toContain('NOW()');
    expect(subscriptionStatusViewSql('sqlserver')).toContain('SYSUTCDATETIME()');
    expect(subscriptionStatusViewSql('sqlserver')).toContain('s.[key]');
    expect(subscriptionStatusViewSql('postgres')).toContain('cancellation_pending');
  });

  test('drops views without CASCADE on SQL Server', () => {
    expect(dropViewSql('postgres')).toContain('CASCADE');
    expect(dropViewSql('sqlserver')).toContain('OBJECT_ID');
    expect(dropViewSql('sqlserver')).not.toContain('CASCADE');
  });

  test('classifies transient and schema-missing errors', () => {
    expect(isTransientDbError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isTransientDbError(new Error('validation failed'))).toBe(false);
    expect(isSchemaMissingError(new Error('relation "subscrio.system_config" does not exist'))).toBe(true);
    expect(isSchemaMissingError(new Error('Invalid object name'))).toBe(true);
    expect(isSchemaMissingError(new Error('syntax error'))).toBe(false);
  });

  test('SQL Server install SQL covers every table and uses SYSUTCDATETIME', () => {
    const joined = INSTALL_TABLES_SQLSERVER.join('\n');
    for (const table of [
      'products',
      'features',
      'customers',
      'system_config',
      'product_features',
      'plans',
      'billing_cycles',
      'plan_features',
      'subscriptions',
      'subscription_feature_overrides',
    ]) {
      expect(joined).toContain(`subscrio.${table}`);
    }
    expect(joined).toContain('SYSUTCDATETIME()');
    expect(joined).toContain('IDENTITY(1,1)');
    expect(joined).not.toContain('BIGSERIAL');
    expect(joined).not.toContain('JSONB');
    expect(createSchemaSql('sqlserver')).toContain('CREATE SCHEMA subscrio');
    expect(dropTableSql('sqlserver', 'plans')).toContain('OBJECT_ID');
    expect(dropTableSql('sqlserver', 'plans')).not.toContain('CASCADE');
    expect(INSTALL_TABLES_POSTGRES.length).toBe(INSTALL_TABLES_SQLSERVER.length);
  });

  test('query runtime rejects SQL Server connection strings', () => {
    expect(() => assertPostgresQueryRuntime('sqlserver')).toThrow(ConfigurationError);
    expect(() => assertPostgresQueryRuntime('postgres')).not.toThrow();
  });

  test('ssl true requires certificate verification', () => {
    expect(postgresSslOption(true)).toEqual({ rejectUnauthorized: true });
    expect(postgresSslOption(false)).toBeUndefined();
  });
});

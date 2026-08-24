/**
 * Environment configuration utilities
 */

export interface EnvironmentConfig {
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  database: {
    maxConnections: number;
    connectionTimeout: number;
    queryTimeout: number;
  };
  cache: {
    planCacheSize: number;
    planCacheTTL: number;
  };
  performance: {
    maxSubscriptionsPerCustomer: number;
    batchSize: number;
  };
}

/**
 * Get environment configuration with defaults
 */
export function getEnvironmentConfig(): EnvironmentConfig {
  return {
    nodeEnv: (process.env.NODE_ENV as 'development' | 'production' | 'test') || 'development',
    logLevel: (process.env.LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug') || 'info',
    database: {
      maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '10'),
      connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '30000'),
      queryTimeout: parseInt(process.env.DB_QUERY_TIMEOUT || '60000'),
    },
    cache: {
      planCacheSize: parseInt(process.env.PLAN_CACHE_SIZE || '1000'),
      planCacheTTL: parseInt(process.env.PLAN_CACHE_TTL || '300000'), // 5 minutes
    },
    performance: {
      maxSubscriptionsPerCustomer: parseInt(process.env.MAX_SUBSCRIPTIONS_PER_CUSTOMER || '100'),
      batchSize: parseInt(process.env.BATCH_SIZE || '50'),
    },
  };
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return getEnvironmentConfig().nodeEnv === 'development';
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return getEnvironmentConfig().nodeEnv === 'production';
}

/**
 * Check if running in test mode
 */
export function isTest(): boolean {
  return getEnvironmentConfig().nodeEnv === 'test';
}

/**
 * Get log level for current environment
 */
export function getLogLevel(): string {
  return getEnvironmentConfig().logLevel;
}

/**
 * Get database configuration
 */
export function getDatabaseConfig() {
  return getEnvironmentConfig().database;
}

/**
 * Get cache configuration
 */
export function getCacheConfig() {
  return getEnvironmentConfig().cache;
}

/**
 * Get performance configuration
 */
export function getPerformanceConfig() {
  return getEnvironmentConfig().performance;
}

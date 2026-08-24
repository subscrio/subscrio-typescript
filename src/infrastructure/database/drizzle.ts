import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { SubscrioConfig } from '../../config/types.js';

export type DrizzleDb = NodePgDatabase<typeof schema>;

let dbInstance: DrizzleDb | null = null;
let poolInstance: Pool | null = null;

/**
 * Initialize database connection
 */
export function initializeDatabase(config: SubscrioConfig['database']): DrizzleDb {
  if (dbInstance) {
    return dbInstance;
  }

  poolInstance = new Pool({
    connectionString: config.connectionString,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    max: config.poolSize || 10
  });

  dbInstance = drizzle(poolInstance, { schema });

  return dbInstance;
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
    dbInstance = null;
  }
}

/**
 * Get current database instance
 */
export function getDatabase(): DrizzleDb {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return dbInstance;
}


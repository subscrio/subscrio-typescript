import { transactionalDatabase } from "./transactionContext.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import { SubscrioConfig } from "../../config/types.js";
import { detectDatabaseDialect, type DatabaseDialect } from "./dialect.js";
import { ConfigurationError } from "../../application/errors/index.js";

export type DrizzleDb = NodePgDatabase<typeof schema>;

let dbInstance: DrizzleDb | null = null;
let poolInstance: Pool | null = null;

export function assertPostgresQueryRuntime(dialect: DatabaseDialect): void {
  if (dialect === "sqlserver") {
    throw new ConfigurationError(
      "SQL Server is supported for schema install/drop/migrate SQL generation. " +
        "The TypeScript query runtime uses Drizzle with PostgreSQL. " +
        "Use a PostgreSQL connection string for application queries.",
    );
  }
}

export function postgresSslOption(
  ssl?: boolean,
): { rejectUnauthorized: true } | undefined {
  return ssl ? { rejectUnauthorized: true } : undefined;
}

export function initializeDatabase(
  config: SubscrioConfig["database"],
): DrizzleDb {
  if (dbInstance) {
    return dbInstance;
  }

  const dialect =
    config.databaseType ?? detectDatabaseDialect(config.connectionString);
  assertPostgresQueryRuntime(dialect);

  poolInstance = new Pool({
    connectionString: config.connectionString,
    ssl: postgresSslOption(config.ssl),
    max: config.poolSize || 10,
  });

  dbInstance = transactionalDatabase(drizzle(poolInstance, { schema }));

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
    throw new Error(
      "Database not initialized. Call initializeDatabase() first.",
    );
  }
  return dbInstance;
}

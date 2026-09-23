import type { ConfigSyncDto } from "../application/dtos/ConfigSyncDto.js";
import type { HooksConfig } from "../application/hooks/types.js";

/**
 * Initial config sync: same inputs as ConfigSyncService (file path or JSON config).
 * If provided, call subscrio.runInitialConfigSync() after construction to apply it.
 */
export type InitialConfigSync =
  { type: "file"; filePath: string } | { type: "json"; config: ConfigSyncDto };

/**
 * Subscrio configuration interface
 */
export type DatabaseType = "postgres" | "sqlserver";

export interface SubscrioConfig {
  clock?: import("../application/dtos/../utils/Clock.js").Clock;
  database: {
    connectionString: string;
    ssl?: boolean;
    poolSize?: number;
    /**
     * Database dialect. Detected from the connection string when omitted.
     * PostgreSQL is the supported query runtime. SQL Server is supported for schema install/drop/migrate.
     */
    databaseType?: DatabaseType;
  };
  adminPassphrase?: string;
  stripe?: {
    secretKey: string;
    /**
     * Optional Stripe webhook endpoint secret (`whsec_...`).
     * When set, use `constructStripeEvent` to verify signatures.
     */
    webhookSecret?: string;
  };
  logging?: {
    level: "debug" | "info" | "warn" | "error";
  };
  /**
   * Optional initial config sync. If set, call runInitialConfigSync() after construction to sync from file or JSON.
   */
  initialConfig?: InitialConfigSync;
  /**
   * Optional before-mutation hooks registered at construction time.
   */
  hooks?: HooksConfig;
}

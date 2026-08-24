import type { ConfigSyncDto } from '../application/dtos/ConfigSyncDto.js';
import type { HooksConfig } from '../application/hooks/types.js';

/**
 * Initial config sync: same inputs as ConfigSyncService (file path or JSON config).
 * If provided, call subscrio.runInitialConfigSync() after construction to apply it.
 */
export type InitialConfigSync =
  | { type: 'file'; filePath: string }
  | { type: 'json'; config: ConfigSyncDto };

/**
 * Subscrio configuration interface
 */
export interface SubscrioConfig {
  database: {
    connectionString: string;
    ssl?: boolean;
    poolSize?: number;
  };
  adminPassphrase?: string;
  stripe?: {
    secretKey: string;
  };
  logging?: {
    level: 'debug' | 'info' | 'warn' | 'error';
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


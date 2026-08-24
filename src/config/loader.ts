import { z } from 'zod';
import { SubscrioConfig } from './types.js';

const configSchema = z.object({
  database: z.object({
    connectionString: z.string().min(1, 'Database connection string is required'),
    ssl: z.boolean().optional(),
    poolSize: z.number().min(1).max(100).optional()
  }),
  adminPassphrase: z.string().min(8).optional(),
  stripe: z.object({
    secretKey: z.string().startsWith('sk_')
  }).optional(),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error'])
  }).optional()
});

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): SubscrioConfig {
  const config: SubscrioConfig = {
    database: {
      connectionString: process.env.DATABASE_URL || '',
      ssl: process.env.DATABASE_SSL === 'true',
      poolSize: process.env.DATABASE_POOL_SIZE 
        ? parseInt(process.env.DATABASE_POOL_SIZE) 
        : undefined
    },
    adminPassphrase: process.env.ADMIN_PASSPHRASE,
    stripe: process.env.STRIPE_SECRET_KEY ? {
      secretKey: process.env.STRIPE_SECRET_KEY
    } : undefined,
    logging: {
      level: (process.env.LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug') || 'info'
    }
  };

  // Validate configuration
  return configSchema.parse(config);
}


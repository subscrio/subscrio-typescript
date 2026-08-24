import { SubscrioConfig } from '../src/config/types.js';
import { config as dotenvConfig } from 'dotenv';

// Load .env file if it exists
dotenvConfig({ path: '.env' });

export function loadConfig(): SubscrioConfig {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    console.error('Please set DATABASE_URL in your environment or create a .env file');
    console.error('Example: DATABASE_URL=postgresql://user:password@localhost:5432/subscrio_demo');
    process.exit(1);
  }

  return {
    database: {
      connectionString
    }
  };
}


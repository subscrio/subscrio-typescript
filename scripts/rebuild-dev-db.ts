import { Subscrio } from '../src/Subscrio.js';
import { SubscrioConfig } from '../src/config/types.js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from packages/core if it exists
dotenv.config({ path: resolve(__dirname, '../.env') });

console.log('🔄 Rebuilding database...\n');

try {
  // Manual config with fallback
  const config: SubscrioConfig = {
    database: {
      connectionString: process.env.DATABASE_URL || 
        'postgresql://postgres:PASSWORD@localhost:5432/postgres'
    }
  };
  
  console.log('✅ Configuration loaded');
  console.log(`📦 Database: ${config.database.connectionString}\n`);

  // Create Subscrio instance
  const subscrio = new Subscrio(config);
  console.log('✅ Subscrio instance created\n');

  // Drop existing schema
  console.log('🗑️  Dropping existing schema...');
  await subscrio.dropSchema();
  console.log('✅ Schema dropped\n');

  // Install fresh schema
  console.log('🔨 Installing fresh schema...');
  await subscrio.installSchema();
  console.log('✅ Schema installed\n');

  // Close connection
  await subscrio.close();
  console.log('✅ Database connection closed\n');

  console.log('🎉 Database rebuild complete!');
} catch (error) {
  console.error('❌ Error rebuilding database:', error);
  process.exit(1);
}

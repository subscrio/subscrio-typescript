#!/usr/bin/env node
/**
 * Subscrio Migration CLI
 * 
 * Runs pending database migrations for the Subscrio schema.
 * 
 * Usage:
 *   npm run migrate
 *   npx subscrio migrate
 */

import { Subscrio } from '../src/Subscrio.js';
import { loadConfig } from '../src/config/index.js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from packages/core if it exists
dotenv.config({ path: resolve(__dirname, '../.env') });

async function main() {
  try {
    console.log('🔄 Checking for pending migrations...\n');
    
    const config = loadConfig();
    const subscrio = new Subscrio(config);

    // Verify schema exists
    const schemaVersion = await subscrio.verifySchema();
    if (schemaVersion === null) {
      console.error('❌ Subscrio schema not found. Run installSchema() first.');
      process.exit(1);
    }
    console.log(`📋 Current schema version: ${schemaVersion}\n`);

    // Run migrations
    const migrationsApplied = await subscrio.migrate();

    if (migrationsApplied === 0) {
      console.log('✅ Database is up to date. No migrations needed.\n');
    } else {
      console.log(`✅ Applied ${migrationsApplied} migration(s) successfully.\n`);
    }

    await subscrio.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();


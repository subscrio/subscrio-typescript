// Vitest global setup - runs once before all test files
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { setupTestDatabase, teardownTestDatabase, cleanupDanglingTestDatabases } from './database.js';

// Load environment variables FIRST (if .env exists)
loadEnv({ path: resolve(import.meta.dirname, '../../.env') });

// Set LOG_LEVEL to error for tests to reduce noise
if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = 'error';
}

// If TEST_DATABASE_URL is not set, try to use DATABASE_URL from environment
if (!process.env.TEST_DATABASE_URL && process.env.DATABASE_URL) {
  process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
}

let testDbName: string;

export async function setup() {
  console.log('🏗️  Setting up global test database...');
  
  // Clean up any dangling test databases first
  await cleanupDanglingTestDatabases();
  
  const context = await setupTestDatabase();
  
  // Store Subscrio instance AND database info globally
  global.subscrio = context.subscrio;
  global.__TEST_DB_NAME__ = context.dbName;
  global.__TEST_CONNECTION_STRING__ = context.connectionString;
  
  testDbName = context.dbName;
  
  console.log(`✅ Test database ready: ${context.dbName}\n`);
}

export async function teardown() {
  if (global.subscrio) {
    await global.subscrio.close();
  }
  
  if (testDbName) {
    console.log('\n🧹 Tearing down global test database...');
    await teardownTestDatabase(testDbName);
    console.log('✅ Test database cleaned up');
  }
}


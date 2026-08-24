import { randomBytes } from 'crypto';
import { Client } from 'pg';
import { Subscrio } from '../../src/index.js';

export interface TestContext {
  dbName: string;
  connectionString: string;
  subscrio: Subscrio;
}

/**
 * Setup a fresh test database
 * Uses fixed name: subscrio_test
 */
export async function setupTestDatabase(): Promise<TestContext> {
  const dbName = 'subscrio_test';
  
  // Get base connection URL from environment
  const baseUrl = process.env.TEST_DATABASE_URL || 
    'postgresql://postgres:postgres@localhost:5432/postgres';
  
  // Connect to postgres database
  const adminClient = new Client({ connectionString: baseUrl });
  
  try {
    await adminClient.connect();
    
    // Drop existing test database if it exists
    await adminClient.query(`DROP DATABASE IF EXISTS ${dbName}`);
    
    // Create fresh test database
    await adminClient.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await adminClient.end();
  }
  
  // Build connection string for test database
  const connectionString = baseUrl.replace(/\/[^/]*$/, `/${dbName}`);
  
  // Initialize Subscrio with test database
  const subscrio = new Subscrio({
    database: { connectionString }
  });
  
  // Install schema using public API
  await subscrio.installSchema('test-admin-passphrase');
  
  return { dbName, connectionString, subscrio };
}

/**
 * Teardown test database
 * Set KEEP_TEST_DB=true to preserve databases for debugging
 */
export async function teardownTestDatabase(dbName: string): Promise<void> {
  // Check if we should keep the database for debugging
  if (process.env.KEEP_TEST_DB === 'true') {
    const baseUrl = process.env.TEST_DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/postgres';
    const connectionString = baseUrl.replace(/\/[^/]*$/, `/${dbName}`);
    
    console.log(`\n🔍 Test database preserved for debugging:`);
    console.log(`   Database: ${dbName}`);
    console.log(`   Connection: ${connectionString}`);
    console.log(`   To connect: psql ${connectionString}`);
    console.log(`   To drop: DROP DATABASE ${dbName};`);
    return;
  }
  
  const baseUrl = process.env.TEST_DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/postgres';
  
  const adminClient = new Client({ connectionString: baseUrl });
  
  try {
    await adminClient.connect();
    
    // Terminate connections
    await adminClient.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = '${dbName}'
        AND pid <> pg_backend_pid()
    `);
    
    // Drop database
    await adminClient.query(`DROP DATABASE IF EXISTS ${dbName}`);
  } finally {
    await adminClient.end();
  }
}

/**
 * Clean up any dangling test databases
 * Set KEEP_TEST_DB=true to skip cleanup
 */
export async function cleanupDanglingTestDatabases(): Promise<void> {
  // Skip cleanup if we're preserving test databases
  if (process.env.KEEP_TEST_DB === 'true') {
    console.log('🔍 Skipping test database cleanup (KEEP_TEST_DB=true)');
    return;
  }
  
  const baseUrl = process.env.TEST_DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/postgres';
  
  const adminClient = new Client({ connectionString: baseUrl });
  
  try {
    await adminClient.connect();
    
    // Find all test databases
    const result = await adminClient.query(`
      SELECT datname 
      FROM pg_database 
      WHERE datname LIKE 'subscrio_test_%'
    `);
    
    if (result.rows.length > 0) {
      console.log(`🧹 Cleaning up ${result.rows.length} dangling test databases...`);
      
      for (const row of result.rows) {
        const dbName = row.datname;
        
        try {
          // Terminate connections to this database
          await adminClient.query(`
            SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = '${dbName}'
              AND pid <> pg_backend_pid()
          `);
          
          // Drop the database
          await adminClient.query(`DROP DATABASE IF EXISTS ${dbName}`);
          console.log(`   ✓ Dropped ${dbName}`);
        } catch (error) {
          console.log(`   ⚠️  Failed to drop ${dbName}: ${error.message}`);
        }
      }
    }
  } finally {
    await adminClient.end();
  }
}


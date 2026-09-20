#!/usr/bin/env node

import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { Subscrio } from '../Subscrio.js';
import { loadConfig } from '../config/index.js';

dotenv.config({ path: resolve(process.cwd(), '.env') });

async function main(): Promise<void> {
  let subscrio: Subscrio | undefined;

  try {
    console.log('Checking for pending Subscrio migrations...');
    subscrio = new Subscrio(loadConfig());

    const schemaVersion = await subscrio.verifySchema();
    if (schemaVersion === null) {
      throw new Error('Subscrio schema not found. Run installSchema() first.');
    }

    console.log(`Current schema version: ${schemaVersion}`);
    const migrationsApplied = await subscrio.migrate();
    console.log(
      migrationsApplied === 0
        ? 'Database is up to date.'
        : `Applied ${migrationsApplied} migration(s).`
    );
  } catch (error) {
    console.error(
      'Subscrio migration failed:',
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  } finally {
    await subscrio?.close();
  }
}

void main();

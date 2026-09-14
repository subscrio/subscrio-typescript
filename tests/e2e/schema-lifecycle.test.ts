import { describe, expect, test } from 'vitest';
import { Subscrio } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';

describe('Schema lifecycle', () => {
  test('verify, migrate, and drop with passphrase enforcement', async () => {
    const passphrase = 'test-admin-passphrase';
    const subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() },
      adminPassphrase: passphrase,
    });

    const version = await subscrio.verifySchema();
    expect(version).toBeTruthy();

    const applied = await subscrio.migrate();
    expect(applied).toBeGreaterThanOrEqual(0);
    expect(await subscrio.verifySchema()).toBeTruthy();

    await expect(subscrio.dropSchema('wrong-passphrase')).rejects.toThrow(/Admin passphrase/);

    await subscrio.installSchema(passphrase);
    expect(await subscrio.verifySchema()).toBeTruthy();
  });
});

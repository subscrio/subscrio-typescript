import { afterEach, describe, expect, test } from 'vitest';
import { loadConfig } from '../../src/config/loader.js';

describe('loadConfig', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  test('loads webhook secret with stripe key', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.STRIPE_SECRET_KEY = 'sk_test_1234567890';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const config = loadConfig();
    expect(config.stripe?.secretKey).toBe('sk_test_1234567890');
    expect(config.stripe?.webhookSecret).toBe('whsec_test');
  });
});

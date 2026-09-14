import { describe, expect, test } from 'vitest';
import { SystemConfig } from '../../src/domain/entities/SystemConfig.js';

describe('SystemConfig entity', () => {
  test('updateValue changes configValue', () => {
    const config = new SystemConfig({
      configKey: 'schema_version',
      configValue: '1.0.0',
      encrypted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(config.configKey).toBe('schema_version');
    expect(config.encrypted).toBe(false);
    config.updateValue('1.1.0');
    expect(config.configValue).toBe('1.1.0');
  });
});

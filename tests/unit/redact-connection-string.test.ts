import { describe, expect, test } from 'vitest';
import { redactConnectionString } from '../../src/infrastructure/utils/redactConnectionString.js';

describe('redactConnectionString', () => {
  test('redacts postgres URL passwords', () => {
    const redacted = redactConnectionString('postgresql://user:secret@localhost:5432/db');
    expect(redacted).not.toContain('secret');
    expect(redacted).toContain('***');
    expect(redacted).toContain('localhost');
  });

  test('redacts SQL Server Password= style strings', () => {
    const redacted = redactConnectionString('Server=localhost;Database=x;Password=hunter2;');
    expect(redacted).not.toContain('hunter2');
  });
});

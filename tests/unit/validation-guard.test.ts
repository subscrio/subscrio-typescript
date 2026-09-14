import { describe, expect, test } from 'vitest';
import { assertValid, compactDefined, ensureKeyAvailable, requireByKey } from '../../src/application/utils/ValidationGuard.js';
import { ConflictError, NotFoundError, ValidationError } from '../../src/application/errors/index.js';

describe('ValidationGuard', () => {
  test('requireByKey returns the entity', async () => {
    const entity = await requireByKey(async () => ({ key: 'a' }), 'a', 'Customer');
    expect(entity.key).toBe('a');
  });

  test('requireByKey throws NotFoundError', async () => {
    await expect(requireByKey(async () => null, 'missing', 'Customer')).rejects.toThrow(NotFoundError);
  });

  test('ensureKeyAvailable throws ConflictError', async () => {
    await expect(ensureKeyAvailable(async () => ({ id: 1 }), 'taken', 'Plan')).rejects.toThrow(ConflictError);
    await expect(ensureKeyAvailable(async () => null, 'free', 'Plan')).resolves.toBeUndefined();
  });

  test('assertValid unwraps success and throws on failure', () => {
    expect(assertValid({ success: true, data: 3 }, 'filter')).toBe(3);
    expect(() =>
      assertValid({ success: false, error: { issues: [{ message: 'bad' }] } }, 'filter')
    ).toThrow(ValidationError);
  });

  test('compactDefined drops null and undefined', () => {
    expect(compactDefined({ a: 1, b: null, c: undefined, d: 'x' })).toEqual({ a: 1, d: 'x' });
  });
});

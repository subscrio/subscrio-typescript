import { describe, expect, test } from 'vitest';
import { convertFeatureValue } from '../../src/application/utils/convertFeatureValue.js';

describe('convertFeatureValue', () => {
  test('returns string when no default is provided', () => {
    expect(convertFeatureValue('10')).toBe('10');
  });

  test('converts to number when default is a number', () => {
    expect(convertFeatureValue('42', 0)).toBe(42);
    expect(convertFeatureValue('not-a-number', 7)).toBe(7);
  });

  test('converts to boolean when default is a boolean', () => {
    expect(convertFeatureValue('true', false)).toBe(true);
    expect(convertFeatureValue('FALSE', true)).toBe(false);
    expect(convertFeatureValue('1', false)).toBe(true);
    expect(convertFeatureValue('off', true)).toBe(false);
  });

  test('returns default for null/undefined', () => {
    expect(convertFeatureValue(null, 3)).toBe(3);
    expect(convertFeatureValue(undefined)).toBeNull();
  });
});

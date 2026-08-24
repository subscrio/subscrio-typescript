import { describe, test, expect } from 'vitest';
import { generateId } from '../../src/infrastructure/utils/uuid.js';

describe('UUID Utilities', () => {
  describe('generateId()', () => {
    test('generates unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      
      expect(id1).not.toBe(id2);
    });

    test('generates valid UUID format', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    test('generates UUIDv7 (time-ordered)', () => {
      const id1 = generateId();
      const id2 = generateId();
      
      // UUIDv7 should be sortable by creation time
      expect(id1 < id2).toBe(true);
    });

    test('generates different IDs for different calls', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId());
      }
      
      expect(ids.size).toBe(100);
    });
  });
});

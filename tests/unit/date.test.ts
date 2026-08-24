import { describe, test, expect } from 'vitest';
import { 
  now, 
  nowISO, 
  fromISOString, 
  addDays, 
  addMonths, 
  addYears, 
  isPast, 
  isFuture, 
  isToday, 
  formatDate, 
  formatDateTime 
} from '../../src/infrastructure/utils/date.js';

describe('Date Utilities', () => {
  describe('now()', () => {
    test('returns current date', () => {
      const current = now();
      expect(current).toBeInstanceOf(Date);
      expect(current.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('nowISO()', () => {
    test('returns current date as ISO string', () => {
      const iso = nowISO();
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('fromISOString()', () => {
    test('creates date from valid ISO string', () => {
      const date = fromISOString('2023-12-25T10:30:00.000Z');
      expect(date).toBeInstanceOf(Date);
      expect(date.getFullYear()).toBe(2023);
      expect(date.getMonth()).toBe(11); // December is 11
      expect(date.getDate()).toBe(25);
    });

    test('throws error for invalid ISO string', () => {
      expect(() => fromISOString('invalid-date')).toThrow('Invalid ISO date string');
    });
  });

  describe('addDays()', () => {
    test('adds days to date', () => {
      const date = new Date('2023-12-25T10:30:00.000Z');
      const result = addDays(date, 5);
      expect(result.getDate()).toBe(30);
    });

    test('handles negative days', () => {
      const date = new Date('2023-12-25T10:30:00.000Z');
      const result = addDays(date, -5);
      expect(result.getDate()).toBe(20);
    });
  });

  describe('addMonths()', () => {
    test('adds months to date', () => {
      const date = new Date('2023-12-25T10:30:00.000Z');
      const result = addMonths(date, 2);
      expect(result.getMonth()).toBe(1); // February is 1
      expect(result.getFullYear()).toBe(2024);
    });
  });

  describe('addYears()', () => {
    test('adds years to date', () => {
      const date = new Date('2023-12-25T10:30:00.000Z');
      const result = addYears(date, 1);
      expect(result.getFullYear()).toBe(2024);
    });
  });

  describe('isPast()', () => {
    test('returns true for past date', () => {
      const pastDate = new Date('2020-01-01T00:00:00.000Z');
      expect(isPast(pastDate)).toBe(true);
    });

    test('returns false for future date', () => {
      const futureDate = new Date('2030-01-01T00:00:00.000Z');
      expect(isPast(futureDate)).toBe(false);
    });
  });

  describe('isFuture()', () => {
    test('returns true for future date', () => {
      const futureDate = new Date('2030-01-01T00:00:00.000Z');
      expect(isFuture(futureDate)).toBe(true);
    });

    test('returns false for past date', () => {
      const pastDate = new Date('2020-01-01T00:00:00.000Z');
      expect(isFuture(pastDate)).toBe(false);
    });
  });

  describe('isToday()', () => {
    test('returns true for today', () => {
      const today = new Date();
      expect(isToday(today)).toBe(true);
    });

    test('returns false for yesterday', () => {
      const yesterday = addDays(new Date(), -1);
      expect(isToday(yesterday)).toBe(false);
    });
  });

  describe('formatDate()', () => {
    test('formats date for display', () => {
      const date = new Date('2023-12-25T10:30:00.000Z');
      const formatted = formatDate(date);
      expect(formatted).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    });
  });

  describe('formatDateTime()', () => {
    test('formats date and time for display', () => {
      const date = new Date('2023-12-25T10:30:00.000Z');
      const formatted = formatDateTime(date);
      expect(formatted).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2}/);
    });
  });
});

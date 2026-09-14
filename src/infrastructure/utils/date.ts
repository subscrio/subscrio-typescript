import { now as domainNow } from '../../domain/clock.js';

export { now } from '../../domain/clock.js';

const _now = domainNow;

/**
 * Get the current date/time as ISO string
 * Useful for logging and API responses
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Create a date from an ISO string
 * Throws an error if the string is invalid
 */
export function fromISOString(isoString: string): Date {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date string: ${isoString}`);
  }
  return date;
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Add months to a date
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Add years to a date
 */
export function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

/**
 * Check if a date is in the past
 */
export function isPast(date: Date): boolean {
  return date < _now();
}

/**
 * Check if a date is in the future
 */
export function isFuture(date: Date): boolean {
  return date > _now();
}

/**
 * Check if a date is today
 */
export function isToday(date: Date): boolean {
  const today = _now();
  return date.toDateString() === today.toDateString();
}

/**
 * Format date for display
 */
export function formatDate(date: Date, locale: string = 'en-US'): string {
  return date.toLocaleDateString(locale);
}

/**
 * Format date and time for display
 */
export function formatDateTime(date: Date, locale: string = 'en-US'): string {
  return date.toLocaleString(locale);
}

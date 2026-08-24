import { uuidv7 } from 'uuidv7';

/**
 * Generate a UUIDv7 identifier
 * UUIDv7 provides time-ordered, sortable UUIDs for better database performance
 */
export function generateId(): string {
  return uuidv7();
}

/**
 * Generate a short, unique key with prefix for external reference
 * Example: "sub_a1b2c3d4" for subscriptions, "plan_x9y8z7" for plans
 */
export function generateKey(prefix: string): string {
  const uuid = uuidv7();
  // Take first 8 chars of UUID (without hyphens) for uniqueness
  const short = uuid.replace(/-/g, '').substring(0, 12);
  return `${prefix}_${short}`;
}


import { randomUUID } from 'crypto';

export function uniqueKey(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

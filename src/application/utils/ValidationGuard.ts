import { ConflictError, NotFoundError, ValidationError } from '../errors/index.js';

export async function requireByKey<T>(
  finder: (key: string) => Promise<T | null>,
  key: string,
  entityType: string
): Promise<T> {
  const entity = await finder(key);
  if (!entity) {
    throw new NotFoundError(`${entityType} with key '${key}' not found`);
  }
  return entity;
}

export async function ensureKeyAvailable<T>(
  finder: (key: string) => Promise<T | null>,
  key: string,
  entityType: string
): Promise<void> {
  const existing = await finder(key);
  if (existing) {
    throw new ConflictError(`${entityType} with key '${key}' already exists`);
  }
}

export function assertValid<T>(
  result: { success: true; data: T } | { success: false; error: { issues: unknown[] } },
  context: string
): T {
  if (!result.success) {
    throw new ValidationError(`Invalid ${context}`, result.error.issues);
  }
  return result.data;
}

export function compactDefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      out[key] = value;
    }
  }
  return out;
}

export function revalidateAfterHook(
  schema: { safeParse: (data: unknown) => { success: boolean; data?: unknown; error?: { issues?: unknown[] } } },
  data: unknown,
  context: string
): void {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(`Invalid ${context}`, result.error?.issues);
  }
}

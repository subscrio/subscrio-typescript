/**
 * Convert a stored string feature value to the caller's requested type.
 * TypeScript erases generics, so conversion uses `defaultValue`'s runtime type
 * (or an explicit `valueType` when provided).
 */
export function convertFeatureValue<T>(
  value: string | null | undefined,
  defaultValue?: T,
  valueType?: 'string' | 'boolean' | 'number'
): T | null {
  if (value == null) {
    return defaultValue ?? null;
  }

  const target = valueType ?? (defaultValue !== undefined ? typeof defaultValue : 'string');

  if (target === 'string') {
    return value as T;
  }

  if (target === 'boolean') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
      return true as T;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
      return false as T;
    }
    return defaultValue ?? null;
  }

  if (target === 'number') {
    const num = Number(value);
    if (Number.isNaN(num) || !Number.isFinite(num)) {
      return defaultValue ?? null;
    }
    return num as T;
  }

  return (value as T) ?? defaultValue ?? null;
}

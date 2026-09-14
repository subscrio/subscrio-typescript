/**
 * UTC clock for domain entities. Avoids importing infrastructure from domain.
 */
export function now(): Date {
  return new Date();
}

/**
 * Apply offset then limit. Callers must order the query first.
 */
export function applyPaging(query: any, offset?: number, limit?: number): any {
  let next = query;
  if (offset !== undefined && offset > 0) {
    next = next.offset(offset);
  }
  if (limit !== undefined && limit > 0) {
    next = next.limit(limit);
  }
  return next;
}

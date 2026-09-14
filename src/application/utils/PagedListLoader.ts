import { MAX_PAGE_SIZE } from '../constants/index.js';

/**
 * Loads every page from a limit/offset list API until a short page is returned.
 */
export async function loadAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  pageSize: number = MAX_PAGE_SIZE
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const page = await fetchPage(offset, pageSize);
    all.push(...page);
    if (page.length < pageSize) {
      break;
    }
    offset += pageSize;
  }
  return all;
}

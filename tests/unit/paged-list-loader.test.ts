import { describe, expect, test } from 'vitest';
import { loadAllPages } from '../../src/application/utils/PagedListLoader.js';

describe('loadAllPages', () => {
  test('pages until a short page is returned', async () => {
    const pages = [
      [1, 2],
      [3, 4],
      [5],
    ];
    const result = await loadAllPages(async (offset, limit) => {
      expect(limit).toBe(2);
      const pageIndex = offset / 2;
      return pages[pageIndex] ?? [];
    }, 2);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });
});

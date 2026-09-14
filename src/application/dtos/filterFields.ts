import { z } from 'zod';

export const paginationFields = {
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
};

export const sortOrderField = z.enum(['asc', 'desc']).optional();

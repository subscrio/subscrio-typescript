import { z } from 'zod';
import { paginationFields, sortOrderField } from './filterFields.js';

export const CreateCustomerDtoSchema = z.object({
  key: z.string()
    .min(1, 'Customer key is required')
    .max(255, 'Customer key too long'),
  displayName: z.string().max(255).optional(),
  email: z.string().email().optional(),
  externalBillingId: z.string().max(255).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type CreateCustomerDto = z.infer<typeof CreateCustomerDtoSchema>;

export const UpdateCustomerDtoSchema = z.object({
  // Only updateable fields - excluding immutable field: key
  displayName: z.string().max(255).optional(),
  email: z.string().email().optional(),
  externalBillingId: z.string().max(255).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});
export type UpdateCustomerDto = z.infer<typeof UpdateCustomerDtoSchema>;

export interface CustomerDto {
  key: string;
  displayName?: string | null;
  email?: string | null;
  externalBillingId?: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export const CustomerFilterDtoSchema = z.object({
  status: z.enum(['active', 'suspended', 'archived', 'deleted']).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['displayName', 'key', 'createdAt']).optional(),
  sortOrder: sortOrderField,
  ...paginationFields
});

export type CustomerFilterDto = z.infer<typeof CustomerFilterDtoSchema>;


import { z } from 'zod';
import { paginationFields, sortOrderField } from './filterFields.js';

export const CreateBillingCycleObjectSchema = z.object({
  planKey: z.string()
    .min(1, 'Plan key is required')
    .regex(/^[a-z0-9-]+$/, 'Plan key must be lowercase alphanumeric with hyphens'),
  key: z.string()
    .min(1, 'Key is required')
    .max(255, 'Key too long')
    .regex(/^[a-z0-9-]+$/, 'Key must be globally unique across all billing cycles'),
  displayName: z.string()
    .min(1, 'Display name is required')
    .max(255, 'Display name too long'),
  description: z.string().max(1000).optional(),
  durationValue: z.number().int().min(1, 'Duration value must be positive').optional(),
  durationUnit: z.enum(['days', 'weeks', 'months', 'years', 'forever']),
  externalProductId: z.string().max(255).optional()
});

export const CreateBillingCycleDtoSchema = CreateBillingCycleObjectSchema.refine(
  (data) => {
    // If durationUnit is 'forever', durationValue should be undefined
    // If durationUnit is not 'forever', durationValue should be provided
    if (data.durationUnit === 'forever') {
      return data.durationValue === undefined;
    }
    return data.durationValue !== undefined;
  },
  {
    message: "Duration value is required for non-forever durations, and must be undefined for forever duration",
    path: ["durationValue"]
  }
);

export type CreateBillingCycleDto = z.infer<typeof CreateBillingCycleDtoSchema>;

export const UpdateBillingCycleDtoSchema = z.object({
  displayName: z.string()
    .min(1, 'Display name is required')
    .max(255, 'Display name too long')
    .optional(),
  description: z.string().max(1000).optional(),
  durationValue: z.number().int().min(1, 'Duration value must be positive').optional(),
  durationUnit: z.enum(['days', 'weeks', 'months', 'years', 'forever']).optional(),
  externalProductId: z.string().max(255).optional()
}).refine(
  (data) => {
    // Only validate if durationUnit is provided
    if (data.durationUnit !== undefined) {
      if (data.durationUnit === 'forever') {
        return data.durationValue === undefined; // Can't have durationValue with forever
      }
      return data.durationValue !== undefined; // Must have durationValue for non-forever
    }
    // If durationUnit is not provided, durationValue can be provided or not
    return true;
  },
  {
    message: "Duration value is required for non-forever durations, and must be undefined for forever duration",
    path: ["durationValue"]
  }
);
export type UpdateBillingCycleDto = z.infer<typeof UpdateBillingCycleDtoSchema>;

export interface BillingCycleDto {
  productKey: string | null;
  planKey: string | null;
  key: string;
  displayName: string;
  description?: string | null;
  status: string;
  durationValue?: number | null;
  durationUnit: string;
  externalProductId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const BillingCycleFilterDtoSchema = z.object({
  planKey: z.string().optional(),
  status: z.enum(['active', 'archived']).optional(),
  ...paginationFields,
  durationUnit: z.enum(['days', 'weeks', 'months', 'years', 'forever']).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['displayName', 'createdAt']).optional(),
  sortOrder: sortOrderField
});

export type BillingCycleFilterDto = z.infer<typeof BillingCycleFilterDtoSchema>;


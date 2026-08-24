import { z } from 'zod';

export const CreatePlanDtoSchema = z.object({
  productKey: z.string()
    .min(1, 'Product key is required')
    .regex(/^[a-z0-9-]+$/, 'Product key must be lowercase alphanumeric with hyphens'),
  key: z.string()
    .min(1, 'Key is required')
    .max(255, 'Key too long')
    .regex(/^[a-z0-9-]+$/, 'Key must be globally unique across all plans'),
  displayName: z.string()
    .min(1, 'Display name is required')
    .max(255, 'Display name too long'),
  description: z.string().max(1000).optional(),
  onExpireTransitionToBillingCycleKey: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type CreatePlanDto = z.infer<typeof CreatePlanDtoSchema>;

export const UpdatePlanDtoSchema = z.object({
  // Only updateable fields - excluding immutable fields: key, productKey
  displayName: z.string()
    .min(1, 'Display name is required')
    .max(255, 'Display name too long')
    .optional(),
  description: z.string().max(1000).optional(),
  onExpireTransitionToBillingCycleKey: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});
export type UpdatePlanDto = z.infer<typeof UpdatePlanDtoSchema>;

export interface PlanDto {
  productKey: string;
  key: string;
  displayName: string;
  description?: string | null;
  status: string;
  onExpireTransitionToBillingCycleKey?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export const PlanFilterDtoSchema = z.object({
  productKey: z.string().optional(),
  status: z.enum(['active', 'archived']).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['displayName', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0)
});

export type PlanFilterDto = z.infer<typeof PlanFilterDtoSchema>;


import { z } from 'zod';
import { CustomerDto } from './CustomerDto.js';

// Helper to transform empty strings to undefined for optional date fields
const optionalDateField = () =>
  z.preprocess(
    (val) => (val === '' || val === null ? undefined : val),
    z.union([z.string().datetime(), z.date()]).optional()
  );

export const CreateSubscriptionDtoSchema = z.object({
  key: z.string()
    .min(1, 'Subscription key is required')
    .max(255, 'Subscription key too long')
    .regex(/^[a-zA-Z0-9-_]+$/, 'Subscription key must be alphanumeric with hyphens/underscores'),
  customerKey: z.string().min(1, 'Customer key is required'),
  billingCycleKey: z.string()
    .min(1, 'Billing cycle key is required')
    .regex(/^[a-z0-9-]+$/, 'Billing cycle key must be lowercase alphanumeric with hyphens'),
  activationDate: optionalDateField(),
  expirationDate: optionalDateField(),
  cancellationDate: optionalDateField(),
  trialEndDate: optionalDateField(),
  currentPeriodStart: optionalDateField(),
  currentPeriodEnd: optionalDateField(),
  stripeSubscriptionId: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().optional()
  ),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type CreateSubscriptionDto = z.infer<typeof CreateSubscriptionDtoSchema>;

export const UpdateSubscriptionDtoSchema = z.object({
  // Only updateable fields - excluding immutable fields: key, customerKey, activationDate
  billingCycleKey: z.string()
    .min(1, 'Billing cycle key is required')
    .regex(/^[a-z0-9-]+$/, 'Billing cycle key must be lowercase alphanumeric with hyphens')
    .optional(),
  expirationDate: optionalDateField(),
  cancellationDate: optionalDateField(),
  trialEndDate: optionalDateField(),
  currentPeriodStart: optionalDateField(),
  currentPeriodEnd: optionalDateField(),
  stripeSubscriptionId: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().optional()
  ),
  metadata: z.record(z.string(), z.unknown()).optional()
});
export type UpdateSubscriptionDto = z.infer<typeof UpdateSubscriptionDtoSchema>;

export interface SubscriptionDto {
  key: string;
  customerKey: string;
  productKey: string;
  planKey: string;
  billingCycleKey: string;
  status: string;
  isArchived: boolean;
  activationDate?: string | null;
  expirationDate?: string | null;
  cancellationDate?: string | null;
  trialEndDate?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  stripeSubscriptionId?: string | null;
  metadata?: Record<string, unknown> | null;
  customer?: CustomerDto | null;
  createdAt: string;
  updatedAt: string;
}

export const SubscriptionFilterDtoSchema = z.object({
  customerKey: z.string().optional(),
  productKey: z.string().optional(),
  planKey: z.string().optional(),
  status: z.enum(['pending', 'active', 'trial', 'cancelled', 'cancellation_pending', 'expired']).optional(),
  isArchived: z.boolean().optional(),
  sortBy: z.enum(['activationDate', 'expirationDate', 'createdAt', 'updatedAt', 'currentPeriodStart', 'currentPeriodEnd']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0)
});

export type SubscriptionFilterDto = z.infer<typeof SubscriptionFilterDtoSchema>;

export const DetailedSubscriptionFilterDtoSchema = z.object({
  // Basic filters
  customerKey: z.string().optional(),
  productKey: z.string().optional(),
  planKey: z.string().optional(),
  billingCycleKey: z.string().optional(),
  status: z.enum(['pending', 'active', 'trial', 'cancelled', 'cancellation_pending', 'expired']).optional(),
  isArchived: z.boolean().optional(),
  
  // Date range filters
  activationDateFrom: z.date().optional(),
  activationDateTo: z.date().optional(),
  expirationDateFrom: z.date().optional(),
  expirationDateTo: z.date().optional(),
  trialEndDateFrom: z.date().optional(),
  trialEndDateTo: z.date().optional(),
  
  // Period filters
  currentPeriodStartFrom: z.date().optional(),
  currentPeriodStartTo: z.date().optional(),
  currentPeriodEndFrom: z.date().optional(),
  currentPeriodEndTo: z.date().optional(),
  
  // Boolean filters
  hasStripeId: z.boolean().optional(),
  hasTrial: z.boolean().optional(),
  
  // Feature override filters
  hasFeatureOverrides: z.boolean().optional(),
  featureKey: z.string().optional(),
  
  // Metadata filters
  metadataKey: z.string().optional(),
  metadataValue: z.unknown().optional(),
  
  // Sorting and pagination
  sortBy: z.enum(['activationDate', 'expirationDate', 'createdAt', 'updatedAt', 'currentPeriodStart', 'currentPeriodEnd']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0)
});

export type DetailedSubscriptionFilterDto = z.infer<typeof DetailedSubscriptionFilterDtoSchema>;


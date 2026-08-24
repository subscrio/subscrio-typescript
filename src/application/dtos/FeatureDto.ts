import { z } from 'zod';

export const BaseFeatureDtoSchema = z.object({
  key: z.string()
    .min(1, 'Key is required')
    .max(255, 'Key too long')
    .regex(/^[a-zA-Z0-9-_]+$/, 'Key must be alphanumeric with hyphens/underscores'),
  displayName: z.string()
    .min(1, 'Display name is required')
    .max(255, 'Display name too long'),
  description: z.string().max(1000).optional(),
  valueType: z.enum(['toggle', 'numeric', 'text']),
  defaultValue: z.string().min(1, 'Default value is required'),
  groupName: z.string().max(255).optional(),
  validator: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const CreateFeatureDtoSchema = BaseFeatureDtoSchema.refine((data) => {
  // Validate defaultValue based on valueType
  if (data.valueType === 'toggle') {
    return data.defaultValue === 'true' || data.defaultValue === 'false';
  }
  if (data.valueType === 'numeric') {
    const num = Number(data.defaultValue);
    return !isNaN(num) && isFinite(num);
  }
  // Text type accepts any string
  return true;
}, {
  message: 'Invalid default value for the selected value type. Toggle must be "true" or "false", Numeric must be a valid number.',
  path: ['defaultValue']
});

export type CreateFeatureDto = z.infer<typeof CreateFeatureDtoSchema>;

export const UpdateFeatureDtoSchema = z.object({
  // Only updateable fields - excluding immutable field: key
  displayName: z.string()
    .min(1, 'Display name is required')
    .max(255, 'Display name too long')
    .optional(),
  description: z.string().max(1000).optional(),
  valueType: z.enum(['toggle', 'numeric', 'text']).optional(),
  defaultValue: z.string().min(1, 'Default value is required').optional(),
  groupName: z.string().max(255).optional(),
  validator: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).refine((data) => {
  // Only validate if both valueType and defaultValue are provided
  if (!data.valueType || !data.defaultValue) {
    return true;
  }
  
  if (data.valueType === 'toggle') {
    return data.defaultValue === 'true' || data.defaultValue === 'false';
  }
  if (data.valueType === 'numeric') {
    const num = Number(data.defaultValue);
    return !isNaN(num) && isFinite(num);
  }
  return true;
}, {
  message: 'Invalid default value for the selected value type. Toggle must be "true" or "false", Numeric must be a valid number.',
  path: ['defaultValue']
});
export type UpdateFeatureDto = z.infer<typeof UpdateFeatureDtoSchema>;

export interface FeatureDto {
  key: string;
  displayName: string;
  description?: string | null;
  valueType: string;
  defaultValue: string;
  groupName?: string | null;
  status: string;
  validator?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export const FeatureFilterDtoSchema = z.object({
  status: z.enum(['active', 'archived']).optional(),
  valueType: z.enum(['toggle', 'numeric', 'text']).optional(),
  groupName: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['displayName', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0)
});

export type FeatureFilterDto = z.infer<typeof FeatureFilterDtoSchema>;


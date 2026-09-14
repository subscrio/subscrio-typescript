import { z } from 'zod';
import { FeatureValueValidator } from '../utils/FeatureValueValidator.js';
import { FeatureValueType } from '../../domain/value-objects/FeatureValueType.js';
import { paginationFields, sortOrderField } from './filterFields.js';

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
  return FeatureValueValidator.isValid(data.defaultValue, data.valueType as FeatureValueType);
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
  if (!data.valueType || !data.defaultValue) {
    return true;
  }
  return FeatureValueValidator.isValid(data.defaultValue, data.valueType as FeatureValueType);
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
  sortOrder: sortOrderField,
  ...paginationFields
});

export type FeatureFilterDto = z.infer<typeof FeatureFilterDtoSchema>;


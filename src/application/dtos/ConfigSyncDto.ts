import { z } from 'zod';
import { CreateProductDtoSchema } from './ProductDto.js';
import { CreatePlanDtoSchema } from './PlanDto.js';
import { CreateBillingCycleObjectSchema } from './BillingCycleDto.js';
import { BaseFeatureDtoSchema } from './FeatureDto.js';
import { FeatureValueValidator } from '../utils/FeatureValueValidator.js';
import { FeatureValueType } from '../../domain/value-objects/FeatureValueType.js';

/**
 * Config Sync DTOs
 * 
 * These schemas reuse the existing Create*Dto schemas by:
 * 1. Using .omit() to remove parent keys (productKey, planKey) that come from nesting
 * 2. Using .extend() to add config-specific fields (archived, nested structures)
 */

/**
 * Billing Cycle Configuration
 * Maps to CreateBillingCycleDto / UpdateBillingCycleDto
 * Reuses CreateBillingCycleDtoSchema validation, omitting planKey (comes from nested structure)
 */
export const BillingCycleConfigSchema = CreateBillingCycleObjectSchema
  .omit({ planKey: true })
  .extend({
    archived: z.boolean().optional()
  })
  .refine(
    (data) => {
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

export type BillingCycleConfig = z.infer<typeof BillingCycleConfigSchema>;

/**
 * Plan Configuration
 * Maps to CreatePlanDto / UpdatePlanDto
 * Reuses CreatePlanDtoSchema validation, omitting productKey (comes from nested structure)
 * Note: CreatePlanDtoSchema has no refinements, so we can use .omit() directly
 */
export const PlanConfigSchema = CreatePlanDtoSchema
  .omit({ productKey: true })  // Remove productKey (comes from nested structure)
  .extend({
    archived: z.boolean().optional(),
    featureValues: z.record(z.string(), z.string()).optional(),
    billingCycles: z.array(BillingCycleConfigSchema).optional()
  });

export type PlanConfig = z.infer<typeof PlanConfigSchema>;

/**
 * Feature Configuration
 * Maps to CreateFeatureDto / UpdateFeatureDto
 * Reuses CreateFeatureDtoSchema validation, adding archived field
 */
export const FeatureConfigSchema = BaseFeatureDtoSchema.extend({
  archived: z.boolean().optional()
}).refine((data) => {
  return FeatureValueValidator.isValid(data.defaultValue, data.valueType as FeatureValueType);
}, {
  message: 'Invalid default value for the selected value type. Toggle must be "true" or "false", Numeric must be a valid number.',
  path: ['defaultValue']
});

export type FeatureConfig = z.infer<typeof FeatureConfigSchema>;

/**
 * Product Configuration
 * Maps to CreateProductDto / UpdateProductDto
 * Reuses CreateProductDtoSchema validation (no refinements, so we can extend directly)
 */
export const ProductConfigSchema = CreateProductDtoSchema.extend({
  archived: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  plans: z.array(PlanConfigSchema).optional()
});

export type ProductConfig = z.infer<typeof ProductConfigSchema>;

/**
 * Root Configuration DTO
 * IMPORTANT: In JSON, features must appear before products. The TypeScript interface order does not enforce this - validation will check JSON property order.
 */
export interface ConfigSyncDto {
  version: string;  // Schema version for future compatibility
  features: FeatureConfig[];  // MUST come before products in JSON
  products: ProductConfig[];
}

/**
 * Sync Report returned after sync operations
 */
export interface ConfigSyncReport {
  created: {
    features: number;
    products: number;
    plans: number;
    billingCycles: number;
  };
  updated: {
    features: number;
    products: number;
    plans: number;
    billingCycles: number;
  };
  archived: {
    features: number;
    products: number;
    plans: number;
    billingCycles: number;
  };
  unarchived: {
    features: number;
    products: number;
    plans: number;
    billingCycles: number;
  };
  ignored: {
    features: number;
    products: number;
    plans: number;
    billingCycles: number;
  };
  errors: Array<{
    entityType: 'feature' | 'product' | 'plan' | 'billingCycle';
    key: string;
    message: string;
  }>;
  warnings: Array<{
    entityType: 'feature' | 'product' | 'plan' | 'billingCycle';
    key: string;
    message: string;
  }>;
}

/**
 * Validates JSON property order to ensure features appear before products
 * This is a custom validation that checks the raw JSON string
 */
function validateJsonPropertyOrder(jsonString: string): void {
  // Find the positions of "features" and "products" in the JSON
  const featuresIndex = jsonString.indexOf('"features"');
  const productsIndex = jsonString.indexOf('"products"');
  
  if (featuresIndex === -1 || productsIndex === -1) {
    return; // Let Zod schema validation handle missing properties
  }
  
  if (featuresIndex > productsIndex) {
    throw new Error('The "features" array must appear before the "products" array in the JSON configuration');
  }
}

/**
 * Root Configuration Schema with cross-field validation
 */
export const ConfigSyncDtoSchema = z.object({
  version: z.string().min(1, 'Version is required'),
  features: z.array(FeatureConfigSchema),
  products: z.array(ProductConfigSchema)
}).superRefine((data, ctx) => {
  // Validate duplicate keys within same scope
  const featureKeys = new Set<string>();
  const productKeys = new Set<string>();
  
  // Check for duplicate feature keys
  for (const feature of data.features) {
    if (featureKeys.has(feature.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate feature key: ${feature.key}`,
        path: ['features']
      });
    }
    featureKeys.add(feature.key);
  }
  
  // Check for duplicate product keys
  for (const product of data.products) {
    if (productKeys.has(product.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate product key: ${product.key}`,
        path: ['products']
      });
    }
    productKeys.add(product.key);
    
    // Check for duplicate plan keys within product
    const planKeys = new Set<string>();
    if (product.plans) {
      for (const plan of product.plans) {
        if (planKeys.has(plan.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate plan key '${plan.key}' within product '${product.key}'`,
            path: ['products']
          });
        }
        planKeys.add(plan.key);
        
        // Check for duplicate billing cycle keys within plan
        const billingCycleKeys = new Set<string>();
        if (plan.billingCycles) {
          for (const billingCycle of plan.billingCycles) {
            if (billingCycleKeys.has(billingCycle.key)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Duplicate billing cycle key '${billingCycle.key}' within plan '${plan.key}' of product '${product.key}'`,
                path: ['products']
              });
            }
            billingCycleKeys.add(billingCycle.key);
          }
        }
      }
    }
  }
  
  // Validate references
  const featureKeySet = new Set(data.features.map(f => f.key));
  
  for (const product of data.products) {
    // Validate feature keys referenced in products
    if (product.features) {
      for (const featureKey of product.features) {
        if (!featureKeySet.has(featureKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Feature key '${featureKey}' referenced in product '${product.key}' does not exist in features array`,
            path: ['products']
          });
        }
      }
    }
    
    // Validate plan feature values and references
    if (product.plans) {
      // Collect all billing cycle keys from all plans in this product for cross-plan validation
      const allProductBillingCycleKeys = new Set<string>();
      for (const plan of product.plans) {
        if (plan.billingCycles) {
          for (const billingCycle of plan.billingCycles) {
            allProductBillingCycleKeys.add(billingCycle.key);
          }
        }
      }
      
      for (const plan of product.plans) {
        // Validate feature keys in plan.featureValues exist in product.features
        if (plan.featureValues) {
          const productFeatureKeys = new Set(product.features || []);
          for (const featureKey of Object.keys(plan.featureValues)) {
            if (!productFeatureKeys.has(featureKey)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Feature key '${featureKey}' in plan '${plan.key}' featureValues is not associated with product '${product.key}'`,
                path: ['products']
              });
            }
            
            // Validate feature value matches feature valueType
            const feature = data.features.find(f => f.key === featureKey);
            if (feature) {
              const value = plan.featureValues[featureKey];
              if (!FeatureValueValidator.isValid(value, feature.valueType as FeatureValueType)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `Feature value for '${featureKey}' in plan '${plan.key}' is invalid for ${feature.valueType} type`,
                  path: ['products']
                });
              }
            }
          }
        }
        
        // Validate onExpireTransitionToBillingCycleKey references valid billing cycle in same product
        if (plan.onExpireTransitionToBillingCycleKey) {
          if (!allProductBillingCycleKeys.has(plan.onExpireTransitionToBillingCycleKey)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Billing cycle key '${plan.onExpireTransitionToBillingCycleKey}' referenced in plan '${plan.key}' does not exist in any plan's billingCycles within product '${product.key}'`,
              path: ['products']
            });
          }
        }
      }
    }
  }
});

/**
 * Validates a JSON string for property order before parsing
 * This should be called before JSON.parse() when loading from file
 */
export function validateConfigJsonPropertyOrder(jsonString: string): void {
  validateJsonPropertyOrder(jsonString);
}


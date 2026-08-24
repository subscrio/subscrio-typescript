import { readFile } from 'fs/promises';
import { Subscrio } from '../../Subscrio.js';
import {
  ConfigSyncDto,
  ConfigSyncDtoSchema,
  ConfigSyncReport,
  FeatureConfig,
  ProductConfig,
  PlanConfig,
  BillingCycleConfig,
  validateConfigJsonPropertyOrder
} from '../dtos/ConfigSyncDto.js';
import { CreateFeatureDto, UpdateFeatureDto, FeatureDto } from '../dtos/FeatureDto.js';
import { CreateProductDto, UpdateProductDto, ProductDto } from '../dtos/ProductDto.js';
import { CreatePlanDto, UpdatePlanDto, PlanDto } from '../dtos/PlanDto.js';
import { CreateBillingCycleDto, UpdateBillingCycleDto, BillingCycleDto } from '../dtos/BillingCycleDto.js';
import { ValidationError } from '../errors/index.js';

/**
 * Deep equality check for objects (for metadata comparison)
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  
  if (aKeys.length !== bKeys.length) return false;
  
  for (const key of aKeys) {
    if (!bKeys.includes(key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  
  return true;
}

/**
 * Normalize null/undefined/empty string for comparison
 */
function normalizeValue(value: string | null | undefined): string | null {
  if (value === undefined || value === '') return null;
  return value;
}

/**
 * Compare feature config with existing feature DTO to detect changes
 */
function hasFeatureChanges(config: FeatureConfig, existing: FeatureDto): boolean {
  if (config.displayName !== existing.displayName) return true;
  if (normalizeValue(config.description) !== normalizeValue(existing.description)) return true;
  if (config.valueType !== existing.valueType) return true;
  if (config.defaultValue !== existing.defaultValue) return true;
  if (normalizeValue(config.groupName) !== normalizeValue(existing.groupName)) return true;
  if (!deepEqual(config.validator ?? null, existing.validator ?? null)) return true;
  if (!deepEqual(config.metadata ?? null, existing.metadata ?? null)) return true;
  return false;
}

/**
 * Compare product config with existing product DTO to detect changes
 */
function hasProductChanges(config: ProductConfig, existing: ProductDto): boolean {
  if (config.displayName !== existing.displayName) return true;
  if (normalizeValue(config.description) !== normalizeValue(existing.description)) return true;
  if (!deepEqual(config.metadata ?? null, existing.metadata ?? null)) return true;
  return false;
}

/**
 * Compare plan config with existing plan DTO to detect changes
 */
function hasPlanChanges(config: PlanConfig, existing: PlanDto): boolean {
  if (config.displayName !== existing.displayName) return true;
  if (normalizeValue(config.description) !== normalizeValue(existing.description)) return true;
  if (normalizeValue(config.onExpireTransitionToBillingCycleKey) !== normalizeValue(existing.onExpireTransitionToBillingCycleKey)) return true;
  if (!deepEqual(config.metadata ?? null, existing.metadata ?? null)) return true;
  return false;
}

/**
 * Compare billing cycle config with existing billing cycle DTO to detect changes
 */
function hasBillingCycleChanges(config: BillingCycleConfig, existing: BillingCycleDto): boolean {
  if (config.displayName !== existing.displayName) return true;
  if (normalizeValue(config.description) !== normalizeValue(existing.description)) return true;
  if (config.durationValue !== existing.durationValue) return true;
  if (config.durationUnit !== existing.durationUnit) return true;
  if (normalizeValue(config.externalProductId) !== normalizeValue(existing.externalProductId)) return true;
  return false;
}

/**
 * Configuration Sync Service
 * Syncs configuration from JSON files or programmatic DTOs to the database
 * Uses public Subscrio API methods to ensure all business logic is reused
 */
export class ConfigSyncService {
  constructor(
    private readonly subscrio: Subscrio  // Use public API methods
  ) {}

  /**
   * Load configuration from a JSON file and sync
   * @param filePath Path to the JSON configuration file
   * @returns Sync report with operation results
   */
  async syncFromFile(filePath: string): Promise<ConfigSyncReport> {
    try {
      // Read file, parse JSON, validate, then sync
      const fileContent = await readFile(filePath, 'utf-8');
      
      // Validate JSON property order before parsing
      validateConfigJsonPropertyOrder(fileContent);
      
      const jsonData = JSON.parse(fileContent);
      const config = ConfigSyncDtoSchema.parse(jsonData);
      return await this.syncFromJson(config);
    } catch (error) {
      if (error instanceof Error) {
        throw new ValidationError(`Failed to load configuration from file: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Sync configuration from a ConfigSyncDto object
   * @param config Configuration object (can be built programmatically)
   * @returns Sync report with operation results
   */
  async syncFromJson(config: ConfigSyncDto): Promise<ConfigSyncReport> {
    // Phase 1: Validate configuration schema
    // This will throw ValidationError if schema is invalid
    const validatedConfig = ConfigSyncDtoSchema.parse(config);

    // Initialize sync report
    const report: ConfigSyncReport = {
      created: { features: 0, products: 0, plans: 0, billingCycles: 0 },
      updated: { features: 0, products: 0, plans: 0, billingCycles: 0 },
      archived: { features: 0, products: 0, plans: 0, billingCycles: 0 },
      unarchived: { features: 0, products: 0, plans: 0, billingCycles: 0 },
      ignored: { features: 0, products: 0, plans: 0, billingCycles: 0 },
      errors: [],
      warnings: []
    };

    // Phase 2: Load Current State
    // Use maximum allowed limit to get as many entities as possible
    const existingProducts = await this.subscrio.products.listProducts({ limit: 100, offset: 0, sortOrder: 'asc' });
    const existingFeatures = await this.subscrio.features.listFeatures({ limit: 100, offset: 0 });
    const existingPlans = await this.subscrio.plans.listPlans({ limit: 100, offset: 0, sortOrder: 'asc' });
    const existingBillingCycles = await this.subscrio.billingCycles.listBillingCycles({ limit: 100, offset: 0, sortOrder: 'asc' });

    // Create lookup maps by key
    const productsByKey = new Map(existingProducts.map(p => [p.key, p]));
    const featuresByKey = new Map(existingFeatures.map(f => [f.key, f]));
    // Plan keys are globally unique across all products
    const plansByKey = new Map(existingPlans.map(p => [p.key, p]));
    // Billing cycle keys are globally unique across all plans
    const billingCyclesByKey = new Map(existingBillingCycles.map(bc => [bc.key, bc]));

    // Track ignored entities (in database but not in config)
    const configFeatureKeys = new Set(validatedConfig.features.map(f => f.key));
    const configProductKeys = new Set(validatedConfig.products.map(p => p.key));
    const configPlanKeys = new Set(
      validatedConfig.products.flatMap(p => (p.plans || []).map(plan => plan.key))
    );
    const configBillingCycleKeys = new Set(
      validatedConfig.products.flatMap(p => 
        (p.plans || []).flatMap(plan => (plan.billingCycles || []).map(bc => bc.key))
      )
    );

    report.ignored.features = existingFeatures.filter(f => !configFeatureKeys.has(f.key)).length;
    report.ignored.products = existingProducts.filter(p => !configProductKeys.has(p.key)).length;
    report.ignored.plans = existingPlans.filter(p => !configPlanKeys.has(p.key)).length;
    report.ignored.billingCycles = existingBillingCycles.filter(bc => !configBillingCycleKeys.has(bc.key)).length;

    // Phase 3: Sync Features (Independent Entities)
    for (const featureConfig of validatedConfig.features) {
      try {
        const existing = featuresByKey.get(featureConfig.key);
        
        if (!existing) {
          // Create new feature
          const createDto: CreateFeatureDto = {
            key: featureConfig.key,
            displayName: featureConfig.displayName,
            description: featureConfig.description,
            valueType: featureConfig.valueType,
            defaultValue: featureConfig.defaultValue,
            groupName: featureConfig.groupName,
            validator: featureConfig.validator,
            metadata: featureConfig.metadata
          };
          
          await this.subscrio.features.createFeature(createDto);
          report.created.features++;
          
          // Archive if needed
          if (featureConfig.archived === true) {
            await this.subscrio.features.archiveFeature(featureConfig.key);
            report.archived.features++;
          }
        } else {
          // Check if entity needs updating
          const needsUpdate = hasFeatureChanges(featureConfig, existing);
          
          if (needsUpdate) {
            const updateDto: UpdateFeatureDto = {};
            
            // Only include fields that are explicitly provided in config
            if (featureConfig.displayName !== undefined) {
              updateDto.displayName = featureConfig.displayName;
            }
            if (featureConfig.description !== undefined) {
              updateDto.description = featureConfig.description;
            }
            if (featureConfig.valueType !== undefined) {
              updateDto.valueType = featureConfig.valueType;
            }
            if (featureConfig.defaultValue !== undefined) {
              updateDto.defaultValue = featureConfig.defaultValue;
            }
            if (featureConfig.groupName !== undefined) {
              updateDto.groupName = featureConfig.groupName;
            }
            if (featureConfig.validator !== undefined) {
              updateDto.validator = featureConfig.validator;
            }
            if (featureConfig.metadata !== undefined) {
              updateDto.metadata = featureConfig.metadata;
            }
            
            await this.subscrio.features.updateFeature(featureConfig.key, updateDto);
            report.updated.features++;
          }
          
          // Handle archive status
          const isArchived = existing.status === 'archived';
          if (featureConfig.archived === true && !isArchived) {
            await this.subscrio.features.archiveFeature(featureConfig.key);
            report.archived.features++;
          } else if (featureConfig.archived === false && isArchived) {
            await this.subscrio.features.unarchiveFeature(featureConfig.key);
            report.unarchived.features++;
          }
        }
      } catch (error) {
        report.errors.push({
          entityType: 'feature',
          key: featureConfig.key,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Phase 4: Sync Products
    for (const productConfig of validatedConfig.products) {
      try {
        const existing = productsByKey.get(productConfig.key);
        
        console.log(`[ConfigSync] Processing product: ${productConfig.key}`);
        console.log(`[ConfigSync] Product found in lookup: ${!!existing}`);
        if (existing) {
          console.log(`[ConfigSync] Existing product:`, { 
            key: existing.key, 
            displayName: existing.displayName, 
            description: existing.description,
            status: existing.status 
          });
        }
        console.log(`[ConfigSync] Config product:`, { 
          key: productConfig.key, 
          displayName: productConfig.displayName, 
          description: productConfig.description,
          archived: productConfig.archived 
        });
        
        if (!existing) {
          // Create new product
          console.log(`[ConfigSync] Creating new product: ${productConfig.key}`);
          const createDto: CreateProductDto = {
            key: productConfig.key,
            displayName: productConfig.displayName,
            description: productConfig.description,
            metadata: productConfig.metadata
          };
          
          await this.subscrio.products.createProduct(createDto);
          report.created.products++;
          console.log(`[ConfigSync] Product created, count: ${report.created.products}`);
          
          // Archive if needed
          if (productConfig.archived === true) {
            await this.subscrio.products.archiveProduct(productConfig.key);
            report.archived.products++;
            console.log(`[ConfigSync] Product archived after creation, count: ${report.archived.products}`);
          }
        } else {
          // Check if entity needs updating
          const needsUpdate = hasProductChanges(productConfig, existing);
          console.log(`[ConfigSync] Product needs update: ${needsUpdate}`);
          console.log(`[ConfigSync] Change comparison:`, {
            displayName: `${productConfig.displayName} !== ${existing.displayName} = ${productConfig.displayName !== existing.displayName}`,
            description: `${normalizeValue(productConfig.description)} !== ${normalizeValue(existing.description)} = ${normalizeValue(productConfig.description) !== normalizeValue(existing.description)}`
          });
          
          if (needsUpdate) {
            const updateDto: UpdateProductDto = {};
            
            // Only include fields that are explicitly provided in config
            if (productConfig.displayName !== undefined) {
              updateDto.displayName = productConfig.displayName;
            }
            if (productConfig.description !== undefined) {
              updateDto.description = productConfig.description;
            }
            if (productConfig.metadata !== undefined) {
              updateDto.metadata = productConfig.metadata;
            }
            
            console.log(`[ConfigSync] Updating product with DTO:`, updateDto);
            await this.subscrio.products.updateProduct(productConfig.key, updateDto);
            report.updated.products++;
            console.log(`[ConfigSync] Product updated, count: ${report.updated.products}`);
          }
          
          // Handle archive status
          const isArchived = existing.status === 'archived';
          console.log(`[ConfigSync] Archive check:`, {
            configArchived: productConfig.archived,
            isArchived,
            shouldArchive: productConfig.archived === true && !isArchived,
            shouldUnarchive: productConfig.archived === false && isArchived
          });
          if (productConfig.archived === true && !isArchived) {
            console.log(`[ConfigSync] Archiving product: ${productConfig.key}`);
            await this.subscrio.products.archiveProduct(productConfig.key);
            report.archived.products++;
            console.log(`[ConfigSync] Product archived, count: ${report.archived.products}`);
          } else if (productConfig.archived === false && isArchived) {
            console.log(`[ConfigSync] Unarchiving product: ${productConfig.key}`);
            await this.subscrio.products.unarchiveProduct(productConfig.key);
            report.unarchived.products++;
            console.log(`[ConfigSync] Product unarchived, count: ${report.unarchived.products}`);
          }
        }

        // Sync product-feature associations
        if (productConfig.features) {
          try {
            console.log(`[ConfigSync] Syncing feature associations for product: ${productConfig.key}`);
            const currentFeatures = await this.subscrio.features.getFeaturesByProduct(productConfig.key);
            const currentFeatureKeys = new Set(currentFeatures.map(f => f.key));
            const configFeatureKeys = new Set(productConfig.features);
            
            console.log(`[ConfigSync] Current features:`, Array.from(currentFeatureKeys));
            console.log(`[ConfigSync] Config features:`, Array.from(configFeatureKeys));

            // Associate features in config but not in database
            for (const featureKey of productConfig.features) {
              if (!currentFeatureKeys.has(featureKey)) {
                console.log(`[ConfigSync] Associating feature: ${featureKey} to product: ${productConfig.key}`);
                await this.subscrio.products.associateFeature(productConfig.key, featureKey);
              } else {
                console.log(`[ConfigSync] Feature ${featureKey} already associated, skipping`);
              }
            }

            // Dissociate features in database but not in config
            for (const feature of currentFeatures) {
              if (!configFeatureKeys.has(feature.key)) {
                console.log(`[ConfigSync] Dissociating feature: ${feature.key} from product: ${productConfig.key}`);
                await this.subscrio.products.dissociateFeature(productConfig.key, feature.key);
              } else {
                console.log(`[ConfigSync] Feature ${feature.key} should remain associated, skipping`);
              }
            }
          } catch (error) {
            report.errors.push({
              entityType: 'product',
              key: productConfig.key,
              message: `Failed to sync feature associations: ${error instanceof Error ? error.message : String(error)}`
            });
          }
        }
      } catch (error) {
        report.errors.push({
          entityType: 'product',
          key: productConfig.key,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Phase 5: Sync Plans (Dependent on Products)
    // Track plans that need onExpireTransitionToBillingCycleKey set after billing cycles are created
    const plansPendingTransitionKey: Array<{ planKey: string; transitionKey: string }> = [];
    
    for (const productConfig of validatedConfig.products) {
      if (!productConfig.plans) continue;

      for (const planConfig of productConfig.plans) {
        try {
          // Plan keys are globally unique, so lookup by key only
          const existing = plansByKey.get(planConfig.key);
          
          // Check if billing cycle exists in database or will be created in this config
          const transitionBillingCycleKey = planConfig.onExpireTransitionToBillingCycleKey;
          const transitionBillingCycleExistsInDb = transitionBillingCycleKey
            ? billingCyclesByKey.has(transitionBillingCycleKey)
            : false;
          
          // Check if billing cycle exists in config (will be created in this sync)
          const transitionBillingCycleExistsInConfig = transitionBillingCycleKey
            ? validatedConfig.products.some(p => 
                p.plans?.some(plan => 
                  plan.billingCycles?.some(bc => bc.key === transitionBillingCycleKey)
                )
              )
            : false;
          
          if (!existing) {
            // Create new plan
            const createDto: CreatePlanDto = {
              productKey: productConfig.key,
              key: planConfig.key,
              displayName: planConfig.displayName,
              description: planConfig.description,
              metadata: planConfig.metadata
            };
            
            // Only set onExpireTransitionToBillingCycleKey if billing cycle already exists in database
            // If it only exists in config, we'll set it after billing cycles are created
            if (transitionBillingCycleExistsInDb && planConfig.onExpireTransitionToBillingCycleKey) {
              createDto.onExpireTransitionToBillingCycleKey = planConfig.onExpireTransitionToBillingCycleKey;
            }
            
            await this.subscrio.plans.createPlan(createDto);
            report.created.plans++;
            
            // If billing cycle doesn't exist in DB yet but exists in config, defer setting the transition key
            if (planConfig.onExpireTransitionToBillingCycleKey && !transitionBillingCycleExistsInDb && transitionBillingCycleExistsInConfig) {
              plansPendingTransitionKey.push({
                planKey: planConfig.key,
                transitionKey: planConfig.onExpireTransitionToBillingCycleKey
              });
            }
            
            // Archive if needed
            if (planConfig.archived === true) {
              await this.subscrio.plans.archivePlan(planConfig.key);
              report.archived.plans++;
            }
          } else {
            // Check if entity needs updating
            const needsUpdate = hasPlanChanges(planConfig, existing);
            
            if (needsUpdate) {
              const updateDto: UpdatePlanDto = {};
              
              // Only include fields that are explicitly provided in config
              if (planConfig.displayName !== undefined) {
                updateDto.displayName = planConfig.displayName;
              }
              if (planConfig.description !== undefined) {
                updateDto.description = planConfig.description;
              }
              // Only set onExpireTransitionToBillingCycleKey if billing cycle exists in database
              // If it only exists in config, defer until after billing cycles are created
              if (planConfig.onExpireTransitionToBillingCycleKey !== undefined) {
                if (transitionBillingCycleExistsInDb) {
                  updateDto.onExpireTransitionToBillingCycleKey = planConfig.onExpireTransitionToBillingCycleKey;
                } else if (transitionBillingCycleExistsInConfig) {
                  // Defer setting the transition key until billing cycle is created
                  plansPendingTransitionKey.push({
                    planKey: planConfig.key,
                    transitionKey: planConfig.onExpireTransitionToBillingCycleKey
                  });
                }
              }
              if (planConfig.metadata !== undefined) {
                updateDto.metadata = planConfig.metadata;
              }
              
              // Only update if there are fields to update
              if (Object.keys(updateDto).length > 0) {
                await this.subscrio.plans.updatePlan(planConfig.key, updateDto);
                report.updated.plans++;
              }
            } else if (planConfig.onExpireTransitionToBillingCycleKey !== undefined && !transitionBillingCycleExistsInDb && transitionBillingCycleExistsInConfig) {
              // Even if no other changes, we may need to defer setting the transition key
              const currentTransitionKey = existing.onExpireTransitionToBillingCycleKey;
              if (currentTransitionKey !== planConfig.onExpireTransitionToBillingCycleKey) {
                plansPendingTransitionKey.push({
                  planKey: planConfig.key,
                  transitionKey: planConfig.onExpireTransitionToBillingCycleKey
                });
              }
            }
            
            // Handle archive status
            const isArchived = existing.status === 'archived';
            if (planConfig.archived === true && !isArchived) {
              await this.subscrio.plans.archivePlan(planConfig.key);
              report.archived.plans++;
            } else if (planConfig.archived === false && isArchived) {
              await this.subscrio.plans.unarchivePlan(planConfig.key);
              report.unarchived.plans++;
            }
          }

          // Sync plan feature values
          if (planConfig.featureValues) {
            try {
              const currentPlanFeatures = await this.subscrio.plans.getPlanFeatures(planConfig.key);
              const currentFeatureMap = new Map(currentPlanFeatures.map(f => [f.featureKey, f.value]));
              const configFeatureKeys = new Set(Object.keys(planConfig.featureValues));

              // Set feature values in config (only if changed)
              for (const [featureKey, value] of Object.entries(planConfig.featureValues)) {
                const currentValue = currentFeatureMap.get(featureKey);
                
                // Only update if value changed
                if (currentValue !== value) {
                  const feature = await this.subscrio.features.getFeature(featureKey);
                  if (!feature) {
                    report.warnings.push({
                      entityType: 'plan',
                      key: planConfig.key,
                      message: `Feature '${featureKey}' not found, skipping feature value`
                    });
                    continue;
                  }
                  
                  await this.subscrio.plans.setFeatureValue(planConfig.key, featureKey, value);
                }
              }

              // Remove feature values not in config
              for (const planFeature of currentPlanFeatures) {
                if (!configFeatureKeys.has(planFeature.featureKey)) {
                  await this.subscrio.plans.removeFeatureValue(planConfig.key, planFeature.featureKey);
                }
              }
            } catch (error) {
              report.errors.push({
                entityType: 'plan',
                key: planConfig.key,
                message: `Failed to sync feature values: ${error instanceof Error ? error.message : String(error)}`
              });
            }
          }
        } catch (error) {
          report.errors.push({
            entityType: 'plan',
            key: planConfig.key,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    // Phase 6: Sync Billing Cycles (Dependent on Plans)
    for (const productConfig of validatedConfig.products) {
      if (!productConfig.plans) continue;

      for (const planConfig of productConfig.plans) {
        if (!planConfig.billingCycles) continue;

        for (const billingCycleConfig of planConfig.billingCycles) {
          try {
            // Billing cycle keys are globally unique, so lookup by key only
            const existing = billingCyclesByKey.get(billingCycleConfig.key);
            
            if (!existing) {
              // Create new billing cycle
              const createDto: CreateBillingCycleDto = {
                planKey: planConfig.key,
                key: billingCycleConfig.key,
                displayName: billingCycleConfig.displayName,
                description: billingCycleConfig.description,
                durationValue: billingCycleConfig.durationValue,
                durationUnit: billingCycleConfig.durationUnit,
                externalProductId: billingCycleConfig.externalProductId
              };
              
              await this.subscrio.billingCycles.createBillingCycle(createDto);
              report.created.billingCycles++;
              
              // Archive if needed
              if (billingCycleConfig.archived === true) {
                await this.subscrio.billingCycles.archiveBillingCycle(billingCycleConfig.key);
                report.archived.billingCycles++;
              }
            } else {
              // Check if entity needs updating
              const needsUpdate = hasBillingCycleChanges(billingCycleConfig, existing);
              
              if (needsUpdate) {
                const updateDto: UpdateBillingCycleDto = {
                  displayName: billingCycleConfig.displayName,
                  description: billingCycleConfig.description,
                  durationValue: billingCycleConfig.durationValue,
                  durationUnit: billingCycleConfig.durationUnit,
                  externalProductId: billingCycleConfig.externalProductId
                };
                
                await this.subscrio.billingCycles.updateBillingCycle(billingCycleConfig.key, updateDto);
                report.updated.billingCycles++;
              }
              
              // Handle archive status
              const isArchived = existing.status === 'archived';
              if (billingCycleConfig.archived === true && !isArchived) {
                await this.subscrio.billingCycles.archiveBillingCycle(billingCycleConfig.key);
                report.archived.billingCycles++;
              } else if (billingCycleConfig.archived === false && isArchived) {
                await this.subscrio.billingCycles.unarchiveBillingCycle(billingCycleConfig.key);
                report.unarchived.billingCycles++;
              }
            }
          } catch (error) {
            report.errors.push({
              entityType: 'billingCycle',
              key: billingCycleConfig.key,
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    }

    // Phase 7: Set deferred onExpireTransitionToBillingCycleKey values
    // Now that all billing cycles are created, update plans that were waiting for their transition keys
    for (const { planKey, transitionKey } of plansPendingTransitionKey) {
      try {
        // Verify billing cycle now exists
        const billingCycle = await this.subscrio.billingCycles.getBillingCycle(transitionKey);
        if (billingCycle) {
          await this.subscrio.plans.updatePlan(planKey, {
            onExpireTransitionToBillingCycleKey: transitionKey
          });
        } else {
          report.errors.push({
            entityType: 'plan',
            key: planKey,
            message: `Billing cycle key '${transitionKey}' referenced in onExpireTransitionToBillingCycleKey does not exist`
          });
        }
      } catch (error) {
        report.errors.push({
          entityType: 'plan',
          key: planKey,
          message: `Failed to set onExpireTransitionToBillingCycleKey: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }

    return report;
  }
}


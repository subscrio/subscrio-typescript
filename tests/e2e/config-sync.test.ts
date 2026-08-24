/**
 * Config Sync E2E Tests
 * 
 * These tests verify that the ConfigSyncService correctly synchronizes configuration
 * with the database. The sync service is designed to work with existing databases
 * (not just empty ones), so many tests manually create entities first to simulate
 * existing database state.
 * 
 * Testing Approach:
 * - "Setup" phase: Manually create entities using public API methods (createFeature,
 *   createProduct, etc.) to simulate a database that already has some entities.
 * - "Test" phase: Run syncFromJson() with a configuration and verify that:
 *   - New entities are created
 *   - Existing entities are updated only when values change
 *   - Entities not in config are ignored (additive sync)
 *   - Associations and relationships are synced correctly
 * 
 * This approach tests real-world scenarios where sync is run against databases
 * that already contain entities, ensuring sync is idempotent and non-destructive.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Subscrio, ConfigSyncDto } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';

describe('Config Sync E2E Tests', () => {
  let subscrio: Subscrio;
  let tempConfigFile: string;
  let testCounter: number;
  
  beforeAll(async () => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() }
    });
    
    // Create temp file path for testing syncFromFile
    tempConfigFile = join(tmpdir(), `subscrio-config-${Date.now()}.json`);
    testCounter = 0;
  });

  // Helper to generate unique test keys
  function uniqueKey(base: string): string {
    testCounter++;
    return `${base}-${testCounter}-${Date.now()}`;
  }

  describe('syncFromJson - Create from Scratch', () => {
    /**
     * Tests sync behavior when database is empty (fresh install scenario).
     * All entities in config should be created.
     */
    test('creates complete configuration from scratch when database is empty', async () => {
      const feature1Key = uniqueKey('max-projects');
      const feature2Key = uniqueKey('gantt-charts');
      const productKey = uniqueKey('project-management');
      const planKey = uniqueKey('basic');
      const billingCycleKey = uniqueKey('monthly');

      const config: ConfigSyncDto = {
        version: '1.0',
        features: [
          {
            key: feature1Key,
            displayName: 'Maximum Projects',
            description: 'Maximum number of projects allowed',
            valueType: 'numeric',
            defaultValue: '1',
            groupName: 'Limits'
          },
          {
            key: feature2Key,
            displayName: 'Gantt Charts',
            valueType: 'toggle',
            defaultValue: 'false',
            groupName: 'Features'
          }
        ],
        products: [
          {
            key: productKey,
            displayName: 'Project Management',
            features: [feature1Key, feature2Key],
            plans: [
              {
                key: planKey,
                displayName: 'Basic Plan',
                featureValues: {
                  [feature1Key]: '5',
                  [feature2Key]: 'false'
                },
                billingCycles: [
                  {
                    key: billingCycleKey,
                    displayName: 'Monthly',
                    durationValue: 1,
                    durationUnit: 'months'
                  }
                ]
              }
            ]
          }
        ]
      };

      const report = await subscrio.configSync.syncFromJson(config);

      expect(report.created.features).toBe(2);
      expect(report.created.products).toBe(1);
      expect(report.created.plans).toBe(1);
      expect(report.created.billingCycles).toBe(1);
      expect(report.errors).toHaveLength(0);

      // Verify entities were created
      const feature = await subscrio.features.getFeature(feature1Key);
      expect(feature).toBeDefined();
      expect(feature?.displayName).toBe('Maximum Projects');

      const product = await subscrio.products.getProduct(productKey);
      expect(product).toBeDefined();

      const plan = await subscrio.plans.getPlan(planKey);
      expect(plan).toBeDefined();

      const billingCycle = await subscrio.billingCycles.getBillingCycle(billingCycleKey);
      expect(billingCycle).toBeDefined();
    });
  });

  describe('syncFromJson - Update Existing', () => {
    /**
     * Tests sync behavior when entities already exist in database.
     * Sync should detect changes and only update entities that have changed.
     * 
     * Setup: Create entities manually to simulate existing database state.
     * Test: Sync with modified values and verify only changed entities are updated.
     */
    test('updates existing entities only when values have changed', async () => {
      // Setup: Create entities manually to simulate existing database state
      // This represents a database that already has some entities before sync
      await subscrio.features.createFeature({
        key: 'existing-feature',
        displayName: 'Old Name',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.products.createProduct({
        key: 'existing-product',
        displayName: 'Old Product Name'
      });

      // Test: Sync with modified values
      const config: ConfigSyncDto = {
        version: '1.0',
        features: [
          {
            key: 'existing-feature',
            displayName: 'New Name',
            valueType: 'toggle',
            defaultValue: 'true'
          }
        ],
        products: [
          {
            key: 'existing-product',
            displayName: 'New Product Name',
            description: 'Updated description'
          }
        ]
      };

      const report = await subscrio.configSync.syncFromJson(config);

      // Debug logging
      console.log('Update test - Report:', JSON.stringify(report, null, 2));
      console.log('Update test - Updated features:', report.updated.features);
      console.log('Update test - Updated products:', report.updated.products);
      console.log('Update test - Errors:', report.errors);
      
      // Verify the product exists and check its current state
      const productBefore = await subscrio.products.getProduct('existing-product');
      console.log('Update test - Product before sync:', productBefore);
      
      // Verify updates
      const feature = await subscrio.features.getFeature('existing-feature');
      console.log('Update test - Feature after sync:', feature);
      expect(feature?.displayName).toBe('New Name');
      expect(feature?.defaultValue).toBe('true');

      const product = await subscrio.products.getProduct('existing-product');
      console.log('Update test - Product after sync:', product);
      expect(product?.displayName).toBe('New Product Name');
      expect(product?.description).toBe('Updated description');
      
      expect(report.updated.features).toBe(1);
      expect(report.updated.products).toBe(1);
      expect(report.errors).toHaveLength(0);
    });
  });

  describe('syncFromJson - Archive/Unarchive', () => {
    /**
     * Tests archive behavior when entities exist and config sets archived: true.
     * 
     * Setup: Create active entities manually to simulate existing database state.
     * Test: Sync with archived: true and verify entities are archived.
     */
    test('archives active entities when archived: true in config', async () => {
      // Setup: Create active entities to simulate existing database state
      await subscrio.features.createFeature({
        key: 'feature-to-archive',
        displayName: 'Feature',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.products.createProduct({
        key: 'product-to-archive',
        displayName: 'Product'
      });

      // Test: Archive via sync
      const config: ConfigSyncDto = {
        version: '1.0',
        features: [
          {
            key: 'feature-to-archive',
            displayName: 'Feature',
            valueType: 'toggle',
            defaultValue: 'false',
            archived: true
          }
        ],
        products: [
          {
            key: 'product-to-archive',
            displayName: 'Product',
            archived: true
          }
        ]
      };

      // Check product status before sync
      const productBefore = await subscrio.products.getProduct('product-to-archive');
      console.log('Archive test - Product before sync:', productBefore);
      
      const report = await subscrio.configSync.syncFromJson(config);

      // Debug logging
      console.log('Archive test - Report:', JSON.stringify(report, null, 2));
      console.log('Archive test - Archived features:', report.archived.features);
      console.log('Archive test - Archived products:', report.archived.products);
      console.log('Archive test - Errors:', report.errors);

      // Verify archived status
      const feature = await subscrio.features.getFeature('feature-to-archive');
      console.log('Archive test - Feature after sync:', feature);
      expect(feature?.status).toBe('archived');

      const product = await subscrio.products.getProduct('product-to-archive');
      console.log('Archive test - Product after sync:', product);
      expect(product?.status).toBe('archived');
      
      expect(report.archived.features).toBe(1);
      expect(report.archived.products).toBe(1);
    });

    /**
     * Tests unarchive behavior when entities are archived and config sets archived: false.
     * 
     * Setup: Create and archive entities manually to simulate existing archived state.
     * Test: Sync with archived: false and verify entities are unarchived.
     */
    test('unarchives archived entities when archived: false in config', async () => {
      // Setup: Create and archive entities to simulate existing archived state
      await subscrio.features.createFeature({
        key: 'feature-to-unarchive',
        displayName: 'Feature',
        valueType: 'toggle',
        defaultValue: 'false'
      });
      await subscrio.features.archiveFeature('feature-to-unarchive');

      // Test: Unarchive via sync
      const config: ConfigSyncDto = {
        version: '1.0',
        features: [
          {
            key: 'feature-to-unarchive',
            displayName: 'Feature',
            valueType: 'toggle',
            defaultValue: 'false',
            archived: false
          }
        ],
        products: []
      };

      const report = await subscrio.configSync.syncFromJson(config);

      expect(report.unarchived.features).toBe(1);

      // Verify unarchived status
      const feature = await subscrio.features.getFeature('feature-to-unarchive');
      expect(feature?.status).toBe('active');
    });
  });

  describe('syncFromJson - Entities Not in Config Remain Unchanged', () => {
    /**
     * Tests that sync is additive - entities in database but not in config are ignored.
     * This is critical for partial syncs where you only want to update specific entities.
     * 
     * Setup: Create entities manually that won't be in the sync config.
     * Test: Sync with different entities and verify original entities remain untouched.
     */
    test('ignores entities in database that are not present in config (additive sync)', async () => {
      // Setup: Create entities that will NOT be in the sync config
      // This simulates a database with existing entities that should remain unchanged
      await subscrio.features.createFeature({
        key: 'ignored-feature',
        displayName: 'Ignored Feature',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.products.createProduct({
        key: 'ignored-product',
        displayName: 'Ignored Product'
      });

      // Test: Sync with completely different entities
      const config: ConfigSyncDto = {
        version: '1.0',
        features: [
          {
            key: 'other-feature',
            displayName: 'Other Feature',
            valueType: 'toggle',
            defaultValue: 'false'
          }
        ],
        products: [
          {
            key: 'other-product',
            displayName: 'Other Product'
          }
        ]
      };

      const report = await subscrio.configSync.syncFromJson(config);

      expect(report.ignored.features).toBeGreaterThan(0);
      expect(report.ignored.products).toBeGreaterThan(0);

      // Verify ignored entities still exist and unchanged
      const ignoredFeature = await subscrio.features.getFeature('ignored-feature');
      expect(ignoredFeature).toBeDefined();
      expect(ignoredFeature?.displayName).toBe('Ignored Feature');

      const ignoredProduct = await subscrio.products.getProduct('ignored-product');
      expect(ignoredProduct).toBeDefined();
      expect(ignoredProduct?.displayName).toBe('Ignored Product');
    });
  });

  describe('syncFromJson - Feature Associations', () => {
    /**
     * Tests that sync updates product-feature associations to match config.
     * 
     * Setup: Create entities and set up initial associations manually.
     * Test: Sync with different associations and verify they are updated correctly.
     */
    test('syncs product-feature associations to match config', async () => {
      // Setup: Create features and product with initial associations
      // This simulates existing database state with some associations already set
      await subscrio.features.createFeature({
        key: 'feature-1',
        displayName: 'Feature 1',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.features.createFeature({
        key: 'feature-2',
        displayName: 'Feature 2',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.products.createProduct({
        key: 'product-with-features',
        displayName: 'Product'
      });

      // Setup: Associate feature-1 to simulate existing association
      await subscrio.products.associateFeature('product-with-features', 'feature-1');

      // Test: Sync with different associations (only feature-2)
      const config: ConfigSyncDto = {
        version: '1.0',
        features: [
          { key: 'feature-1', displayName: 'Feature 1', valueType: 'toggle', defaultValue: 'false' },
          { key: 'feature-2', displayName: 'Feature 2', valueType: 'toggle', defaultValue: 'false' }
        ],
        products: [
          {
            key: 'product-with-features',
            displayName: 'Product',
            features: ['feature-2']  // Only feature-2, not feature-1
          }
        ]
      };

      // Check associations before sync
      const featuresBefore = await subscrio.features.getFeaturesByProduct('product-with-features');
      console.log('Feature association test - Features before sync:', featuresBefore.map(f => f.key));
      
      await subscrio.configSync.syncFromJson(config);

      // Verify associations
      const features = await subscrio.features.getFeaturesByProduct('product-with-features');
      console.log('Feature association test - Features after sync:', features.map(f => f.key));
      expect(features).toHaveLength(1);
      expect(features[0].key).toBe('feature-2');
    });
  });

  describe('syncFromJson - Plan Feature Values', () => {
    /**
     * Tests that sync updates plan feature values only when they change.
     * 
     * Setup: Create entities and set initial feature value manually.
     * Test: Sync with different value and verify it's updated, but unchanged values aren't touched.
     */
    test('syncs plan feature values only when values have changed', async () => {
      // Setup: Create entities and set initial feature value
      // This simulates existing database state with feature values already set
      await subscrio.features.createFeature({
        key: 'max-items',
        displayName: 'Max Items',
        valueType: 'numeric',
        defaultValue: '10'
      });

      await subscrio.products.createProduct({
        key: 'product-for-plan',
        displayName: 'Product'
      });

      await subscrio.products.associateFeature('product-for-plan', 'max-items');

      await subscrio.plans.createPlan({
        productKey: 'product-for-plan',
        key: 'plan-with-features',
        displayName: 'Plan'
      });

      // Setup: Set initial feature value to simulate existing state
      await subscrio.plans.setFeatureValue('plan-with-features', 'max-items', '20');

      // Test: Sync with different feature value
      const config: ConfigSyncDto = {
        version: '1.0',
        features: [
          { key: 'max-items', displayName: 'Max Items', valueType: 'numeric', defaultValue: '10' }
        ],
        products: [
          {
            key: 'product-for-plan',
            displayName: 'Product',
            features: ['max-items'],
            plans: [
              {
                key: 'plan-with-features',
                displayName: 'Plan',
                featureValues: {
                  'max-items': '50'  // Different value
                }
              }
            ]
          }
        ]
      };

      await subscrio.configSync.syncFromJson(config);

      // Verify feature value updated
      const value = await subscrio.plans.getFeatureValue('plan-with-features', 'max-items');
      expect(value).toBe('50');
    });
  });

  describe('syncFromJson - Validation Errors', () => {
    test('throws ValidationError for invalid feature value type', async () => {
      const config: ConfigSyncDto = {
        version: '1.0',
        features: [
          {
            key: 'numeric-feature',
            displayName: 'Numeric Feature',
            valueType: 'numeric',
            defaultValue: '10'
          }
        ],
        products: [
          {
            key: 'product',
            displayName: 'Product',
            features: ['numeric-feature'],
            plans: [
              {
                key: 'plan',
                displayName: 'Plan',
                featureValues: {
                  'numeric-feature': 'not-a-number'  // Invalid for numeric type
                }
              }
            ]
          }
        ]
      };

      // Validation should catch this in the schema
      await expect(
        subscrio.configSync.syncFromJson(config)
      ).rejects.toThrow();
    });

    test('throws ValidationError for missing feature reference', async () => {
      const config: ConfigSyncDto = {
        version: '1.0',
        features: [],
        products: [
          {
            key: 'product',
            displayName: 'Product',
            features: ['non-existent-feature']  // Feature doesn't exist
          }
        ]
      };

      await expect(
        subscrio.configSync.syncFromJson(config)
      ).rejects.toThrow();
    });
  });

  describe('syncFromFile', () => {
    test('syncs from JSON file', async () => {
      const config: ConfigSyncDto = {
        version: '1.0',
        features: [
          {
            key: 'file-feature',
            displayName: 'File Feature',
            valueType: 'toggle',
            defaultValue: 'false'
          }
        ],
        products: [
          {
            key: 'file-product',
            displayName: 'File Product'
          }
        ]
      };

      // Write config to temp file
      await writeFile(tempConfigFile, JSON.stringify(config, null, 2), 'utf-8');

      try {
        const report = await subscrio.configSync.syncFromFile(tempConfigFile);

        expect(report.created.features).toBe(1);
        expect(report.created.products).toBe(1);
        expect(report.errors).toHaveLength(0);

        // Verify entities created
        const feature = await subscrio.features.getFeature('file-feature');
        expect(feature).toBeDefined();

        const product = await subscrio.products.getProduct('file-product');
        expect(product).toBeDefined();
      } finally {
        // Cleanup
        try {
          await unlink(tempConfigFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    test('validates JSON property order (features before products)', async () => {
      // Create invalid JSON with products before features
      const invalidConfig = {
        version: '1.0',
        products: [],  // Products before features - invalid!
        features: []
      };

      await writeFile(tempConfigFile, JSON.stringify(invalidConfig, null, 2), 'utf-8');

      try {
        await expect(
          subscrio.configSync.syncFromFile(tempConfigFile)
        ).rejects.toThrow();
      } finally {
        try {
          await unlink(tempConfigFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('syncFromJson - Partial Updates', () => {
    /**
     * Tests that sync supports partial configurations - only entities in config are synced.
     * This is important for incremental updates where you only want to update specific entities.
     * 
     * Setup: Create multiple entities manually to simulate existing database state.
     * Test: Sync with only some entities and verify others remain unchanged.
     */
    test('handles partial configuration - only syncs entities present in config', async () => {
      // Setup: Create multiple entities to simulate existing database state
      // These represent entities that exist but won't all be in the sync config
      await subscrio.features.createFeature({
        key: 'partial-feature-1',
        displayName: 'Feature 1',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.features.createFeature({
        key: 'partial-feature-2',
        displayName: 'Feature 2',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      // Test: Sync with only one feature (partial-feature-1)
      const config: ConfigSyncDto = {
        version: '1.0',
        features: [
          {
            key: 'partial-feature-1',
            displayName: 'Updated Feature 1',
            valueType: 'toggle',
            defaultValue: 'true'
          }
        ],
        products: []
      };

      const report = await subscrio.configSync.syncFromJson(config);

      expect(report.updated.features).toBe(1);
      expect(report.ignored.features).toBeGreaterThan(0);

      // Verify only feature-1 was updated
      const feature1 = await subscrio.features.getFeature('partial-feature-1');
      expect(feature1?.displayName).toBe('Updated Feature 1');
      expect(feature1?.defaultValue).toBe('true');

      const feature2 = await subscrio.features.getFeature('partial-feature-2');
      expect(feature2?.displayName).toBe('Feature 2');  // Unchanged
    });
  });

  describe('syncFromJson - Billing Cycle References', () => {
    test('validates onExpireTransitionToBillingCycleKey references', async () => {
      const productKey1 = uniqueKey('validation-test-product');
      const productKey2 = uniqueKey('validation-test-product');
      
      // Test 1: Should fail when billing cycle doesn't exist in any plan within the product
      const invalidConfig: ConfigSyncDto = {
        version: '1.0',
        features: [],
        products: [
          {
            key: productKey1,
            displayName: 'Product',
            plans: [
              {
                key: uniqueKey('plan'),
                displayName: 'Plan',
                onExpireTransitionToBillingCycleKey: 'non-existent-cycle',  // Invalid reference
                billingCycles: [
                  {
                    key: uniqueKey('monthly'),
                    displayName: 'Monthly',
                    durationValue: 1,
                    durationUnit: 'months'
                  }
                ]
              }
            ]
          }
        ]
      };

      // Should fail validation because billing cycle key doesn't exist in any plan within the product
      await expect(
        subscrio.configSync.syncFromJson(invalidConfig)
      ).rejects.toThrow();

      // Test 2: Should succeed when billing cycle exists in a different plan within the same product
      const trialPlanKey = uniqueKey('trial-plan');
      const freePlanKey = uniqueKey('free-plan');
      const freeForeverCycleKey = uniqueKey('free-forever');
      
      const validCrossPlanConfig: ConfigSyncDto = {
        version: '1.0',
        features: [],
        products: [
          {
            key: productKey2,
            displayName: 'Product',
            plans: [
              {
                key: trialPlanKey,
                displayName: 'Trial Plan',
                onExpireTransitionToBillingCycleKey: freeForeverCycleKey,  // References billing cycle from different plan
                billingCycles: [
                  {
                    key: uniqueKey('trial-cycle'),
                    displayName: 'Trial Cycle',
                    durationValue: 14,
                    durationUnit: 'days'
                  }
                ]
              },
              {
                key: freePlanKey,
                displayName: 'Free Plan',
                billingCycles: [
                  {
                    key: freeForeverCycleKey,
                    displayName: 'Free Forever',
                    durationUnit: 'forever'
                  }
                ]
              }
            ]
          }
        ]
      };

      // Should succeed because the referenced billing cycle exists in another plan within the same product
      const report = await subscrio.configSync.syncFromJson(validCrossPlanConfig);
      expect(report).toBeDefined();
      expect(report.errors).toHaveLength(0);
      
      // Verify that the trial plan has the onExpireTransitionToBillingCycleKey set to the free-forever cycle
      // which exists in a DIFFERENT plan (free-plan) within the same product
      const trialPlan = await subscrio.plans.getPlan(trialPlanKey);
      expect(trialPlan).toBeDefined();
      expect(trialPlan?.onExpireTransitionToBillingCycleKey).toBe(freeForeverCycleKey);
      
      // Verify that the free-forever billing cycle exists and is associated with the free-plan, not trial-plan
      const freeForeverCycle = await subscrio.billingCycles.getBillingCycle(freeForeverCycleKey);
      expect(freeForeverCycle).toBeDefined();
      expect(freeForeverCycle?.planKey).toBe(freePlanKey); // Should be in free-plan, not trial-plan
      
      // Verify that trial-plan has its own billing cycle
      const trialCycles = await subscrio.billingCycles.getBillingCyclesByPlan(trialPlanKey);
      expect(trialCycles.length).toBeGreaterThan(0);
      expect(trialCycles.some(bc => bc.key === freeForeverCycleKey)).toBe(false); // free-forever should NOT be in trial-plan
      
      // Verify that free-plan has the free-forever cycle
      const freePlanCycles = await subscrio.billingCycles.getBillingCyclesByPlan(freePlanKey);
      expect(freePlanCycles.some(bc => bc.key === freeForeverCycleKey)).toBe(true); // free-forever SHOULD be in free-plan
    });
  });

  describe('syncFromJson - onExpireTransitionToBillingCycleKey Updates', () => {
    /**
     * Tests that onExpireTransitionToBillingCycleKey is properly set/updated during sync.
     * 
     * This test verifies the specific issue where onExpireTransitionToBillingCycleKey
     * wasn't being set when provided in the config sync.
     * 
     * Setup: Create plans with onExpireTransitionToBillingCycleKey set to null,
     *        and create billing cycles for those plans.
     * Test: Sync with config that sets onExpireTransitionToBillingCycleKey and verify
     *       the stored value is correctly updated.
     */
    test('sets onExpireTransitionToBillingCycleKey when provided in config', async () => {
      const productKey = uniqueKey('transition-test-product');
      const plan1Key = uniqueKey('plan-without-transition');
      const plan2Key = uniqueKey('plan-with-transition');
      const cycle1Key = uniqueKey('monthly-cycle');
      const cycle2Key = uniqueKey('yearly-cycle');
      const transitionCycleKey = uniqueKey('transition-cycle');

      // Setup: Create product and plans manually
      await subscrio.products.createProduct({
        key: productKey,
        displayName: 'Transition Test Product'
      });

      // Create plan 1: without onExpireTransitionToBillingCycleKey (null)
      const plan1 = await subscrio.plans.createPlan({
        productKey: productKey,
        key: plan1Key,
        displayName: 'Plan Without Transition'
        // onExpireTransitionToBillingCycleKey not set, should be null
      });

      // Create plan 2: without onExpireTransitionToBillingCycleKey initially
      const plan2 = await subscrio.plans.createPlan({
        productKey: productKey,
        key: plan2Key,
        displayName: 'Plan With Transition'
        // onExpireTransitionToBillingCycleKey not set, should be null
      });

      // Create billing cycles for plan1
      const cycle1 = await subscrio.billingCycles.createBillingCycle({
        planKey: plan1Key,
        key: cycle1Key,
        displayName: 'Monthly',
        durationValue: 1,
        durationUnit: 'months'
      });

      const cycle2 = await subscrio.billingCycles.createBillingCycle({
        planKey: plan1Key,
        key: cycle2Key,
        displayName: 'Yearly',
        durationValue: 1,
        durationUnit: 'years'
      });

      // Create transition cycle for plan2
      const transitionCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan2Key,
        key: transitionCycleKey,
        displayName: 'Transition Cycle',
        durationValue: 1,
        durationUnit: 'months'
      });

      // Verify initial state - onExpireTransitionToBillingCycleKey should be null
      const plan1Before = await subscrio.plans.getPlan(plan1Key);
      const plan2Before = await subscrio.plans.getPlan(plan2Key);
      
      expect(plan1Before?.onExpireTransitionToBillingCycleKey).toBeNull();
      expect(plan2Before?.onExpireTransitionToBillingCycleKey).toBeNull();

      // Test: Sync with config that sets onExpireTransitionToBillingCycleKey
      const config: ConfigSyncDto = {
        version: '1.0',
        features: [],
        products: [
          {
            key: productKey,
            displayName: 'Transition Test Product',
            plans: [
              {
                key: plan1Key,
                displayName: 'Plan Without Transition',
                // Set onExpireTransitionToBillingCycleKey to cycle2
                onExpireTransitionToBillingCycleKey: cycle2Key,
                billingCycles: [
                  {
                    key: cycle1Key,
                    displayName: 'Monthly',
                    durationValue: 1,
                    durationUnit: 'months'
                  },
                  {
                    key: cycle2Key,
                    displayName: 'Yearly',
                    durationValue: 1,
                    durationUnit: 'years'
                  }
                ]
              },
              {
                key: plan2Key,
                displayName: 'Plan With Transition',
                // Set onExpireTransitionToBillingCycleKey to transitionCycle
                onExpireTransitionToBillingCycleKey: transitionCycleKey,
                billingCycles: [
                  {
                    key: transitionCycleKey,
                    displayName: 'Transition Cycle',
                    durationValue: 1,
                    durationUnit: 'months'
                  }
                ]
              }
            ]
          }
        ]
      };

      const report = await subscrio.configSync.syncFromJson(config);

      // Verify no errors
      expect(report.errors).toHaveLength(0);

      // Verify the onExpireTransitionToBillingCycleKey was set
      const plan1After = await subscrio.plans.getPlan(plan1Key);
      const plan2After = await subscrio.plans.getPlan(plan2Key);

      console.log('Plan1 before:', plan1Before?.onExpireTransitionToBillingCycleKey);
      console.log('Plan1 after:', plan1After?.onExpireTransitionToBillingCycleKey);
      console.log('Plan2 before:', plan2Before?.onExpireTransitionToBillingCycleKey);
      console.log('Plan2 after:', plan2After?.onExpireTransitionToBillingCycleKey);
      console.log('Sync report:', JSON.stringify(report, null, 2));

      // This is the critical assertion - onExpireTransitionToBillingCycleKey should be set
      expect(plan1After?.onExpireTransitionToBillingCycleKey).toBe(cycle2Key);
      expect(plan2After?.onExpireTransitionToBillingCycleKey).toBe(transitionCycleKey);

      // Verify plans were updated (not created)
      expect(report.updated.plans).toBeGreaterThanOrEqual(2);
    });

    test('preserves onExpireTransitionToBillingCycleKey when not in config', async () => {
      const productKey = uniqueKey('preserve-test-product');
      const planKey = uniqueKey('preserve-plan');
      const cycleKey = uniqueKey('preserve-cycle');
      const transitionCycleKey = uniqueKey('preserve-transition-cycle');

      // Setup: Create plan with onExpireTransitionToBillingCycleKey already set
      await subscrio.products.createProduct({
        key: productKey,
        displayName: 'Preserve Test Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: productKey,
        key: planKey,
        displayName: 'Preserve Plan'
      });

      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: planKey,
        key: cycleKey,
        displayName: 'Monthly',
        durationValue: 1,
        durationUnit: 'months'
      });

      const transitionCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: planKey,
        key: transitionCycleKey,
        displayName: 'Transition',
        durationValue: 1,
        durationUnit: 'months'
      });

      // Set onExpireTransitionToBillingCycleKey initially
      await subscrio.plans.updatePlan(planKey, {
        onExpireTransitionToBillingCycleKey: transitionCycleKey
      });

      // Verify it's set
      const planBefore = await subscrio.plans.getPlan(planKey);
      expect(planBefore?.onExpireTransitionToBillingCycleKey).toBe(transitionCycleKey);

      // Test: Sync with config that does NOT include onExpireTransitionToBillingCycleKey
      const config: ConfigSyncDto = {
        version: '1.0',
        features: [],
        products: [
          {
            key: productKey,
            displayName: 'Preserve Test Product',
            plans: [
              {
                key: planKey,
                displayName: 'Preserve Plan Updated',
                // onExpireTransitionToBillingCycleKey NOT included in config
                billingCycles: [
                  {
                    key: cycleKey,
                    displayName: 'Monthly',
                    durationValue: 1,
                    durationUnit: 'months'
                  },
                  {
                    key: transitionCycleKey,
                    displayName: 'Transition',
                    durationValue: 1,
                    durationUnit: 'months'
                  }
                ]
              }
            ]
          }
        ]
      };

      const report = await subscrio.configSync.syncFromJson(config);

      // Verify the onExpireTransitionToBillingCycleKey is preserved
      const planAfter = await subscrio.plans.getPlan(planKey);

      console.log('Plan before:', planBefore?.onExpireTransitionToBillingCycleKey);
      console.log('Plan after:', planAfter?.onExpireTransitionToBillingCycleKey);
      console.log('Plan displayName before:', planBefore?.displayName);
      console.log('Plan displayName after:', planAfter?.displayName);

      // Should be preserved since it's not in config
      expect(planAfter?.onExpireTransitionToBillingCycleKey).toBe(transitionCycleKey);
      // But displayName should be updated
      expect(planAfter?.displayName).toBe('Preserve Plan Updated');
    });

    test('does not clear onExpireTransitionToBillingCycleKey when field is undefined in config', async () => {
      const productKey = uniqueKey('clear-test-product');
      const planKey = uniqueKey('clear-plan');
      const cycleKey = uniqueKey('clear-cycle');

      // Setup: Create plan with onExpireTransitionToBillingCycleKey set
      await subscrio.products.createProduct({
        key: productKey,
        displayName: 'Clear Test Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: productKey,
        key: planKey,
        displayName: 'Clear Plan'
      });

      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: planKey,
        key: cycleKey,
        displayName: 'Monthly',
        durationValue: 1,
        durationUnit: 'months'
      });

      // Set onExpireTransitionToBillingCycleKey initially
      await subscrio.plans.updatePlan(planKey, {
        onExpireTransitionToBillingCycleKey: cycleKey
      });

      // Verify it's set
      const planBefore = await subscrio.plans.getPlan(planKey);
      expect(planBefore?.onExpireTransitionToBillingCycleKey).toBe(cycleKey);

      // Test: Sync with config that explicitly omits onExpireTransitionToBillingCycleKey
      // (by not including it in the plan config)
      const config: ConfigSyncDto = {
        version: '1.0',
        features: [],
        products: [
          {
            key: productKey,
            displayName: 'Clear Test Product',
            plans: [
              {
                key: planKey,
                displayName: 'Clear Plan',
                // onExpireTransitionToBillingCycleKey is undefined (not in config)
                // This should NOT clear the existing value
                billingCycles: [
                  {
                    key: cycleKey,
                    displayName: 'Monthly',
                    durationValue: 1,
                    durationUnit: 'months'
                  }
                ]
              }
            ]
          }
        ]
      };

      const report = await subscrio.configSync.syncFromJson(config);

      const planAfter = await subscrio.plans.getPlan(planKey);

      console.log('Plan before:', planBefore?.onExpireTransitionToBillingCycleKey);
      console.log('Plan after:', planAfter?.onExpireTransitionToBillingCycleKey);

      // When field is not in config, it should be preserved (not cleared)
      // This tests that undefined in config doesn't clear existing values
      expect(planAfter?.onExpireTransitionToBillingCycleKey).toBe(cycleKey);
    });

    test('updates onExpireTransitionToBillingCycleKey from one value to another', async () => {
      const productKey = uniqueKey('update-test-product');
      const planKey = uniqueKey('update-plan');
      const cycle1Key = uniqueKey('cycle-1');
      const cycle2Key = uniqueKey('cycle-2');

      // Setup: Create plan with onExpireTransitionToBillingCycleKey set to cycle1
      await subscrio.products.createProduct({
        key: productKey,
        displayName: 'Update Test Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: productKey,
        key: planKey,
        displayName: 'Update Plan'
      });

      const cycle1 = await subscrio.billingCycles.createBillingCycle({
        planKey: planKey,
        key: cycle1Key,
        displayName: 'Monthly',
        durationValue: 1,
        durationUnit: 'months'
      });

      const cycle2 = await subscrio.billingCycles.createBillingCycle({
        planKey: planKey,
        key: cycle2Key,
        displayName: 'Yearly',
        durationValue: 1,
        durationUnit: 'years'
      });

      // Set onExpireTransitionToBillingCycleKey initially to cycle1
      await subscrio.plans.updatePlan(planKey, {
        onExpireTransitionToBillingCycleKey: cycle1Key
      });

      // Verify it's set to cycle1
      const planBefore = await subscrio.plans.getPlan(planKey);
      expect(planBefore?.onExpireTransitionToBillingCycleKey).toBe(cycle1Key);

      // Test: Sync with config that changes onExpireTransitionToBillingCycleKey to cycle2
      const config: ConfigSyncDto = {
        version: '1.0',
        features: [],
        products: [
          {
            key: productKey,
            displayName: 'Update Test Product',
            plans: [
              {
                key: planKey,
                displayName: 'Update Plan',
                onExpireTransitionToBillingCycleKey: cycle2Key, // Change to cycle2
                billingCycles: [
                  {
                    key: cycle1Key,
                    displayName: 'Monthly',
                    durationValue: 1,
                    durationUnit: 'months'
                  },
                  {
                    key: cycle2Key,
                    displayName: 'Yearly',
                    durationValue: 1,
                    durationUnit: 'years'
                  }
                ]
              }
            ]
          }
        ]
      };

      const report = await subscrio.configSync.syncFromJson(config);

      const planAfter = await subscrio.plans.getPlan(planKey);

      console.log('Plan before:', planBefore?.onExpireTransitionToBillingCycleKey);
      console.log('Plan after:', planAfter?.onExpireTransitionToBillingCycleKey);
      console.log('Sync report updated plans:', report.updated.plans);

      // Should be updated to cycle2
      expect(planAfter?.onExpireTransitionToBillingCycleKey).toBe(cycle2Key);
      expect(report.updated.plans).toBeGreaterThanOrEqual(1);
    });
  });
});


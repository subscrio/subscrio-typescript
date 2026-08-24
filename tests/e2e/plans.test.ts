import { describe, test, expect, beforeAll } from 'vitest';
import { Subscrio } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';

describe('Plans E2E Tests', () => {
  let subscrio: Subscrio;
  
  beforeAll(() => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() }
    });
  });

  describe('CRUD Operations', () => {
    test('creates a plan with valid data', async () => {
      const product = await subscrio.products.createProduct({
        key: `plan-product-${Date.now()}`,
        displayName: 'Plan Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: `basic-plan-${Date.now()}`,
        displayName: 'Basic Plan',
        description: 'A basic plan'
      });

      expect(plan).toBeDefined();
      expect(plan.key).toMatch(/^basic-plan-/);
      expect(plan.productKey).toBe(product.key);
      expect(plan.displayName).toBe('Basic Plan');
      expect(plan.status).toBe('active');
    });

    test('retrieves plan by plan key', async () => {
      const product = await subscrio.products.createProduct({
        key: 'retrieve-product',
        displayName: 'Retrieve Product'
      });

      const created = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'retrieve-plan',
        displayName: 'Retrieve Plan'
      });

      const retrieved = await subscrio.plans.getPlan(created.key);
      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe(created.key);
      expect(retrieved?.productKey).toBe(product.key);
    });

    test('updates plan display name', async () => {
      const product = await subscrio.products.createProduct({
        key: 'update-name-product',
        displayName: 'Update Name Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'update-name-plan',
        displayName: 'Original Name'
      });

      const updated = await subscrio.plans.updatePlan(plan.key, {
        displayName: 'Updated Name'
      });

      expect(updated.displayName).toBe('Updated Name');
    });

    test('updates plan description', async () => {
      const product = await subscrio.products.createProduct({
        key: 'update-desc-product',
        displayName: 'Update Desc Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'update-desc-plan',
        displayName: 'Update Desc',
        description: 'Old description'
      });

      const updated = await subscrio.plans.updatePlan(plan.key, {
        description: 'New description'
      });

      expect(updated.description).toBe('New description');
    });

    test('returns null for non-existent plan', async () => {
      const product = await subscrio.products.createProduct({
        key: 'null-plan-product',
        displayName: 'Null Plan Product'
      });

      const result = await subscrio.plans.getPlan('non-existent-plan');
      expect(result).toBeNull();
    });

    test('throws error when updating non-existent plan', async () => {
      const product = await subscrio.products.createProduct({
        key: `error-plan-product-${Date.now()}`,
        displayName: 'Error Plan Product'
      });

      await expect(
        subscrio.plans.updatePlan('non-existent', {
          displayName: 'New Name'
        })
      ).rejects.toThrow('not found');
    });
  });

  describe('Validation Tests', () => {
    test('throws error for empty plan key', async () => {
      const product = await subscrio.products.createProduct({
        key: 'empty-key-product',
        displayName: 'Empty Key Product'
      });

      await expect(
        subscrio.plans.createPlan({
          productKey: product.key,
          key: '',
          displayName: 'Test'
        })
      ).rejects.toThrow();
    });

    test('throws error for invalid key format', async () => {
      const product = await subscrio.products.createProduct({
        key: `invalid-key-product-${Date.now()}`,
        displayName: 'Invalid Key Product'
      });

      await expect(
        subscrio.plans.createPlan({
          productKey: product.key,
          key: 'Invalid Key!',
          displayName: 'Invalid'
        })
      ).rejects.toThrow();
    });

    test('throws error for duplicate plan key globally', async () => {
      const product1 = await subscrio.products.createProduct({
        key: 'product-1-dup',
        displayName: 'Product 1'
      });

      const product2 = await subscrio.products.createProduct({
        key: 'product-2-dup',
        displayName: 'Product 2'
      });

      await subscrio.plans.createPlan({
        productKey: product1.key,
        key: 'duplicate-plan',
        displayName: 'Plan 1'
      });

      await expect(
        subscrio.plans.createPlan({
          productKey: product2.key,
          key: 'duplicate-plan',
          displayName: 'Plan 2'
        })
      ).rejects.toThrow('already exists');
    });

    test('throws error for non-existent product key', async () => {
      await expect(
        subscrio.plans.createPlan({
          productKey: 'non-existent-product',
          key: 'test-plan',
          displayName: 'Test Plan'
        })
      ).rejects.toThrow('not found');
    });
  });

  describe('Lifecycle/Status Tests', () => {
    test('activates a plan', async () => {
      const product = await subscrio.products.createProduct({
        key: 'activate-plan-product',
        displayName: 'Activate Plan Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'activate-plan',
        displayName: 'Activate Plan'
      });

      await subscrio.plans.archivePlan(plan.key);
      await subscrio.plans.unarchivePlan(plan.key);

      const retrieved = await subscrio.plans.getPlan(plan.key);
      expect(retrieved?.status).toBe('active');
    });

    test('deactivates a plan', async () => {
      const product = await subscrio.products.createProduct({
        key: 'deactivate-plan-product',
        displayName: 'Deactivate Plan Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'deactivate-plan',
        displayName: 'Deactivate Plan'
      });

      await subscrio.plans.archivePlan(plan.key);

      const retrieved = await subscrio.plans.getPlan(plan.key);
      expect(retrieved?.status).toBe('archived');
    });

    test('archives a plan', async () => {
      const product = await subscrio.products.createProduct({
        key: 'archive-plan-product',
        displayName: 'Archive Plan Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'archive-plan',
        displayName: 'Archive Plan'
      });

      await subscrio.plans.archivePlan(plan.key);

      const retrieved = await subscrio.plans.getPlan(plan.key);
      expect(retrieved?.status).toBe('archived');
    });

    test('deletes an archived plan', async () => {
      const product = await subscrio.products.createProduct({
        key: 'delete-plan-product',
        displayName: 'Delete Plan Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'delete-plan',
        displayName: 'Delete Plan'
      });

      await subscrio.plans.archivePlan(plan.key);
      await subscrio.plans.deletePlan(plan.key);

      const retrieved = await subscrio.plans.getPlan(plan.key);
      expect(retrieved).toBeNull();
    });

    test('throws error when deleting active plan', async () => {
      const product = await subscrio.products.createProduct({
        key: 'delete-active-plan-product',
        displayName: 'Delete Active Plan Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'delete-active-plan',
        displayName: 'Delete Active Plan'
      });

      await expect(
        subscrio.plans.deletePlan(plan.key)
      ).rejects.toThrow('archived');
    });

    test('deletes archived plan successfully', async () => {
      const product = await subscrio.products.createProduct({
        key: 'delete-archived-plan-product',
        displayName: 'Delete Archived Plan Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'delete-archived-plan',
        displayName: 'Delete Archived Plan'
      });

      await subscrio.plans.archivePlan(plan.key);

      await subscrio.plans.deletePlan(plan.key);

      const retrieved = await subscrio.plans.getPlan(plan.key);
      expect(retrieved).toBeNull();
    });

    test('prevents deletion of plan with billing cycles', async () => {
      const product = await subscrio.products.createProduct({
        key: 'plan-with-cycles-product',
        displayName: 'Plan With Cycles Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'plan-with-cycles',
        displayName: 'Plan With Cycles'
      });

      await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: 'cycle-for-plan',
        displayName: 'Cycle For Plan',
        durationValue: 1,
        durationUnit: 'months'
      });

      await subscrio.plans.archivePlan(plan.key);

      await expect(
        subscrio.plans.deletePlan(plan.key)
      ).rejects.toThrow('has associated billing cycles');
    });

    test('prevents deletion of plan with subscriptions', async () => {
      const product = await subscrio.products.createProduct({
        key: 'plan-with-subs-product',
        displayName: 'Plan With Subs Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'plan-with-subs',
        displayName: 'Plan With Subs'
      });

      const billingCycle1 = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: 'cycle-1-for-subs',
        displayName: 'Cycle 1 For Subs',
        durationValue: 1,
        durationUnit: 'months'
      });

      const billingCycle2 = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: 'cycle-2-for-subs',
        displayName: 'Cycle 2 For Subs',
        durationValue: 1,
        durationUnit: 'months'
      });

      const customer = await subscrio.customers.createCustomer({
        key: 'customer-for-plan',
        displayName: 'Customer For Plan'
      });

      // Create subscription using cycle 1
      await subscrio.subscriptions.createSubscription({
        customerKey: customer.key,
        planKey: plan.key,
        billingCycleKey: billingCycle1.key,
        key: 'sub-for-plan'
      });

      // Archive and delete cycle 1 (this will fail because it has subscriptions)
      await subscrio.billingCycles.archiveBillingCycle(billingCycle1.key);
      await expect(
        subscrio.billingCycles.deleteBillingCycle(billingCycle1.key)
      ).rejects.toThrow('has active subscriptions');

      // Archive and delete cycle 2 (should work - no subscriptions)
      await subscrio.billingCycles.archiveBillingCycle(billingCycle2.key);
      await subscrio.billingCycles.deleteBillingCycle(billingCycle2.key);

      await subscrio.plans.archivePlan(plan.key);

      // Now try to delete plan - should fail because it has subscriptions (even though cycle 1 is archived)
      await expect(
        subscrio.plans.deletePlan(plan.key)
      ).rejects.toThrow('has active subscriptions');
    });
  });

  describe('List & Filter Tests', () => {
    test('lists all plans', async () => {
      const product = await subscrio.products.createProduct({
        key: 'list-plans-product',
        displayName: 'List Plans Product'
      });

      await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'list-plan-1',
        displayName: 'List Plan 1'
      });
      await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'list-plan-2',
        displayName: 'List Plan 2'
      });

      const plans = await subscrio.plans.listPlans();
      expect(plans.length).toBeGreaterThanOrEqual(2);
    });

    test('filters plans by product key', async () => {
      const product = await subscrio.products.createProduct({
        key: 'filter-product-key',
        displayName: 'Filter Product Key'
      });

      await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'filter-plan-by-product',
        displayName: 'Filter Plan'
      });

      const plans = await subscrio.plans.listPlans({ productKey: product.key });
      expect(plans.every(p => p.productKey === product.key)).toBe(true);
    });

    test('filters plans by status (active)', async () => {
      const product = await subscrio.products.createProduct({
        key: 'filter-active-product',
        displayName: 'Filter Active Product'
      });

      await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'filter-active-plan',
        displayName: 'Filter Active Plan'
      });

      const activePlans = await subscrio.plans.listPlans({ status: 'active' });
      expect(activePlans.every(p => p.status === 'active')).toBe(true);
    });

    test('filters plans by status (archived)', async () => {
      const product = await subscrio.products.createProduct({
        key: 'filter-archived-product',
        displayName: 'Filter Archived Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'filter-archived-plan',
        displayName: 'Filter Archived Plan'
      });

      await subscrio.plans.archivePlan(plan.key);

      const archivedPlans = await subscrio.plans.listPlans({ status: 'archived' });
      expect(archivedPlans.some(p => p.key === plan.key)).toBe(true);
    });

    test('searches plans by key or display name', async () => {
      const product = await subscrio.products.createProduct({
        key: 'search-plans-product',
        displayName: 'Search Plans Product'
      });

      await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'search-unique-plan',
        displayName: 'Search Unique Plan'
      });

      const plans = await subscrio.plans.listPlans({ search: 'search-unique' });
      expect(plans.some(p => p.key === 'search-unique-plan')).toBe(true);
    });

    test('paginates plan list', async () => {
      const plans = await subscrio.plans.listPlans({ limit: 5 });
      expect(plans.length).toBeLessThanOrEqual(5);
    });

    test('gets plans by product key', async () => {
      const product = await subscrio.products.createProduct({
        key: 'get-by-product',
        displayName: 'Get By Product'
      });

      await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'plan-by-product-1',
        displayName: 'Plan 1'
      });
      await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'plan-by-product-2',
        displayName: 'Plan 2'
      });

      const plans = await subscrio.plans.getPlansByProduct(product.key);
      expect(plans.length).toBe(2);
    });
  });

  describe('Feature Value Management', () => {
    test('sets feature value for plan', async () => {
      const product = await subscrio.products.createProduct({
        key: 'set-value-product',
        displayName: 'Set Value Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'set-value-feature',
        displayName: 'Set Value Feature',
        valueType: 'numeric',
        defaultValue: '10'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'set-value-plan',
        displayName: 'Set Value Plan'
      });

      await subscrio.plans.setFeatureValue(plan.key, feature.key, '50');

      const value = await subscrio.plans.getFeatureValue(plan.key, feature.key);
      expect(value).toBe('50');
    });

    test('updates existing feature value', async () => {
      const product = await subscrio.products.createProduct({
        key: 'update-value-product',
        displayName: 'Update Value Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'update-value-feature',
        displayName: 'Update Value Feature',
        valueType: 'numeric',
        defaultValue: '10'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'update-value-plan',
        displayName: 'Update Value Plan'
      });

      await subscrio.plans.setFeatureValue(plan.key, feature.key, '50');
      await subscrio.plans.setFeatureValue(plan.key, feature.key, '100');

      const value = await subscrio.plans.getFeatureValue(plan.key, feature.key);
      expect(value).toBe('100');
    });

    test('removes feature value from plan', async () => {
      const product = await subscrio.products.createProduct({
        key: 'remove-value-product',
        displayName: 'Remove Value Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'remove-value-feature',
        displayName: 'Remove Value Feature',
        valueType: 'numeric',
        defaultValue: '10'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'remove-value-plan',
        displayName: 'Remove Value Plan'
      });

      await subscrio.plans.setFeatureValue(plan.key, feature.key, '50');
      await subscrio.plans.removeFeatureValue(plan.key, feature.key);

      const value = await subscrio.plans.getFeatureValue(plan.key, feature.key);
      expect(value).toBeNull();
    });

    test('gets feature value for plan', async () => {
      const product = await subscrio.products.createProduct({
        key: 'get-value-product',
        displayName: 'Get Value Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'get-value-feature',
        displayName: 'Get Value Feature',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'get-value-plan',
        displayName: 'Get Value Plan'
      });

      await subscrio.plans.setFeatureValue(plan.key, feature.key, 'true');

      const value = await subscrio.plans.getFeatureValue(plan.key, feature.key);
      expect(value).toBe('true');
    });

    test('returns null for non-existent feature value', async () => {
      const product = await subscrio.products.createProduct({
        key: 'null-value-product',
        displayName: 'Null Value Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'null-value-feature',
        displayName: 'Null Value Feature',
        valueType: 'numeric',
        defaultValue: '10'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'null-value-plan',
        displayName: 'Null Value Plan'
      });

      const value = await subscrio.plans.getFeatureValue(plan.key, feature.key);
      expect(value).toBeNull();
    });

    test('gets all plan features', async () => {
      const product = await subscrio.products.createProduct({
        key: 'all-features-product',
        displayName: 'All Features Product'
      });

      const feature1 = await subscrio.features.createFeature({
        key: 'all-features-1',
        displayName: 'All Features 1',
        valueType: 'numeric',
        defaultValue: '10'
      });

      const feature2 = await subscrio.features.createFeature({
        key: 'all-features-2',
        displayName: 'All Features 2',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.products.associateFeature(product.key, feature1.key);
      await subscrio.products.associateFeature(product.key, feature2.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'all-features-plan',
        displayName: 'All Features Plan'
      });

      await subscrio.plans.setFeatureValue(plan.key, feature1.key, '50');
      await subscrio.plans.setFeatureValue(plan.key, feature2.key, 'true');

      const features = await subscrio.plans.getPlanFeatures(plan.key);
      expect(features.length).toBe(2);
      expect(features.find(f => f.featureKey === feature1.key)?.value).toBe('50');
      expect(features.find(f => f.featureKey === feature2.key)?.value).toBe('true');
    });

    test('throws error when setting value for non-existent feature', async () => {
      const product = await subscrio.products.createProduct({
        key: 'error-feature-product',
        displayName: 'Error Feature Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'error-feature-plan',
        displayName: 'Error Feature Plan'
      });

      await expect(
        subscrio.plans.setFeatureValue(plan.key, 'non-existent-feature', '50')
      ).rejects.toThrow('not found');
    });

    test('throws error when setting value for non-existent plan', async () => {
      const product = await subscrio.products.createProduct({
        key: 'error-plan-feature-product',
        displayName: 'Error Plan Feature Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'error-plan-feature',
        displayName: 'Error Plan Feature',
        valueType: 'numeric',
        defaultValue: '10'
      });

      await expect(
        subscrio.plans.setFeatureValue('non-existent-plan', feature.key, '50')
      ).rejects.toThrow('not found');
    });
  });
});


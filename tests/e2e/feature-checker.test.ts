import { describe, test, expect, beforeAll } from 'vitest';
import { Subscrio } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';
import { OverrideType } from '../../src/domain/value-objects/OverrideType.js';

describe('Feature Checker E2E Tests', () => {
  let subscrio: Subscrio;
  let sharedBillingCycle: any;
  let sharedTestProduct: any;
  let sharedTestPlan: any;
  
  beforeAll(async () => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() }
    });
    
    // Create shared product and plan for billing cycle
    sharedTestProduct = await subscrio.products.createProduct({
      key: 'shared-fc-product',
      displayName: 'Shared FC Product'
    });

    sharedTestPlan = await subscrio.plans.createPlan({
      productKey: sharedTestProduct.key,
      key: 'shared-fc-plan',
      displayName: 'Shared FC Plan'
    });
    
    // Create a shared billing cycle for all tests
    sharedBillingCycle = await subscrio.billingCycles.createBillingCycle({
      planKey: sharedTestPlan.key,
      key: 'test-monthly-fc',
      displayName: 'Test Monthly FC',
      durationValue: 1,
      durationUnit: 'months'
    });
  });

  describe('Basic Resolution Tests', () => {
    test('resolves feature from default value', async () => {
      // Create product and feature
      const product = await subscrio.products.createProduct({
        key: 'basic-product',
        displayName: 'Basic Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'max-users',
        displayName: 'Max Users',
        valueType: 'numeric',
        defaultValue: '10'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      // Create customer with no subscription
      const customer = await subscrio.customers.createCustomer({
        key: 'test-customer-1',
        displayName: 'Test Customer'
      });

      // Should return feature default
      const value = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature.key);
      expect(value).toBe('10');
    });

    test('resolves feature from plan value', async () => {
      const product = await subscrio.products.createProduct({
        key: 'plan-product',
        displayName: 'Plan Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'storage-gb',
        displayName: 'Storage GB',
        valueType: 'numeric',
        defaultValue: '5'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'pro-plan',
        displayName: 'Pro Plan'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      // Set plan value
      await subscrio.plans.setFeatureValue(plan.key, feature.key, '50');

      const customer = await subscrio.customers.createCustomer({
        key: 'plan-customer',
        displayName: 'Plan Customer'
      });

      const subscription = await subscrio.subscriptions.createSubscription({
        key: 'sub-plan',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      // Should return plan value
      const value = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature.key);
      expect(value).toBe('50');
    });

    test('resolves feature from subscription override', async () => {
      const product = await subscrio.products.createProduct({
        key: `override-product-${Date.now()}`,
        displayName: 'Override Product'
      });

      const feature = await subscrio.features.createFeature({
        key: `api-calls-${Date.now()}`,
        displayName: 'API Calls',
        valueType: 'numeric',
        defaultValue: '100'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'basic',
        displayName: 'Basic'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      await subscrio.plans.setFeatureValue(plan.key, feature.key, '1000');

      const customer = await subscrio.customers.createCustomer({
        key: `override-customer-${Date.now()}`,
        displayName: 'Override Customer'
      });

      const subscription = await subscrio.subscriptions.createSubscription({
        key: 'sub-override',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      // Add subscription override
      await subscrio.subscriptions.addFeatureOverride(
        subscription.key,
        feature.key,
        '5000',
        OverrideType.Permanent
      );

      // Should return subscription override
      const value = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature.key);
      expect(value).toBe('5000');
    });

    test('returns null for non-existent customer', async () => {
      // Create a product for this test
      const product = await subscrio.products.createProduct({
        key: 'null-test-product',
        displayName: 'Null Test Product'
      });

      const value = await subscrio.featureChecker.getValueForCustomer('non-existent', product.key, 'any-feature');
      expect(value).toBeNull();
    });

    test('returns null for non-existent feature', async () => {
      // Create a product for this test
      const product = await subscrio.products.createProduct({
        key: 'null-feature-product',
        displayName: 'Null Feature Product'
      });

      const customer = await subscrio.customers.createCustomer({
        key: 'null-test-customer',
        displayName: 'Null Test'
      });

      const value = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, 'non-existent-feature');
      expect(value).toBeNull();
    });
  });

  describe('Resolution Hierarchy Tests', () => {
    test('subscription override takes precedence over plan value', async () => {
      const product = await subscrio.products.createProduct({
        key: 'hierarchy-product-1',
        displayName: 'Hierarchy Product 1'
      });

      const feature = await subscrio.features.createFeature({
        key: 'projects',
        displayName: 'Projects',
        valueType: 'numeric',
        defaultValue: '3'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'standard',
        displayName: 'Standard'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      await subscrio.plans.setFeatureValue(plan.key, feature.key, '10');

      const customer = await subscrio.customers.createCustomer({
        key: 'hierarchy-customer-1',
        displayName: 'Hierarchy Customer 1'
      });

      const subscription = await subscrio.subscriptions.createSubscription({
        key: 'sub-hierarchy-1',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      // Add override
      await subscrio.subscriptions.addFeatureOverride(
        subscription.key,
        feature.key,
        '25',
        OverrideType.Permanent
      );

      // Should return override (25), not plan (10) or default (3)
      const value = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature.key);
      expect(value).toBe('25');
    });

    test('subscription override takes precedence over feature default', async () => {
      const product = await subscrio.products.createProduct({
        key: 'hierarchy-product-2',
        displayName: 'Hierarchy Product 2'
      });

      const feature = await subscrio.features.createFeature({
        key: 'team-members',
        displayName: 'Team Members',
        valueType: 'numeric',
        defaultValue: '5'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'no-value-plan',
        displayName: 'No Value Plan'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      // Don't set plan value

      const customer = await subscrio.customers.createCustomer({
        key: 'hierarchy-customer-2',
        displayName: 'Hierarchy Customer 2'
      });

      const subscription = await subscrio.subscriptions.createSubscription({
        key: 'sub-hierarchy-2',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      // Add override
      await subscrio.subscriptions.addFeatureOverride(
        subscription.key,
        feature.key,
        '15',
        OverrideType.Permanent
      );

      // Should return override (15), not default (5)
      const value = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature.key);
      expect(value).toBe('15');
    });

    test('plan value takes precedence over feature default', async () => {
      const product = await subscrio.products.createProduct({
        key: 'hierarchy-product-3',
        displayName: 'Hierarchy Product 3'
      });

      const feature = await subscrio.features.createFeature({
        key: 'bandwidth-gb',
        displayName: 'Bandwidth GB',
        valueType: 'numeric',
        defaultValue: '10'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'premium',
        displayName: 'Premium'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      await subscrio.plans.setFeatureValue(plan.key, feature.key, '100');

      const customer = await subscrio.customers.createCustomer({
        key: 'hierarchy-customer-3',
        displayName: 'Hierarchy Customer 3'
      });

      await subscrio.subscriptions.createSubscription({
        key: 'sub-hierarchy-3',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      // Should return plan value (100), not default (10)
      const value = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature.key);
      expect(value).toBe('100');
    });

    test('falls back to default when no plan value or override', async () => {
      const product = await subscrio.products.createProduct({
        key: 'fallback-product',
        displayName: 'Fallback Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'workspaces',
        displayName: 'Workspaces',
        valueType: 'numeric',
        defaultValue: '1'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'free',
        displayName: 'Free'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      const customer = await subscrio.customers.createCustomer({
        key: 'fallback-customer',
        displayName: 'Fallback Customer'
      });

      await subscrio.subscriptions.createSubscription({
        key: 'sub-fallback',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      // Should return default (1)
      const value = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature.key);
      expect(value).toBe('1');
    });
  });

  describe('Multiple Subscriptions', () => {
    test('handles customer with no active subscriptions', async () => {
      const product = await subscrio.products.createProduct({
        key: 'no-sub-product',
        displayName: 'No Sub Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'feature-no-sub',
        displayName: 'Feature No Sub',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const customer = await subscrio.customers.createCustomer({
        key: 'no-sub-customer',
        displayName: 'No Sub Customer'
      });

      // No subscription created

      const value = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature.key);
      expect(value).toBe('false');
    });
  });

  describe('Feature Types', () => {
    test('checks toggle feature is enabled', async () => {
      const product = await subscrio.products.createProduct({
        key: 'toggle-product-1',
        displayName: 'Toggle Product 1'
      });

      const feature = await subscrio.features.createFeature({
        key: 'dark-mode',
        displayName: 'Dark Mode',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'premium-plan',
        displayName: 'Premium Plan'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      await subscrio.plans.setFeatureValue(plan.key, feature.key, 'true');

      const customer = await subscrio.customers.createCustomer({
        key: 'toggle-customer-1',
        displayName: 'Toggle Customer 1'
      });

      await subscrio.subscriptions.createSubscription({
        key: 'sub-toggle-1',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      const isEnabled = await subscrio.featureChecker.isEnabledForCustomer(customer.key, product.key, feature.key);
      expect(isEnabled).toBe(true);
    });

    test('checks toggle feature is disabled', async () => {
      const product = await subscrio.products.createProduct({
        key: 'toggle-product-2',
        displayName: 'Toggle Product 2'
      });

      const feature = await subscrio.features.createFeature({
        key: 'advanced-analytics',
        displayName: 'Advanced Analytics',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const customer = await subscrio.customers.createCustomer({
        key: 'toggle-customer-2',
        displayName: 'Toggle Customer 2'
      });

      const isEnabled = await subscrio.featureChecker.isEnabledForCustomer(customer.key, product.key, feature.key);
      expect(isEnabled).toBe(false);
    });

    test('gets numeric feature value', async () => {
      const product = await subscrio.products.createProduct({
        key: 'numeric-product',
        displayName: 'Numeric Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'max-files',
        displayName: 'Max Files',
        valueType: 'numeric',
        defaultValue: '100'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const customer = await subscrio.customers.createCustomer({
        key: 'numeric-customer',
        displayName: 'Numeric Customer'
      });

      const value = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature.key);
      expect(value).toBe('100');
      expect(parseInt(value as string)).toBe(100);
    });

    test('gets text feature value', async () => {
      const product = await subscrio.products.createProduct({
        key: 'text-product',
        displayName: 'Text Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'branding-color',
        displayName: 'Branding Color',
        valueType: 'text',
        defaultValue: '#000000'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const customer = await subscrio.customers.createCustomer({
        key: 'text-customer',
        displayName: 'Text Customer'
      });

      const value = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature.key);
      expect(value).toBe('#000000');
    });
  });

  describe('Override Types', () => {
    test('resolves permanent override', async () => {
      const product = await subscrio.products.createProduct({
        key: 'permanent-product',
        displayName: 'Permanent Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'permanent-feature',
        displayName: 'Permanent Feature',
        valueType: 'numeric',
        defaultValue: '10'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'permanent-plan',
        displayName: 'Permanent Plan'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      const customer = await subscrio.customers.createCustomer({
        key: 'permanent-customer',
        displayName: 'Permanent Customer'
      });

      const subscription = await subscrio.subscriptions.createSubscription({
        key: 'sub-permanent',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      await subscrio.subscriptions.addFeatureOverride(
        subscription.key,
        feature.key,
        '50',
        OverrideType.Permanent
      );

      const value = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature.key);
      expect(value).toBe('50');
    });

    test('resolves temporary override', async () => {
      const product = await subscrio.products.createProduct({
        key: 'temporary-product',
        displayName: 'Temporary Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'temporary-feature',
        displayName: 'Temporary Feature',
        valueType: 'numeric',
        defaultValue: '10'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'temporary-plan',
        displayName: 'Temporary Plan'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      const customer = await subscrio.customers.createCustomer({
        key: 'temporary-customer',
        displayName: 'Temporary Customer'
      });

      const subscription = await subscrio.subscriptions.createSubscription({
        key: 'sub-temporary',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      await subscrio.subscriptions.addFeatureOverride(
        subscription.key,
        feature.key,
        '75',
        OverrideType.Temporary
      );

      const value = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature.key);
      expect(value).toBe('75');
    });

    test('ignores temporary overrides after clearing', async () => {
      const product = await subscrio.products.createProduct({
        key: `clear-temp-product-${Date.now()}`,
        displayName: 'Clear Temp Product'
      });

      const feature = await subscrio.features.createFeature({
        key: `clear-temp-feature-${Date.now()}`,
        displayName: 'Clear Temp Feature',
        valueType: 'numeric',
        defaultValue: '10'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: `clear-temp-plan-${Date.now()}`,
        displayName: 'Clear Temp Plan'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      const customer = await subscrio.customers.createCustomer({
        key: `clear-temp-customer-${Date.now()}`,
        displayName: 'Clear Temp Customer'
      });

      const subscription = await subscrio.subscriptions.createSubscription({
        key: 'sub-clear-temp',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      await subscrio.subscriptions.addFeatureOverride(
        subscription.key,
        feature.key,
        '100',
        OverrideType.Temporary
      );

      // Clear temporary overrides
      await subscrio.subscriptions.clearTemporaryOverrides(subscription.key);

      const value = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature.key);
      expect(value).toBe('10'); // Should fall back to default
    });

    test('keeps permanent overrides after clearing temporary', async () => {
      const product = await subscrio.products.createProduct({
        key: 'keep-perm-product',
        displayName: 'Keep Perm Product'
      });

      const feature1 = await subscrio.features.createFeature({
        key: 'keep-perm-feature-1',
        displayName: 'Keep Perm Feature 1',
        valueType: 'numeric',
        defaultValue: '10'
      });

      const feature2 = await subscrio.features.createFeature({
        key: 'keep-perm-feature-2',
        displayName: 'Keep Perm Feature 2',
        valueType: 'numeric',
        defaultValue: '20'
      });

      await subscrio.products.associateFeature(product.key, feature1.key);
      await subscrio.products.associateFeature(product.key, feature2.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'keep-perm-plan',
        displayName: 'Keep Perm Plan'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      const customer = await subscrio.customers.createCustomer({
        key: 'keep-perm-customer',
        displayName: 'Keep Perm Customer'
      });

      const subscription = await subscrio.subscriptions.createSubscription({
        key: 'sub-keep-perm',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      // Add permanent override
      await subscrio.subscriptions.addFeatureOverride(
        subscription.key,
        feature1.key,
        '50',
        OverrideType.Permanent
      );

      // Add temporary override
      await subscrio.subscriptions.addFeatureOverride(
        subscription.key,
        feature2.key,
        '100',
        OverrideType.Temporary
      );

      // Clear temporary overrides
      await subscrio.subscriptions.clearTemporaryOverrides(subscription.key);

      const value1 = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature1.key);
      const value2 = await subscrio.featureChecker.getValueForCustomer(customer.key, product.key, feature2.key);

      expect(value1).toBe('50'); // Permanent should remain
      expect(value2).toBe('20'); // Temporary cleared, falls back to default
    });
  });

  describe('Bulk Operations', () => {
    test('gets all features for customer', async () => {
      const product = await subscrio.products.createProduct({
        key: 'bulk-product',
        displayName: 'Bulk Product'
      });

      const feature1 = await subscrio.features.createFeature({
        key: 'bulk-feature-1',
        displayName: 'Bulk Feature 1',
        valueType: 'numeric',
        defaultValue: '5'
      });

      const feature2 = await subscrio.features.createFeature({
        key: 'bulk-feature-2',
        displayName: 'Bulk Feature 2',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.products.associateFeature(product.key, feature1.key);
      await subscrio.products.associateFeature(product.key, feature2.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'bulk-plan',
        displayName: 'Bulk Plan'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      await subscrio.plans.setFeatureValue(plan.key, feature1.key, '25');
      await subscrio.plans.setFeatureValue(plan.key, feature2.key, 'true');

      const customer = await subscrio.customers.createCustomer({
        key: 'bulk-customer',
        displayName: 'Bulk Customer'
      });

      await subscrio.subscriptions.createSubscription({
        key: 'sub-bulk',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      const allFeatures = await subscrio.featureChecker.getAllFeaturesForCustomer(customer.key, product.key);
      
      expect(allFeatures.get(feature1.key)).toBe('25');
      expect(allFeatures.get(feature2.key)).toBe('true');
    });

    test('gets feature usage summary', async () => {
      const product = await subscrio.products.createProduct({
        key: 'summary-product',
        displayName: 'Summary Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'summary-feature',
        displayName: 'Summary Feature',
        valueType: 'numeric',
        defaultValue: '1'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'summary-plan',
        displayName: 'Summary Plan'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      const customer = await subscrio.customers.createCustomer({
        key: 'summary-customer',
        displayName: 'Summary Customer'
      });

      await subscrio.subscriptions.createSubscription({
        key: 'sub-summary',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      const summary = await subscrio.featureChecker.getFeatureUsageSummary(customer.key, product.key);
      
      expect(summary).toBeDefined();
      expect(summary.activeSubscriptions).toBeGreaterThan(0);
    });

    test('gets active plans for customer', async () => {
      const product = await subscrio.products.createProduct({
        key: 'active-plans-product',
        displayName: 'Active Plans Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'active-plan',
        displayName: 'Active Plan'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      const customer = await subscrio.customers.createCustomer({
        key: 'active-plans-customer',
        displayName: 'Active Plans Customer'
      });

      await subscrio.subscriptions.createSubscription({
        key: 'sub-active-plans',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      const activePlans = await subscrio.featureChecker.getActivePlans(customer.key);
      
      expect(activePlans).toContain(plan.key);
    });
  });

  describe('Plan Access', () => {
    test('checks if customer has plan access', async () => {
      const product = await subscrio.products.createProduct({
        key: 'access-product',
        displayName: 'Access Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'access-plan',
        displayName: 'Access Plan'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      const customer = await subscrio.customers.createCustomer({
        key: 'access-customer',
        displayName: 'Access Customer'
      });

      await subscrio.subscriptions.createSubscription({
        key: 'sub-access',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      const hasAccess = await subscrio.featureChecker.hasPlanAccess(
        customer.key,
        product.key,
        plan.key
      );
      
      expect(hasAccess).toBe(true);
    });

    test('returns false for customer without subscription', async () => {
      const product = await subscrio.products.createProduct({
        key: 'no-access-product',
        displayName: 'No Access Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'no-access-plan',
        displayName: 'No Access Plan'
      });

      const customer = await subscrio.customers.createCustomer({
        key: 'no-access-customer',
        displayName: 'No Access Customer'
      });

      const hasAccess = await subscrio.featureChecker.hasPlanAccess(
        customer.key,
        product.key,
        plan.key
      );
      
      expect(hasAccess).toBe(false);
    });

    test('returns false for cancelled subscription', async () => {
      const product = await subscrio.products.createProduct({
        key: 'cancelled-product',
        displayName: 'Cancelled Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'cancelled-plan',
        displayName: 'Cancelled Plan'
      });

      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: `test-monthly-fc-${Date.now()}`,
        displayName: 'Test Monthly FC',
        durationValue: 1,
        durationUnit: 'months'
      });

      const customer = await subscrio.customers.createCustomer({
        key: 'cancelled-customer',
        displayName: 'Cancelled Customer'
      });

      const subscription = await subscrio.subscriptions.createSubscription({
        key: 'sub-cancelled',
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
      });

      // Cancel subscription
      await subscrio.subscriptions.updateSubscription(subscription.key, {
        cancellationDate: new Date().toISOString()
      });

      const hasAccess = await subscrio.featureChecker.hasPlanAccess(
        customer.key,
        product.key,
        plan.key
      );
      
      expect(hasAccess).toBe(false);
    });
  });
});


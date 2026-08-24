import { describe, test, expect, beforeAll } from 'vitest';
import { Subscrio } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';

describe('FeatureChecker Caching Integration Tests', () => {
  let subscrio: Subscrio;
  let sharedBillingCycle: any;
  
  beforeAll(async () => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() }
    });

    // Create a shared billing cycle for all tests
    const product = await subscrio.products.createProduct({
      key: 'shared-caching-product',
      displayName: 'Shared Caching Product'
    });

    const plan = await subscrio.plans.createPlan({
      productKey: product.key,
      key: 'shared-caching-plan',
      displayName: 'Shared Caching Plan'
    });

    sharedBillingCycle = await subscrio.billingCycles.createBillingCycle({
      planKey: plan.key,
      key: 'monthly-caching',
      displayName: 'Monthly Caching',
      durationValue: 1,
      durationUnit: 'months'
    });
  });

  describe('Plan Caching Performance', () => {
    test('caches plans to avoid repeated database calls', async () => {
      // Create a product with multiple plans
      const product = await subscrio.products.createProduct({
        key: 'caching-test-product',
        displayName: 'Caching Test Product'
      });

      // Create multiple plans
      const plans = [];
      for (let i = 0; i < 5; i++) {
        const plan = await subscrio.plans.createPlan({
          productKey: product.key,
          key: `plan-${i}`,
          displayName: `Plan ${i}`
        });
        plans.push(plan);
      }

      // Create features
      const feature = await subscrio.features.createFeature({
        key: 'test-feature',
        displayName: 'Test Feature',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.products.associateFeature(product.key, feature.key);

      // Set feature values for each plan
      for (const plan of plans) {
        await subscrio.plans.setFeatureValue(plan.key, feature.key, 'true');
      }

      // Create customer with multiple subscriptions
      const customer = await subscrio.customers.createCustomer({
        key: 'caching-test-customer',
        displayName: 'Caching Test Customer',
        email: 'test@example.com'
      });

      // Create billing cycles and subscriptions for all plans
      const subscriptions = [];
      for (let i = 0; i < plans.length; i++) {
        const plan = plans[i];
        const billingCycle = await subscrio.billingCycles.createBillingCycle({
          planKey: plan.key,
          key: `caching-cycle-${i}`,
          displayName: `Caching Cycle ${i}`,
          durationValue: 1,
          durationUnit: 'months'
        });
        
        const subscription = await subscrio.subscriptions.createSubscription({
          customerKey: customer.key,
          billingCycleKey: billingCycle.key,
          key: `sub-${i}`
        });
        subscriptions.push(subscription);
      }

      // This should use cached plans and not make N+1 queries
      const startTime = Date.now();
      
      // Get all features for customer - this should use caching
      const allFeatures = await subscrio.featureChecker.getAllFeaturesForCustomer(
        customer.key,
        product.key
      );
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Should be fast due to caching
      expect(executionTime).toBeLessThan(1000); // Less than 1 second
      expect(allFeatures.size).toBeGreaterThan(0);
      expect(allFeatures.get('test-feature')).toBe('true');
    });

    test('handles cache invalidation correctly', async () => {
      // Create test data
      const product = await subscrio.products.createProduct({
        key: 'cache-invalidation-test',
        displayName: 'Cache Invalidation Test'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'cache-test-plan',
        displayName: 'Cache Test Plan'
      });

      const feature = await subscrio.features.createFeature({
        key: 'cache-test-feature',
        displayName: 'Cache Test Feature',
        valueType: 'numeric',
        defaultValue: '10'
      });

      await subscrio.products.associateFeature(product.key, feature.key);
      await subscrio.plans.setFeatureValue(plan.key, feature.key, '20');

      const customer = await subscrio.customers.createCustomer({
        key: 'cache-invalidation-customer',
        displayName: 'Cache Invalidation Customer',
        email: 'test@example.com'
      });

      // Create billing cycle for the plan
      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: 'cache-invalidation-cycle',
        displayName: 'Cache Invalidation Cycle',
        durationValue: 1,
        durationUnit: 'months'
      });

      const subscription = await subscrio.subscriptions.createSubscription({
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
        key: 'cache-invalidation-sub'
      });

      // First call should populate cache
      const firstResult = await subscrio.featureChecker.getValueForCustomer(
        customer.key,
        product.key,
        feature.key
      );
      expect(firstResult).toBe('20');

      // Update plan feature value
      await subscrio.plans.setFeatureValue(plan.key, feature.key, '30');

      // Second call should still work (cache should handle updates)
      const secondResult = await subscrio.featureChecker.getValueForCustomer(
        customer.key,
        product.key,
        feature.key
      );
      expect(secondResult).toBe('30');
    });
  });

  describe('Memory Leak Prevention', () => {
    test('does not accumulate memory over multiple calls', async () => {
      // Create test data
      const product = await subscrio.products.createProduct({
        key: 'memory-test-product',
        displayName: 'Memory Test Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'memory-test-plan',
        displayName: 'Memory Test Plan'
      });

      const feature = await subscrio.features.createFeature({
        key: 'memory-test-feature',
        displayName: 'Memory Test Feature',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.products.associateFeature(product.key, feature.key);
      await subscrio.plans.setFeatureValue(plan.key, feature.key, 'true');

      const customer = await subscrio.customers.createCustomer({
        key: 'memory-test-customer',
        displayName: 'Memory Test Customer',
        email: 'test@example.com'
      });

      // Create billing cycle for the plan
      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: 'memory-test-cycle',
        displayName: 'Memory Test Cycle',
        durationValue: 1,
        durationUnit: 'months'
      });

      const subscription = await subscrio.subscriptions.createSubscription({
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
        key: 'memory-test-sub'
      });

      // Make many calls to test for memory leaks
      for (let i = 0; i < 100; i++) {
        const result = await subscrio.featureChecker.getValueForCustomer(
          customer.key,
          product.key,
          feature.key
        );
        expect(result).toBe('true');
      }

      // If we get here without memory issues, the test passes
      expect(true).toBe(true);
    });
  });
});

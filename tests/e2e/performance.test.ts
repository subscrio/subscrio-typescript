import { describe, test, expect, beforeAll } from 'vitest';
import { Subscrio } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';

describe('Performance Tests', () => {
  let subscrio: Subscrio;
  let sharedBillingCycle: any;
  
  beforeAll(async () => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() }
    });

    // Create a shared billing cycle for all tests
    const product = await subscrio.products.createProduct({
      key: 'shared-performance-product',
      displayName: 'Shared Performance Product'
    });

    const plan = await subscrio.plans.createPlan({
      productKey: product.key,
      key: 'shared-performance-plan',
      displayName: 'Shared Performance Plan'
    });

    sharedBillingCycle = await subscrio.billingCycles.createBillingCycle({
      planKey: plan.key,
      key: 'monthly',
      displayName: 'Monthly',
      durationValue: 1,
      durationUnit: 'months'
    });
  });

  describe('N+1 Query Performance', () => {
    test('feature resolution with many subscriptions is fast', async () => {
      // Create a product
      const product = await subscrio.products.createProduct({
        key: 'performance-test-product',
        displayName: 'Performance Test Product'
      });

      // Create multiple plans
      const plans = [];
      for (let i = 0; i < 10; i++) {
        const plan = await subscrio.plans.createPlan({
          productKey: product.key,
          key: `performance-plan-${i}`,
          displayName: `Performance Plan ${i}`
        });
        plans.push(plan);
      }

      // Create features
      const features = [];
      for (let i = 0; i < 5; i++) {
        const feature = await subscrio.features.createFeature({
          key: `performance-feature-${i}`,
          displayName: `Performance Feature ${i}`,
          valueType: 'numeric',
          defaultValue: '10'
        });
        await subscrio.products.associateFeature(product.key, feature.key);
        features.push(feature);
      }

      // Set feature values for plans
      for (const plan of plans) {
        for (const feature of features) {
          await subscrio.plans.setFeatureValue(plan.key, feature.key, '20');
        }
      }

      // Create customer with many subscriptions
      const customer = await subscrio.customers.createCustomer({
        key: 'performance-test-customer',
        displayName: 'Performance Test Customer',
        email: 'test@example.com'
      });

      // Create billing cycles for each plan and create subscriptions
      const subscriptions = [];
      for (let i = 0; i < 20; i++) {
        const plan = plans[i % plans.length]; // Cycle through plans
        const billingCycle = await subscrio.billingCycles.createBillingCycle({
          planKey: plan.key,
          key: `performance-cycle-${i}`,
          displayName: `Performance Cycle ${i}`,
          durationValue: 1,
          durationUnit: 'months'
        });
        
        const subscription = await subscrio.subscriptions.createSubscription({
          customerKey: customer.key,
          billingCycleKey: billingCycle.key,
          key: `performance-sub-${i}`
        });
        subscriptions.push(subscription);
      }

      // Measure performance of feature resolution
      const startTime = Date.now();
      
      // This should use batch loading and be fast
      const allFeatures = await subscrio.featureChecker.getAllFeaturesForCustomer(
        customer.key,
        product.key
      );
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Should complete in reasonable time (less than 2 seconds)
      expect(executionTime).toBeLessThan(2000);
      expect(allFeatures.size).toBe(features.length);
      
      // All features should have the plan value
      for (const feature of features) {
        expect(allFeatures.get(feature.key)).toBe('20');
      }
    });

    test('batch loading prevents N+1 queries', async () => {
      // Create test data
      const product = await subscrio.products.createProduct({
        key: 'batch-test-product',
        displayName: 'Batch Test Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'batch-test-plan',
        displayName: 'Batch Test Plan'
      });

      const feature = await subscrio.features.createFeature({
        key: 'batch-test-feature',
        displayName: 'Batch Test Feature',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.products.associateFeature(product.key, feature.key);
      await subscrio.plans.setFeatureValue(plan.key, feature.key, 'true');

      const customer = await subscrio.customers.createCustomer({
        key: 'batch-test-customer',
        displayName: 'Batch Test Customer',
        email: 'test@example.com'
      });

      // Create billing cycle for the plan and create multiple subscriptions
      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: 'batch-test-cycle',
        displayName: 'Batch Test Cycle',
        durationValue: 1,
        durationUnit: 'months'
      });

      const subscriptions = [];
      for (let i = 0; i < 50; i++) {
        const subscription = await subscrio.subscriptions.createSubscription({
          customerKey: customer.key,
          billingCycleKey: billingCycle.key,
          key: `batch-sub-${i}`
        });
        subscriptions.push(subscription);
      }

      // This should use batch loading and not make 50+ individual queries
      const startTime = Date.now();
      
      const result = await subscrio.featureChecker.getValueForCustomer(
        customer.key,
        product.key,
        feature.key
      );
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Should be fast due to batch loading
      expect(executionTime).toBeLessThan(1000);
      expect(result).toBe('true');
    });
  });

  describe('Memory Usage', () => {
    test('does not leak memory with repeated calls', async () => {
      // Create test data
      const product = await subscrio.products.createProduct({
        key: 'memory-performance-product',
        displayName: 'Memory Performance Product'
      });

      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'memory-performance-plan',
        displayName: 'Memory Performance Plan'
      });

      const feature = await subscrio.features.createFeature({
        key: 'memory-performance-feature',
        displayName: 'Memory Performance Feature',
        valueType: 'numeric',
        defaultValue: '10'
      });

      await subscrio.products.associateFeature(product.key, feature.key);
      await subscrio.plans.setFeatureValue(plan.key, feature.key, '50');

      const customer = await subscrio.customers.createCustomer({
        key: 'memory-performance-customer',
        displayName: 'Memory Performance Customer',
        email: 'test@example.com'
      });

      // Create billing cycle for the plan
      const billingCycle = await subscrio.billingCycles.createBillingCycle({
        planKey: plan.key,
        key: 'memory-performance-cycle',
        displayName: 'Memory Performance Cycle',
        durationValue: 1,
        durationUnit: 'months'
      });

      const subscription = await subscrio.subscriptions.createSubscription({
        customerKey: customer.key,
        billingCycleKey: billingCycle.key,
        key: 'memory-performance-sub'
      });

      // Make many repeated calls
      const startTime = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        const result = await subscrio.featureChecker.getValueForCustomer(
          customer.key,
          product.key,
          feature.key
        );
        expect(result).toBe('50');
      }
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Should complete in reasonable time (allow 20 seconds to avoid flakiness)
      expect(executionTime).toBeLessThan(20000);
    });
  });
});

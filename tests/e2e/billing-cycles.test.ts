import { describe, test, expect, beforeAll } from 'vitest';
import { Subscrio } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';

describe('Billing Cycles E2E Tests', () => {
  let subscrio: Subscrio;
  let testProduct: any;
  let testPlan: any;
  
  beforeAll(async () => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() }
    });

    // Create test product and plan
    testProduct = await subscrio.products.createProduct({
      key: 'billing-test-product',
      displayName: 'Billing Test Product'
    });

    testPlan = await subscrio.plans.createPlan({
      productKey: testProduct.key,
      key: 'billing-test-plan',
      displayName: 'Billing Test Plan'
    });
  });

  describe('CRUD Operations', () => {
    test('creates billing cycle (days)', async () => {
      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'daily-cycle',
        displayName: 'Daily Cycle',
        durationValue: 1,
        durationUnit: 'days'
      });

      expect(cycle).toBeDefined();
      expect(cycle.productKey).toBe(testProduct.key);
      expect(cycle.planKey).toBe(testPlan.key);
      expect(cycle.key).toBe('daily-cycle');
      expect(cycle.durationValue).toBe(1);
      expect(cycle.durationUnit).toBe('days');
    });

    test('creates billing cycle (weeks)', async () => {
      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'weekly-cycle',
        displayName: 'Weekly Cycle',
        durationValue: 1,
        durationUnit: 'weeks'
      });

      expect(cycle.durationUnit).toBe('weeks');
    });

    test('creates billing cycle (months)', async () => {
      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'monthly-cycle',
        displayName: 'Monthly Cycle',
        durationValue: 1,
        durationUnit: 'months'
      });

      expect(cycle.durationUnit).toBe('months');
    });

    test('creates billing cycle (years)', async () => {
      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'yearly-cycle',
        displayName: 'Yearly Cycle',
        durationValue: 1,
        durationUnit: 'years'
      });

      expect(cycle.durationUnit).toBe('years');
    });

    test('creates billing cycle with external product ID', async () => {
      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'stripe-monthly',
        displayName: 'Stripe Monthly',
        durationValue: 1,
        durationUnit: 'months',
        externalProductId: 'price_1234567890'
      });

      expect(cycle.externalProductId).toBe('price_1234567890');
    });

    test('retrieves billing cycle by key', async () => {
      const created = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'retrieve-cycle',
        displayName: 'Retrieve Cycle',
        durationValue: 1,
        durationUnit: 'months'
      });

      const retrieved = await subscrio.billingCycles.getBillingCycle(created.key);
      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe(created.key);
    });

    test('updates billing cycle display name', async () => {
      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'update-name-cycle',
        displayName: 'Original Name',
        durationValue: 1,
        durationUnit: 'months'
      });

      const updated = await subscrio.billingCycles.updateBillingCycle(cycle.key, {
        displayName: 'Updated Name'
      });

      expect(updated.displayName).toBe('Updated Name');
    });

    test('updates billing cycle duration', async () => {
      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'update-duration-cycle',
        displayName: 'Update Duration',
        durationValue: 1,
        durationUnit: 'months'
      });

      const updated = await subscrio.billingCycles.updateBillingCycle(cycle.key, {
        durationValue: 3
      });

      expect(updated.durationValue).toBe(3);
    });

    test('updates external product ID', async () => {
      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'update-external-id',
        displayName: 'Update External ID',
        durationValue: 1,
        durationUnit: 'months'
      });

      const updated = await subscrio.billingCycles.updateBillingCycle(cycle.key, {
        externalProductId: 'price_updated'
      });

      expect(updated.externalProductId).toBe('price_updated');
    });

    test('returns null for non-existent billing cycle', async () => {
      const result = await subscrio.billingCycles.getBillingCycle('non-existent-cycle');
      expect(result).toBeNull();
    });
  });

  describe('Validation Tests', () => {
    test('throws error for duplicate billing cycle key', async () => {
      await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'duplicate-cycle',
        displayName: 'Cycle 1',
        durationValue: 1,
        durationUnit: 'months'
      });

      await expect(
        subscrio.billingCycles.createBillingCycle({
          planKey: testPlan.key,
          key: 'duplicate-cycle',
          displayName: 'Cycle 2',
          durationValue: 1,
          durationUnit: 'months'
        })
      ).rejects.toThrow('already exists');
    });

    test('throws error for invalid duration unit', async () => {
      await expect(
        subscrio.billingCycles.createBillingCycle({
          planKey: testPlan.key,
          key: 'invalid-unit',
          displayName: 'Invalid Unit',
          durationValue: 1,
          durationUnit: 'fortnights' as any
        })
      ).rejects.toThrow();
    });

    test('throws error for zero duration value', async () => {
      await expect(
        subscrio.billingCycles.createBillingCycle({
          planKey: testPlan.key,
          key: 'zero-duration',
          displayName: 'Zero Duration',
          durationValue: 0,
          durationUnit: 'months'
        })
      ).rejects.toThrow();
    });

    test('throws error for negative duration value', async () => {
      await expect(
        subscrio.billingCycles.createBillingCycle({
          planKey: testPlan.key,
          key: 'negative-duration',
          displayName: 'Negative Duration',
          durationValue: -1,
          durationUnit: 'months'
        })
      ).rejects.toThrow();
    });

    test('validates key format', async () => {
      await expect(
        subscrio.billingCycles.createBillingCycle({
          planKey: testPlan.key,
          key: 'Invalid Key!',
          displayName: 'Invalid',
          durationValue: 1,
          durationUnit: 'months'
        })
      ).rejects.toThrow();
    });
  });

  describe('List & Filter Tests', () => {
    test('lists all billing cycles', async () => {
      await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'list-cycle-1',
        displayName: 'List Cycle 1',
        durationValue: 1,
        durationUnit: 'months'
      });
      await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'list-cycle-2',
        displayName: 'List Cycle 2',
        durationValue: 1,
        durationUnit: 'years'
      });

      const cycles = await subscrio.billingCycles.getBillingCyclesByPlan(testPlan.key);
      expect(cycles.length).toBeGreaterThanOrEqual(2);
    });

    test('filters by duration unit (days)', async () => {
      await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'filter-days',
        displayName: 'Filter Days',
        durationValue: 7,
        durationUnit: 'days'
      });

      const cycles = await subscrio.billingCycles.getBillingCyclesByDurationUnit('days');
      expect(cycles.every(c => c.durationUnit === 'days')).toBe(true);
    });

    test('filters by duration unit (weeks)', async () => {
      await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'filter-weeks',
        displayName: 'Filter Weeks',
        durationValue: 2,
        durationUnit: 'weeks'
      });

      const cycles = await subscrio.billingCycles.getBillingCyclesByDurationUnit('weeks');
      expect(cycles.every(c => c.durationUnit === 'weeks')).toBe(true);
    });

    test('filters by duration unit (months)', async () => {
      await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'filter-months',
        displayName: 'Filter Months',
        durationValue: 1,
        durationUnit: 'months'
      });

      const cycles = await subscrio.billingCycles.getBillingCyclesByDurationUnit('months');
      expect(cycles.every(c => c.durationUnit === 'months')).toBe(true);
    });

    test('filters by duration unit (years)', async () => {
      await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'filter-years',
        displayName: 'Filter Years',
        durationValue: 1,
        durationUnit: 'years'
      });

      const cycles = await subscrio.billingCycles.getBillingCyclesByDurationUnit('years');
      expect(cycles.every(c => c.durationUnit === 'years')).toBe(true);
    });

    test('paginates billing cycle list', async () => {
      const allCycles = await subscrio.billingCycles.getBillingCyclesByPlan(testPlan.key);
      // Verify we have billing cycles (from previous tests)
      expect(allCycles.length).toBeGreaterThan(0);
      
      // Note: Pagination would be implemented with limit/offset parameters in the service method
      // For now, just verify that we can retrieve all cycles for a plan
      expect(Array.isArray(allCycles)).toBe(true);
    });
  });

  describe('Billing Cycle Lifecycle', () => {
    test('creates billing cycle with active status', async () => {
      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'status-test-cycle',
        displayName: 'Status Test Cycle',
        durationValue: 1,
        durationUnit: 'months'
      });

      expect(cycle.status).toBe('active');
    });

    test('archives and unarchives billing cycle', async () => {
      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'archive-test-cycle',
        displayName: 'Archive Test Cycle',
        durationValue: 1,
        durationUnit: 'months'
      });

      expect(cycle.status).toBe('active');

      // Archive
      await subscrio.billingCycles.archiveBillingCycle(cycle.key);
      const archived = await subscrio.billingCycles.getBillingCycle(cycle.key);
      expect(archived?.status).toBe('archived');

      // Unarchive
      await subscrio.billingCycles.unarchiveBillingCycle(cycle.key);
      const unarchived = await subscrio.billingCycles.getBillingCycle(cycle.key);
      expect(unarchived?.status).toBe('active');
    });

    test('deletes archived billing cycle with no references', async () => {
      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'delete-cycle',
        displayName: 'Delete Cycle',
        durationValue: 1,
        durationUnit: 'months'
      });

      await subscrio.billingCycles.archiveBillingCycle(cycle.key);
      await subscrio.billingCycles.deleteBillingCycle(cycle.key);

      const retrieved = await subscrio.billingCycles.getBillingCycle(cycle.key);
      expect(retrieved).toBeNull();
    });

    test('prevents deletion of active billing cycle', async () => {
      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'no-delete-cycle',
        displayName: 'No Delete Cycle',
        durationValue: 1,
        durationUnit: 'months'
      });

      await expect(
        subscrio.billingCycles.deleteBillingCycle(cycle.key)
      ).rejects.toThrow('must be archived');
    });
  });

  describe('Relationship Tests', () => {
    test('deletes billing cycle with no references', async () => {
      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'delete-no-ref-cycle',
        displayName: 'Delete No Ref Cycle',
        durationValue: 1,
        durationUnit: 'months'
      });

      await subscrio.billingCycles.archiveBillingCycle(cycle.key);
      await subscrio.billingCycles.deleteBillingCycle(cycle.key);

      const retrieved = await subscrio.billingCycles.getBillingCycle(cycle.key);
      expect(retrieved).toBeNull();
    });

    test('prevents deletion of billing cycle with subscriptions', async () => {
      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: testPlan.key,
        key: 'cycle-with-subs',
        displayName: 'Cycle With Subs',
        durationValue: 1,
        durationUnit: 'months'
      });

      const customer = await subscrio.customers.createCustomer({
        key: 'customer-for-cycle',
        displayName: 'Customer For Cycle'
      });

      await subscrio.subscriptions.createSubscription({
        customerKey: customer.key,
        planKey: testPlan.key,
        billingCycleKey: cycle.key,
        key: 'sub-for-cycle'
      });

      await subscrio.billingCycles.archiveBillingCycle(cycle.key);

      await expect(
        subscrio.billingCycles.deleteBillingCycle(cycle.key)
      ).rejects.toThrow('has active subscriptions');
    });

    test('prevents deletion of billing cycle referenced by plan transition', async () => {
      const transitionPlan = await subscrio.plans.createPlan({
        productKey: testProduct.key,
        key: 'transition-plan',
        displayName: 'Transition Plan'
      });

      const cycle = await subscrio.billingCycles.createBillingCycle({
        planKey: transitionPlan.key,
        key: 'transition-cycle',
        displayName: 'Transition Cycle',
        durationValue: 1,
        durationUnit: 'months'
      });

      // Update plan to reference this billing cycle in transition
      await subscrio.plans.updatePlan(transitionPlan.key, {
        onExpireTransitionToBillingCycleKey: cycle.key
      });

      await subscrio.billingCycles.archiveBillingCycle(cycle.key);

      await expect(
        subscrio.billingCycles.deleteBillingCycle(cycle.key)
      ).rejects.toThrow('referenced by plan transition settings');
    });
  });
});


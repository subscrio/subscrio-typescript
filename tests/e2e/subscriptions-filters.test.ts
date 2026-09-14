import { describe, expect, test, beforeAll } from 'vitest';
import { Subscrio } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';
import { uniqueKey } from '../setup/unique-key.js';

describe('Subscription filters, trial omit, and status', () => {
  let subscrio: Subscrio;

  beforeAll(() => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() }
    });
  });

  async function createHierarchy(prefix: string) {
    const product = await subscrio.products.createProduct({
      key: uniqueKey(`${prefix}-product`),
      displayName: 'Filter Product'
    });
    const plan = await subscrio.plans.createPlan({
      productKey: product.key,
      key: uniqueKey(`${prefix}-plan`),
      displayName: 'Filter Plan'
    });
    const cycle = await subscrio.billingCycles.createBillingCycle({
      planKey: plan.key,
      key: uniqueKey(`${prefix}-cycle`),
      displayName: 'Monthly',
      durationValue: 1,
      durationUnit: 'months'
    });
    const customer = await subscrio.customers.createCustomer({
      key: uniqueKey(`${prefix}-cust`),
      displayName: 'Filter Customer'
    });
    return { product, plan, cycle, customer };
  }

  test('listSubscriptions filters by customerKey and planKey', async () => {
    const a = await createHierarchy('list-a');
    const b = await createHierarchy('list-b');
    await subscrio.subscriptions.createSubscription({
      key: uniqueKey('sub-a'),
      customerKey: a.customer.key,
      billingCycleKey: a.cycle.key
    });
    await subscrio.subscriptions.createSubscription({
      key: uniqueKey('sub-b'),
      customerKey: b.customer.key,
      billingCycleKey: b.cycle.key
    });

    const byCustomer = await subscrio.subscriptions.listSubscriptions({
      customerKey: a.customer.key
    });
    expect(byCustomer.length).toBeGreaterThanOrEqual(1);
    expect(byCustomer.every((s) => s.customerKey === a.customer.key)).toBe(true);

    const byPlan = await subscrio.subscriptions.listSubscriptions({
      planKey: a.plan.key
    });
    expect(byPlan.length).toBeGreaterThanOrEqual(1);
    expect(byPlan.every((s) => s.planKey === a.plan.key)).toBe(true);
  });

  test('findSubscriptions applies date and stripe/trial criteria', async () => {
    const ctx = await createHierarchy('detail');
    const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const withTrial = await subscrio.subscriptions.createSubscription({
      key: uniqueKey('sub-trial'),
      customerKey: ctx.customer.key,
      billingCycleKey: ctx.cycle.key,
      trialEndDate: trialEnd.toISOString(),
      stripeSubscriptionId: uniqueKey('stripe')
    });
    await subscrio.subscriptions.createSubscription({
      key: uniqueKey('sub-plain'),
      customerKey: ctx.customer.key,
      billingCycleKey: ctx.cycle.key
    });

    const withStripe = await subscrio.subscriptions.findSubscriptions({
      customerKey: ctx.customer.key,
      hasStripeId: true
    });
    expect(withStripe.every((s) => !!s.stripeSubscriptionId)).toBe(true);
    expect(withStripe.some((s) => s.key === withTrial.key)).toBe(true);

    const withTrialFilter = await subscrio.subscriptions.findSubscriptions({
      customerKey: ctx.customer.key,
      hasTrial: true
    });
    expect(withTrialFilter.every((s) => !!s.trialEndDate)).toBe(true);
  });

  test('omitting trialEndDate on update does not clear an existing trial', async () => {
    const ctx = await createHierarchy('trial-omit');
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const created = await subscrio.subscriptions.createSubscription({
      key: uniqueKey('sub-keep-trial'),
      customerKey: ctx.customer.key,
      billingCycleKey: ctx.cycle.key,
      trialEndDate: trialEnd.toISOString()
    });
    expect(created.trialEndDate).toBeTruthy();

    const updated = await subscrio.subscriptions.updateSubscription(created.key, {
      metadata: { note: 'keep-trial' }
    });
    expect(updated.trialEndDate).toBeTruthy();

    const cleared = await subscrio.subscriptions.updateSubscription(created.key, {
      clearTrialEndDate: true
    });
    expect(cleared.trialEndDate).toBeNull();
  });

  test('emits cancellation_pending for a future cancellation date', async () => {
    const ctx = await createHierarchy('cancel-pending');
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const created = await subscrio.subscriptions.createSubscription({
      key: uniqueKey('sub-pending'),
      customerKey: ctx.customer.key,
      billingCycleKey: ctx.cycle.key,
      cancellationDate: future.toISOString()
    });
    expect(created.status).toBe('cancellation_pending');

    const listed = await subscrio.subscriptions.listSubscriptions({
      customerKey: ctx.customer.key,
      status: 'cancellation_pending'
    });
    expect(listed.some((s) => s.key === created.key)).toBe(true);
  });

  test('paginates with order then offset then limit', async () => {
    const ctx = await createHierarchy('page');
    for (let i = 0; i < 4; i++) {
      await subscrio.subscriptions.createSubscription({
        key: uniqueKey(`sub-page-${i}`),
        customerKey: ctx.customer.key,
        billingCycleKey: ctx.cycle.key
      });
    }
    const page = await subscrio.subscriptions.listSubscriptions({
      customerKey: ctx.customer.key,
      sortBy: 'createdAt',
      sortOrder: 'asc',
      limit: 2,
      offset: 1
    });
    expect(page.length).toBe(2);
  });

  test('getSubscription includes feature overrides', async () => {
    const ctx = await createHierarchy('ovr');
    const feature = await subscrio.features.createFeature({
      key: uniqueKey('feat'),
      displayName: 'Override Feature',
      valueType: 'numeric',
      defaultValue: '1'
    });
    await subscrio.products.associateFeature(ctx.product.key, feature.key);
    const sub = await subscrio.subscriptions.createSubscription({
      key: uniqueKey('sub-ovr'),
      customerKey: ctx.customer.key,
      billingCycleKey: ctx.cycle.key
    });
    await subscrio.subscriptions.addFeatureOverride(sub.key, feature.key, '9');
    const loaded = await subscrio.subscriptions.getSubscription(sub.key);
    expect(loaded?.featureOverrides?.some((o) => o.featureKey === feature.key && o.value === '9')).toBe(true);
  });
});

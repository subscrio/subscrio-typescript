import { describe, expect, test, beforeAll } from 'vitest';
import { Subscrio } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';
import { uniqueKey } from '../setup/unique-key.js';

describe('FeatureChecker coverage', () => {
  let subscrio: Subscrio;

  beforeAll(() => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() }
    });
  });

  test('multi-sub resolution does not lock onto the first plan default', async () => {
    const product = await subscrio.products.createProduct({
      key: uniqueKey('fc-product'),
      displayName: 'Multi Product'
    });
    const feature = await subscrio.features.createFeature({
      key: uniqueKey('fc-feat'),
      displayName: 'Seats',
      valueType: 'numeric',
      defaultValue: '1'
    });
    await subscrio.products.associateFeature(product.key, feature.key);

    const lowPlan = await subscrio.plans.createPlan({
      productKey: product.key,
      key: uniqueKey('fc-low'),
      displayName: 'Low'
    });
    const highPlan = await subscrio.plans.createPlan({
      productKey: product.key,
      key: uniqueKey('fc-high'),
      displayName: 'High'
    });
    await subscrio.plans.setFeatureValue(highPlan.key, feature.key, '50');

    const lowCycle = await subscrio.billingCycles.createBillingCycle({
      planKey: lowPlan.key,
      key: uniqueKey('fc-low-c'),
      displayName: 'Low cycle',
      durationValue: 1,
      durationUnit: 'months'
    });
    const highCycle = await subscrio.billingCycles.createBillingCycle({
      planKey: highPlan.key,
      key: uniqueKey('fc-high-c'),
      displayName: 'High cycle',
      durationValue: 1,
      durationUnit: 'months'
    });
    const customer = await subscrio.customers.createCustomer({
      key: uniqueKey('fc-cust'),
      displayName: 'Multi customer'
    });
    await subscrio.subscriptions.createSubscription({
      key: uniqueKey('fc-sub-low'),
      customerKey: customer.key,
      billingCycleKey: lowCycle.key
    });
    await subscrio.subscriptions.createSubscription({
      key: uniqueKey('fc-sub-high'),
      customerKey: customer.key,
      billingCycleKey: highCycle.key
    });

    const value = await subscrio.featureChecker.getValueForCustomer(
      customer.key,
      product.key,
      feature.key,
      0
    );
    expect(value).toBe(50);
  });

  test('hasPlanAccess requires the plan to belong to the product', async () => {
    const productA = await subscrio.products.createProduct({
      key: uniqueKey('access-a'),
      displayName: 'A'
    });
    const productB = await subscrio.products.createProduct({
      key: uniqueKey('access-b'),
      displayName: 'B'
    });
    const planB = await subscrio.plans.createPlan({
      productKey: productB.key,
      key: uniqueKey('access-plan-b'),
      displayName: 'Plan B'
    });
    const cycleB = await subscrio.billingCycles.createBillingCycle({
      planKey: planB.key,
      key: uniqueKey('access-cycle-b'),
      displayName: 'Cycle B',
      durationValue: 1,
      durationUnit: 'months'
    });
    const customer = await subscrio.customers.createCustomer({
      key: uniqueKey('access-cust'),
      displayName: 'Access customer'
    });
    await subscrio.subscriptions.createSubscription({
      key: uniqueKey('access-sub'),
      customerKey: customer.key,
      billingCycleKey: cycleB.key
    });

    expect(await subscrio.featureChecker.hasPlanAccess(customer.key, productA.key, planB.key)).toBe(false);
    expect(await subscrio.featureChecker.hasPlanAccess(customer.key, productB.key, planB.key)).toBe(true);
  });

  test('getActivePlans returns only active/trial plan keys', async () => {
    const product = await subscrio.products.createProduct({
      key: uniqueKey('active-p'),
      displayName: 'Active product'
    });
    const plan = await subscrio.plans.createPlan({
      productKey: product.key,
      key: uniqueKey('active-plan'),
      displayName: 'Plan'
    });
    const cycle = await subscrio.billingCycles.createBillingCycle({
      planKey: plan.key,
      key: uniqueKey('active-cycle'),
      displayName: 'Cycle',
      durationValue: 1,
      durationUnit: 'months'
    });
    const customer = await subscrio.customers.createCustomer({
      key: uniqueKey('active-cust'),
      displayName: 'Active customer'
    });
    const sub = await subscrio.subscriptions.createSubscription({
      key: uniqueKey('active-sub'),
      customerKey: customer.key,
      billingCycleKey: cycle.key
    });
    const past = new Date(Date.now() - 60_000).toISOString();
    await subscrio.subscriptions.updateSubscription(sub.key, { expirationDate: past });

    const plans = await subscrio.featureChecker.getActivePlans(customer.key);
    expect(plans).not.toContain(plan.key);
  });

  test('usage summary is product-scoped to active/trial subscriptions', async () => {
    const product = await subscrio.products.createProduct({
      key: uniqueKey('usage-p'),
      displayName: 'Usage product'
    });
    const other = await subscrio.products.createProduct({
      key: uniqueKey('usage-other'),
      displayName: 'Other product'
    });
    const feature = await subscrio.features.createFeature({
      key: uniqueKey('usage-feat'),
      displayName: 'Toggle',
      valueType: 'toggle',
      defaultValue: 'true'
    });
    await subscrio.products.associateFeature(product.key, feature.key);

    const plan = await subscrio.plans.createPlan({
      productKey: product.key,
      key: uniqueKey('usage-plan'),
      displayName: 'Plan'
    });
    const otherPlan = await subscrio.plans.createPlan({
      productKey: other.key,
      key: uniqueKey('usage-other-plan'),
      displayName: 'Other plan'
    });
    const cycle = await subscrio.billingCycles.createBillingCycle({
      planKey: plan.key,
      key: uniqueKey('usage-cycle'),
      displayName: 'Cycle',
      durationValue: 1,
      durationUnit: 'months'
    });
    const otherCycle = await subscrio.billingCycles.createBillingCycle({
      planKey: otherPlan.key,
      key: uniqueKey('usage-other-cycle'),
      displayName: 'Other cycle',
      durationValue: 1,
      durationUnit: 'months'
    });
    const customer = await subscrio.customers.createCustomer({
      key: uniqueKey('usage-cust'),
      displayName: 'Usage customer'
    });
    await subscrio.subscriptions.createSubscription({
      key: uniqueKey('usage-sub'),
      customerKey: customer.key,
      billingCycleKey: cycle.key
    });
    await subscrio.subscriptions.createSubscription({
      key: uniqueKey('usage-other-sub'),
      customerKey: customer.key,
      billingCycleKey: otherCycle.key
    });

    const summary = await subscrio.featureChecker.getFeatureUsageSummary(customer.key, product.key);
    expect(summary.activeSubscriptions).toBe(1);
    expect(summary.enabledFeatures).toContain(feature.key);
  });

  test('missing customer or product returns defaults and empty usage', async () => {
    expect(await subscrio.featureChecker.getValueForCustomer('missing-cust', 'no-product', 'no-feat', 'x')).toBe('x');
    expect(await subscrio.featureChecker.hasPlanAccess('missing-cust', 'no-product', 'no-plan')).toBe(false);
    expect(await subscrio.featureChecker.getActivePlans('missing-cust')).toEqual([]);
    const summary = await subscrio.featureChecker.getFeatureUsageSummary('missing-cust', 'no-product');
    expect(summary.activeSubscriptions).toBe(0);
    expect(summary.enabledFeatures).toEqual([]);
  });

  test('usage summary splits toggle, numeric, and text features', async () => {
    const product = await subscrio.products.createProduct({
      key: uniqueKey('sum-p'),
      displayName: 'Summary product'
    });
    const toggleOn = await subscrio.features.createFeature({
      key: uniqueKey('sum-on'),
      displayName: 'On',
      valueType: 'toggle',
      defaultValue: 'true'
    });
    const toggleOff = await subscrio.features.createFeature({
      key: uniqueKey('sum-off'),
      displayName: 'Off',
      valueType: 'toggle',
      defaultValue: 'false'
    });
    const numeric = await subscrio.features.createFeature({
      key: uniqueKey('sum-num'),
      displayName: 'Seats',
      valueType: 'numeric',
      defaultValue: '7'
    });
    const text = await subscrio.features.createFeature({
      key: uniqueKey('sum-text'),
      displayName: 'Color',
      valueType: 'text',
      defaultValue: 'blue'
    });
    for (const f of [toggleOn, toggleOff, numeric, text]) {
      await subscrio.products.associateFeature(product.key, f.key);
    }
    const customer = await subscrio.customers.createCustomer({
      key: uniqueKey('sum-cust'),
      displayName: 'Summary customer'
    });

    const summary = await subscrio.featureChecker.getFeatureUsageSummary(customer.key, product.key);
    expect(summary.enabledFeatures).toContain(toggleOn.key);
    expect(summary.disabledFeatures).toContain(toggleOff.key);
    expect(summary.numericFeatures.get(numeric.key)).toBe(7);
    expect(summary.textFeatures.get(text.key)).toBe('blue');
  });

  test('subscription feature APIs resolve and toggle-check values', async () => {
    const product = await subscrio.products.createProduct({
      key: uniqueKey('subfc-p'),
      displayName: 'Sub product'
    });
    const feature = await subscrio.features.createFeature({
      key: uniqueKey('subfc-f'),
      displayName: 'API',
      valueType: 'toggle',
      defaultValue: 'true'
    });
    await subscrio.products.associateFeature(product.key, feature.key);
    const plan = await subscrio.plans.createPlan({
      productKey: product.key,
      key: uniqueKey('subfc-plan'),
      displayName: 'Plan'
    });
    const cycle = await subscrio.billingCycles.createBillingCycle({
      planKey: plan.key,
      key: uniqueKey('subfc-c'),
      displayName: 'Cycle',
      durationValue: 1,
      durationUnit: 'months'
    });
    const customer = await subscrio.customers.createCustomer({
      key: uniqueKey('subfc-cust'),
      displayName: 'Customer'
    });
    const sub = await subscrio.subscriptions.createSubscription({
      key: uniqueKey('subfc-sub'),
      customerKey: customer.key,
      billingCycleKey: cycle.key
    });

    expect(await subscrio.featureChecker.isEnabledForSubscription(sub.key, feature.key)).toBe(true);
    expect(await subscrio.featureChecker.isEnabledForCustomer(customer.key, product.key, feature.key)).toBe(true);
    const all = await subscrio.featureChecker.getAllFeaturesForSubscription(sub.key);
    expect(all.get(feature.key)).toBe('true');
    expect(await subscrio.featureChecker.getValueForSubscription('missing-sub', feature.key, 'fallback')).toBe('fallback');
  });
});

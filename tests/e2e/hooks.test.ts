import { beforeAll, describe, expect, test } from 'vitest';
import Stripe from 'stripe';
import {
  HookEvents,
  OverrideType,
  Subscrio,
  type CustomerMutationHookEvent,
  type StripeReceivedHookEvent,
  type SubscriptionMutationHookEvent,
} from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Hooks E2E Tests', () => {
  let subscrio: Subscrio;

  beforeAll(async () => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() },
    });
  });

  async function createSubscriptionFixture() {
    const product = await subscrio.products.createProduct({
      key: unique('hook-prod'),
      displayName: 'Hook Product',
    });
    const plan = await subscrio.plans.createPlan({
      productKey: product.key,
      key: unique('hook-plan'),
      displayName: 'Hook Plan',
    });
    const cycle = await subscrio.billingCycles.createBillingCycle({
      planKey: plan.key,
      key: unique('hook-cycle'),
      displayName: 'Monthly',
      durationValue: 1,
      durationUnit: 'months',
    });
    const customer = await subscrio.customers.createCustomer({
      key: unique('hook-sub-cust'),
      displayName: 'Sub Cust',
    });
    return { product, plan, cycle, customer };
  }

  test('emits customer.created.before before persist with old null and new JSON', async () => {
    const events: CustomerMutationHookEvent[] = [];
    const off = subscrio.hooks.on(HookEvents.CustomerCreatedBefore, async (e) => {
      events.push(e);
      const existing = await subscrio.customers.getCustomer(e.new!.key);
      expect(existing).toBeNull();
    });

    const key = unique('hook-cust');
    await subscrio.customers.createCustomer({
      key,
      displayName: 'Hook Customer',
    });

    expect(events).toHaveLength(1);
    expect(events[0].phase).toBe('before');
    expect(events[0].source).toBe('api');
    expect(events[0].entityId).toBeNull();
    expect(events[0].old).toBeNull();
    expect(events[0].new?.key).toBe(key);
    expect(events[0].new?.displayName).toBe('Hook Customer');
    off();
  });

  test('before-hook mutating evt.new.displayName persists on createCustomer', async () => {
    const key = unique('hook-mut');
    const off = subscrio.hooks.on(HookEvents.CustomerCreatedBefore, async (e) => {
      e.new!.displayName = 'Mutated Name';
    });

    await subscrio.customers.createCustomer({
      key,
      displayName: 'Original Name',
    });

    const persisted = await subscrio.customers.getCustomer(key);
    expect(persisted?.displayName).toBe('Mutated Name');
    off();
  });

  test('before-hook invalid email is rejected and not persisted', async () => {
    const key = unique('hook-bad-email');
    const off = subscrio.hooks.on(HookEvents.CustomerCreatedBefore, async (e) => {
      e.new!.email = 'not-an-email';
    });

    await expect(
      subscrio.customers.createCustomer({
        key,
        displayName: 'Hook Customer',
      })
    ).rejects.toThrow(/after hook|Invalid customer/i);

    expect(await subscrio.customers.getCustomer(key)).toBeNull();
    off();
  });

  test('after-hook receives non-null entityId on create', async () => {
    let entityId: number | null | undefined;
    const off = subscrio.hooks.on(HookEvents.CustomerCreatedAfter, async (e) => {
      entityId = e.entityId;
    });

    const key = unique('hook-eid');
    await subscrio.customers.createCustomer({
      key,
      displayName: 'Entity Id Customer',
    });

    expect(entityId).toBeTypeOf('number');
    expect(entityId!).toBeGreaterThan(0);
    off();
  });

  test('unsubscribe via returned off() stops further events', async () => {
    let count = 0;
    const off = subscrio.hooks.on(HookEvents.CustomerCreatedAfter, async () => {
      count++;
    });
    off();

    await subscrio.customers.createCustomer({
      key: unique('hook-unsub'),
      displayName: 'Unsubscribed',
    });

    expect(count).toBe(0);
  });

  test('after-hook throw leaves the customer row', async () => {
    const key = unique('hook-aft');
    const off = subscrio.hooks.on(HookEvents.CustomerCreatedAfter, async () => {
      throw new Error('after boom');
    });

    await expect(
      subscrio.customers.createCustomer({
        key,
        displayName: 'After Throw',
      })
    ).rejects.toThrow('after boom');

    const persisted = await subscrio.customers.getCustomer(key);
    expect(persisted).not.toBeNull();
    expect(persisted?.displayName).toBe('After Throw');
    off();
  });

  test('emits customer.updated.before with full old and new; abort prevents persist', async () => {
    const key = unique('hook-upd');
    await subscrio.customers.createCustomer({
      key,
      displayName: 'Before',
    });

    const events: CustomerMutationHookEvent[] = [];
    const off = subscrio.hooks.on(HookEvents.CustomerUpdatedBefore, async (e) => {
      events.push(e);
      throw new Error('abort update');
    });

    await expect(
      subscrio.customers.updateCustomer(key, { displayName: 'After' })
    ).rejects.toThrow('abort update');

    const persisted = await subscrio.customers.getCustomer(key);
    expect(persisted?.displayName).toBe('Before');
    expect(events).toHaveLength(1);
    expect(events[0].old?.displayName).toBe('Before');
    expect(events[0].new?.displayName).toBe('After');
    off();
  });

  test('emits customer.archived / deleted before with old/new JSON', async () => {
    const key = unique('hook-arc');
    await subscrio.customers.createCustomer({ key, displayName: 'Archive Me' });

    const archived: CustomerMutationHookEvent[] = [];
    const deleted: CustomerMutationHookEvent[] = [];
    const off1 = subscrio.hooks.on(HookEvents.CustomerArchivedBefore, async (e) => archived.push(e));
    const off2 = subscrio.hooks.on(HookEvents.CustomerDeletedBefore, async (e) => deleted.push(e));

    await subscrio.customers.archiveCustomer(key);
    expect(archived).toHaveLength(1);
    expect(archived[0].old?.status).toBe('active');
    expect(archived[0].new?.status).toBe('archived');
    expect(archived[0].source).toBe('api');

    await subscrio.customers.deleteCustomer(key);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].old?.key).toBe(key);
    expect(deleted[0].new).toBeNull();
    off1();
    off2();
  });

  test('shares one payload across multiple handlers', async () => {
    const seen: unknown[] = [];
    const off1 = subscrio.hooks.on(HookEvents.CustomerCreatedBefore, async (e) => {
      seen.push(e.new);
    });
    const off2 = subscrio.hooks.on(HookEvents.CustomerCreatedBefore, async (e) => {
      seen.push(e.new);
    });

    await subscrio.customers.createCustomer({
      key: unique('hook-multi'),
      displayName: 'Multi',
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(seen[1]);
    off1();
    off2();
  });

  test('hasListeners is false when no handlers registered', async () => {
    expect(subscrio.hooks.hasListeners(HookEvents.CustomerDeletedBefore)).toBe(false);
    const key = unique('hook-noli');
    await subscrio.customers.createCustomer({ key, displayName: 'No listeners' });
    await subscrio.customers.archiveCustomer(key);
    await subscrio.customers.deleteCustomer(key);
    expect(await subscrio.customers.getCustomer(key)).toBeNull();
  });

  test('subscription before-hook mutation persists metadata; after has entityId and customerId', async () => {
    const { cycle, customer } = await createSubscriptionFixture();

    const offBefore = subscrio.hooks.on(HookEvents.SubscriptionCreatedBefore, async (e) => {
      e.new!.metadata = { ...(e.new!.metadata ?? {}), fromHook: 'yes' };
    });

    let afterEvt: SubscriptionMutationHookEvent | undefined;
    const offAfter = subscrio.hooks.on(HookEvents.SubscriptionCreatedAfter, async (e) => {
      afterEvt = e;
    });

    const subKey = unique('hook-sub-mut');
    await subscrio.subscriptions.createSubscription({
      key: subKey,
      customerKey: customer.key,
      billingCycleKey: cycle.key,
    });

    const persisted = await subscrio.subscriptions.getSubscription(subKey);
    expect(persisted?.metadata).toMatchObject({ fromHook: 'yes' });
    expect(afterEvt?.phase).toBe('after');
    expect(afterEvt?.entityId).toBeTypeOf('number');
    expect(afterEvt?.entityId!).toBeGreaterThan(0);
    expect(afterEvt?.customerId).toBeTypeOf('number');
    expect(afterEvt?.customerId!).toBeGreaterThan(0);
    expect(afterEvt?.new?.metadata).toMatchObject({ fromHook: 'yes' });

    offBefore();
    offAfter();
  });

  test('emits subscription.created / updated / deleted before with source api', async () => {
    const { cycle, customer } = await createSubscriptionFixture();
    const created: SubscriptionMutationHookEvent[] = [];
    const updated: SubscriptionMutationHookEvent[] = [];
    const deleted: SubscriptionMutationHookEvent[] = [];

    const off1 = subscrio.hooks.on(HookEvents.SubscriptionCreatedBefore, async (e) => created.push(e));
    const off2 = subscrio.hooks.on(HookEvents.SubscriptionUpdatedBefore, async (e) => updated.push(e));
    const off3 = subscrio.hooks.on(HookEvents.SubscriptionDeletedBefore, async (e) => deleted.push(e));

    const subKey = unique('hook-sub');
    await subscrio.subscriptions.createSubscription({
      key: subKey,
      customerKey: customer.key,
      billingCycleKey: cycle.key,
    });
    expect(created).toHaveLength(1);
    expect(created[0].source).toBe('api');
    expect(created[0].phase).toBe('before');
    expect(created[0].old).toBeNull();
    expect(created[0].new?.key).toBe(subKey);

    await subscrio.subscriptions.updateSubscription(subKey, {
      metadata: { note: 'updated' },
    });
    expect(updated).toHaveLength(1);
    expect(updated[0].old?.key).toBe(subKey);
    expect(updated[0].new?.metadata).toEqual({ note: 'updated' });

    await subscrio.subscriptions.deleteSubscription(subKey);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].old?.key).toBe(subKey);
    expect(deleted[0].new).toBeNull();

    off1();
    off2();
    off3();
  });

  test('emits subscription.featureOverrideAdded.before before persist', async () => {
    const { product, cycle, customer } = await createSubscriptionFixture();
    const feature = await subscrio.features.createFeature({
      key: unique('hook-feat'),
      displayName: 'Hook Feature',
      valueType: 'toggle',
      defaultValue: 'false',
    });
    await subscrio.products.associateFeature(product.key, feature.key);

    const subKey = unique('hook-ov');
    await subscrio.subscriptions.createSubscription({
      key: subKey,
      customerKey: customer.key,
      billingCycleKey: cycle.key,
    });

    const events: SubscriptionMutationHookEvent[] = [];
    const off = subscrio.hooks.on(HookEvents.SubscriptionFeatureOverrideAddedBefore, async (e) => {
      events.push(e);
    });

    await subscrio.subscriptions.addFeatureOverride(
      subKey,
      feature.key,
      'true',
      OverrideType.Permanent
    );

    expect(events).toHaveLength(1);
    expect(events[0].featureKey).toBe(feature.key);
    expect(events[0].value).toBe('true');
    expect(events[0].overrideType).toBe(OverrideType.Permanent);
    expect(events[0].old?.key).toBe(subKey);
    expect(events[0].new?.key).toBe(subKey);
    off();
  });

  test('stripe.received.before fires before domain hooks; after fires after process completes', async () => {
    const product = await subscrio.products.createProduct({
      key: unique('stripe-prod'),
      displayName: 'Stripe Product',
    });
    const plan = await subscrio.plans.createPlan({
      productKey: product.key,
      key: unique('stripe-plan'),
      displayName: 'Stripe Plan',
    });
    const priceId = unique('price');
    await subscrio.billingCycles.createBillingCycle({
      planKey: plan.key,
      key: unique('stripe-cycle'),
      displayName: 'Monthly',
      durationValue: 1,
      durationUnit: 'months',
      externalProductId: priceId,
    });
    const customerKey = unique('stripe-cust');
    const stripeCustomerId = unique('cus');
    await subscrio.customers.createCustomer({
      key: customerKey,
      displayName: 'Stripe Cust',
      externalBillingId: stripeCustomerId,
    });

    const order: string[] = [];
    const stripeBefore: StripeReceivedHookEvent[] = [];
    const stripeAfter: StripeReceivedHookEvent[] = [];
    const subEvents: SubscriptionMutationHookEvent[] = [];

    const off1 = subscrio.hooks.on(HookEvents.StripeReceivedBefore, async (e) => {
      order.push('stripe.received.before');
      stripeBefore.push(e);
    });
    const off2 = subscrio.hooks.on(HookEvents.SubscriptionCreatedBefore, async (e) => {
      order.push('subscription.created.before');
      subEvents.push(e);
    });
    const off3 = subscrio.hooks.on(HookEvents.StripeReceivedAfter, async (e) => {
      order.push('stripe.received.after');
      stripeAfter.push(e);
    });

    const event = {
      id: unique('evt'),
      object: 'event',
      api_version: '2026-07-29.dahlia',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: unique('sub'),
          object: 'subscription',
          customer: stripeCustomerId,
          status: 'active',
          created: Math.floor(Date.now() / 1000),
          cancel_at_period_end: false,
          canceled_at: null,
          metadata: { subscrioCustomerKey: customerKey },
          items: {
            object: 'list',
            data: [{
              id: unique('si'),
              object: 'subscription_item',
              current_period_start: Math.floor(Date.now() / 1000),
              current_period_end: Math.floor(Date.now() / 1000) + 2_592_000,
              price: { id: priceId, object: 'price' }
            }],
          },
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: 'customer.subscription.created',
    } as Stripe.Event;

    await subscrio.stripe.processStripeEvent(event);

    expect(order[0]).toBe('stripe.received.before');
    expect(order).toContain('subscription.created.before');
    expect(order[order.length - 1]).toBe('stripe.received.after');
    expect(order.indexOf('stripe.received.before')).toBeLessThan(
      order.indexOf('subscription.created.before')
    );
    expect(order.indexOf('subscription.created.before')).toBeLessThan(
      order.indexOf('stripe.received.after')
    );
    expect(stripeBefore[0].phase).toBe('before');
    expect(stripeBefore[0].data.id).toBe(event.id);
    expect(stripeAfter[0].phase).toBe('after');
    expect(stripeAfter[0].data.id).toBe(event.id);
    expect(subEvents.some((e) => e.source === 'stripe')).toBe(true);
    off1();
    off2();
    off3();
  });

  test('transitionExpiredSubscriptions emits system-sourced hooks', async () => {
    const product = await subscrio.products.createProduct({
      key: unique('trn-prod'),
      displayName: 'Transition Product',
    });
    const paidPlan = await subscrio.plans.createPlan({
      productKey: product.key,
      key: unique('trn-paid'),
      displayName: 'Paid',
    });
    const freePlan = await subscrio.plans.createPlan({
      productKey: product.key,
      key: unique('trn-free'),
      displayName: 'Free',
    });
    const paidCycle = await subscrio.billingCycles.createBillingCycle({
      planKey: paidPlan.key,
      key: unique('trn-paid-cycle'),
      displayName: 'Paid Monthly',
      durationValue: 1,
      durationUnit: 'months',
    });
    const freeCycle = await subscrio.billingCycles.createBillingCycle({
      planKey: freePlan.key,
      key: unique('trn-free-cycle'),
      displayName: 'Free Forever',
      durationUnit: 'forever',
    });
    await subscrio.plans.updatePlan(paidPlan.key, {
      onExpireTransitionToBillingCycleKey: freeCycle.key,
    });

    const customer = await subscrio.customers.createCustomer({
      key: unique('trn-cust'),
      displayName: 'Transition Cust',
    });
    const subKey = unique('trn-sub');
    await subscrio.subscriptions.createSubscription({
      key: subKey,
      customerKey: customer.key,
      billingCycleKey: paidCycle.key,
      expirationDate: new Date(Date.now() - 60_000).toISOString(),
    });

    const archived: SubscriptionMutationHookEvent[] = [];
    const created: SubscriptionMutationHookEvent[] = [];
    const off1 = subscrio.hooks.on(HookEvents.SubscriptionArchivedBefore, async (e) => archived.push(e));
    const off2 = subscrio.hooks.on(HookEvents.SubscriptionCreatedBefore, async (e) => created.push(e));

    const report = await subscrio.subscriptions.transitionExpiredSubscriptions();
    expect(report.transitioned).toBeGreaterThanOrEqual(1);

    expect(archived.some((e) => e.source === 'system' && e.old?.key === subKey)).toBe(true);
    expect(created.some((e) => e.source === 'system' && e.new?.key?.startsWith(subKey))).toBe(true);
    off1();
    off2();
  });
});

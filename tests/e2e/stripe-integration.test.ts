import { beforeAll, describe, expect, test } from 'vitest';
import Stripe from 'stripe';
import { Subscrio } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';

const STRIPE_API_VERSION = '2026-07-29.dahlia';

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildStripeEvent(type: Stripe.Event.Type, payload: Record<string, unknown>): Stripe.Event {
  return {
    id: uniqueId('evt'),
    object: 'event',
    api_version: STRIPE_API_VERSION,
    created: Math.floor(Date.now() / 1000),
    data: { object: payload },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type
  } as Stripe.Event;
}

function stripeCustomerPayload(params: {
  id: string;
  metadata?: Record<string, string>;
}): Record<string, unknown> {
  return {
    id: params.id,
    object: 'customer',
    email: `${params.id}@example.com`,
    metadata: params.metadata ?? {}
  };
}

function stripeSubscriptionPayload(params: {
  id: string;
  customerId: string;
  priceId: string;
  status?: Stripe.Subscription.Status;
  metadata?: Record<string, string>;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  canceledAt?: number | null;
}): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const periodStart = params.currentPeriodStart ?? nowSeconds;
  const periodEnd = params.currentPeriodEnd ?? nowSeconds + 2_592_000;
  return {
    id: params.id,
    object: 'subscription',
    customer: params.customerId,
    status: params.status ?? 'active',
    created: nowSeconds,
    cancel_at_period_end: false,
    canceled_at: params.canceledAt ?? null,
    metadata: params.metadata ?? {},
    items: {
      object: 'list',
      data: [
        {
          id: uniqueId('si'),
          object: 'subscription_item',
          current_period_start: periodStart,
          current_period_end: periodEnd,
          price: {
            id: params.priceId,
            object: 'price'
          }
        }
      ]
    }
  };
}

function stripeInvoicePayload(params: {
  id: string;
  customerId: string;
  subscriptionId: string;
  priceId: string;
  periodStart: number;
  periodEnd: number;
}): Record<string, unknown> {
  return {
    id: params.id,
    object: 'invoice',
    status: 'paid',
    customer: params.customerId,
    parent: {
      type: 'subscription_details',
      subscription_details: {
        subscription: params.subscriptionId
      }
    },
    lines: {
      object: 'list',
      data: [
        {
          id: uniqueId('il'),
          object: 'line_item',
          pricing: {
            type: 'price_details',
            price_details: {
              price: params.priceId
            }
          },
          period: {
            start: params.periodStart,
            end: params.periodEnd
          }
        }
      ]
    }
  };
}

describe('Stripe Integration E2E Tests', () => {
  let subscrio: Subscrio;

  beforeAll(async () => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() }
    });
  });

  async function createPlanHierarchy(priceId: string) {
    const suffix = uniqueId('stripe');
    const product = await subscrio.products.createProduct({
      key: `product-${suffix}`,
      displayName: `Stripe Product ${suffix}`
    });

    const plan = await subscrio.plans.createPlan({
      productKey: product.key,
      key: `plan-${suffix}`,
      displayName: `Stripe Plan ${suffix}`
    });

    const billingCycle = await subscrio.billingCycles.createBillingCycle({
      planKey: plan.key,
      key: `cycle-${suffix}`,
      displayName: `Stripe Cycle ${suffix}`,
      durationValue: 1,
      durationUnit: 'months',
      externalProductId: priceId
    });

    return { product, plan, billingCycle };
  }

  async function createCustomer() {
    const suffix = uniqueId('cust');
    return subscrio.customers.createCustomer({
      key: `customer-${suffix}`,
      displayName: `Customer ${suffix}`
    });
  }

  describe('Customer events', () => {
    test('customer.created backfills externalBillingId using metadata', async () => {
      const customer = await createCustomer();
      const stripeCustomerId = uniqueId('cus');

      const event = buildStripeEvent(
        'customer.created',
        stripeCustomerPayload({
          id: stripeCustomerId,
          metadata: { subscrioCustomerKey: customer.key }
        })
      );

      await subscrio.stripe.processStripeEvent(event);
      const updated = await subscrio.customers.getCustomer(customer.key);
      expect(updated?.externalBillingId).toBe(stripeCustomerId);
    });

    test('customer.updated reuses stored externalBillingId without metadata', async () => {
      const customer = await createCustomer();
      const stripeCustomerId = uniqueId('cus');

      const createdEvent = buildStripeEvent(
        'customer.created',
        stripeCustomerPayload({
          id: stripeCustomerId,
          metadata: { subscrioCustomerKey: customer.key }
        })
      );
      await subscrio.stripe.processStripeEvent(createdEvent);

      const updatedEvent = buildStripeEvent(
        'customer.updated',
        stripeCustomerPayload({
          id: stripeCustomerId,
          metadata: {}
        })
      );

      await subscrio.stripe.processStripeEvent(updatedEvent);
      const updated = await subscrio.customers.getCustomer(customer.key);
      expect(updated?.externalBillingId).toBe(stripeCustomerId);
    });

    test('customer.deleted clears externalBillingId', async () => {
      const customer = await createCustomer();
      const stripeCustomerId = uniqueId('cus');

      await subscrio.stripe.processStripeEvent(
        buildStripeEvent(
          'customer.created',
          stripeCustomerPayload({
            id: stripeCustomerId,
            metadata: { subscrioCustomerKey: customer.key }
          })
        )
      );

      await subscrio.stripe.processStripeEvent(
        buildStripeEvent('customer.deleted', {
          id: stripeCustomerId,
          object: 'customer',
          deleted: true
        })
      );

      const updated = await subscrio.customers.getCustomer(customer.key);
      expect(updated?.externalBillingId).toBeNull();
    });
  });

  describe('Subscription events', () => {
    test('customer.subscription.created creates a Subscrio subscription', async () => {
      const priceId = uniqueId('price');
      await createPlanHierarchy(priceId);
      const customer = await createCustomer();
      const stripeCustomerId = uniqueId('cus');
      const subscriptionKey = uniqueId('sub');
      const stripeSubscriptionId = uniqueId('sub_stripe');

      const event = buildStripeEvent(
        'customer.subscription.created',
        stripeSubscriptionPayload({
          id: stripeSubscriptionId,
          customerId: stripeCustomerId,
          priceId,
          metadata: {
            subscrioCustomerKey: customer.key,
            subscrioSubscriptionKey: subscriptionKey
          }
        })
      );

      await subscrio.stripe.processStripeEvent(event);
      const stored = await subscrio.subscriptions.getSubscription(subscriptionKey);
      expect(stored).not.toBeNull();
      expect(stored?.stripeSubscriptionId).toBe(stripeSubscriptionId);

      const updatedCustomer = await subscrio.customers.getCustomer(customer.key);
      expect(updatedCustomer?.externalBillingId).toBe(stripeCustomerId);
    });

    test('customer.subscription.updated refreshes period and cancellation data', async () => {
      const priceId = uniqueId('price');
      await createPlanHierarchy(priceId);
      const customer = await createCustomer();
      const stripeCustomerId = uniqueId('cus');
      const subscriptionKey = uniqueId('sub');
      const stripeSubscriptionId = uniqueId('sub_stripe');

      await subscrio.stripe.processStripeEvent(
        buildStripeEvent(
          'customer.subscription.created',
          stripeSubscriptionPayload({
            id: stripeSubscriptionId,
            customerId: stripeCustomerId,
            priceId,
            metadata: {
              subscrioCustomerKey: customer.key,
              subscrioSubscriptionKey: subscriptionKey
            }
          })
        )
      );

      const updatedEvent = buildStripeEvent(
        'customer.subscription.updated',
        stripeSubscriptionPayload({
          id: stripeSubscriptionId,
          customerId: stripeCustomerId,
          priceId,
          status: 'canceled',
          metadata: { subscrioCustomerKey: customer.key },
          canceledAt: Math.floor(Date.now() / 1000)
        })
      );

      await subscrio.stripe.processStripeEvent(updatedEvent);
      const stored = await subscrio.subscriptions.getSubscription(subscriptionKey);
      expect(stored?.status).toBe('cancelled');
      expect(stored?.cancellationDate).not.toBeNull();
    });

    test('customer.subscription.deleted expires the subscription', async () => {
      const priceId = uniqueId('price');
      await createPlanHierarchy(priceId);
      const customer = await createCustomer();
      const stripeCustomerId = uniqueId('cus');
      const subscriptionKey = uniqueId('sub');
      const stripeSubscriptionId = uniqueId('sub_stripe');

      await subscrio.stripe.processStripeEvent(
        buildStripeEvent(
          'customer.subscription.created',
          stripeSubscriptionPayload({
            id: stripeSubscriptionId,
            customerId: stripeCustomerId,
            priceId,
            metadata: {
              subscrioCustomerKey: customer.key,
              subscrioSubscriptionKey: subscriptionKey
            }
          })
        )
      );

      await subscrio.stripe.processStripeEvent(
        buildStripeEvent(
          'customer.subscription.deleted',
          stripeSubscriptionPayload({
            id: stripeSubscriptionId,
            customerId: stripeCustomerId,
            priceId,
            status: 'canceled',
            metadata: { subscrioCustomerKey: customer.key }
          })
        )
      );

      const stored = await subscrio.subscriptions.getSubscription(subscriptionKey);
      expect(stored?.status).toBe('expired');
    });
  });

  describe('Invoice events', () => {
    test('invoice.payment_succeeded updates the billing period', async () => {
      const priceId = uniqueId('price');
      await createPlanHierarchy(priceId);
      const customer = await createCustomer();
      const stripeCustomerId = uniqueId('cus');
      const subscriptionKey = uniqueId('sub');
      const stripeSubscriptionId = uniqueId('sub_stripe');

      await subscrio.stripe.processStripeEvent(
        buildStripeEvent(
          'customer.subscription.created',
          stripeSubscriptionPayload({
            id: stripeSubscriptionId,
            customerId: stripeCustomerId,
            priceId,
            metadata: {
              subscrioCustomerKey: customer.key,
              subscrioSubscriptionKey: subscriptionKey
            }
          })
        )
      );

      const periodStart = Math.floor(Date.now() / 1000);
      const periodEnd = periodStart + 2_592_000;

      await subscrio.stripe.processStripeEvent(
        buildStripeEvent(
          'invoice.payment_succeeded',
          stripeInvoicePayload({
            id: uniqueId('in'),
            customerId: stripeCustomerId,
            subscriptionId: stripeSubscriptionId,
            priceId,
            periodStart,
            periodEnd
          })
        )
      );

      const stored = await subscrio.subscriptions.getSubscription(subscriptionKey);
      expect(stored?.currentPeriodStart).toBe(new Date(periodStart * 1000).toISOString());
      expect(stored?.currentPeriodEnd).toBe(new Date(periodEnd * 1000).toISOString());
    });
  });
});


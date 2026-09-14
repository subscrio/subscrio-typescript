import { describe, expect, test } from 'vitest';
import { Subscription } from '../../src/domain/entities/Subscription.js';
import { SubscriptionStatus } from '../../src/domain/value-objects/SubscriptionStatus.js';
import { OverrideType } from '../../src/domain/value-objects/OverrideType.js';
import { DomainError } from '../../src/domain/errors/DomainError.js';

function makeSubscription(overrides: Partial<ConstructorParameters<typeof Subscription>[0]> = {}) {
  return new Subscription({
    key: 'sub-1',
    customerId: 1,
    planId: 1,
    billingCycleId: 1,
    status: SubscriptionStatus.Active,
    isArchived: false,
    featureOverrides: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

describe('Subscription entity', () => {
  test('cancel throws when already cancelled', () => {
    const sub = makeSubscription({ status: SubscriptionStatus.Cancelled });
    expect(() => sub.cancel()).toThrow(DomainError);
  });

  test('archive and unarchive toggle the flag without changing status', () => {
    const sub = makeSubscription();
    sub.archive();
    expect(sub.isArchived).toBe(true);
    expect(sub.status).toBe(SubscriptionStatus.Active);
    sub.unarchive();
    expect(sub.isArchived).toBe(false);
  });

  test('renew clears only temporary overrides', () => {
    const sub = makeSubscription({
      featureOverrides: [
        { featureId: 1, value: 'true', type: OverrideType.Permanent, createdAt: new Date() },
        { featureId: 2, value: 'false', type: OverrideType.Temporary, createdAt: new Date() },
      ],
    });
    sub.renew();
    expect(sub.props.featureOverrides).toHaveLength(1);
    expect(sub.props.featureOverrides[0].featureId).toBe(1);
  });
});

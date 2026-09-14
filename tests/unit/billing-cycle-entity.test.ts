import { describe, expect, test } from 'vitest';
import { BillingCycle } from '../../src/domain/entities/BillingCycle.js';
import { BillingCycleStatus } from '../../src/domain/value-objects/BillingCycleStatus.js';
import { DurationUnit } from '../../src/domain/value-objects/DurationUnit.js';

describe('BillingCycle entity', () => {
  test('calculateNextPeriodEnd for forever is null', () => {
    const cycle = new BillingCycle({
      planId: 1,
      key: 'forever',
      displayName: 'Forever',
      status: BillingCycleStatus.Active,
      durationUnit: DurationUnit.Forever,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(cycle.calculateNextPeriodEnd(new Date('2026-01-01T00:00:00.000Z'))).toBeNull();
  });

  test('calculateNextPeriodEnd for months', () => {
    const cycle = new BillingCycle({
      planId: 1,
      key: 'monthly',
      displayName: 'Monthly',
      status: BillingCycleStatus.Active,
      durationValue: 1,
      durationUnit: DurationUnit.Months,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const end = cycle.calculateNextPeriodEnd(new Date('2026-01-15T00:00:00.000Z'));
    expect(end?.getUTCMonth()).toBe(1);
  });

  test('archive then canDelete', () => {
    const cycle = new BillingCycle({
      planId: 1,
      key: 'monthly',
      displayName: 'Monthly',
      status: BillingCycleStatus.Active,
      durationValue: 1,
      durationUnit: DurationUnit.Months,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(cycle.canDelete()).toBe(false);
    cycle.archive();
    expect(cycle.status).toBe(BillingCycleStatus.Archived);
    expect(cycle.canDelete()).toBe(true);
    cycle.unarchive();
    expect(cycle.status).toBe(BillingCycleStatus.Active);
  });
});

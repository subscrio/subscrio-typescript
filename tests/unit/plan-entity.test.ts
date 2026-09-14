import { describe, expect, test } from 'vitest';
import { Plan } from '../../src/domain/entities/Plan.js';
import { PlanStatus } from '../../src/domain/value-objects/PlanStatus.js';

describe('Plan entity', () => {
  test('archive and unarchive update status', () => {
    const plan = new Plan({
      productKey: 'prod',
      key: 'plan',
      displayName: 'Plan',
      status: PlanStatus.Active,
      featureValues: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    plan.archive();
    expect(plan.status).toBe(PlanStatus.Archived);
    plan.unarchive();
    expect(plan.status).toBe(PlanStatus.Active);
  });

  test('setFeatureValue inserts and updates', () => {
    const plan = new Plan({
      productKey: 'prod',
      key: 'plan',
      displayName: 'Plan',
      status: PlanStatus.Active,
      featureValues: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    plan.setFeatureValue(10, '1');
    expect(plan.getFeatureValue(10)).toBe('1');
    plan.setFeatureValue(10, '2');
    expect(plan.getFeatureValue(10)).toBe('2');
    plan.removeFeatureValue(10);
    expect(plan.getFeatureValue(10)).toBeNull();
  });
});

import { describe, expect, test } from 'vitest';
import { FeatureValueMapper } from '../../src/application/mappers/FeatureValueMapper.js';
import { OverrideType } from '../../src/domain/value-objects/OverrideType.js';

describe('FeatureValueMapper', () => {
  test('maps plan feature rows', () => {
    const created = new Date('2026-01-01T00:00:00.000Z');
    const updated = new Date('2026-01-02T00:00:00.000Z');
    const values = FeatureValueMapper.toPlanFeatureValues([
      { feature_id: 9, value: '12', created_at: created, updated_at: updated }
    ]);
    expect(values).toEqual([
      { featureId: 9, value: '12', createdAt: created, updatedAt: updated }
    ]);
  });

  test('maps subscription override rows', () => {
    const created = new Date('2026-01-01T00:00:00.000Z');
    const overrides = FeatureValueMapper.toFeatureOverrides([
      { feature_id: 3, value: 'true', override_type: 'permanent', created_at: created }
    ]);
    expect(overrides[0]).toMatchObject({
      featureId: 3,
      value: 'true',
      type: OverrideType.Permanent
    });
  });
});

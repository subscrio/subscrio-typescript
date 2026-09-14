import type { PlanFeatureValue } from '../../domain/entities/Plan.js';
import type { FeatureOverride } from '../../domain/entities/Subscription.js';
import { OverrideType } from '../../domain/value-objects/OverrideType.js';

export class FeatureValueMapper {
  static toPlanFeatureValues(
    records: Array<{ feature_id: number; value: string; created_at: Date; updated_at: Date }>
  ): PlanFeatureValue[] {
    return records.map((r) => ({
      featureId: r.feature_id,
      value: r.value,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    }));
  }

  static toFeatureOverrides(
    records: Array<{ feature_id: number; value: string; override_type: string; created_at: Date }>
  ): FeatureOverride[] {
    return records.map((r) => ({
      featureId: r.feature_id,
      value: r.value,
      type: r.override_type as OverrideType,
      createdAt: new Date(r.created_at),
    }));
  }
}

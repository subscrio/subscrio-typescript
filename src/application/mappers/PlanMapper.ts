import { Plan, PlanFeatureValue } from '../../domain/entities/Plan.js';
import { PlanDto } from '../dtos/PlanDto.js';
import { PlanStatus } from '../../domain/value-objects/PlanStatus.js';

export class PlanMapper {
  static toDto(
    plan: Plan, 
    productKey: string,
    onExpireTransitionToBillingCycleKey?: string
  ): PlanDto {
    return {
      productKey,
      key: plan.key,
      displayName: plan.displayName,
      description: plan.props.description ?? null,
      status: plan.status,
      onExpireTransitionToBillingCycleKey: onExpireTransitionToBillingCycleKey ?? null,
      metadata: plan.props.metadata ?? null,
      createdAt: plan.props.createdAt.toISOString(),
      updatedAt: plan.props.updatedAt.toISOString()
    };
  }

  static toDomain(raw: any, featureValues: PlanFeatureValue[] = []): Plan {
    // Repository should join to provide product_key and on_expire_transition_to_billing_cycle_key
    // raw.product_key comes from join with products table
    // raw.on_expire_transition_to_billing_cycle_key comes from join with billing_cycles table
    return new Plan(
      {
        productKey: raw.product_key, // From join, not from plans table
        key: raw.key,
        displayName: raw.display_name,
        description: raw.description,
        status: raw.status as PlanStatus,
        onExpireTransitionToBillingCycleKey: raw.on_expire_transition_to_billing_cycle_key, // From join, not from plans table
        featureValues,
        metadata: raw.metadata,
        createdAt: new Date(raw.created_at),
        updatedAt: new Date(raw.updated_at)
      },
      raw.id as number | undefined
    );
  }

  static toPersistence(
    plan: Plan, 
    productId: number,
    onExpireTransitionToBillingCycleId?: number
  ): any {
    // Repository should resolve productKey to productId before calling this
    // Repository should resolve onExpireTransitionToBillingCycleKey to onExpireTransitionToBillingCycleId before calling this
    const record: any = {
      product_id: productId,
      key: plan.key,
      display_name: plan.displayName,
      description: plan.props.description,
      status: plan.status,
      on_expire_transition_to_billing_cycle_id: onExpireTransitionToBillingCycleId ?? null,
      metadata: plan.props.metadata,
      created_at: plan.props.createdAt,
      updated_at: plan.props.updatedAt
    };
    
    // Only include id for updates (not inserts)
    if (plan.id !== undefined) {
      record.id = plan.id;
    }
    
    return record;
  }
}


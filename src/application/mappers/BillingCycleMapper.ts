import { BillingCycle } from '../../domain/entities/BillingCycle.js';
import { BillingCycleDto } from '../dtos/BillingCycleDto.js';
import { DurationUnit } from '../../domain/value-objects/DurationUnit.js';
import { BillingCycleStatus } from '../../domain/value-objects/BillingCycleStatus.js';

export class BillingCycleMapper {
  static toDto(billingCycle: BillingCycle, productKey?: string, planKey?: string): BillingCycleDto {
    return {
      productKey: productKey ?? null,
      planKey: planKey ?? null,
      key: billingCycle.key,
      displayName: billingCycle.displayName,
      description: billingCycle.props.description ?? null,
      status: billingCycle.status,
      durationValue: billingCycle.props.durationValue ?? null,
      durationUnit: billingCycle.props.durationUnit,
      externalProductId: billingCycle.props.externalProductId ?? null,
      createdAt: billingCycle.props.createdAt.toISOString(),
      updatedAt: billingCycle.props.updatedAt.toISOString()
    };
  }

  static toDomain(raw: any): BillingCycle {
    return new BillingCycle(
      {
        planId: raw.plan_id as number,
        key: raw.key,
        displayName: raw.display_name,
        description: raw.description,
        status: (raw.status as BillingCycleStatus) || BillingCycleStatus.Active,
        durationValue: raw.duration_value,
        durationUnit: raw.duration_unit as DurationUnit,
        externalProductId: raw.external_product_id,
        createdAt: new Date(raw.created_at),
        updatedAt: new Date(raw.updated_at)
      },
      raw.id as number | undefined
    );
  }

  static toPersistence(billingCycle: BillingCycle): any {
    const record: any = {
      plan_id: billingCycle.planId,
      key: billingCycle.key,
      display_name: billingCycle.displayName,
      description: billingCycle.props.description,
      status: billingCycle.status,
      duration_value: billingCycle.props.durationValue,
      duration_unit: billingCycle.props.durationUnit,
      external_product_id: billingCycle.props.externalProductId,
      created_at: billingCycle.props.createdAt,
      updated_at: billingCycle.props.updatedAt
    };
    
    // Only include id for updates (not inserts)
    if (billingCycle.id !== undefined) {
      record.id = billingCycle.id;
    }
    
    return record;
  }
}


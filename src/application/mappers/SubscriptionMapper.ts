import { Subscription, FeatureOverride } from '../../domain/entities/Subscription.js';
import { SubscriptionDto } from '../dtos/SubscriptionDto.js';
import { SubscriptionStatus } from '../../domain/value-objects/SubscriptionStatus.js';
import { Customer } from '../../domain/entities/Customer.js';
import { CustomerMapper } from './CustomerMapper.js';

export class SubscriptionMapper {
  static toDto(
    subscription: Subscription,
    customerKey: string,
    productKey: string,
    planKey: string,
    billingCycleKey: string,
    customer?: Customer | null
  ): SubscriptionDto {
    return {
      key: subscription.key,
      customerKey,
      productKey,
      planKey,
      billingCycleKey,
      status: subscription.status,
      isArchived: subscription.isArchived,
      activationDate: subscription.props.activationDate?.toISOString() ?? null,
      expirationDate: subscription.props.expirationDate?.toISOString() ?? null,
      cancellationDate: subscription.props.cancellationDate?.toISOString() ?? null,
      trialEndDate: subscription.props.trialEndDate?.toISOString() ?? null,
      currentPeriodStart: subscription.props.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: subscription.props.currentPeriodEnd?.toISOString() ?? null,
      stripeSubscriptionId: subscription.props.stripeSubscriptionId ?? null,
      metadata: subscription.props.metadata ?? null,
      customer: customer ? CustomerMapper.toDto(customer) : null,
      createdAt: subscription.props.createdAt.toISOString(),
      updatedAt: subscription.props.updatedAt.toISOString()
    };
  }

  static toDomain(raw: any, featureOverrides: FeatureOverride[] = []): Subscription {
    return new Subscription(
      {
        key: raw.key,
        customerId: raw.customer_id as number,
        planId: raw.plan_id as number,
        billingCycleId: raw.billing_cycle_id as number,
        status: raw.computed_status as SubscriptionStatus,
        isArchived: raw.is_archived === true,
        activationDate: raw.activation_date ? new Date(raw.activation_date) : undefined,
        expirationDate: raw.expiration_date ? new Date(raw.expiration_date) : undefined,
        cancellationDate: raw.cancellation_date ? new Date(raw.cancellation_date) : undefined,
        trialEndDate: raw.trial_end_date ? new Date(raw.trial_end_date) : undefined,
        currentPeriodStart: raw.current_period_start ? new Date(raw.current_period_start) : undefined,
        currentPeriodEnd: raw.current_period_end ? new Date(raw.current_period_end) : undefined,
        stripeSubscriptionId: raw.stripe_subscription_id,
        featureOverrides,
        metadata: raw.metadata,
        createdAt: new Date(raw.created_at),
        updatedAt: new Date(raw.updated_at),
        transitionedAt: raw.transitioned_at ? new Date(raw.transitioned_at) : undefined
      },
      raw.id as number | undefined
    );
  }

  static toPersistence(subscription: Subscription): any {
    const record: any = {
      key: subscription.key,
      customer_id: subscription.customerId,
      plan_id: subscription.planId,
      billing_cycle_id: subscription.props.billingCycleId,
      is_archived: subscription.props.isArchived,
      activation_date: subscription.props.activationDate ?? null,
      expiration_date: subscription.props.expirationDate ?? null,
      cancellation_date: subscription.props.cancellationDate ?? null,
      trial_end_date: subscription.props.trialEndDate ?? null,
      current_period_start: subscription.props.currentPeriodStart ?? null,
      current_period_end: subscription.props.currentPeriodEnd ?? null,
      stripe_subscription_id: subscription.props.stripeSubscriptionId ?? null,
      metadata: subscription.props.metadata ?? null,
      created_at: subscription.props.createdAt,
      updated_at: subscription.props.updatedAt,
      transitioned_at: subscription.props.transitionedAt ?? null
    };
    
    // Only include id for updates (not inserts)
    if (subscription.id !== undefined) {
      record.id = subscription.id;
    }
    
    return record;
  }
}


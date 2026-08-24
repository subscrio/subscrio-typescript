import { ISubscriptionRepository } from '../../application/repositories/ISubscriptionRepository.js';
import { Subscription, FeatureOverride } from '../../domain/entities/Subscription.js';
import { Customer } from '../../domain/entities/Customer.js';
import { SubscriptionMapper } from '../../application/mappers/SubscriptionMapper.js';
import { CustomerMapper } from '../../application/mappers/CustomerMapper.js';
import { DrizzleDb } from '../database/drizzle.js';
import { subscriptions, subscription_feature_overrides, subscriptionStatusView, plans, customers } from '../database/schema.js';
import { eq, and, desc, asc, inArray, gte, lte, isNotNull, isNull } from 'drizzle-orm';
import { SubscriptionFilterDto } from '../../application/dtos/SubscriptionDto.js';
import { OverrideType } from '../../domain/value-objects/OverrideType.js';

export class DrizzleSubscriptionRepository implements ISubscriptionRepository {
  constructor(private readonly db: DrizzleDb) {}

  async save(subscription: Subscription): Promise<Subscription> {
    const record = SubscriptionMapper.toPersistence(subscription);
    
    let savedSubscriptionId: number;
    if (subscription.id === undefined) {
      // Insert new entity
      const [inserted] = await this.db
        .insert(subscriptions)
        .values(record)
        .returning({ id: subscriptions.id });
      
      savedSubscriptionId = inserted.id;
      
      // Insert feature overrides
      if (subscription.props.featureOverrides.length > 0) {
        const overrideRecords = subscription.props.featureOverrides.map(override => ({
          subscription_id: savedSubscriptionId,
          feature_id: override.featureId,
          value: override.value,
          override_type: override.type,
          created_at: override.createdAt
        }));

        await this.db.insert(subscription_feature_overrides).values(overrideRecords);
      }
      
    } else {
      // Update existing entity
      savedSubscriptionId = subscription.id;
      
      await this.db
        .update(subscriptions)
        .set({
          key: record.key,
          customer_id: record.customer_id,
          plan_id: record.plan_id,
          billing_cycle_id: record.billing_cycle_id,
          is_archived: record.is_archived,
          activation_date: record.activation_date,
          expiration_date: record.expiration_date,
          cancellation_date: record.cancellation_date,
          trial_end_date: record.trial_end_date,
          current_period_start: record.current_period_start,
          current_period_end: record.current_period_end,
          stripe_subscription_id: record.stripe_subscription_id,
          metadata: record.metadata,
          updated_at: record.updated_at,
          transitioned_at: record.transitioned_at
        })
        .where(eq(subscriptions.id, subscription.id));

      // Delete existing feature overrides
      await this.db.delete(subscription_feature_overrides).where(eq(subscription_feature_overrides.subscription_id, subscription.id));

      // Insert new feature overrides
      if (subscription.props.featureOverrides.length > 0) {
        if (savedSubscriptionId === undefined) {
          throw new Error('Subscription ID is undefined during update');
        }

        const overrideRecords = subscription.props.featureOverrides.map(override => ({
          subscription_id: savedSubscriptionId,
          feature_id: override.featureId,
          value: override.value,
          override_type: override.type,
          created_at: override.createdAt
        }));

        await this.db.insert(subscription_feature_overrides).values(overrideRecords);
      }
      
    }

    return this.loadSubscriptionById(savedSubscriptionId);
  }

  private async loadSubscriptionById(id: number): Promise<Subscription> {
    const [record] = await this.db
      .select()
      .from(subscriptionStatusView)
      .where(eq(subscriptionStatusView.id, id))
      .limit(1);

    if (!record) {
      throw new Error(`Subscription with id '${id}' not found after save`);
    }

    const featureOverrides = await this.loadFeatureOverrides(id);
    return SubscriptionMapper.toDomain(record, featureOverrides);
  }

  private async loadFeatureOverrides(subscriptionId: number): Promise<FeatureOverride[]> {
    const records = await this.db
      .select()
      .from(subscription_feature_overrides)
      .where(eq(subscription_feature_overrides.subscription_id, subscriptionId));

    return records.map(r => ({
      featureId: r.feature_id as number,
      value: r.value,
      type: r.override_type as OverrideType,
      createdAt: new Date(r.created_at)
    }));
  }

  async findById(id: number): Promise<Subscription | null> {
    const [record] = await this.db
      .select()
      .from(subscriptionStatusView)
      .where(eq(subscriptionStatusView.id, id))
      .limit(1);
    
    if (!record) return null;

    const featureOverrides = await this.loadFeatureOverrides(record.id);
    return SubscriptionMapper.toDomain(record, featureOverrides);
  }

  async findByKey(key: string): Promise<Subscription | null> {
    const [record] = await this.db
      .select()
      .from(subscriptionStatusView)
      .where(eq(subscriptionStatusView.key, key))
      .limit(1);
    
    if (!record) return null;

    const featureOverrides = await this.loadFeatureOverrides(record.id);
    return SubscriptionMapper.toDomain(record, featureOverrides);
  }

  async findByStripeId(stripeId: string): Promise<Subscription | null> {
    // Only find active (non-archived) subscriptions by Stripe ID
    // Archived subscriptions keep their Stripe ID for historical reference
    const [record] = await this.db
      .select()
      .from(subscriptionStatusView)
      .where(
        and(
          eq(subscriptionStatusView.stripe_subscription_id, stripeId),
          eq(subscriptionStatusView.is_archived, false)
        )
      )
      .limit(1);
    
    if (!record) return null;

    const featureOverrides = await this.loadFeatureOverrides(record.id);
    return SubscriptionMapper.toDomain(record, featureOverrides);
  }

  async findAll(filters?: SubscriptionFilterDto): Promise<Array<{ subscription: Subscription; customer: Customer | null }>> {
    // Build SQL query with proper WHERE clauses for IDs and join with customers
    let query = this.db
      .select({
        // Subscription fields from view
        id: subscriptionStatusView.id,
        key: subscriptionStatusView.key,
        customer_id: subscriptionStatusView.customer_id,
        plan_id: subscriptionStatusView.plan_id,
        billing_cycle_id: subscriptionStatusView.billing_cycle_id,
        activation_date: subscriptionStatusView.activation_date,
        expiration_date: subscriptionStatusView.expiration_date,
        cancellation_date: subscriptionStatusView.cancellation_date,
        trial_end_date: subscriptionStatusView.trial_end_date,
        current_period_start: subscriptionStatusView.current_period_start,
        current_period_end: subscriptionStatusView.current_period_end,
        stripe_subscription_id: subscriptionStatusView.stripe_subscription_id,
        metadata: subscriptionStatusView.metadata,
        created_at: subscriptionStatusView.created_at,
        updated_at: subscriptionStatusView.updated_at,
        is_archived: subscriptionStatusView.is_archived,
        transitioned_at: subscriptionStatusView.transitioned_at,
        computed_status: subscriptionStatusView.computed_status,
        // Customer fields
        customer_id_field: customers.id,
        customer_key: customers.key,
        customer_display_name: customers.display_name,
        customer_email: customers.email,
        customer_external_billing_id: customers.external_billing_id,
        customer_status: customers.status,
        customer_metadata: customers.metadata,
        customer_created_at: customers.created_at,
        customer_updated_at: customers.updated_at
      })
      .from(subscriptionStatusView)
      .innerJoin(customers, eq(subscriptionStatusView.customer_id, customers.id));

    if (filters) {
      const conditions = [];

      // Filter by customer ID (resolved from customerKey in service layer)
      if ((filters as any).customerId) {
        conditions.push(eq(subscriptionStatusView.customer_id, (filters as any).customerId));
      }

      // Filter by plan IDs (resolved from planKey or productKey in service layer)
      if ((filters as any).planIds && (filters as any).planIds.length > 0) {
        conditions.push(inArray(subscriptionStatusView.plan_id, (filters as any).planIds));
      } else if ((filters as any).planId) {
        conditions.push(eq(subscriptionStatusView.plan_id, (filters as any).planId));
      }

      // Filter by billing cycle ID (resolved from billingCycleKey in service layer)
      if ((filters as any).billingCycleId) {
        conditions.push(eq(subscriptionStatusView.billing_cycle_id, (filters as any).billingCycleId));
      }

      // Filter by is_archived
      if (filters.isArchived !== undefined) {
        conditions.push(eq(subscriptionStatusView.is_archived, filters.isArchived));
      }

      // Filter by date ranges (can be done in SQL)
      if ((filters as any).activationDateFrom) {
        conditions.push(gte(subscriptionStatusView.activation_date, (filters as any).activationDateFrom));
      }
      if ((filters as any).activationDateTo) {
        conditions.push(lte(subscriptionStatusView.activation_date, (filters as any).activationDateTo));
      }
      if ((filters as any).expirationDateFrom) {
        conditions.push(gte(subscriptionStatusView.expiration_date, (filters as any).expirationDateFrom));
      }
      if ((filters as any).expirationDateTo) {
        conditions.push(lte(subscriptionStatusView.expiration_date, (filters as any).expirationDateTo));
      }
      if ((filters as any).trialEndDateFrom) {
        conditions.push(gte(subscriptionStatusView.trial_end_date, (filters as any).trialEndDateFrom));
      }
      if ((filters as any).trialEndDateTo) {
        conditions.push(lte(subscriptionStatusView.trial_end_date, (filters as any).trialEndDateTo));
      }
      if ((filters as any).currentPeriodStartFrom) {
        conditions.push(gte(subscriptionStatusView.current_period_start, (filters as any).currentPeriodStartFrom));
      }
      if ((filters as any).currentPeriodStartTo) {
        conditions.push(lte(subscriptionStatusView.current_period_start, (filters as any).currentPeriodStartTo));
      }
      if ((filters as any).currentPeriodEndFrom) {
        conditions.push(gte(subscriptionStatusView.current_period_end, (filters as any).currentPeriodEndFrom));
      }
      if ((filters as any).currentPeriodEndTo) {
        conditions.push(lte(subscriptionStatusView.current_period_end, (filters as any).currentPeriodEndTo));
      }

      // Filter by hasStripeId
      if ((filters as any).hasStripeId !== undefined) {
        if ((filters as any).hasStripeId) {
          conditions.push(isNotNull(subscriptionStatusView.stripe_subscription_id));
        } else {
          conditions.push(isNull(subscriptionStatusView.stripe_subscription_id));
        }
      }

      // Filter by hasTrial
      if ((filters as any).hasTrial !== undefined) {
        if ((filters as any).hasTrial) {
          conditions.push(isNotNull(subscriptionStatusView.trial_end_date));
        } else {
          conditions.push(isNull(subscriptionStatusView.trial_end_date));
        }
      }

      if (filters.status) {
        conditions.push(eq(subscriptionStatusView.computed_status, filters.status));
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }

      // Apply sorting
      const sortBy = filters.sortBy || 'createdAt';
      const sortOrder = filters.sortOrder || 'desc';
      
      if (sortBy === 'activationDate') {
        query = query.orderBy(sortOrder === 'desc' ? desc(subscriptionStatusView.activation_date) : asc(subscriptionStatusView.activation_date)) as typeof query;
      } else if (sortBy === 'expirationDate') {
        query = query.orderBy(sortOrder === 'desc' ? desc(subscriptionStatusView.expiration_date) : asc(subscriptionStatusView.expiration_date)) as typeof query;
      } else if (sortBy === 'currentPeriodStart') {
        query = query.orderBy(sortOrder === 'desc' ? desc(subscriptionStatusView.current_period_start) : asc(subscriptionStatusView.current_period_start)) as typeof query;
      } else if (sortBy === 'currentPeriodEnd') {
        query = query.orderBy(sortOrder === 'desc' ? desc(subscriptionStatusView.current_period_end) : asc(subscriptionStatusView.current_period_end)) as typeof query;
      } else {
        query = query.orderBy(sortOrder === 'desc' ? desc(subscriptionStatusView.created_at) : asc(subscriptionStatusView.created_at)) as typeof query;
      }

      // Apply pagination
      if (filters.limit) {
        query = query.limit(filters.limit) as typeof query;
      }
      if (filters.offset) {
        query = query.offset(filters.offset) as typeof query;
      }
    } else {
      query = query.orderBy(desc(subscriptionStatusView.created_at)) as typeof query;
    }

    const records = await query;
    
    const results: Array<{ subscription: Subscription; customer: Customer | null }> = [];
    for (const record of records) {
      const featureOverrides = await this.loadFeatureOverrides(record.id);
      
      // Map subscription from the view record
      const subscriptionRecord = {
        id: record.id,
        key: record.key,
        customer_id: record.customer_id,
        plan_id: record.plan_id,
        billing_cycle_id: record.billing_cycle_id,
        activation_date: record.activation_date,
        expiration_date: record.expiration_date,
        cancellation_date: record.cancellation_date,
        trial_end_date: record.trial_end_date,
        current_period_start: record.current_period_start,
        current_period_end: record.current_period_end,
        stripe_subscription_id: record.stripe_subscription_id,
        metadata: record.metadata,
        created_at: record.created_at,
        updated_at: record.updated_at,
        is_archived: record.is_archived,
        transitioned_at: record.transitioned_at,
        computed_status: record.computed_status
      };
      const subscription = SubscriptionMapper.toDomain(subscriptionRecord, featureOverrides);
      
      // Map customer
      let customer: Customer | null = null;
      if (record.customer_id_field) {
        const customerRecord = {
          id: record.customer_id_field,
          key: record.customer_key,
          display_name: record.customer_display_name,
          email: record.customer_email,
          external_billing_id: record.customer_external_billing_id,
          status: record.customer_status,
          metadata: record.customer_metadata,
          created_at: record.customer_created_at,
          updated_at: record.customer_updated_at
        };
        customer = CustomerMapper.toDomain(customerRecord);
      }
      
      results.push({ subscription, customer });
    }
    return results;
  }

  async findByCustomerId(customerId: number, filters?: any): Promise<Subscription[]> {
    const conditions = [eq(subscriptionStatusView.customer_id, customerId)];

    if (filters?.status) {
      conditions.push(eq(subscriptionStatusView.computed_status, filters.status));
    }

    const records = await this.db
      .select()
      .from(subscriptionStatusView)
      .where(and(...conditions))
      .orderBy(desc(subscriptionStatusView.created_at));

    const subscriptionsWithOverrides = [];
    for (const record of records) {
      const featureOverrides = await this.loadFeatureOverrides(record.id);
      subscriptionsWithOverrides.push(SubscriptionMapper.toDomain(record, featureOverrides));
    }
    return subscriptionsWithOverrides;
  }

  async findByIds(ids: number[]): Promise<Subscription[]> {
    if (ids.length === 0) return [];

    const records = await this.db
      .select()
      .from(subscriptionStatusView)
      .where(inArray(subscriptionStatusView.id, ids));

    const subscriptionsWithOverrides = [];
    for (const record of records) {
      const featureOverrides = await this.loadFeatureOverrides(record.id);
      subscriptionsWithOverrides.push(SubscriptionMapper.toDomain(record, featureOverrides));
    }
    return subscriptionsWithOverrides;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(subscriptions).where(eq(subscriptions.id, id));
  }

  async findActiveByCustomerAndPlan(customerId: number, planId: number): Promise<Subscription | null> {
    // Don't filter by stored status - filter by computed status after loading
    const records = await this.db
      .select()
      .from(subscriptionStatusView)
      .where(and(
        eq(subscriptionStatusView.customer_id, customerId),
        eq(subscriptionStatusView.plan_id, planId),
        inArray(subscriptionStatusView.computed_status, ['active', 'trial'])
      ))
      .limit(100);

    for (const record of records) {
      const featureOverrides = await this.loadFeatureOverrides(record.id);
      return SubscriptionMapper.toDomain(record, featureOverrides);
    }
    return null;
  }

  async exists(id: number): Promise<boolean> {
    const [record] = await this.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .limit(1);
    
    return !!record;
  }

  async hasSubscriptionsForPlan(planId: number): Promise<boolean> {
    const [record] = await this.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.plan_id, planId))
      .limit(1);

    return !!record;
  }

  async hasSubscriptionsForBillingCycle(billingCycleId: number): Promise<boolean> {
    const [record] = await this.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.billing_cycle_id, billingCycleId))
      .limit(1);

    return !!record;
  }

  async findExpiredWithTransitionPlans(limit: number = 1000): Promise<Subscription[]> {
    // Query expired subscriptions (status='expired') that are not archived
    // and whose plan has a transition requirement (on_expire_transition_to_billing_cycle_id IS NOT NULL)
    const records = await this.db
      .select({
        id: subscriptionStatusView.id,
        key: subscriptionStatusView.key,
        customer_id: subscriptionStatusView.customer_id,
        plan_id: subscriptionStatusView.plan_id,
        billing_cycle_id: subscriptionStatusView.billing_cycle_id,
        activation_date: subscriptionStatusView.activation_date,
        expiration_date: subscriptionStatusView.expiration_date,
        cancellation_date: subscriptionStatusView.cancellation_date,
        trial_end_date: subscriptionStatusView.trial_end_date,
        current_period_start: subscriptionStatusView.current_period_start,
        current_period_end: subscriptionStatusView.current_period_end,
        stripe_subscription_id: subscriptionStatusView.stripe_subscription_id,
        metadata: subscriptionStatusView.metadata,
        created_at: subscriptionStatusView.created_at,
        updated_at: subscriptionStatusView.updated_at,
        is_archived: subscriptionStatusView.is_archived,
        computed_status: subscriptionStatusView.computed_status
      })
      .from(subscriptionStatusView)
      .innerJoin(plans, eq(subscriptionStatusView.plan_id, plans.id))
      .where(
        and(
          eq(subscriptionStatusView.computed_status, 'expired'),
          eq(subscriptionStatusView.is_archived, false),
          isNotNull(plans.on_expire_transition_to_billing_cycle_id)
        )
      )
      .limit(limit)
      .orderBy(desc(subscriptionStatusView.expiration_date));

    const subscriptionsWithOverrides = [];
    for (const record of records) {
      const featureOverrides = await this.loadFeatureOverrides(record.id);
      subscriptionsWithOverrides.push(SubscriptionMapper.toDomain(record, featureOverrides));
    }
    return subscriptionsWithOverrides;
  }
}

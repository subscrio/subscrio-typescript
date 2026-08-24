import { IPlanRepository } from '../../application/repositories/IPlanRepository.js';
import { Plan, PlanFeatureValue } from '../../domain/entities/Plan.js';
import { PlanMapper } from '../../application/mappers/PlanMapper.js';
import { DrizzleDb } from '../database/drizzle.js';
import { plans, plan_features, billing_cycles, products } from '../database/schema.js';
import { eq, and, like, or, desc, asc, inArray } from 'drizzle-orm';
import { PlanFilterDto } from '../../application/dtos/PlanDto.js';

export class DrizzlePlanRepository implements IPlanRepository {
  constructor(private readonly db: DrizzleDb) {}

  async save(plan: Plan): Promise<Plan> {
    // Resolve productKey to productId
    const [product] = await this.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.key, plan.productKey))
      .limit(1);
    
    if (!product) {
      throw new Error(`Product with key '${plan.productKey}' not found`);
    }

    // Resolve onExpireTransitionToBillingCycleKey to onExpireTransitionToBillingCycleId if provided
    let billingCycleId: number | undefined;
    if (plan.props.onExpireTransitionToBillingCycleKey) {
      const [billingCycle] = await this.db
        .select({ id: billing_cycles.id })
        .from(billing_cycles)
        .where(eq(billing_cycles.key, plan.props.onExpireTransitionToBillingCycleKey))
        .limit(1);
      
      if (!billingCycle) {
        throw new Error(`Billing cycle with key '${plan.props.onExpireTransitionToBillingCycleKey}' not found`);
      }
      
      billingCycleId = billingCycle.id as number;
    }

    if (product.id === undefined) {
      throw new Error('Product ID is undefined');
    }

    const record = PlanMapper.toPersistence(plan, product.id, billingCycleId);

    let savedPlanId: number;
    if (plan.id === undefined) {
      // Insert new entity
      const [inserted] = await this.db
        .insert(plans)
        .values(record)
        .returning({ id: plans.id });
      
      savedPlanId = inserted.id;
      
      // Insert feature values
      if (plan.props.featureValues.length > 0) {
        const featureValueRecords = plan.props.featureValues.map(fv => ({
          plan_id: savedPlanId,
          feature_id: fv.featureId,
          value: fv.value,
          created_at: fv.createdAt,
          updated_at: fv.updatedAt
        }));

        await this.db.insert(plan_features).values(featureValueRecords);
      }
      
      // Return entity with generated ID
      return new Plan(plan.props, savedPlanId);
    } else {
      // Update existing entity
      savedPlanId = plan.id;
      
      await this.db
        .update(plans)
        .set({
          product_id: record.product_id,
          key: record.key,
          display_name: record.display_name,
          description: record.description,
          status: record.status,
          on_expire_transition_to_billing_cycle_id: record.on_expire_transition_to_billing_cycle_id,
          metadata: record.metadata,
          updated_at: record.updated_at
        })
        .where(eq(plans.id, plan.id));

      // Delete existing feature values
      await this.db.delete(plan_features).where(eq(plan_features.plan_id, plan.id));

      // Insert new feature values
      if (plan.props.featureValues.length > 0) {
        if (savedPlanId === undefined) {
          throw new Error('Plan ID is undefined after insert');
        }

        const featureValueRecords = plan.props.featureValues.map(fv => ({
          plan_id: savedPlanId,
          feature_id: fv.featureId,
          value: fv.value,
          created_at: fv.createdAt,
          updated_at: fv.updatedAt
        }));

        await this.db.insert(plan_features).values(featureValueRecords);
      }
      
      return plan;
    }
  }

  async findById(id: number): Promise<Plan | null> {
    // Join with products to get product_key, and billing_cycles to get on_expire_transition_to_billing_cycle_key
    const [result] = await this.db
      .select({
        plans: plans,
        product_key: products.key,
        on_expire_transition_to_billing_cycle_key: billing_cycles.key
      })
      .from(plans)
      .innerJoin(products, eq(plans.product_id, products.id))
      .leftJoin(billing_cycles, eq(plans.on_expire_transition_to_billing_cycle_id, billing_cycles.id))
      .where(eq(plans.id, id))
      .limit(1);
    
    if (!result) return null;

    const featureValues = await this.loadFeatureValues(result.plans.id);
    // Combine plan record with joined keys
    const recordWithKeys = {
      ...result.plans,
      product_key: result.product_key,
      on_expire_transition_to_billing_cycle_key: result.on_expire_transition_to_billing_cycle_key ?? null
    };
    return PlanMapper.toDomain(recordWithKeys, featureValues);
  }

  async findByKey(key: string): Promise<Plan | null> {
    // Join with products to get product_key, and billing_cycles to get on_expire_transition_to_billing_cycle_key
    const [result] = await this.db
      .select({
        plans: plans,
        product_key: products.key,
        on_expire_transition_to_billing_cycle_key: billing_cycles.key
      })
      .from(plans)
      .innerJoin(products, eq(plans.product_id, products.id))
      .leftJoin(billing_cycles, eq(plans.on_expire_transition_to_billing_cycle_id, billing_cycles.id))
      .where(eq(plans.key, key))
      .limit(1);
    
    if (!result) return null;

    const featureValues = await this.loadFeatureValues(result.plans.id);
    // Combine plan record with joined keys
    const recordWithKeys = {
      ...result.plans,
      product_key: result.product_key,
      on_expire_transition_to_billing_cycle_key: result.on_expire_transition_to_billing_cycle_key ?? null
    };
    return PlanMapper.toDomain(recordWithKeys, featureValues);
  }

  private async loadFeatureValues(planId: number): Promise<PlanFeatureValue[]> {
    const records = await this.db
      .select()
      .from(plan_features)
      .where(eq(plan_features.plan_id, planId));

    return records.map(r => ({
      featureId: r.feature_id as number,
      value: r.value,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at)
    }));
  }

  async findByProduct(productKey: string): Promise<Plan[]> {
    // Join with products to resolve productKey and get product_key, and billing_cycles to get on_expire_transition_to_billing_cycle_key
    const results = await this.db
      .select({
        plans: plans,
        product_key: products.key,
        on_expire_transition_to_billing_cycle_key: billing_cycles.key
      })
      .from(plans)
      .innerJoin(products, eq(plans.product_id, products.id))
      .leftJoin(billing_cycles, eq(plans.on_expire_transition_to_billing_cycle_id, billing_cycles.id))
      .where(eq(products.key, productKey))
      .orderBy(asc(plans.created_at));

    const plansWithValues = [];
    for (const result of results) {
      const featureValues = await this.loadFeatureValues(result.plans.id);
      // Combine plan record with joined keys
      const recordWithKeys = {
        ...result.plans,
        product_key: result.product_key,
        on_expire_transition_to_billing_cycle_key: result.on_expire_transition_to_billing_cycle_key ?? null
      };
      plansWithValues.push(PlanMapper.toDomain(recordWithKeys, featureValues));
    }
    return plansWithValues;
  }

  async findAll(filters?: PlanFilterDto): Promise<Plan[]> {
    // Always join with products to get product_key, and billing_cycles to get on_expire_transition_to_billing_cycle_key
    let query = this.db
      .select({
        plans: plans,
        product_key: products.key,
        on_expire_transition_to_billing_cycle_key: billing_cycles.key
      })
      .from(plans)
      .innerJoin(products, eq(plans.product_id, products.id))
      .leftJoin(billing_cycles, eq(plans.on_expire_transition_to_billing_cycle_id, billing_cycles.id));

    if (filters) {
      const conditions = [];

      if (filters.productKey) {
        // Filter by product key via join
        conditions.push(eq(products.key, filters.productKey));
      }

      if (filters.status) {
        conditions.push(eq(plans.status, filters.status));
      }

      if (filters.search) {
        // Drizzle handles parameterized queries automatically - no manual sanitization needed
        conditions.push(
          or(
            like(plans.key, `%${filters.search}%`),
            like(plans.display_name, `%${filters.search}%`),
            like(plans.description, `%${filters.search}%`)
          )
        );
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }

      // Apply sorting
      const sortBy = filters.sortBy || 'createdAt';
      const sortOrder = filters.sortOrder || 'asc';
      
      if (sortBy === 'displayName') {
        query = query.orderBy(sortOrder === 'desc' ? desc(plans.display_name) : asc(plans.display_name)) as typeof query;
      } else {
        query = query.orderBy(sortOrder === 'desc' ? desc(plans.created_at) : asc(plans.created_at)) as typeof query;
      }

      // Apply pagination
      if (filters.limit) {
        query = query.limit(filters.limit) as typeof query;
      }
      if (filters.offset) {
        query = query.offset(filters.offset) as typeof query;
      }
    } else {
      query = query.orderBy(asc(plans.created_at)) as typeof query;
    }

    const results = await query;
    
    const plansWithValues = [];
    for (const result of results) {
      const featureValues = await this.loadFeatureValues(result.plans.id);
      // Combine plan record with joined keys
      const recordWithKeys = {
        ...result.plans,
        product_key: result.product_key,
        on_expire_transition_to_billing_cycle_key: result.on_expire_transition_to_billing_cycle_key ?? null
      };
      plansWithValues.push(PlanMapper.toDomain(recordWithKeys, featureValues));
    }
    return plansWithValues;
  }


  async findByIds(ids: number[]): Promise<Plan[]> {
    if (ids.length === 0) return [];

    // Join with products to get product_key, and billing_cycles to get on_expire_transition_to_billing_cycle_key
    const results = await this.db
      .select({
        plans: plans,
        product_key: products.key,
        on_expire_transition_to_billing_cycle_key: billing_cycles.key
      })
      .from(plans)
      .innerJoin(products, eq(plans.product_id, products.id))
      .leftJoin(billing_cycles, eq(plans.on_expire_transition_to_billing_cycle_id, billing_cycles.id))
      .where(inArray(plans.id, ids));

    const plansWithValues = [];
    for (const result of results) {
      const featureValues = await this.loadFeatureValues(result.plans.id);
      // Combine plan record with joined keys
      const recordWithKeys = {
        ...result.plans,
        product_key: result.product_key,
        on_expire_transition_to_billing_cycle_key: result.on_expire_transition_to_billing_cycle_key ?? null
      };
      plansWithValues.push(PlanMapper.toDomain(recordWithKeys, featureValues));
    }
    return plansWithValues;
  }

  async findByBillingCycleId(billingCycleId: number): Promise<Plan | null> {
    // Find plan_id from billing_cycle, then load the plan normally (which includes all joins)
    const [billingCycle] = await this.db
      .select({ plan_id: billing_cycles.plan_id })
      .from(billing_cycles)
      .where(eq(billing_cycles.id, billingCycleId))
      .limit(1);
    
    if (!billingCycle) return null;
    
    // Use findById which already has all the necessary joins
    return this.findById(billingCycle.plan_id as number);
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(plans).where(eq(plans.id, id));
  }

  async exists(id: number): Promise<boolean> {
    const [record] = await this.db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.id, id))
      .limit(1);
    
    return !!record;
  }

  async hasBillingCycles(planId: number): Promise<boolean> {
    const [record] = await this.db
      .select({ id: billing_cycles.id })
      .from(billing_cycles)
      .where(eq(billing_cycles.plan_id, planId))
      .limit(1);

    return !!record;
  }

  async hasPlanTransitionReferences(billingCycleKey: string): Promise<boolean> {
    // Join with billing_cycles to resolve key to ID, then check plans
    const [billingCycle] = await this.db
      .select({ id: billing_cycles.id })
      .from(billing_cycles)
      .where(eq(billing_cycles.key, billingCycleKey))
      .limit(1);
    
    if (!billingCycle) return false;

    const [record] = await this.db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.on_expire_transition_to_billing_cycle_id, billingCycle.id as number))
      .limit(1);

    return !!record;
  }

}

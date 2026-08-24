import { Subscription } from '../../domain/entities/Subscription.js';
import { Customer } from '../../domain/entities/Customer.js';
import { SubscriptionFilterDto } from '../dtos/SubscriptionDto.js';

export interface ISubscriptionRepository {
  save(subscription: Subscription): Promise<Subscription>;
  findById(id: number): Promise<Subscription | null>;
  findByKey(key: string): Promise<Subscription | null>;
  findByCustomerId(customerId: number, filters?: SubscriptionFilterDto): Promise<Subscription[]>;
  findByStripeId(stripeSubscriptionId: string): Promise<Subscription | null>;
  findAll(filters?: SubscriptionFilterDto): Promise<Array<{ subscription: Subscription; customer: Customer | null }>>;
  findByIds(ids: number[]): Promise<Subscription[]>;
  delete(id: number): Promise<void>;
  exists(id: number): Promise<boolean>;
  
  // Find active subscription for customer and plan combination
  findActiveByCustomerAndPlan(customerId: number, planId: number): Promise<Subscription | null>;
  
  // Foreign key checks
  hasSubscriptionsForPlan(planId: number): Promise<boolean>;
  hasSubscriptionsForBillingCycle(billingCycleId: number): Promise<boolean>;
  
  // Find expired subscriptions with transition plans (for transition processing)
  findExpiredWithTransitionPlans(limit?: number): Promise<Subscription[]>;
}


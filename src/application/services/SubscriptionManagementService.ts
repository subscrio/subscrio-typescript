import { ISubscriptionRepository } from '../repositories/ISubscriptionRepository.js';
import { ICustomerRepository } from '../repositories/ICustomerRepository.js';
import { IPlanRepository } from '../repositories/IPlanRepository.js';
import { IBillingCycleRepository } from '../repositories/IBillingCycleRepository.js';
import { IFeatureRepository } from '../repositories/IFeatureRepository.js';
import { IProductRepository } from '../repositories/IProductRepository.js';
import { 
  CreateSubscriptionDto, 
  CreateSubscriptionDtoSchema, 
  UpdateSubscriptionDto, 
  UpdateSubscriptionDtoSchema,
  SubscriptionFilterDto,
  SubscriptionFilterDtoSchema,
  DetailedSubscriptionFilterDto,
  DetailedSubscriptionFilterDtoSchema,
  SubscriptionDto 
} from '../dtos/SubscriptionDto.js';
import { SubscriptionMapper } from '../mappers/SubscriptionMapper.js';
import { Subscription } from '../../domain/entities/Subscription.js';
import { SubscriptionStatus } from '../../domain/value-objects/SubscriptionStatus.js';
import { OverrideType } from '../../domain/value-objects/OverrideType.js';
import { now } from '../../infrastructure/utils/date.js';
import { 
  ValidationError, 
  NotFoundError, 
  ConflictError, 
  DomainError 
} from '../errors/index.js';
import { FeatureValueValidator } from '../utils/FeatureValueValidator.js';
import { HookDispatcher } from '../hooks/HookDispatcher.js';
import { HookEvents, type HookSource, type SubscriptionMutationHookEvent } from '../hooks/types.js';
import { cloneJson } from '../hooks/cloneJson.js';
import { applySubscriptionDtoMutation } from '../hooks/applySubscriptionDtoMutation.js';
import { compactDefined, revalidateAfterHook } from '../utils/ValidationGuard.js';

/**
 * Transition report for expired subscription processing
 */
export interface TransitionExpiredSubscriptionsReport {
  processed: number;
  transitioned: number;
  archived: number;
  errors: Array<{
    subscriptionKey: string;
    error: string;
  }>;
}

export class SubscriptionManagementService {
  constructor(
    private readonly subscriptionRepository: ISubscriptionRepository,
    private readonly customerRepository: ICustomerRepository,
    private readonly planRepository: IPlanRepository,
    private readonly billingCycleRepository: IBillingCycleRepository,
    private readonly featureRepository: IFeatureRepository,
    private readonly productRepository: IProductRepository,
    private readonly hooks: HookDispatcher = new HookDispatcher()
  ) {}

  private async emitSubscriptionBefore(
    type: SubscriptionMutationHookEvent['type'],
    source: HookSource,
    subscription: Subscription,
    oldDto: SubscriptionDto | null,
    newDto: SubscriptionDto | null,
    extras?: { featureKey?: string; value?: string; overrideType?: string }
  ): Promise<{ newDto: SubscriptionDto | null; extras: { featureKey?: string; value?: string; overrideType?: string } }> {
    const baseExtras = { ...extras };
    if (!this.hooks.hasListeners(type)) {
      return { newDto, extras: baseExtras };
    }
    const payload: SubscriptionMutationHookEvent = {
      type,
      phase: 'before',
      source,
      occurredAt: new Date().toISOString(),
      entityId: subscription.id ?? null,
      customerId: subscription.customerId,
      old: oldDto ? cloneJson(oldDto) : null,
      new: newDto ? cloneJson(newDto) : null,
      ...baseExtras,
    };
    await this.hooks.emit(type, payload);
    return {
      newDto: payload.new,
      extras: {
        featureKey: payload.featureKey ?? baseExtras.featureKey,
        value: payload.value ?? baseExtras.value,
        overrideType: payload.overrideType ?? baseExtras.overrideType,
      },
    };
  }

  private async emitSubscriptionAfter(
    type: SubscriptionMutationHookEvent['type'],
    source: HookSource,
    subscription: Subscription,
    oldDto: SubscriptionDto | null,
    newDto: SubscriptionDto | null,
    extras?: { featureKey?: string; value?: string; overrideType?: string }
  ): Promise<void> {
    if (!this.hooks.hasListeners(type)) return;
    await this.hooks.emit(type, {
      type,
      phase: 'after',
      source,
      occurredAt: new Date().toISOString(),
      entityId: subscription.id ?? null,
      customerId: subscription.customerId,
      old: oldDto ? cloneJson(oldDto) : null,
      new: newDto ? cloneJson(newDto) : null,
      ...extras,
    });
  }

  private async toSubscriptionDto(subscription: Subscription): Promise<SubscriptionDto> {
    const keys = await this.resolveSubscriptionKeys(subscription);
    const featureOverrides = await this.toFeatureOverrideDtos(subscription);
    return SubscriptionMapper.toDto(
      subscription,
      keys.customerKey,
      keys.productKey,
      keys.planKey,
      keys.billingCycleKey,
      undefined,
      featureOverrides
    );
  }

  private async toFeatureOverrideDtos(subscription: Subscription): Promise<import('../dtos/SubscriptionDto.js').FeatureOverrideDto[]> {
    const overrides = [];
    for (const override of subscription.props.featureOverrides) {
      const feature = await this.featureRepository.findById(override.featureId);
      if (!feature) continue;
      overrides.push({
        featureKey: feature.key,
        value: override.value,
        type: override.type,
        createdAt: override.createdAt.toISOString(),
      });
    }
    return overrides;
  }

  private async resolveSubscriptionKeys(subscription: Subscription): Promise<{
    customerKey: string;
    productKey: string;
    planKey: string;
    billingCycleKey: string;
  }> {
    // Get customer
    const customer = await this.customerRepository.findById(subscription.customerId);
    if (!customer) {
      // This should never happen in normal operation, but log error with subscription key
      throw new NotFoundError(
        `Customer not found for subscription '${subscription.key}'. ` +
        'This indicates data integrity issue - subscription references invalid customer.'
      );
    }

    // Get plan
    const plan = await this.planRepository.findById(subscription.planId);
    if (!plan) {
      // This should never happen in normal operation, but log error with subscription key
      throw new NotFoundError(
        `Plan not found for subscription '${subscription.key}'. ` +
        'This indicates data integrity issue - subscription references invalid plan.'
      );
    }

    // Get billing cycle (required)
    const cycle = await this.billingCycleRepository.findById(subscription.props.billingCycleId);
    if (!cycle) {
      // This should never happen in normal operation, but log error with subscription key
      throw new NotFoundError(
        `Billing cycle not found for subscription '${subscription.key}'. ` +
        'This indicates data integrity issue - subscription references invalid billing cycle.'
      );
    }

    return {
      customerKey: customer.key,
      productKey: plan.productKey,
      planKey: plan.key,
      billingCycleKey: cycle.key
    };
  }

  async createSubscription(dto: CreateSubscriptionDto): Promise<SubscriptionDto> {
    const validationResult = CreateSubscriptionDtoSchema.safeParse(dto);
    if (!validationResult.success) {
      throw new ValidationError(
        'Invalid subscription data',
        validationResult.error.issues
      );
    }
    const validatedDto = validationResult.data;

    // Verify customer exists
    const customer = await this.customerRepository.findByKey(validatedDto.customerKey);
    if (!customer) {
      throw new NotFoundError(`Customer with key '${validatedDto.customerKey}' not found`);
    }

    // Get billing cycle and derive plan/product from it
    const billingCycle = await this.billingCycleRepository.findByKey(validatedDto.billingCycleKey);
    if (!billingCycle) {
      throw new NotFoundError(`Billing cycle with key '${validatedDto.billingCycleKey}' not found`);
    }

    // Get plan from billing cycle
    const plan = await this.planRepository.findById(billingCycle.props.planId);
    if (!plan) {
      throw new NotFoundError(`Plan not found for billing cycle '${validatedDto.billingCycleKey}'`);
    }

    // Get product from plan
    const product = await this.productRepository.findByKey(plan.productKey);
    if (!product) {
      throw new NotFoundError(`Product not found for plan '${plan.key}'`);
    }

    // Billing cycle from repository always has ID (BIGSERIAL PRIMARY KEY)
    const billingCycleId = billingCycle.id!;

    // Check for duplicate subscription key
    const existingKey = await this.subscriptionRepository.findByKey(validatedDto.key);
    if (existingKey) {
      throw new ConflictError(`Subscription with key '${validatedDto.key}' already exists`);
    }

    // Check for duplicate Stripe subscription ID if provided
    if (validatedDto.stripeSubscriptionId) {
      const existing = await this.subscriptionRepository.findByStripeId(validatedDto.stripeSubscriptionId);
      if (existing) {
        throw new ConflictError(`Subscription with Stripe ID '${validatedDto.stripeSubscriptionId}' already exists`);
      }
    }

    // Entities from repository always have IDs (BIGSERIAL PRIMARY KEY)
    // billingCycleId comes from findByKey lookup, so it's guaranteed to have an ID if billingCycle exists
    const trialEndDate = validatedDto.trialEndDate ? new Date(validatedDto.trialEndDate) : undefined;
    
    // Calculate currentPeriodEnd based on billing cycle duration
    const currentPeriodStart = validatedDto.currentPeriodStart ? new Date(validatedDto.currentPeriodStart) : now();
    const currentPeriodEnd = validatedDto.currentPeriodEnd 
      ? new Date(validatedDto.currentPeriodEnd) 
      : this.calculatePeriodEnd(currentPeriodStart, billingCycle);
    
    
    // Create domain entity (no ID - database will generate)
    const subscription = new Subscription({
      key: validatedDto.key,  // User-supplied key
      customerId: customer.id!,
      planId: plan.id!,
      billingCycleId: billingCycleId!,
      status: SubscriptionStatus.Active,  // Default status, will be calculated dynamically
      isArchived: false,
      activationDate: validatedDto.activationDate ? new Date(validatedDto.activationDate) : now(),
      expirationDate: validatedDto.expirationDate ? new Date(validatedDto.expirationDate) : undefined,
      cancellationDate: validatedDto.cancellationDate ? new Date(validatedDto.cancellationDate) : undefined,
      trialEndDate,
      currentPeriodStart,
      currentPeriodEnd,
      stripeSubscriptionId: validatedDto.stripeSubscriptionId,
      featureOverrides: [],
      metadata: validatedDto.metadata,
      createdAt: now(),
      updatedAt: now()
    });

    if (this.hooks.hasListeners(HookEvents.SubscriptionCreatedBefore) ||
        this.hooks.hasListeners(HookEvents.SubscriptionCreatedAfter)) {
      let proposed = SubscriptionMapper.toDto(
        subscription,
        customer.key,
        product.key,
        plan.key,
        billingCycle.key
      );
      const before = await this.emitSubscriptionBefore(
        HookEvents.SubscriptionCreatedBefore,
        'api',
        subscription,
        null,
        proposed
      );
      proposed = before.newDto ?? proposed;
      revalidateAfterHook(
        CreateSubscriptionDtoSchema,
        compactDefined({
          key: proposed.key,
          customerKey: proposed.customerKey,
          billingCycleKey: proposed.billingCycleKey,
          activationDate: proposed.activationDate,
          expirationDate: proposed.expirationDate,
          cancellationDate: proposed.cancellationDate,
          trialEndDate: proposed.trialEndDate,
          currentPeriodStart: proposed.currentPeriodStart,
          currentPeriodEnd: proposed.currentPeriodEnd,
          stripeSubscriptionId: proposed.stripeSubscriptionId,
          metadata: proposed.metadata,
        }),
        'subscription data'
      );
      applySubscriptionDtoMutation(subscription, proposed, { allowKeyChange: true });

      if (subscription.key !== validatedDto.key) {
        const keyTaken = await this.subscriptionRepository.findByKey(subscription.key);
        if (keyTaken) {
          throw new ConflictError(`Subscription with key '${subscription.key}' already exists`);
        }
      }
    }
    
    // Save and get entity with generated ID
    const savedSubscription = await this.subscriptionRepository.save(subscription);

    const keys = await this.resolveSubscriptionKeys(savedSubscription);
    const savedDto = SubscriptionMapper.toDto(
      savedSubscription,
      keys.customerKey,
      keys.productKey,
      keys.planKey,
      keys.billingCycleKey,
      undefined,
      await this.toFeatureOverrideDtos(savedSubscription)
    );
    await this.emitSubscriptionAfter(
      HookEvents.SubscriptionCreatedAfter,
      'api',
      savedSubscription,
      null,
      savedDto
    );
    return savedDto;
  }

  async updateSubscription(subscriptionKey: string, dto: UpdateSubscriptionDto): Promise<SubscriptionDto> {
    const validationResult = UpdateSubscriptionDtoSchema.safeParse(dto);
    if (!validationResult.success) {
      throw new ValidationError(
        'Invalid update data',
        validationResult.error.issues
      );
    }
    const validatedDto = validationResult.data;
    
    const subscription = await this.subscriptionRepository.findByKey(subscriptionKey);
    if (!subscription) {
      throw new NotFoundError(`Subscription with key '${subscriptionKey}' not found`);
    }

    // Block updates if subscription is archived
    if (subscription.isArchived) {
      throw new DomainError(
        `Cannot update archived subscription with key '${subscriptionKey}'. ` +
        'Please unarchive the subscription first.'
      );
    }

    const oldDto = await this.toSubscriptionDto(subscription);

    // Update properties (activationDate is immutable)
    if (validatedDto.expirationDate !== undefined) {
      subscription.props.expirationDate = validatedDto.expirationDate ? new Date(validatedDto.expirationDate) : undefined;
    }
    if (validatedDto.cancellationDate !== undefined) {
      subscription.props.cancellationDate = validatedDto.cancellationDate ? new Date(validatedDto.cancellationDate) : undefined;
    }
    if (validatedDto.clearTrialEndDate) {
      subscription.props.trialEndDate = undefined;
    } else if (validatedDto.trialEndDate !== undefined) {
      subscription.props.trialEndDate = validatedDto.trialEndDate
        ? new Date(validatedDto.trialEndDate)
        : undefined;
    }
    if (validatedDto.currentPeriodStart !== undefined) {
      subscription.props.currentPeriodStart = validatedDto.currentPeriodStart ? new Date(validatedDto.currentPeriodStart) : undefined;
    }
    if (validatedDto.currentPeriodEnd !== undefined) {
      subscription.props.currentPeriodEnd = validatedDto.currentPeriodEnd ? new Date(validatedDto.currentPeriodEnd) : undefined;
    }
    if (validatedDto.metadata !== undefined) {
      subscription.props.metadata = validatedDto.metadata;
    }
    if (validatedDto.billingCycleKey !== undefined) {
      // Find the new billing cycle
      const billingCycle = await this.billingCycleRepository.findByKey(validatedDto.billingCycleKey);
      if (!billingCycle) {
        throw new NotFoundError(`Billing cycle with key '${validatedDto.billingCycleKey}' not found`);
      }

      // Billing cycle from repository always has ID (BIGSERIAL PRIMARY KEY)
      subscription.props.billingCycleId = billingCycle.id!;
      subscription.props.planId = billingCycle.props.planId; // Update plan ID to match new billing cycle
    }
    if (validatedDto.stripeSubscriptionId !== undefined) {
      subscription.props.stripeSubscriptionId = validatedDto.stripeSubscriptionId;
    }

    subscription.props.updatedAt = now();

    let proposed = await this.toSubscriptionDto(subscription);
    const before = await this.emitSubscriptionBefore(
      HookEvents.SubscriptionUpdatedBefore,
      'api',
      subscription,
      oldDto,
      proposed
    );
    proposed = before.newDto ?? proposed;
    revalidateAfterHook(
      UpdateSubscriptionDtoSchema,
      compactDefined({
        billingCycleKey: proposed.billingCycleKey,
        expirationDate: proposed.expirationDate,
        cancellationDate: proposed.cancellationDate,
        trialEndDate: proposed.trialEndDate,
        currentPeriodStart: proposed.currentPeriodStart,
        currentPeriodEnd: proposed.currentPeriodEnd,
        stripeSubscriptionId: proposed.stripeSubscriptionId,
        metadata: proposed.metadata,
      }),
      'subscription update'
    );
    applySubscriptionDtoMutation(subscription, proposed, { allowKeyChange: false });

    const updatedSubscription = await this.subscriptionRepository.save(subscription);
    
    const keys = await this.resolveSubscriptionKeys(updatedSubscription);
    const savedDto = SubscriptionMapper.toDto(
      updatedSubscription,
      keys.customerKey,
      keys.productKey,
      keys.planKey,
      keys.billingCycleKey,
      undefined,
      await this.toFeatureOverrideDtos(updatedSubscription)
    );
    await this.emitSubscriptionAfter(
      HookEvents.SubscriptionUpdatedAfter,
      'api',
      updatedSubscription,
      oldDto,
      savedDto
    );
    return savedDto;
  }

  async getSubscription(subscriptionKey: string): Promise<SubscriptionDto | null> {
    const subscription = await this.subscriptionRepository.findByKey(subscriptionKey);
    if (!subscription) return null;
    
    const keys = await this.resolveSubscriptionKeys(subscription);
    return SubscriptionMapper.toDto(
      subscription,
      keys.customerKey,
      keys.productKey,
      keys.planKey,
      keys.billingCycleKey,
      undefined,
      await this.toFeatureOverrideDtos(subscription)
    );
  }


  /**
   * Resolve filter keys to IDs for database querying
   * Returns null if any required entity is not found (to indicate empty result)
   */
  private async resolveFilterKeys(filters: SubscriptionFilterDto | DetailedSubscriptionFilterDto): Promise<{
    customerId?: string;
    planIds?: string[];
    planId?: string;
    billingCycleId?: string;
    _emptyResult?: boolean; // Marker to indicate empty result
    [key: string]: any;
  } | null> {
    const resolved: any = {};

    // Resolve customerKey to customerId
    if (filters.customerKey) {
      const customer = await this.customerRepository.findByKey(filters.customerKey);
      if (!customer) {
        // Customer not found - return null to indicate empty result
        return null;
      }
      // Customer from repository always has ID (BIGSERIAL PRIMARY KEY)
      resolved.customerId = customer.id!;
    }

    // Resolve planKey and/or productKey to planIds
    if (filters.planKey) {
      if (filters.productKey) {
        // Both planKey and productKey - find specific plan
        const plan = await this.planRepository.findByKey(filters.planKey);
        if (!plan || plan.productKey !== filters.productKey) {
          // Plan not found or doesn't belong to product - return null to indicate empty result
          return null;
        }
        // Plan from repository always has ID (BIGSERIAL PRIMARY KEY)
        resolved.planId = plan.id!;
      } else {
        // Only planKey - plan keys are globally unique, so findByKey is sufficient
        const plan = await this.planRepository.findByKey(filters.planKey);
        if (!plan) {
          return null;
        }
        // Plan from repository always has ID (BIGSERIAL PRIMARY KEY)
        resolved.planId = plan.id!;
      }
    } else if (filters.productKey) {
      // Only productKey - find all plans for this product
      const product = await this.productRepository.findByKey(filters.productKey);
      if (!product) {
        return { planIds: [] };
      }
      const plans = await this.planRepository.findByProduct(product.key);
      if (plans.length === 0) {
        return { planIds: [] };
      }
      // Plans from repository always have IDs (BIGSERIAL PRIMARY KEY)
      resolved.planIds = plans.map(p => p.id!);
    }

    // Resolve billingCycleKey to billingCycleId (only for DetailedSubscriptionFilterDto)
    if ('billingCycleKey' in filters && filters.billingCycleKey) {
      const billingCycle = await this.billingCycleRepository.findByKey(filters.billingCycleKey);
      if (!billingCycle) {
        return null;
      }
      // Billing cycle from repository always has ID (BIGSERIAL PRIMARY KEY)
      resolved.billingCycleId = billingCycle.id!;
    }

    // Copy other filter properties (date ranges, etc.)
    if ('activationDateFrom' in filters && filters.activationDateFrom) {
      resolved.activationDateFrom = filters.activationDateFrom;
    }
    if ('activationDateTo' in filters && filters.activationDateTo) {
      resolved.activationDateTo = filters.activationDateTo;
    }
    if ('expirationDateFrom' in filters && filters.expirationDateFrom) {
      resolved.expirationDateFrom = filters.expirationDateFrom;
    }
    if ('expirationDateTo' in filters && filters.expirationDateTo) {
      resolved.expirationDateTo = filters.expirationDateTo;
    }
    if ('trialEndDateFrom' in filters && filters.trialEndDateFrom) {
      resolved.trialEndDateFrom = filters.trialEndDateFrom;
    }
    if ('trialEndDateTo' in filters && filters.trialEndDateTo) {
      resolved.trialEndDateTo = filters.trialEndDateTo;
    }
    if ('currentPeriodStartFrom' in filters && filters.currentPeriodStartFrom) {
      resolved.currentPeriodStartFrom = filters.currentPeriodStartFrom;
    }
    if ('currentPeriodStartTo' in filters && filters.currentPeriodStartTo) {
      resolved.currentPeriodStartTo = filters.currentPeriodStartTo;
    }
    if ('currentPeriodEndFrom' in filters && filters.currentPeriodEndFrom) {
      resolved.currentPeriodEndFrom = filters.currentPeriodEndFrom;
    }
    if ('currentPeriodEndTo' in filters && filters.currentPeriodEndTo) {
      resolved.currentPeriodEndTo = filters.currentPeriodEndTo;
    }
    if ('hasStripeId' in filters && filters.hasStripeId !== undefined) {
      resolved.hasStripeId = filters.hasStripeId;
    }
    if ('hasTrial' in filters && filters.hasTrial !== undefined) {
      resolved.hasTrial = filters.hasTrial;
    }
    
    // Pass through isArchived filter
    if ('isArchived' in filters && filters.isArchived !== undefined) {
      resolved.isArchived = filters.isArchived;
    }

    return resolved;
  }

  async listSubscriptions(filters?: SubscriptionFilterDto): Promise<SubscriptionDto[]> {
    const validationResult = SubscriptionFilterDtoSchema.safeParse(filters || {});
    if (!validationResult.success) {
      throw new ValidationError(
        'Invalid filter parameters',
        validationResult.error.issues
      );
    }

    // Resolve keys to IDs first
    const resolvedFilters = await this.resolveFilterKeys(validationResult.data);

    // If any key resolution returned null/empty, return empty array
    if (!resolvedFilters || 
        (resolvedFilters.planIds && resolvedFilters.planIds.length === 0)) {
      return [];
    }

    const validated = validationResult.data;
    const dbFilters: any = {
      ...resolvedFilters,
      sortBy: validated.sortBy,
      sortOrder: validated.sortOrder,
      limit: validated.limit,
      offset: validated.offset,
      status: validated.status,
      isArchived: validated.isArchived
    };

    const results = await this.subscriptionRepository.findAll(dbFilters);

    // Map to DTOs
    const dtos: SubscriptionDto[] = [];
    for (const { subscription, customer } of results) {
      const keys = await this.resolveSubscriptionKeys(subscription);
      dtos.push(SubscriptionMapper.toDto(
        subscription,
        keys.customerKey,
        keys.productKey,
        keys.planKey,
        keys.billingCycleKey,
        customer,
        await this.toFeatureOverrideDtos(subscription)
      ));
    }
    return dtos;
  }

  async findSubscriptions(filters: DetailedSubscriptionFilterDto): Promise<SubscriptionDto[]> {
    const validationResult = DetailedSubscriptionFilterDtoSchema.safeParse(filters);
    if (!validationResult.success) {
      throw new ValidationError(
        'Invalid filter parameters',
        validationResult.error.issues
      );
    }

    // Resolve keys to IDs first
    const resolvedFilters = await this.resolveFilterKeys(validationResult.data);

    // If any key resolution returned null/empty, return empty array
    if (!resolvedFilters || 
        (resolvedFilters.planIds && resolvedFilters.planIds.length === 0)) {
      return [];
    }

    const validated = validationResult.data;
    const dbFilters: any = {
      ...resolvedFilters,
      sortBy: validated.sortBy,
      sortOrder: validated.sortOrder,
      limit: validated.limit,
      offset: validated.offset,
      status: validated.status,
      isArchived: validated.isArchived
    };

    const results = await this.subscriptionRepository.findAll(dbFilters);

    let filteredResults = results;
    if (filters.hasFeatureOverrides !== undefined) {
      const hasOverrides = filters.hasFeatureOverrides;
      filteredResults = filteredResults.filter(({ subscription }) => 
        hasOverrides ? subscription.props.featureOverrides.length > 0 : subscription.props.featureOverrides.length === 0
      );
    }

    // Map to DTOs
    const dtos: SubscriptionDto[] = [];
    for (const { subscription, customer } of filteredResults) {
      const keys = await this.resolveSubscriptionKeys(subscription);
      dtos.push(SubscriptionMapper.toDto(
        subscription,
        keys.customerKey,
        keys.productKey,
        keys.planKey,
        keys.billingCycleKey,
        customer,
        await this.toFeatureOverrideDtos(subscription)
      ));
    }
    return dtos;
  }

  async getSubscriptionsByCustomer(customerKey: string): Promise<SubscriptionDto[]> {
    const customer = await this.customerRepository.findByKey(customerKey);
    if (!customer) {
      throw new NotFoundError(`Customer with key '${customerKey}' not found`);
    }

    // Customer from repository always has ID (BIGSERIAL PRIMARY KEY)
    const subscriptions = await this.subscriptionRepository.findByCustomerId(customer.id!);
    
    const dtos: SubscriptionDto[] = [];
    for (const subscription of subscriptions) {
      const keys = await this.resolveSubscriptionKeys(subscription);
      dtos.push(SubscriptionMapper.toDto(
        subscription,
        keys.customerKey,
        keys.productKey,
        keys.planKey,
        keys.billingCycleKey,
        undefined,
        await this.toFeatureOverrideDtos(subscription)
      ));
    }
    return dtos;
  }

  async archiveSubscription(subscriptionKey: string): Promise<void> {
    const subscription = await this.subscriptionRepository.findByKey(subscriptionKey);
    if (!subscription) {
      throw new NotFoundError(`Subscription with key '${subscriptionKey}' not found`);
    }

    const oldDto = await this.toSubscriptionDto(subscription);
    let proposed: SubscriptionDto = {
      ...oldDto,
      isArchived: true,
      updatedAt: now().toISOString(),
    };
    const before = await this.emitSubscriptionBefore(
      HookEvents.SubscriptionArchivedBefore,
      'api',
      subscription,
      oldDto,
      proposed
    );
    proposed = before.newDto ?? proposed;
    applySubscriptionDtoMutation(subscription, proposed, { allowKeyChange: false });

    // Archive does not change any properties - just sets the archive flag
    subscription.archive();
    const saved = await this.subscriptionRepository.save(subscription);
    await this.emitSubscriptionAfter(
      HookEvents.SubscriptionArchivedAfter,
      'api',
      saved,
      oldDto,
      await this.toSubscriptionDto(saved)
    );
  }

  async unarchiveSubscription(subscriptionKey: string): Promise<void> {
    const subscription = await this.subscriptionRepository.findByKey(subscriptionKey);
    if (!subscription) {
      throw new NotFoundError(`Subscription with key '${subscriptionKey}' not found`);
    }

    const oldDto = await this.toSubscriptionDto(subscription);
    let proposed: SubscriptionDto = {
      ...oldDto,
      isArchived: false,
      updatedAt: now().toISOString(),
    };
    const before = await this.emitSubscriptionBefore(
      HookEvents.SubscriptionUnarchivedBefore,
      'api',
      subscription,
      oldDto,
      proposed
    );
    proposed = before.newDto ?? proposed;
    applySubscriptionDtoMutation(subscription, proposed, { allowKeyChange: false });

    // Unarchive just clears the archive flag
    subscription.unarchive();
    const saved = await this.subscriptionRepository.save(subscription);
    await this.emitSubscriptionAfter(
      HookEvents.SubscriptionUnarchivedAfter,
      'api',
      saved,
      oldDto,
      await this.toSubscriptionDto(saved)
    );
  }

  async deleteSubscription(subscriptionKey: string): Promise<void> {
    const subscription = await this.subscriptionRepository.findByKey(subscriptionKey);
    if (!subscription) {
      throw new NotFoundError(`Subscription with key '${subscriptionKey}' not found`);
    }

    const oldDto = await this.toSubscriptionDto(subscription);
    await this.emitSubscriptionBefore(
      HookEvents.SubscriptionDeletedBefore,
      'api',
      subscription,
      oldDto,
      null
    );

    // Subscription from repository always has ID (BIGSERIAL PRIMARY KEY)
    // No deletion constraint - subscriptions can be deleted regardless of status
    await this.subscriptionRepository.delete(subscription.id!);

    await this.emitSubscriptionAfter(
      HookEvents.SubscriptionDeletedAfter,
      'api',
      subscription,
      oldDto,
      null
    );
  }

  async addFeatureOverride(
    subscriptionKey: string, 
    featureKey: string, 
    value: string, 
    overrideType: OverrideType = OverrideType.Permanent
  ): Promise<void> {
    const subscription = await this.subscriptionRepository.findByKey(subscriptionKey);
    if (!subscription) {
      throw new NotFoundError(`Subscription with key '${subscriptionKey}' not found`);
    }

    // Block updates if subscription is archived
    if (subscription.isArchived) {
      throw new DomainError(
        `Cannot add feature override to archived subscription with key '${subscriptionKey}'. ` +
        'Please unarchive the subscription first.'
      );
    }

    const feature = await this.featureRepository.findByKey(featureKey);
    if (!feature) {
      throw new NotFoundError(`Feature with key '${featureKey}' not found`);
    }

    // Validate value against feature type
    FeatureValueValidator.validate(value, feature.props.valueType);

    const oldDto = await this.toSubscriptionDto(subscription);
    let valueToApply = value;
    let typeToApply = overrideType;
    const before = await this.emitSubscriptionBefore(
      HookEvents.SubscriptionFeatureOverrideAddedBefore,
      'api',
      subscription,
      oldDto,
      { ...oldDto, updatedAt: now().toISOString() },
      { featureKey, value, overrideType }
    );
    valueToApply = before.extras.value ?? value;
    typeToApply = (before.extras.overrideType as OverrideType) ?? overrideType;
    if (before.newDto) {
      applySubscriptionDtoMutation(subscription, before.newDto, { allowKeyChange: false });
    }

    // Feature from repository always has ID (BIGSERIAL PRIMARY KEY)
    FeatureValueValidator.validate(valueToApply, feature.props.valueType);
    subscription.addFeatureOverride(feature.id!, valueToApply, typeToApply);
    const saved = await this.subscriptionRepository.save(subscription);
    await this.emitSubscriptionAfter(
      HookEvents.SubscriptionFeatureOverrideAddedAfter,
      'api',
      saved,
      oldDto,
      await this.toSubscriptionDto(saved),
      { featureKey, value: valueToApply, overrideType: typeToApply }
    );
  }

  async removeFeatureOverride(subscriptionKey: string, featureKey: string): Promise<void> {
    const subscription = await this.subscriptionRepository.findByKey(subscriptionKey);
    if (!subscription) {
      throw new NotFoundError(`Subscription with key '${subscriptionKey}' not found`);
    }

    // Block updates if subscription is archived
    if (subscription.isArchived) {
      throw new DomainError(
        `Cannot remove feature override from archived subscription with key '${subscriptionKey}'. ` +
        'Please unarchive the subscription first.'
      );
    }

    const feature = await this.featureRepository.findByKey(featureKey);
    if (!feature) {
      throw new NotFoundError(`Feature with key '${featureKey}' not found`);
    }

    const oldDto = await this.toSubscriptionDto(subscription);
    await this.emitSubscriptionBefore(
      HookEvents.SubscriptionFeatureOverrideRemovedBefore,
      'api',
      subscription,
      oldDto,
      { ...oldDto, updatedAt: now().toISOString() },
      { featureKey }
    );

    // Feature from repository always has ID (BIGSERIAL PRIMARY KEY)
    subscription.removeFeatureOverride(feature.id!);
    const saved = await this.subscriptionRepository.save(subscription);
    await this.emitSubscriptionAfter(
      HookEvents.SubscriptionFeatureOverrideRemovedAfter,
      'api',
      saved,
      oldDto,
      await this.toSubscriptionDto(saved),
      { featureKey }
    );
  }

  async clearTemporaryOverrides(subscriptionKey: string): Promise<void> {
    const subscription = await this.subscriptionRepository.findByKey(subscriptionKey);
    if (!subscription) {
      throw new NotFoundError(`Subscription with key '${subscriptionKey}' not found`);
    }

    // Block updates if subscription is archived
    if (subscription.isArchived) {
      throw new DomainError(
        `Cannot clear temporary overrides for archived subscription with key '${subscriptionKey}'. ` +
        'Please unarchive the subscription first.'
      );
    }

    const oldDto = await this.toSubscriptionDto(subscription);
    const before = await this.emitSubscriptionBefore(
      HookEvents.SubscriptionTemporaryOverridesClearedBefore,
      'api',
      subscription,
      oldDto,
      { ...oldDto, updatedAt: now().toISOString() }
    );
    if (before.newDto) {
      applySubscriptionDtoMutation(subscription, before.newDto, { allowKeyChange: false });
    }

    subscription.clearTemporaryOverrides();
    const saved = await this.subscriptionRepository.save(subscription);
    await this.emitSubscriptionAfter(
      HookEvents.SubscriptionTemporaryOverridesClearedAfter,
      'api',
      saved,
      oldDto,
      await this.toSubscriptionDto(saved)
    );
  }


  private calculatePeriodEnd(startDate: Date, billingCycle: any): Date | null {
    // For forever billing cycles, return null (never expires)
    if (billingCycle.props.durationUnit === 'forever') {
      return null;
    }
    
    const endDate = new Date(startDate);
    
    switch (billingCycle.props.durationUnit) {
      case 'days':
        endDate.setDate(endDate.getDate() + billingCycle.props.durationValue);
        break;
      case 'weeks':
        endDate.setDate(endDate.getDate() + (billingCycle.props.durationValue * 7));
        break;
      case 'months':
        endDate.setMonth(endDate.getMonth() + billingCycle.props.durationValue);
        break;
      case 'years':
        endDate.setFullYear(endDate.getFullYear() + billingCycle.props.durationValue);
        break;
      default:
        throw new ValidationError(`Unknown duration unit: ${billingCycle.props.durationUnit}`);
    }
    
    return endDate;
  }

  /**
   * Generate versioned subscription key from base key
   * Examples:
   * - "sub-abc" -> "sub-abc-v1"
   * - "sub-abc-v1" -> "sub-abc-v2"
   * - "sub-abc-v5" -> "sub-abc-v6"
   */
  private generateVersionedKey(baseKey: string): string {
    const versionPattern = /-v(\d+)$/;
    const match = baseKey.match(versionPattern);
    
    if (match) {
      const currentVersion = parseInt(match[1], 10);
      const base = baseKey.replace(versionPattern, '');
      return `${base}-v${currentVersion + 1}`;
    } else {
      return `${baseKey}-v1`;
    }
  }

  /**
   * Process expired subscriptions and transition them to configured plans.
   * 
   * This method:
   * 1. Finds all expired subscriptions (status='expired', not archived) whose plan has a transition requirement
   * 2. For each expired subscription:
   *    - Creates a new subscription to the transition billing cycle first
   *    - Archives the old subscription after the replacement is persisted
   *    - New subscription key is versioned: original key + "-vX" (or increments if already versioned)
   * 
   * Note: Plans do not have grace periods. A subscription is expired when
   * `expirationDate <= NOW()` and there is no cancellation.
   * 
   * @returns Report of processed subscriptions
   */
  async transitionExpiredSubscriptions(): Promise<TransitionExpiredSubscriptionsReport> {
    const report: TransitionExpiredSubscriptionsReport = {
      processed: 0,
      transitioned: 0,
      archived: 0,
      errors: []
    };

    // Find all expired subscriptions with transition plans (optimized query with join)
    const expiredSubscriptions = await this.subscriptionRepository.findExpiredWithTransitionPlans(1000);

    for (const expiredSubscription of expiredSubscriptions) {
      try {
        report.processed++;

        // Get the plan (already verified to have transition in query, but need it for the key)
        const plan = await this.planRepository.findById(expiredSubscription.planId);
        if (!plan) {
          report.errors.push({
            subscriptionKey: expiredSubscription.key,
            error: `Plan with id '${expiredSubscription.planId}' not found`
          });
          continue;
        }

        // Plan already verified to have transition requirement in query
        // Transition configured - archive old subscription and create new one
        // Get customer
        const customer = await this.customerRepository.findById(expiredSubscription.customerId);
        if (!customer) {
          report.errors.push({
            subscriptionKey: expiredSubscription.key,
            error: `Customer with id '${expiredSubscription.customerId}' not found`
          });
          continue;
        }

        // Get transition billing cycle
        if (!plan.props.onExpireTransitionToBillingCycleKey) {
          report.errors.push({
            subscriptionKey: expiredSubscription.key,
            error: `Plan '${plan.id}' does not have onExpireTransitionToBillingCycleKey set`
          });
          continue;
        }

        const transitionBillingCycle = await this.billingCycleRepository.findByKey(
          plan.props.onExpireTransitionToBillingCycleKey
        );
        if (!transitionBillingCycle) {
          report.errors.push({
            subscriptionKey: expiredSubscription.key,
            error: `Billing cycle with key '${plan.props.onExpireTransitionToBillingCycleKey}' not found`
          });
          continue;
        }

        const newSubscriptionKey = this.generateVersionedKey(expiredSubscription.key);
        const existing = await this.subscriptionRepository.findByKey(newSubscriptionKey);
        if (existing) {
          report.errors.push({
            subscriptionKey: expiredSubscription.key,
            error: `Generated subscription key '${newSubscriptionKey}' already exists`
          });
          continue;
        }

        const currentPeriodStart = now();
        const currentPeriodEnd = this.calculatePeriodEnd(
          currentPeriodStart,
          transitionBillingCycle
        );

        const transitionPlan = await this.planRepository.findById(transitionBillingCycle.props.planId);
        if (!transitionPlan) {
          report.errors.push({
            subscriptionKey: expiredSubscription.key,
            error: `Plan with id '${transitionBillingCycle.props.planId}' not found for transition`
          });
          continue;
        }

        const newSubscription = new Subscription({
          key: newSubscriptionKey,
          customerId: customer.id!,
          planId: transitionBillingCycle.props.planId,
          billingCycleId: transitionBillingCycle.id!,
          status: SubscriptionStatus.Active,
          isArchived: false,
          activationDate: currentPeriodStart,
          expirationDate: undefined,
          cancellationDate: undefined,
          trialEndDate: undefined,
          currentPeriodStart,
          currentPeriodEnd,
          stripeSubscriptionId: undefined,
          featureOverrides: [],
          metadata: expiredSubscription.props.metadata,
          createdAt: now(),
          updatedAt: now()
        });

        let createdProposed = SubscriptionMapper.toDto(
          newSubscription,
          customer.key,
          transitionPlan.productKey,
          transitionPlan.key,
          transitionBillingCycle.key
        );
        const createBefore = await this.emitSubscriptionBefore(
          HookEvents.SubscriptionCreatedBefore,
          'system',
          newSubscription,
          null,
          createdProposed
        );
        createdProposed = createBefore.newDto ?? createdProposed;
        applySubscriptionDtoMutation(newSubscription, createdProposed, { allowKeyChange: true });

        const savedNew = await this.subscriptionRepository.save(newSubscription);
        await this.emitSubscriptionAfter(
          HookEvents.SubscriptionCreatedAfter,
          'system',
          savedNew,
          null,
          await this.toSubscriptionDto(savedNew)
        );
        report.transitioned++;

        const oldArchivedDto = await this.toSubscriptionDto(expiredSubscription);
        let archivedProposed: SubscriptionDto = {
          ...oldArchivedDto,
          isArchived: true,
          updatedAt: now().toISOString(),
        };
        const archiveBefore = await this.emitSubscriptionBefore(
          HookEvents.SubscriptionArchivedBefore,
          'system',
          expiredSubscription,
          oldArchivedDto,
          archivedProposed
        );
        archivedProposed = archiveBefore.newDto ?? archivedProposed;
        applySubscriptionDtoMutation(expiredSubscription, archivedProposed, { allowKeyChange: false });
        expiredSubscription.markAsTransitioned();
        const archivedSaved = await this.subscriptionRepository.save(expiredSubscription);
        await this.emitSubscriptionAfter(
          HookEvents.SubscriptionArchivedAfter,
          'system',
          archivedSaved,
          oldArchivedDto,
          await this.toSubscriptionDto(archivedSaved)
        );
        report.archived++;
      } catch (error) {
        report.errors.push({
          subscriptionKey: expiredSubscription.key,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return report;
  }

}

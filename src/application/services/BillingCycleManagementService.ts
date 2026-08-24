import { IBillingCycleRepository } from '../repositories/IBillingCycleRepository.js';
import { IPlanRepository } from '../repositories/IPlanRepository.js';
import { ISubscriptionRepository } from '../repositories/ISubscriptionRepository.js';
import { 
  CreateBillingCycleDto, 
  CreateBillingCycleDtoSchema, 
  UpdateBillingCycleDto, 
  UpdateBillingCycleDtoSchema,
  BillingCycleFilterDto,
  BillingCycleFilterDtoSchema,
  BillingCycleDto 
} from '../dtos/BillingCycleDto.js';
import { BillingCycleMapper } from '../mappers/BillingCycleMapper.js';
import { BillingCycle } from '../../domain/entities/BillingCycle.js';
import { DurationUnit } from '../../domain/value-objects/DurationUnit.js';
import { BillingCycleStatus } from '../../domain/value-objects/BillingCycleStatus.js';
import { now } from '../../infrastructure/utils/date.js';
import { 
  ValidationError, 
  NotFoundError, 
  ConflictError, 
  DomainError 
} from '../errors/index.js';

export class BillingCycleManagementService {
  constructor(
    private readonly billingCycleRepository: IBillingCycleRepository,
    private readonly planRepository: IPlanRepository,
    private readonly subscriptionRepository: ISubscriptionRepository
  ) {}

  async createBillingCycle(dto: CreateBillingCycleDto): Promise<BillingCycleDto> {
    const validationResult = CreateBillingCycleDtoSchema.safeParse(dto);
    if (!validationResult.success) {
      throw new ValidationError(
        'Invalid billing cycle data',
        validationResult.error.issues
      );
    }
    const validatedDto = validationResult.data;

    // Verify plan exists
    const plan = await this.planRepository.findByKey(validatedDto.planKey);
    if (!plan) {
      throw new NotFoundError(`Plan with key '${validatedDto.planKey}' not found`);
    }

    // Check if key already exists globally
    const existing = await this.billingCycleRepository.findByKey(validatedDto.key);
    if (existing) {
      throw new ConflictError(`Billing cycle with key '${validatedDto.key}' already exists`);
    }

    // Validate duration unit
    if (!Object.values(DurationUnit).includes(validatedDto.durationUnit as DurationUnit)) {
      throw new ValidationError(`Invalid duration unit: ${validatedDto.durationUnit}`);
    }

    // Validate duration value based on duration unit
    if (validatedDto.durationUnit === 'forever') {
      // For forever billing cycles, durationValue must be undefined
      if (validatedDto.durationValue !== undefined) {
        throw new ValidationError('Duration value must not be provided for forever billing cycles');
      }
    } else {
      // For all other duration units, durationValue is required and must be positive
      if (validatedDto.durationValue === undefined) {
        throw new ValidationError('Duration value is required for non-forever billing cycles');
      }
      if (validatedDto.durationValue <= 0) {
        throw new ValidationError('Duration value must be greater than 0');
      }
    }

    // Plan from repository always has ID (BIGSERIAL PRIMARY KEY)
    // Create domain entity (no ID - database will generate)
    const billingCycle = new BillingCycle({
      planId: plan.id!,
      key: validatedDto.key,
      displayName: validatedDto.displayName,
      description: validatedDto.description,
      status: BillingCycleStatus.Active,
      durationValue: validatedDto.durationValue,
      durationUnit: validatedDto.durationUnit as DurationUnit,
      externalProductId: validatedDto.externalProductId,
      createdAt: now(),
      updatedAt: now()
    });

    // Save and get entity with generated ID
    const savedBillingCycle = await this.billingCycleRepository.save(billingCycle);
    return BillingCycleMapper.toDto(savedBillingCycle, plan.productKey, plan.key);
  }

  async updateBillingCycle(key: string, dto: UpdateBillingCycleDto): Promise<BillingCycleDto> {
    const validationResult = UpdateBillingCycleDtoSchema.safeParse(dto);
    if (!validationResult.success) {
      throw new ValidationError(
        'Invalid update data',
        validationResult.error.issues
      );
    }
    const validatedDto = validationResult.data;

    const billingCycle = await this.billingCycleRepository.findByKey(key);
    if (!billingCycle) {
      throw new NotFoundError(`Billing cycle with key '${key}' not found`);
    }

    // Update properties
    if (validatedDto.displayName !== undefined) {
      billingCycle.props.displayName = validatedDto.displayName;
    }
    if (validatedDto.description !== undefined) {
      billingCycle.props.description = validatedDto.description;
    }
    if (validatedDto.durationValue !== undefined) {
      if (validatedDto.durationValue <= 0) {
        throw new ValidationError('Duration value must be greater than 0');
      }
      billingCycle.props.durationValue = validatedDto.durationValue;
    }
    if (validatedDto.durationUnit !== undefined) {
      if (!Object.values(DurationUnit).includes(validatedDto.durationUnit as DurationUnit)) {
        throw new ValidationError(`Invalid duration unit: ${validatedDto.durationUnit}`);
      }
      billingCycle.props.durationUnit = validatedDto.durationUnit as DurationUnit;
    }
    if (validatedDto.externalProductId !== undefined) {
      billingCycle.props.externalProductId = validatedDto.externalProductId;
    }

    billingCycle.props.updatedAt = now();
    await this.billingCycleRepository.save(billingCycle);
    
    // Get plan to resolve keys for DTO
    const plan = await this.planRepository.findById(billingCycle.props.planId);
    if (!plan) {
      throw new NotFoundError(`Plan not found for billing cycle`);
    }
    
    return BillingCycleMapper.toDto(billingCycle, plan.productKey, plan.key);
  }

  async getBillingCycle(key: string): Promise<BillingCycleDto | null> {
    const billingCycle = await this.billingCycleRepository.findByKey(key);
    if (!billingCycle) {
      return null;
    }

    // Get plan to resolve keys for DTO
    const plan = await this.planRepository.findById(billingCycle.props.planId);
    if (!plan) {
      throw new NotFoundError(`Plan not found for billing cycle`);
    }

    return BillingCycleMapper.toDto(billingCycle, plan.productKey, plan.key);
  }

  async getBillingCyclesByPlan(planKey: string): Promise<BillingCycleDto[]> {
    // Verify plan exists
    const plan = await this.planRepository.findByKey(planKey);
    if (!plan) {
      throw new NotFoundError(`Plan with key '${planKey}' not found`);
    }

    // Plan from repository always has ID (BIGSERIAL PRIMARY KEY)
    const billingCycles = await this.billingCycleRepository.findByPlan(plan.id!);
    return billingCycles.map(bc => BillingCycleMapper.toDto(bc, plan.productKey, plan.key));
  }

  async listBillingCycles(filters: BillingCycleFilterDto = { limit: 50, offset: 0 }): Promise<BillingCycleDto[]> {
    const validationResult = BillingCycleFilterDtoSchema.safeParse(filters);
    if (!validationResult.success) {
      throw new ValidationError(
        'Invalid filter parameters',
        validationResult.error.issues
      );
    }

    // If filtering by plan, get plan first
    if (validationResult.data.planKey) {
      return this.getBillingCyclesByPlan(validationResult.data.planKey);
    }

    // Otherwise list all (need to resolve productKey/planKey for each)
    const billingCycles = await this.billingCycleRepository.findAll(validationResult.data);
    const dtos: BillingCycleDto[] = [];
    
    for (const bc of billingCycles) {
      const plan = await this.planRepository.findById(bc.planId);
      if (plan) {
        dtos.push(BillingCycleMapper.toDto(bc, plan.productKey, plan.key));
      }
    }
    
    return dtos;
  }

  async archiveBillingCycle(key: string): Promise<void> {
    const billingCycle = await this.billingCycleRepository.findByKey(key);
    if (!billingCycle) {
      throw new NotFoundError(`Billing cycle with key '${key}' not found`);
    }

    billingCycle.archive();
    await this.billingCycleRepository.save(billingCycle);
  }

  async unarchiveBillingCycle(key: string): Promise<void> {
    const billingCycle = await this.billingCycleRepository.findByKey(key);
    if (!billingCycle) {
      throw new NotFoundError(`Billing cycle with key '${key}' not found`);
    }

    billingCycle.unarchive();
    await this.billingCycleRepository.save(billingCycle);
  }

  async deleteBillingCycle(key: string): Promise<void> {
    const billingCycle = await this.billingCycleRepository.findByKey(key);
    if (!billingCycle) {
      throw new NotFoundError(`Billing cycle with key '${key}' not found`);
    }

    if (!billingCycle.canDelete()) {
      throw new DomainError(
        `Cannot delete billing cycle with status '${billingCycle.status}'. Billing cycle must be archived before deletion.`
      );
    }

    // Billing cycle from repository always has ID (BIGSERIAL PRIMARY KEY)
    // Check for subscriptions before deletion
    const hasSubscriptions = await this.subscriptionRepository.hasSubscriptionsForBillingCycle(billingCycle.id!);
    if (hasSubscriptions) {
      throw new DomainError(
        `Cannot delete billing cycle '${billingCycle.key}'. Billing cycle has active subscriptions. Please cancel or expire all subscriptions first.`
      );
    }

    // Check for plan transition references
    const hasPlanTransitionReferences = await this.planRepository.hasPlanTransitionReferences(billingCycle.key);
    if (hasPlanTransitionReferences) {
      throw new DomainError(
        `Cannot delete billing cycle '${billingCycle.key}'. Billing cycle is referenced by plan transition settings. Please update or remove plan transition references first.`
      );
    }

    await this.billingCycleRepository.delete(billingCycle.id!);
  }

  /**
   * Calculate next period end date based on billing cycle
   */
  async calculateNextPeriodEnd(
    billingCycleKey: string, 
    currentPeriodEnd: Date
  ): Promise<Date | null> {
    const billingCycle = await this.billingCycleRepository.findByKey(billingCycleKey);
    if (!billingCycle) {
      throw new NotFoundError(`Billing cycle with key '${billingCycleKey}' not found`);
    }
    return billingCycle.calculateNextPeriodEnd(currentPeriodEnd);
  }

  /**
   * Get billing cycles by duration unit
   */
  async getBillingCyclesByDurationUnit(durationUnit: DurationUnit): Promise<BillingCycleDto[]> {
    const allCycles = await this.billingCycleRepository.findAll();
    const filtered = allCycles.filter(cycle => cycle.props.durationUnit === durationUnit);
    return filtered.map(cycle => BillingCycleMapper.toDto(cycle));
  }

  /**
   * Get default billing cycles (commonly used ones)
   */
  async getDefaultBillingCycles(): Promise<BillingCycleDto[]> {
    const commonCycles = [
      { key: 'monthly', durationValue: 1, durationUnit: DurationUnit.Months },
      { key: 'quarterly', durationValue: 3, durationUnit: DurationUnit.Months },
      { key: 'yearly', durationValue: 1, durationUnit: DurationUnit.Years }
    ];

    const cycles: BillingCycleDto[] = [];

    for (const cycle of commonCycles) {
      const existing = await this.billingCycleRepository.findByKey(cycle.key);
      if (existing) {
        cycles.push(BillingCycleMapper.toDto(existing));
      }
    }

    return cycles;
  }
}


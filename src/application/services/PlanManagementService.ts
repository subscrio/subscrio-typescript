import { CatalogReader } from "../../infrastructure/repositories/CatalogReader.js";
import { IPlanRepository } from "../repositories/IPlanRepository.js";
import { IProductRepository } from "../repositories/IProductRepository.js";
import { IFeatureRepository } from "../repositories/IFeatureRepository.js";
import { ISubscriptionRepository } from "../repositories/ISubscriptionRepository.js";
import {
  CreatePlanDto,
  CreatePlanDtoSchema,
  UpdatePlanDto,
  UpdatePlanDtoSchema,
  PlanFilterDto,
  PlanFilterDtoSchema,
  PlanDto,
} from "../dtos/PlanDto.js";
import { PlanMapper } from "../mappers/PlanMapper.js";
import { Plan } from "../../domain/entities/Plan.js";
import { PlanStatus } from "../../domain/value-objects/PlanStatus.js";
import { now } from "../../infrastructure/utils/date.js";
import {
  ValidationError,
  NotFoundError,
  DomainError,
} from "../errors/index.js";
import { FeatureValueValidator } from "../utils/FeatureValueValidator.js";
import {
  assertValid,
  ensureKeyAvailable,
  requireByKey,
} from "../utils/ValidationGuard.js";

export class PlanManagementService {
  constructor(
    private readonly planRepository: IPlanRepository,
    private readonly productRepository: IProductRepository,
    private readonly featureRepository: IFeatureRepository,
    private readonly subscriptionRepository: ISubscriptionRepository,
    private readonly catalog?: CatalogReader,
  ) {}

  private async resolvePlanKeys(plan: Plan): Promise<{
    productKey: string;
    onExpireTransitionToBillingCycleKey?: string;
  }> {
    // Plan now stores productKey directly
    const productKey = plan.productKey;

    let onExpireTransitionToBillingCycleKey: string | undefined;
    if (plan.props.onExpireTransitionToBillingCycleKey) {
      onExpireTransitionToBillingCycleKey =
        plan.props.onExpireTransitionToBillingCycleKey;
    }

    return {
      productKey,
      onExpireTransitionToBillingCycleKey,
    };
  }

  async createPlan(dto: CreatePlanDto): Promise<PlanDto> {
    const validatedDto = assertValid(
      CreatePlanDtoSchema.safeParse(dto),
      "plan data",
    );
    const product = await requireByKey(
      (k) => this.productRepository.findByKey(k),
      validatedDto.productKey,
      "Product",
    );
    await ensureKeyAvailable(
      (k) => this.planRepository.findByKey(k),
      validatedDto.key,
      "Plan",
    );

    // Create domain entity (no ID - database will generate)
    const plan = new Plan({
      productKey: product.key,
      key: validatedDto.key,
      displayName: validatedDto.displayName,
      description: validatedDto.description,
      status: PlanStatus.Active,
      onExpireTransitionToBillingCycleKey:
        validatedDto.onExpireTransitionToBillingCycleKey,
      featureValues: [],
      metadata: validatedDto.metadata,
      createdAt: now(),
      updatedAt: now(),
    });

    // Save and get entity with generated ID
    const savedPlan = await this.planRepository.save(plan);

    return await this.enrich(
      PlanMapper.toDto(
        savedPlan,
        product.key,
        validatedDto.onExpireTransitionToBillingCycleKey,
      ),
    );
  }

  async updatePlan(planKey: string, dto: UpdatePlanDto): Promise<PlanDto> {
    const validationResult = UpdatePlanDtoSchema.safeParse(dto);
    if (!validationResult.success) {
      throw new ValidationError(
        "Invalid update data",
        validationResult.error.issues,
      );
    }
    const validatedDto = validationResult.data;

    const plan = await this.planRepository.findByKey(planKey);
    if (!plan) {
      throw new NotFoundError(`Plan with key '${planKey}' not found`);
    }

    // Update properties
    if (validatedDto.displayName !== undefined) {
      plan.updateDisplayName(validatedDto.displayName);
    }
    if (validatedDto.description !== undefined) {
      plan.props.description = validatedDto.description;
    }
    if (validatedDto.clearOnExpireTransitionToBillingCycleKey) {
      plan.props.onExpireTransitionToBillingCycleKey = undefined;
    } else if (validatedDto.onExpireTransitionToBillingCycleKey !== undefined) {
      plan.props.onExpireTransitionToBillingCycleKey =
        validatedDto.onExpireTransitionToBillingCycleKey;
    }
    if (validatedDto.metadata !== undefined) {
      plan.props.metadata = validatedDto.metadata;
    }

    plan.props.updatedAt = now();
    await this.planRepository.save(plan);

    const keys = await this.resolvePlanKeys(plan);
    return await this.enrich(
      PlanMapper.toDto(
        plan,
        keys.productKey,
        keys.onExpireTransitionToBillingCycleKey,
      ),
    );
  }

  async getPlan(planKey: string): Promise<PlanDto | null> {
    const plan = await this.planRepository.findByKey(planKey);
    if (!plan) {
      return null;
    }

    const keys = await this.resolvePlanKeys(plan);
    return await this.enrich(
      PlanMapper.toDto(
        plan,
        keys.productKey,
        keys.onExpireTransitionToBillingCycleKey,
      ),
    );
  }

  async listPlans(
    filters: PlanFilterDto = { limit: 50, offset: 0 },
  ): Promise<PlanDto[]> {
    const validationResult = PlanFilterDtoSchema.safeParse(filters);
    if (!validationResult.success) {
      throw new ValidationError(
        "Invalid filter parameters",
        validationResult.error.issues,
      );
    }

    // Filters are already validated and use productKey
    const resolvedFilters = validationResult.data;

    const plans = await this.planRepository.findAll(resolvedFilters);

    // Map each plan with resolved keys
    const planDtos: PlanDto[] = [];
    for (const plan of plans) {
      const keys = await this.resolvePlanKeys(plan);
      planDtos.push(
        await this.enrich(
          PlanMapper.toDto(
            plan,
            keys.productKey,
            keys.onExpireTransitionToBillingCycleKey,
          ),
        ),
      );
    }
    return planDtos;
  }

  async getPlansByProduct(productKey: string): Promise<PlanDto[]> {
    // Verify product exists
    const product = await this.productRepository.findByKey(productKey);
    if (!product) {
      throw new NotFoundError(`Product with key '${productKey}' not found`);
    }

    const plans = await this.planRepository.findByProduct(product.key);

    // Map each plan with resolved keys
    const planDtos: PlanDto[] = [];
    for (const plan of plans) {
      const keys = await this.resolvePlanKeys(plan);
      planDtos.push(
        await this.enrich(
          PlanMapper.toDto(
            plan,
            keys.productKey,
            keys.onExpireTransitionToBillingCycleKey,
          ),
        ),
      );
    }
    return planDtos;
  }

  async archivePlan(planKey: string): Promise<void> {
    const plan = await this.planRepository.findByKey(planKey);
    if (!plan) {
      throw new NotFoundError(`Plan with key '${planKey}' not found`);
    }

    plan.archive();
    await this.planRepository.save(plan);
  }

  async unarchivePlan(planKey: string): Promise<void> {
    const plan = await this.planRepository.findByKey(planKey);
    if (!plan) {
      throw new NotFoundError(`Plan with key '${planKey}' not found`);
    }

    plan.unarchive();
    await this.planRepository.save(plan);
  }

  async deletePlan(planKey: string): Promise<void> {
    const plan = await this.planRepository.findByKey(planKey);
    if (!plan) {
      throw new NotFoundError(`Plan with key '${planKey}' not found`);
    }

    if (!plan.canDelete()) {
      throw new DomainError(
        `Cannot delete plan with status '${plan.status}'. ` +
          "Plan must be archived before deletion.",
      );
    }

    // Plan from repository always has ID (BIGSERIAL PRIMARY KEY)
    // Check for subscriptions before deletion (more critical than billing cycles)
    const hasSubscriptions =
      await this.subscriptionRepository.hasSubscriptionsForPlan(plan.id!);
    if (hasSubscriptions) {
      throw new DomainError(
        `Cannot delete plan '${plan.key}'. Plan has active subscriptions. Please cancel or expire all subscriptions first.`,
      );
    }

    // Check for billing cycles before deletion
    const hasBillingCycles = await this.planRepository.hasBillingCycles(
      plan.id!,
    );
    if (hasBillingCycles) {
      throw new DomainError(
        `Cannot delete plan '${plan.key}'. Plan has associated billing cycles. Please delete or archive all billing cycles first.`,
      );
    }

    await this.planRepository.delete(plan.id!);
  }

  async setFeatureValue(
    planKey: string,
    featureKey: string,
    value: string,
  ): Promise<void> {
    const plan = await this.planRepository.findByKey(planKey);
    if (!plan) {
      throw new NotFoundError(`Plan with key '${planKey}' not found`);
    }

    const feature = await this.featureRepository.findByKey(featureKey);
    if (!feature) {
      throw new NotFoundError(`Feature with key '${featureKey}' not found`);
    }

    const product = await this.productRepository.findByKey(plan.productKey);
    if (!product) {
      throw new NotFoundError(
        `Product with key '${plan.productKey}' not found`,
      );
    }
    const associatedFeatureIds =
      await this.productRepository.getFeaturesByProduct(product.id!);
    if (!associatedFeatureIds.includes(feature.id!)) {
      throw new ValidationError(
        `Feature '${featureKey}' is not associated with the product for plan '${planKey}'. ` +
          "Associate the feature with the product before setting a plan value.",
      );
    }

    FeatureValueValidator.validate(value, feature.props.valueType);

    // Feature from repository always has ID (BIGSERIAL PRIMARY KEY)
    plan.setFeatureValue(feature.id!, value);
    await this.planRepository.save(plan);
  }

  async removeFeatureValue(planKey: string, featureKey: string): Promise<void> {
    const plan = await this.planRepository.findByKey(planKey);
    if (!plan) {
      throw new NotFoundError(`Plan with key '${planKey}' not found`);
    }

    const feature = await this.featureRepository.findByKey(featureKey);
    if (!feature) {
      throw new NotFoundError(`Feature with key '${featureKey}' not found`);
    }

    // Feature from repository always has ID (BIGSERIAL PRIMARY KEY)
    plan.removeFeatureValue(feature.id!);
    await this.planRepository.save(plan);
  }

  async getFeatureValue(
    planKey: string,
    featureKey: string,
  ): Promise<string | null> {
    const plan = await this.planRepository.findByKey(planKey);
    if (!plan) {
      throw new NotFoundError(`Plan with key '${planKey}' not found`);
    }

    const feature = await this.featureRepository.findByKey(featureKey);
    if (!feature) {
      return null;
    }

    // Feature from repository always has ID (BIGSERIAL PRIMARY KEY)
    return plan.getFeatureValue(feature.id!);
  }

  async getPlanFeatures(
    planKey: string,
  ): Promise<Array<{ featureKey: string; value: string }>> {
    const plan = await this.planRepository.findByKey(planKey);
    if (!plan) {
      throw new NotFoundError(`Plan with key '${planKey}' not found`);
    }

    // Map feature IDs to keys
    const features: Array<{ featureKey: string; value: string }> = [];
    for (const fv of plan.props.featureValues || []) {
      const feature = await this.featureRepository.findById(fv.featureId);
      if (feature) {
        features.push({ featureKey: feature.key, value: fv.value });
      }
    }

    return features;
  }

  private async enrich(dto: PlanDto): Promise<PlanDto> {
    if (!this.catalog) return dto;
    return { ...dto, addons: await this.catalog.addons(dto.productKey) };
  }
}

import { CatalogReader } from "../../infrastructure/repositories/CatalogReader.js";
import { IFeatureRepository } from "../repositories/IFeatureRepository.js";
import { IProductRepository } from "../repositories/IProductRepository.js";
import {
  CreateFeatureDto,
  CreateFeatureDtoSchema,
  UpdateFeatureDto,
  UpdateFeatureDtoSchema,
  FeatureFilterDto,
  FeatureFilterDtoSchema,
  FeatureDto,
} from "../dtos/FeatureDto.js";
import { FeatureMapper } from "../mappers/FeatureMapper.js";
import { Feature } from "../../domain/entities/Feature.js";
import { FeatureStatus } from "../../domain/value-objects/FeatureStatus.js";
import { FeatureValueType } from "../../domain/value-objects/FeatureValueType.js";
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

export class FeatureManagementService {
  constructor(
    private readonly featureRepository: IFeatureRepository,
    private readonly productRepository: IProductRepository,
    private readonly catalog?: CatalogReader,
  ) {}

  async createFeature(dto: CreateFeatureDto): Promise<FeatureDto> {
    const validatedDto = assertValid(
      CreateFeatureDtoSchema.safeParse(dto),
      "feature data",
    );
    await ensureKeyAvailable(
      (k) => this.featureRepository.findByKey(k),
      validatedDto.key,
      "Feature",
    );

    // Validate default value based on type
    FeatureValueValidator.validate(
      validatedDto.defaultValue,
      validatedDto.valueType as FeatureValueType,
    );

    // Create domain entity (no ID - database will generate)
    const feature = new Feature({
      key: validatedDto.key,
      displayName: validatedDto.displayName,
      description: validatedDto.description,
      valueType: validatedDto.valueType as FeatureValueType,
      defaultValue: validatedDto.defaultValue,
      groupName: validatedDto.groupName,
      status: FeatureStatus.Active,
      meteredConfig: validatedDto.meteredConfig,
      validator: validatedDto.validator,
      metadata: validatedDto.metadata,
      createdAt: now(),
      updatedAt: now(),
    });

    // Save and get entity with generated ID
    const savedFeature = await this.featureRepository.save(feature);
    return await this.enrich(FeatureMapper.toDto(savedFeature));
  }

  async updateFeature(key: string, dto: UpdateFeatureDto): Promise<FeatureDto> {
    const validatedDto = assertValid(
      UpdateFeatureDtoSchema.safeParse(dto),
      "update data",
    );
    const feature = await requireByKey(
      (k) => this.featureRepository.findByKey(k),
      key,
      "Feature",
    );

    // Key is immutable - no validation needed

    if (validatedDto.displayName !== undefined) {
      feature.updateDisplayName(validatedDto.displayName);
    }
    if (validatedDto.description !== undefined) {
      feature.props.description = validatedDto.description;
    }
    if (validatedDto.valueType !== undefined) {
      feature.setValueType(validatedDto.valueType as FeatureValueType);
    }
    if (validatedDto.defaultValue !== undefined) {
      FeatureValueValidator.validate(
        validatedDto.defaultValue,
        feature.props.valueType,
      );
      feature.props.defaultValue = validatedDto.defaultValue;
    } else if (validatedDto.valueType !== undefined) {
      FeatureValueValidator.validate(
        feature.props.defaultValue,
        feature.props.valueType,
      );
    }
    if (validatedDto.groupName !== undefined) {
      feature.props.groupName = validatedDto.groupName;
    }
    if (validatedDto.validator !== undefined) {
      feature.props.validator = validatedDto.validator;
    }
    if (validatedDto.metadata !== undefined) {
      feature.props.metadata = validatedDto.metadata;
    }

    if (validatedDto.meteredConfig !== undefined)
      feature.props.meteredConfig = validatedDto.meteredConfig;
    feature.props.updatedAt = now();
    const savedFeature = await this.featureRepository.save(feature);
    return await this.enrich(FeatureMapper.toDto(savedFeature));
  }

  async getFeature(key: string): Promise<FeatureDto | null> {
    const feature = await this.featureRepository.findByKey(key);
    return feature ? await this.enrich(FeatureMapper.toDto(feature)) : null;
  }

  async listFeatures(
    filters: FeatureFilterDto = { limit: 50, offset: 0 },
  ): Promise<FeatureDto[]> {
    const validationResult = FeatureFilterDtoSchema.safeParse(filters);
    if (!validationResult.success) {
      throw new ValidationError(
        "Invalid filter parameters",
        validationResult.error.issues,
      );
    }

    const features = await this.featureRepository.findAll(
      validationResult.data,
    );
    return Promise.all(
      features.map((entity) => this.enrich(FeatureMapper.toDto(entity))),
    );
  }

  async archiveFeature(key: string): Promise<void> {
    const feature = await this.featureRepository.findByKey(key);
    if (!feature) {
      throw new NotFoundError(`Feature with key '${key}' not found`);
    }

    feature.archive();
    await this.featureRepository.save(feature);
  }

  async unarchiveFeature(key: string): Promise<void> {
    const feature = await this.featureRepository.findByKey(key);
    if (!feature) {
      throw new NotFoundError(`Feature with key '${key}' not found`);
    }

    feature.unarchive();
    await this.featureRepository.save(feature);
  }

  async deleteFeature(key: string): Promise<void> {
    const feature = await this.featureRepository.findByKey(key);
    if (!feature) {
      throw new NotFoundError(`Feature with key '${key}' not found`);
    }

    if (!feature.canDelete()) {
      throw new DomainError(
        `Cannot delete feature with status '${feature.status}'. ` +
          "Feature must be archived before deletion.",
      );
    }

    // Feature from repository always has ID (BIGSERIAL PRIMARY KEY)
    // Check for product associations
    const hasProductAssociations =
      await this.featureRepository.hasProductAssociations(feature.id!);
    if (hasProductAssociations) {
      throw new DomainError(
        `Cannot delete feature '${feature.key}'. Feature is associated with products. Please dissociate from all products first.`,
      );
    }

    // Check for plan feature values
    const hasPlanFeatureValues =
      await this.featureRepository.hasPlanFeatureValues(feature.id!);
    if (hasPlanFeatureValues) {
      throw new DomainError(
        `Cannot delete feature '${feature.key}'. Feature is used in plan feature values. Please remove from all plans first.`,
      );
    }

    // Check for subscription overrides
    const hasSubscriptionOverrides =
      await this.featureRepository.hasSubscriptionOverrides(feature.id!);
    if (hasSubscriptionOverrides) {
      throw new DomainError(
        `Cannot delete feature '${feature.key}'. Feature has subscription overrides. Please remove all subscription overrides first.`,
      );
    }

    await this.featureRepository.delete(feature.id!);
  }

  async getFeaturesByProduct(productKey: string): Promise<FeatureDto[]> {
    // Verify product exists
    const product = await this.productRepository.findByKey(productKey);
    if (!product) {
      throw new NotFoundError(`Product with key '${productKey}' not found`);
    }

    // Product from repository always has ID (BIGSERIAL PRIMARY KEY)
    const features = await this.featureRepository.findByProduct(product.id!);
    return Promise.all(
      features.map((entity) => this.enrich(FeatureMapper.toDto(entity))),
    );
  }

  private async enrich(dto: FeatureDto): Promise<FeatureDto> {
    if (!this.catalog) return dto;
    return { ...dto, addons: await this.catalog.addons(undefined, dto.key) };
  }
}

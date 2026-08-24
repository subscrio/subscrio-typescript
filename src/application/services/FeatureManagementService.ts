import { IFeatureRepository } from '../repositories/IFeatureRepository.js';
import { IProductRepository } from '../repositories/IProductRepository.js';
import { 
  CreateFeatureDto, 
  CreateFeatureDtoSchema, 
  UpdateFeatureDto, 
  UpdateFeatureDtoSchema,
  FeatureFilterDto,
  FeatureFilterDtoSchema,
  FeatureDto 
} from '../dtos/FeatureDto.js';
import { FeatureMapper } from '../mappers/FeatureMapper.js';
import { Feature } from '../../domain/entities/Feature.js';
import { FeatureStatus } from '../../domain/value-objects/FeatureStatus.js';
import { FeatureValueType } from '../../domain/value-objects/FeatureValueType.js';
import { now } from '../../infrastructure/utils/date.js';
import { 
  ValidationError, 
  NotFoundError, 
  ConflictError, 
  DomainError 
} from '../errors/index.js';
import { FeatureValueValidator } from '../utils/FeatureValueValidator.js';

export class FeatureManagementService {
  constructor(
    private readonly featureRepository: IFeatureRepository,
    private readonly productRepository: IProductRepository
  ) {}

  async createFeature(dto: CreateFeatureDto): Promise<FeatureDto> {
    const validationResult = CreateFeatureDtoSchema.safeParse(dto);
    if (!validationResult.success) {
      throw new ValidationError(
        'Invalid feature data',
        validationResult.error.issues
      );
    }
    const validatedDto = validationResult.data;

    // Check if key already exists
    const existing = await this.featureRepository.findByKey(validatedDto.key);
    if (existing) {
      throw new ConflictError(`Feature with key '${validatedDto.key}' already exists`);
    }

    // Validate default value based on type
    FeatureValueValidator.validate(validatedDto.defaultValue, validatedDto.valueType as FeatureValueType);

    // Create domain entity (no ID - database will generate)
    const feature = new Feature({
      key: validatedDto.key,
      displayName: validatedDto.displayName,
      description: validatedDto.description,
      valueType: validatedDto.valueType as FeatureValueType,
      defaultValue: validatedDto.defaultValue,
      groupName: validatedDto.groupName,
      status: FeatureStatus.Active,
      validator: validatedDto.validator,
      metadata: validatedDto.metadata,
      createdAt: now(),
      updatedAt: now()
    });

    // Save and get entity with generated ID
    const savedFeature = await this.featureRepository.save(feature);
    return FeatureMapper.toDto(savedFeature);
  }

  async updateFeature(key: string, dto: UpdateFeatureDto): Promise<FeatureDto> {
    const validationResult = UpdateFeatureDtoSchema.safeParse(dto);
    if (!validationResult.success) {
      throw new ValidationError(
        'Invalid update data',
        validationResult.error.issues
      );
    }
    const validatedDto = validationResult.data;

    const feature = await this.featureRepository.findByKey(key);
    if (!feature) {
      throw new NotFoundError(`Feature with key '${key}' not found`);
    }

    // Key is immutable - no validation needed

    // Update properties
    if (validatedDto.displayName !== undefined) {
      feature.updateDisplayName(validatedDto.displayName);
    }
    if (validatedDto.description !== undefined) {
      feature.props.description = validatedDto.description;
    }
    if (validatedDto.defaultValue !== undefined) {
      FeatureValueValidator.validate(validatedDto.defaultValue, feature.props.valueType);
      feature.props.defaultValue = validatedDto.defaultValue;
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

    feature.props.updatedAt = now();
    const savedFeature = await this.featureRepository.save(feature);
    return FeatureMapper.toDto(savedFeature);
  }

  async getFeature(key: string): Promise<FeatureDto | null> {
    const feature = await this.featureRepository.findByKey(key);
    return feature ? FeatureMapper.toDto(feature) : null;
  }

  async listFeatures(filters: FeatureFilterDto = { limit: 50, offset: 0 }): Promise<FeatureDto[]> {
    const validationResult = FeatureFilterDtoSchema.safeParse(filters);
    if (!validationResult.success) {
      throw new ValidationError(
        'Invalid filter parameters',
        validationResult.error.issues
      );
    }

    const features = await this.featureRepository.findAll(validationResult.data);
    return features.map(FeatureMapper.toDto);
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
        'Feature must be archived before deletion.'
      );
    }

    // Feature from repository always has ID (BIGSERIAL PRIMARY KEY)
    // Check for product associations
    const hasProductAssociations = await this.featureRepository.hasProductAssociations(feature.id!);
    if (hasProductAssociations) {
      throw new DomainError(
        `Cannot delete feature '${feature.key}'. Feature is associated with products. Please dissociate from all products first.`
      );
    }

    // Check for plan feature values
    const hasPlanFeatureValues = await this.featureRepository.hasPlanFeatureValues(feature.id!);
    if (hasPlanFeatureValues) {
      throw new DomainError(
        `Cannot delete feature '${feature.key}'. Feature is used in plan feature values. Please remove from all plans first.`
      );
    }

    // Check for subscription overrides
    const hasSubscriptionOverrides = await this.featureRepository.hasSubscriptionOverrides(feature.id!);
    if (hasSubscriptionOverrides) {
      throw new DomainError(
        `Cannot delete feature '${feature.key}'. Feature has subscription overrides. Please remove all subscription overrides first.`
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
    return features.map(FeatureMapper.toDto);
  }

}

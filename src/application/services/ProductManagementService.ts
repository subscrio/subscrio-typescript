import { CatalogReader } from "../../infrastructure/repositories/CatalogReader.js";
import { ProductFeatureRepository } from "../../infrastructure/repositories/ProductFeatureRepository.js";
import type { FeatureResolutionOptions } from "../dtos/FeatureResolutionDto.js";
import { IProductRepository } from "../repositories/IProductRepository.js";
import { IFeatureRepository } from "../repositories/IFeatureRepository.js";
import { Product } from "../../domain/entities/Product.js";
import { ProductStatus } from "../../domain/value-objects/ProductStatus.js";
import {
  CreateProductDto,
  CreateProductDtoSchema,
  UpdateProductDto,
  UpdateProductDtoSchema,
  ProductDto,
  ProductFilterDto,
  ProductFilterDtoSchema,
} from "../dtos/ProductDto.js";
import { ProductMapper } from "../mappers/ProductMapper.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  DomainError,
} from "../errors/index.js";
import { now } from "../../infrastructure/utils/date.js";

export class ProductManagementService {
  constructor(
    private readonly productRepository: IProductRepository,
    private readonly featureRepository: IFeatureRepository,
    private readonly associations?: ProductFeatureRepository,
    private readonly catalog?: CatalogReader,
  ) {}
  async createProduct(dto: CreateProductDto): Promise<ProductDto> {
    // Validate input
    const validation = CreateProductDtoSchema.safeParse(dto);
    if (!validation.success) {
      throw new ValidationError(
        `Invalid product data for key '${dto.key}': ${validation.error.issues.map((e) => e.message).join(", ")}`,
        validation.error.issues,
      );
    }
    const validatedDto = validation.data;

    // Check for duplicate key
    const existing = await this.productRepository.findByKey(validatedDto.key);
    if (existing) {
      throw new ConflictError(
        `Product with key '${validatedDto.key}' already exists`,
      );
    }

    // Create domain entity (no ID - database will generate)
    const product = new Product({
      key: validatedDto.key,
      displayName: validatedDto.displayName,
      description: validatedDto.description,
      status: ProductStatus.Active,
      metadata: validatedDto.metadata,
      createdAt: now(),
      updatedAt: now(),
    });

    // Save and get entity with generated ID
    const savedProduct = await this.productRepository.save(product);

    return await this.enrich(ProductMapper.toDto(savedProduct));
  }

  async updateProduct(key: string, dto: UpdateProductDto): Promise<ProductDto> {
    // Validate input
    const validation = UpdateProductDtoSchema.safeParse(dto);
    if (!validation.success) {
      throw new ValidationError("Invalid update data", validation.error.issues);
    }
    const validatedDto = validation.data;

    // Find existing by key
    const product = await this.productRepository.findByKey(key);
    if (!product) {
      throw new NotFoundError(
        `Product with key '${key}' not found. Please check the product key and try again.`,
      );
    }

    // Key is immutable - no validation needed

    // Update properties
    if (validatedDto.displayName !== undefined) {
      product.updateDisplayName(validatedDto.displayName);
    }
    if (validatedDto.description !== undefined) {
      product.props.description = validatedDto.description;
    }
    if (validatedDto.metadata !== undefined) {
      product.props.metadata = validatedDto.metadata;
    }

    product.props.updatedAt = now();

    // Save
    const savedProduct = await this.productRepository.save(product);

    return await this.enrich(ProductMapper.toDto(savedProduct));
  }

  async getProduct(key: string): Promise<ProductDto | null> {
    const product = await this.productRepository.findByKey(key);
    return product ? await this.enrich(ProductMapper.toDto(product)) : null;
  }

  async listProducts(filters?: ProductFilterDto): Promise<ProductDto[]> {
    const validation = ProductFilterDtoSchema.safeParse(filters || {});
    if (!validation.success) {
      throw new ValidationError(
        "Invalid filter parameters",
        validation.error.issues,
      );
    }

    const products = await this.productRepository.findAll(validation.data);
    return Promise.all(
      products.map((entity) => this.enrich(ProductMapper.toDto(entity))),
    );
  }

  async deleteProduct(key: string): Promise<void> {
    const product = await this.productRepository.findByKey(key);
    if (!product) {
      throw new NotFoundError(`Product with key '${key}' not found`);
    }

    if (!product.canDelete()) {
      throw new DomainError(
        `Cannot delete product with status '${product.status}'. Product must be archived before deletion.`,
      );
    }

    // Check for plans before deletion
    const hasPlans = await this.productRepository.hasPlans(product.key);
    if (hasPlans) {
      throw new DomainError(
        `Cannot delete product '${product.key}'. Product has associated plans. Please delete or archive all plans first.`,
      );
    }

    // Product from repository always has ID (BIGSERIAL PRIMARY KEY)
    await this.productRepository.delete(product.id!);
  }

  async archiveProduct(key: string): Promise<ProductDto> {
    const product = await this.productRepository.findByKey(key);
    if (!product) {
      throw new NotFoundError(`Product with key '${key}' not found`);
    }

    product.archive();
    const savedProduct = await this.productRepository.save(product);

    return await this.enrich(ProductMapper.toDto(savedProduct));
  }

  async unarchiveProduct(key: string): Promise<ProductDto> {
    const product = await this.productRepository.findByKey(key);
    if (!product) {
      throw new NotFoundError(`Product with key '${key}' not found`);
    }

    product.unarchive();
    const savedProduct = await this.productRepository.save(product);

    return await this.enrich(ProductMapper.toDto(savedProduct));
  }

  async associateFeature(
    productKey: string,
    featureKey: string,
    resolution?: FeatureResolutionOptions,
  ): Promise<void> {
    const product = await this.productRepository.findByKey(productKey);
    if (!product) {
      throw new NotFoundError(`Product with key '${productKey}' not found`);
    }

    const feature = await this.featureRepository.findByKey(featureKey);
    if (!feature) {
      throw new NotFoundError(`Feature with key '${featureKey}' not found`);
    }

    // Entities from repository always have IDs (BIGSERIAL PRIMARY KEY)
    if (this.associations)
      await this.associations.associate(productKey, featureKey, resolution);
    else {
      if (resolution)
        throw new ValidationError(
          "Feature resolution configuration requires an association repository",
        );
      await this.productRepository.associateFeature(product.id!, feature.id!);
    }
  }

  async dissociateFeature(
    productKey: string,
    featureKey: string,
  ): Promise<void> {
    const product = await this.productRepository.findByKey(productKey);
    if (!product) {
      throw new NotFoundError(`Product with key '${productKey}' not found`);
    }

    const feature = await this.featureRepository.findByKey(featureKey);
    if (!feature) {
      throw new NotFoundError(`Feature with key '${featureKey}' not found`);
    }

    // Entities from repository always have IDs (BIGSERIAL PRIMARY KEY)
    await this.productRepository.dissociateFeature(product.id!, feature.id!);
  }

  private async enrich(dto: ProductDto): Promise<ProductDto> {
    if (!this.catalog) return dto;
    return {
      ...dto,
      addons: await this.catalog.addons(dto.key),
      features: await this.catalog.productFeatures(dto.key),
    };
  }
}

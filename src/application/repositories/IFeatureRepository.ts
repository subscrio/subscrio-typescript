import { Feature } from '../../domain/entities/Feature.js';
import { FeatureFilterDto } from '../dtos/FeatureDto.js';

export interface IFeatureRepository {
  save(feature: Feature): Promise<Feature>;
  findById(id: number): Promise<Feature | null>;
  findByKey(key: string): Promise<Feature | null>;
  findAll(filters?: FeatureFilterDto): Promise<Feature[]>;
  findByIds(ids: number[]): Promise<Feature[]>;
  delete(id: number): Promise<void>;
  exists(id: number): Promise<boolean>;
  
  // Get features by product
  findByProduct(productId: number): Promise<Feature[]>;
  
  // Foreign key checks
  hasProductAssociations(featureId: number): Promise<boolean>;
  hasPlanFeatureValues(featureId: number): Promise<boolean>;
  hasSubscriptionOverrides(featureId: number): Promise<boolean>;
}


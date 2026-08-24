import { Product } from '../../domain/entities/Product.js';
import { ProductFilterDto } from '../dtos/ProductDto.js';

export interface IProductRepository {
  save(product: Product): Promise<Product>;
  findById(id: number): Promise<Product | null>;
  findByKey(key: string): Promise<Product | null>;
  findAll(filters?: ProductFilterDto): Promise<Product[]>;
  delete(id: number): Promise<void>;
  exists(id: number): Promise<boolean>;
  
  // Product-Feature associations
  associateFeature(productId: number, featureId: number): Promise<void>;
  dissociateFeature(productId: number, featureId: number): Promise<void>;
  getFeaturesByProduct(productId: number): Promise<number[]>;
  
  // Foreign key checks
  hasPlans(productKey: string): Promise<boolean>;
}


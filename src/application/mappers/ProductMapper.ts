import { Product } from '../../domain/entities/Product.js';
import { ProductDto } from '../dtos/ProductDto.js';
import { ProductStatus } from '../../domain/value-objects/ProductStatus.js';

export class ProductMapper {
  static toDto(product: Product): ProductDto {
    return {
      key: product.key,
      displayName: product.displayName,
      description: product.props.description ?? null,
      status: product.status,
      metadata: product.props.metadata ?? null,
      createdAt: product.props.createdAt.toISOString(),
      updatedAt: product.props.updatedAt.toISOString()
    };
  }

  static toDomain(raw: any): Product {
    return new Product(
      {
        key: raw.key,
        displayName: raw.display_name,
        description: raw.description,
        status: raw.status as ProductStatus,
        metadata: raw.metadata,
        createdAt: new Date(raw.created_at),
        updatedAt: new Date(raw.updated_at)
      },
      raw.id as number | undefined
    );
  }

  static toPersistence(product: Product): any {
    const record: any = {
      key: product.key,
      display_name: product.displayName,
      description: product.props.description,
      status: product.status,
      metadata: product.props.metadata,
      created_at: product.props.createdAt,
      updated_at: product.props.updatedAt
    };
    
    // Only include id for updates (not inserts)
    if (product.id !== undefined) {
      record.id = product.id;
    }
    
    return record;
  }
}


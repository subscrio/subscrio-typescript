import { Entity } from '../base/Entity.js';
import { ProductStatus } from '../value-objects/ProductStatus.js';
import { DomainError } from '../../application/errors/index.js';
import { MAX_DISPLAY_NAME_LENGTH, MIN_DISPLAY_NAME_LENGTH } from '../../application/constants/index.js';
import { now } from '../../infrastructure/utils/date.js';

export interface ProductProps {
  key: string;
  displayName: string;
  description?: string;
  status: ProductStatus;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class Product extends Entity<ProductProps> {
  get key(): string {
    return this.props.key;
  }

  get displayName(): string {
    return this.props.displayName;
  }

  get status(): ProductStatus {
    return this.props.status;
  }

  archive(): void {
    this.props.status = ProductStatus.Archived;
    this.props.updatedAt = now();
  }

  unarchive(): void {
    this.props.status = ProductStatus.Active;
    this.props.updatedAt = now();
  }

  canDelete(): boolean {
    return this.props.status === ProductStatus.Archived;
  }

  updateDisplayName(name: string): void {
    if (!name || name.trim().length < MIN_DISPLAY_NAME_LENGTH) {
      throw new DomainError('Display name cannot be empty. Product key: ' + this.key);
    }
    if (name.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new DomainError(`Display name cannot exceed ${MAX_DISPLAY_NAME_LENGTH} characters. Product key: ${this.key}, provided length: ${name.length}`);
    }
    this.props.displayName = name;
    this.props.updatedAt = now();
  }
}


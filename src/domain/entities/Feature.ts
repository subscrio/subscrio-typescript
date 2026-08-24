import { Entity } from '../base/Entity.js';
import { FeatureStatus } from '../value-objects/FeatureStatus.js';
import { FeatureValueType } from '../value-objects/FeatureValueType.js';
import { DomainError } from '../../application/errors/index.js';
import { now } from '../../infrastructure/utils/date.js';

export interface FeatureProps {
  key: string;
  displayName: string;
  description?: string;
  valueType: FeatureValueType;
  defaultValue: string;
  groupName?: string;
  status: FeatureStatus;
  validator?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class Feature extends Entity<FeatureProps> {
  get key(): string {
    return this.props.key;
  }

  get displayName(): string {
    return this.props.displayName;
  }

  get status(): FeatureStatus {
    return this.props.status;
  }

  get valueType(): FeatureValueType {
    return this.props.valueType;
  }

  get defaultValue(): string {
    return this.props.defaultValue;
  }

  archive(): void {
    this.props.status = FeatureStatus.Archived;
    this.props.updatedAt = now();
  }

  unarchive(): void {
    this.props.status = FeatureStatus.Active;
    this.props.updatedAt = now();
  }

  canDelete(): boolean {
    return this.props.status === FeatureStatus.Archived;
  }

  updateDisplayName(name: string): void {
    if (!name || name.length === 0) {
      throw new DomainError('Display name cannot be empty');
    }
    this.props.displayName = name;
    this.props.updatedAt = now();
  }

}


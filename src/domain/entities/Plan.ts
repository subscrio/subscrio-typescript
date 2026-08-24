import { Entity } from '../base/Entity.js';
import { PlanStatus } from '../value-objects/PlanStatus.js';
import { DomainError } from '../../application/errors/index.js';
import { now } from '../../infrastructure/utils/date.js';

export interface PlanFeatureValue {
  featureId: number;
  value: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanProps {
  productKey: string;
  key: string;
  displayName: string;
  description?: string;
  status: PlanStatus;
  onExpireTransitionToBillingCycleKey?: string;
  featureValues: PlanFeatureValue[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class Plan extends Entity<PlanProps> {
  get productKey(): string {
    return this.props.productKey;
  }

  get key(): string {
    return this.props.key;
  }

  get displayName(): string {
    return this.props.displayName;
  }

  get status(): PlanStatus {
    return this.props.status;
  }

  archive(): void {
    this.props.status = PlanStatus.Archived;
    this.props.updatedAt = now();
  }

  unarchive(): void {
    this.props.status = PlanStatus.Active;
    this.props.updatedAt = now();
  }

  setFeatureValue(featureId: number, value: string): void {
    const existing = this.props.featureValues.find(fv => fv.featureId === featureId);
    if (existing) {
      existing.value = value;
      existing.updatedAt = now();
    } else {
      this.props.featureValues.push({
        featureId,
        value,
        createdAt: now(),
        updatedAt: now()
      });
    }
    this.props.updatedAt = now();
  }

  removeFeatureValue(featureId: number): void {
    this.props.featureValues = this.props.featureValues.filter(
      fv => fv.featureId !== featureId
    );
    this.props.updatedAt = now();
  }

  getFeatureValue(featureId: number): string | null {
    const featureValue = this.props.featureValues.find(fv => fv.featureId === featureId);
    return featureValue ? featureValue.value : null;
  }

  canDelete(): boolean {
    return this.props.status === PlanStatus.Archived;
  }

  updateDisplayName(name: string): void {
    if (!name || name.length === 0) {
      throw new DomainError('Display name cannot be empty');
    }
    this.props.displayName = name;
    this.props.updatedAt = now();
  }
}


import { Entity } from '../base/Entity.js';
import { SubscriptionStatus } from '../value-objects/SubscriptionStatus.js';
import { OverrideType } from '../value-objects/OverrideType.js';
import { DomainError } from '../../application/errors/index.js';
import { now } from '../../infrastructure/utils/date.js';

export interface FeatureOverride {
  featureId: number;
  value: string;
  type: OverrideType;
  createdAt: Date;
}

export interface SubscriptionProps {
  key: string;  // External reference key for this subscription
  customerId: number;
  planId: number;
  billingCycleId: number;
  status: SubscriptionStatus;
  isArchived: boolean; // Archive flag - blocks updates but doesn't affect status calculation
  activationDate?: Date;
  expirationDate?: Date;
  cancellationDate?: Date;
  trialEndDate?: Date;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date | null;
  stripeSubscriptionId?: string;
  featureOverrides: FeatureOverride[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  transitionedAt?: Date; // UTC datetime when subscription was transitioned to a new plan
}

export class Subscription extends Entity<SubscriptionProps> {
  get key(): string {
    return this.props.key;
  }

  get customerId(): number {
    return this.props.customerId;
  }

  get planId(): number {
    return this.props.planId;
  }

  get status(): SubscriptionStatus {
    return this.props.status;
  }

  activate(): void {
    this.props.activationDate = this.props.activationDate || new Date();
    this.props.trialEndDate = undefined; // Clear trial end date when activating
    this.props.updatedAt = now();
  }

  cancel(): void {
    if (this.status === SubscriptionStatus.Cancelled) {
      throw new DomainError('Subscription is already cancelled. Current status: ' + this.status);
    }
    this.props.cancellationDate = now();
    this.props.updatedAt = now();
  }

  renew(): void {
    // Clear temporary overrides on renewal
    this.clearTemporaryOverrides();
    this.props.updatedAt = now();
  }

  expire(): void {
    this.props.expirationDate = now();
    this.props.updatedAt = now();
  }

  archive(): void {
    // Archive does not change any properties - just sets the archive flag
    this.props.isArchived = true;
    this.props.updatedAt = now();
  }

  markAsTransitioned(): void {
    // Mark subscription as transitioned - archives it and sets transitioned_at timestamp
    this.props.isArchived = true;
    this.props.transitionedAt = now();
    this.props.updatedAt = now();
  }

  unarchive(): void {
    // Unarchive just clears the archive flag
    this.props.isArchived = false;
    this.props.updatedAt = now();
  }

  get isArchived(): boolean {
    return this.props.isArchived;
  }

  setExpirationDate(date: Date): void {
    this.props.expirationDate = date;
    this.props.updatedAt = now();
  }

  setActivationDate(date: Date): void {
    this.props.activationDate = date;
    this.props.updatedAt = now();
  }

  setTrialEndDate(date: Date | null): void {
    this.props.trialEndDate = date ?? undefined;
    this.props.updatedAt = now();
  }

  setCurrentPeriod(start: Date, end: Date): void {
    this.props.currentPeriodStart = start;
    this.props.currentPeriodEnd = end;
    this.props.updatedAt = now();
  }

  addFeatureOverride(featureId: number, value: string, type: OverrideType): void {
    // Remove existing override if present
    this.removeFeatureOverride(featureId);
    
    this.props.featureOverrides.push({
      featureId,
      value,
      type,
      createdAt: now()
    });
    this.props.updatedAt = now();
  }

  removeFeatureOverride(featureId: number): void {
    this.props.featureOverrides = this.props.featureOverrides.filter(
      o => o.featureId !== featureId
    );
    this.props.updatedAt = now();
  }

  getFeatureOverride(featureId: number): FeatureOverride | null {
    return this.props.featureOverrides.find(o => o.featureId === featureId) || null;
  }

  clearTemporaryOverrides(): void {
    this.props.featureOverrides = this.props.featureOverrides.filter(
      o => o.type === OverrideType.Permanent
    );
    this.props.updatedAt = now();
  }

  // No deletion constraint - subscriptions can be deleted regardless of status
  canDelete(): boolean {
    return true;
  }

}


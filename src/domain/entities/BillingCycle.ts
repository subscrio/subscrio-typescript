import { Entity } from '../base/Entity.js';
import { DurationUnit } from '../value-objects/DurationUnit.js';
import { BillingCycleStatus } from '../value-objects/BillingCycleStatus.js';
import { now } from '../../infrastructure/utils/date.js';

export interface BillingCycleProps {
  planId: number;
  key: string;
  displayName: string;
  description?: string;
  status: BillingCycleStatus;
  durationValue?: number; // Optional for forever duration
  durationUnit: DurationUnit;
  externalProductId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class BillingCycle extends Entity<BillingCycleProps> {
  get planId(): number {
    return this.props.planId;
  }

  get key(): string {
    return this.props.key;
  }

  get displayName(): string {
    return this.props.displayName;
  }

  get status(): BillingCycleStatus {
    return this.props.status;
  }

  calculateNextPeriodEnd(startDate: Date): Date | null {
    // For forever duration, return null (never expires)
    if (this.props.durationUnit === DurationUnit.Forever) {
      return null;
    }
    
    const nextDate = new Date(startDate);
    const durationValue = this.props.durationValue ?? 1; // Default to 1 if not specified
    
    switch (this.props.durationUnit) {
      case DurationUnit.Days:
        nextDate.setDate(nextDate.getDate() + durationValue);
        break;
      case DurationUnit.Weeks:
        nextDate.setDate(nextDate.getDate() + (durationValue * 7));
        break;
      case DurationUnit.Months:
        nextDate.setMonth(nextDate.getMonth() + durationValue);
        break;
      case DurationUnit.Years:
        nextDate.setFullYear(nextDate.getFullYear() + durationValue);
        break;
    }
    
    return nextDate;
  }

  archive(): void {
    this.props.status = BillingCycleStatus.Archived;
    this.props.updatedAt = now();
  }

  unarchive(): void {
    this.props.status = BillingCycleStatus.Active;
    this.props.updatedAt = now();
  }

  canDelete(): boolean {
    return this.props.status === BillingCycleStatus.Archived;
  }
}


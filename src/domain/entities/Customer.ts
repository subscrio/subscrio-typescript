import { Entity } from '../base/Entity.js';
import { CustomerStatus } from '../value-objects/CustomerStatus.js';
import { now } from '../../infrastructure/utils/date.js';

export interface CustomerProps {
  key: string;
  displayName?: string;
  email?: string;
  externalBillingId?: string;
  status: CustomerStatus;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class Customer extends Entity<CustomerProps> {
  get key(): string {
    return this.props.key;
  }

  get status(): CustomerStatus {
    return this.props.status;
  }

  get externalBillingId(): string | undefined {
    return this.props.externalBillingId;
  }

  setExternalBillingId(externalBillingId: string | undefined): void {
    this.props.externalBillingId = externalBillingId;
    this.props.updatedAt = now();
  }

  archive(): void {
    this.props.status = CustomerStatus.Archived;
    this.props.updatedAt = now();
  }

  unarchive(): void {
    this.props.status = CustomerStatus.Active;
    this.props.updatedAt = now();
  }

  canDelete(): boolean {
    return this.props.status === CustomerStatus.Archived;
  }
}


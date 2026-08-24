import { Entity } from '../base/Entity.js';
import { now } from '../../infrastructure/utils/date.js';

export interface SystemConfigProps {
  configKey: string;
  configValue: string;
  encrypted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class SystemConfig extends Entity<SystemConfigProps> {
  get configKey(): string {
    return this.props.configKey;
  }

  get configValue(): string {
    return this.props.configValue;
  }

  get encrypted(): boolean {
    return this.props.encrypted;
  }

  updateValue(value: string): void {
    this.props.configValue = value;
    this.props.updatedAt = now();
  }
}


import { BillingCycle } from '../../domain/entities/BillingCycle.js';
import { BillingCycleFilterDto } from '../dtos/BillingCycleDto.js';

export interface IBillingCycleRepository {
  save(billingCycle: BillingCycle): Promise<BillingCycle>;
  findById(id: number): Promise<BillingCycle | null>;
  findByKey(key: string): Promise<BillingCycle | null>;
  findByPlan(planId: number): Promise<BillingCycle[]>;
  findAll(filters?: BillingCycleFilterDto): Promise<BillingCycle[]>;
  delete(id: number): Promise<void>;
  exists(id: number): Promise<boolean>;
}


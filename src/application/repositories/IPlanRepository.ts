import { Plan } from '../../domain/entities/Plan.js';
import { PlanFilterDto } from '../dtos/PlanDto.js';

export interface IPlanRepository {
  save(plan: Plan): Promise<Plan>;
  findById(id: number): Promise<Plan | null>;
  findByKey(key: string): Promise<Plan | null>;
  findByProduct(productKey: string): Promise<Plan[]>; // Uses productKey - joins to resolve
  findByBillingCycleId(billingCycleId: number): Promise<Plan | null>;
  findAll(filters?: PlanFilterDto): Promise<Plan[]>;
  findByIds(ids: number[]): Promise<Plan[]>;
  delete(id: number): Promise<void>;
  exists(id: number): Promise<boolean>;
  
  // Foreign key checks
  hasBillingCycles(planId: number): Promise<boolean>;
  hasPlanTransitionReferences(billingCycleKey: string): Promise<boolean>;
}


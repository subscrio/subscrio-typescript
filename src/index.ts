// Main class
export { Subscrio } from './Subscrio.js';

// Configuration
export type { SubscrioConfig, InitialConfigSync } from './config/types.js';
export { loadConfig } from './config/loader.js';

// DTOs
export * from './application/dtos/ProductDto.js';
export * from './application/dtos/FeatureDto.js';
export * from './application/dtos/PlanDto.js';
export * from './application/dtos/CustomerDto.js';
export * from './application/dtos/SubscriptionDto.js';
export * from './application/dtos/BillingCycleDto.js';
export * from './application/dtos/ConfigSyncDto.js';

// Errors
export * from './application/errors/index.js';

// Value objects (for type safety)
export { ProductStatus } from './domain/value-objects/ProductStatus.js';
export { FeatureStatus } from './domain/value-objects/FeatureStatus.js';
export { FeatureValueType } from './domain/value-objects/FeatureValueType.js';
export { PlanStatus } from './domain/value-objects/PlanStatus.js';
export { BillingCycleStatus } from './domain/value-objects/BillingCycleStatus.js';
export { CustomerStatus } from './domain/value-objects/CustomerStatus.js';
export { SubscriptionStatus } from './domain/value-objects/SubscriptionStatus.js';
export { OverrideType } from './domain/value-objects/OverrideType.js';
export { DurationUnit } from './domain/value-objects/DurationUnit.js';

// Utilities
export { FeatureValueValidator } from './application/utils/FeatureValueValidator.js';
export { convertFeatureValue } from './application/utils/convertFeatureValue.js';
export { now, nowISO, fromISOString, addDays, addMonths, addYears, isPast, isFuture, isToday, formatDate, formatDateTime } from './infrastructure/utils/date.js';

// Domain entities
export * from './domain/entities/Product.js';
export * from './domain/entities/Feature.js';
export * from './domain/entities/Plan.js';
export * from './domain/entities/Customer.js';
export * from './domain/entities/Subscription.js';
export * from './domain/entities/BillingCycle.js';
export * from './domain/entities/SystemConfig.js';

// Repository interfaces
export * from './application/repositories/IProductRepository.js';
export * from './application/repositories/IFeatureRepository.js';
export * from './application/repositories/IPlanRepository.js';
export * from './application/repositories/ICustomerRepository.js';
export * from './application/repositories/ISubscriptionRepository.js';
export * from './application/repositories/IBillingCycleRepository.js';

// Constants
export * from './application/constants/index.js';

// Hooks
export { HookDispatcher } from './application/hooks/HookDispatcher.js';
export {
  HookEvents,
  type HookSource,
  type HookPhase,
  type HookEventName,
  type HookHandler,
  type HooksConfig,
  type EntityMutationHookEvent,
  type CustomerMutationHookEvent,
  type SubscriptionMutationHookEvent,
  type StripeReceivedHookEvent,
  type HookEventMap,
} from './application/hooks/types.js';


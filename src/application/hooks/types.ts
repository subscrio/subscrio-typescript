import type { CustomerDto } from "../dtos/CustomerDto.js";
import type { SubscriptionDto } from "../dtos/SubscriptionDto.js";
import type Stripe from "stripe";

export type HookSource = "api" | "stripe" | "system";
export type HookPhase = "before" | "after";

export const HookEvents = {
  SubscriptionAddonAttachedBefore: "subscription.addonAttached.before",
  SubscriptionAddonAttachedAfter: "subscription.addonAttached.after",
  SubscriptionAddonDetachedBefore: "subscription.addonDetached.before",
  SubscriptionAddonDetachedAfter: "subscription.addonDetached.after",
  UsageReportedBefore: "usage.reported.before",
  UsageReportedAfter: "usage.reported.after",
  CreditConsumedBefore: "credit.consumed.before",
  CreditConsumedAfter: "credit.consumed.after",
  CreditGrantedBefore: "credit.granted.before",
  CreditGrantedAfter: "credit.granted.after",
  CreditAdjustedBefore: "credit.adjusted.before",
  CreditAdjustedAfter: "credit.adjusted.after",
  CustomerCreatedBefore: "customer.created.before",
  CustomerCreatedAfter: "customer.created.after",
  CustomerUpdatedBefore: "customer.updated.before",
  CustomerUpdatedAfter: "customer.updated.after",
  CustomerArchivedBefore: "customer.archived.before",
  CustomerArchivedAfter: "customer.archived.after",
  CustomerUnarchivedBefore: "customer.unarchived.before",
  CustomerUnarchivedAfter: "customer.unarchived.after",
  CustomerDeletedBefore: "customer.deleted.before",
  CustomerDeletedAfter: "customer.deleted.after",
  SubscriptionCreatedBefore: "subscription.created.before",
  SubscriptionCreatedAfter: "subscription.created.after",
  SubscriptionUpdatedBefore: "subscription.updated.before",
  SubscriptionUpdatedAfter: "subscription.updated.after",
  SubscriptionArchivedBefore: "subscription.archived.before",
  SubscriptionArchivedAfter: "subscription.archived.after",
  SubscriptionUnarchivedBefore: "subscription.unarchived.before",
  SubscriptionUnarchivedAfter: "subscription.unarchived.after",
  SubscriptionDeletedBefore: "subscription.deleted.before",
  SubscriptionDeletedAfter: "subscription.deleted.after",
  SubscriptionFeatureOverrideAddedBefore:
    "subscription.featureOverrideAdded.before",
  SubscriptionFeatureOverrideAddedAfter:
    "subscription.featureOverrideAdded.after",
  SubscriptionFeatureOverrideRemovedBefore:
    "subscription.featureOverrideRemoved.before",
  SubscriptionFeatureOverrideRemovedAfter:
    "subscription.featureOverrideRemoved.after",
  SubscriptionTemporaryOverridesClearedBefore:
    "subscription.temporaryOverridesCleared.before",
  SubscriptionTemporaryOverridesClearedAfter:
    "subscription.temporaryOverridesCleared.after",
  StripeReceivedBefore: "stripe.received.before",
  StripeReceivedAfter: "stripe.received.after",
} as const;

export type HookEventName = (typeof HookEvents)[keyof typeof HookEvents];

export interface EntityMutationHookEvent<T> {
  type: HookEventName;
  phase: HookPhase;
  source: HookSource;
  occurredAt: string;
  /** Numeric PK when known; null on before-create; set on after-* and before-update/delete */
  entityId: number | null;
  /** For subscription events: customer PK when known */
  customerId?: number | null;
  old: T | null;
  /** before: mutable proposed DTO; after: immutable clone of persisted DTO */
  new: T | null;
}

export interface CustomerMutationHookEvent extends EntityMutationHookEvent<CustomerDto> {}

export interface SubscriptionMutationHookEvent extends EntityMutationHookEvent<SubscriptionDto> {
  featureKey?: string;
  value?: string;
  overrideType?: string;
  expiresAt?: string | null;
}

export interface StripeReceivedHookEvent {
  type:
    | typeof HookEvents.StripeReceivedBefore
    | typeof HookEvents.StripeReceivedAfter;
  phase: HookPhase;
  occurredAt: string;
  data: Stripe.Event;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export interface AccountingMutationHookEvent {
  type: HookEventName;
  phase: HookPhase;
  source: HookSource;
  occurredAt: string;
  input: Record<string, unknown>;
  result?: unknown;
}

export type HookEventMap = {
  [HookEvents.SubscriptionAddonAttachedBefore]: AccountingMutationHookEvent;
  [HookEvents.SubscriptionAddonAttachedAfter]: AccountingMutationHookEvent;
  [HookEvents.SubscriptionAddonDetachedBefore]: AccountingMutationHookEvent;
  [HookEvents.SubscriptionAddonDetachedAfter]: AccountingMutationHookEvent;
  [HookEvents.UsageReportedBefore]: AccountingMutationHookEvent;
  [HookEvents.UsageReportedAfter]: AccountingMutationHookEvent;
  [HookEvents.CreditConsumedBefore]: AccountingMutationHookEvent;
  [HookEvents.CreditConsumedAfter]: AccountingMutationHookEvent;
  [HookEvents.CreditGrantedBefore]: AccountingMutationHookEvent;
  [HookEvents.CreditGrantedAfter]: AccountingMutationHookEvent;
  [HookEvents.CreditAdjustedBefore]: AccountingMutationHookEvent;
  [HookEvents.CreditAdjustedAfter]: AccountingMutationHookEvent;
  [HookEvents.CustomerCreatedBefore]: CustomerMutationHookEvent;
  [HookEvents.CustomerCreatedAfter]: CustomerMutationHookEvent;
  [HookEvents.CustomerUpdatedBefore]: CustomerMutationHookEvent;
  [HookEvents.CustomerUpdatedAfter]: CustomerMutationHookEvent;
  [HookEvents.CustomerArchivedBefore]: CustomerMutationHookEvent;
  [HookEvents.CustomerArchivedAfter]: CustomerMutationHookEvent;
  [HookEvents.CustomerUnarchivedBefore]: CustomerMutationHookEvent;
  [HookEvents.CustomerUnarchivedAfter]: CustomerMutationHookEvent;
  [HookEvents.CustomerDeletedBefore]: CustomerMutationHookEvent;
  [HookEvents.CustomerDeletedAfter]: CustomerMutationHookEvent;
  [HookEvents.SubscriptionCreatedBefore]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionCreatedAfter]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionUpdatedBefore]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionUpdatedAfter]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionArchivedBefore]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionArchivedAfter]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionUnarchivedBefore]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionUnarchivedAfter]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionDeletedBefore]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionDeletedAfter]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionFeatureOverrideAddedBefore]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionFeatureOverrideAddedAfter]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionFeatureOverrideRemovedBefore]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionFeatureOverrideRemovedAfter]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionTemporaryOverridesClearedBefore]: SubscriptionMutationHookEvent;
  [HookEvents.SubscriptionTemporaryOverridesClearedAfter]: SubscriptionMutationHookEvent;
  [HookEvents.StripeReceivedBefore]: StripeReceivedHookEvent;
  [HookEvents.StripeReceivedAfter]: StripeReceivedHookEvent;
};

export type HookHandler<E extends HookEventName> = (
  event: HookEventMap[E],
) => void | Promise<void>;

export type HooksConfig = {
  [E in HookEventName]?: HookHandler<E> | Array<HookHandler<E>>;
};

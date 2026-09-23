export interface CreditCurrencyDto {
  key: string;
  displayName: string;
  status: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanCreditGrantInput {
  amount: number;
  cadence: "once" | "monthly" | "yearly" | "billing_period";
  expiryPolicy?: "none" | "grant_period_end";
  cancellationPolicy?: "retain" | "expire";
}

export interface CreditActionDto {
  customerKey: string;
  featureKey: string;
  units: number;
}

export interface CreditCostDto {
  currencyKey: string;
  cost: number;
  available: number;
}

export interface CreditCheckDto {
  hasAccess: boolean;
  costs: CreditCostDto[];
  accessDeniedReason?: "insufficient_credits" | "currency_inactive";
}

export interface CreditGrantInput {
  customerKey: string;
  currencyKey: string;
  amount: number;
  grantType: "manual" | "promotional" | "prepaid";
  priority?: number;
  expiresAt?: Date | string;
  subscriptionKey?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface CreditConsumeInput extends CreditActionDto {
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface CreditAdjustInput {
  customerKey: string;
  currencyKey: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
}

export interface CreditAllocationDto {
  currencyKey: string;
  grantId: string;
  amount: number;
}

export interface CreditConsumeDto {
  operationId: string;
  idempotencyKey: string;
  allocations: CreditAllocationDto[];
  balances: Array<{ currencyKey: string; available: number }>;
}

export interface CreditGrantDto {
  id: string;
  currencyKey: string;
  subscriptionKey?: string | null;
  grantType: string;
  originalAmount: number;
  remainingAmount: number;
  priority: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditBalanceDto {
  currencyKey: string;
  available: number;
  grants: CreditGrantDto[];
}

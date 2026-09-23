import { z } from "zod";
import type { PageFilter } from "./PaginationDto.js";
export const MeteredConfigSchema = z
  .object({
    resetPeriod: z.enum([
      "hourly",
      "daily",
      "weekly",
      "monthly",
      "yearly",
      "billing_period",
    ]),
    enforcement: z.enum(["hard", "soft"]),
    aggregation: z.enum(["count", "sum"]),
    usageScope: z.enum(["customer", "subscription"]),
  })
  .refine(
    (c) =>
      c.resetPeriod !== "billing_period" || c.usageScope === "subscription",
    "Billing period requires subscription scope",
  );

export type MeteredFeatureConfigDto = z.infer<typeof MeteredConfigSchema>;

export interface UsageOptions {
  subscriptionKey?: string;
  requestedUsage?: number;
}

export interface UsageReportOptions {
  idempotencyKey: string;
  subscriptionKey?: string;
  metadata?: Record<string, unknown>;
}

export interface UsageDto {
  hasAccess: boolean;
  limit: number;
  consumed: number;
  remaining: number;
  requestedUsage: number;
  projectedConsumed: number;
  isOverage: boolean;
  enforcement: "hard" | "soft";
  usageScope: "customer" | "subscription";
  subscriptionKey?: string;
  periodStart: string;
  periodEnd: string;
  accessDeniedReason?: "limit_exceeded" | "no_active_subscription";
}

export interface UsageReportDto {
  eventId: string;
  idempotencyKey: string;
  quantity: number;
  recordedAt: string;
  usage: UsageDto;
}

export interface UsageHistoryFilter extends PageFilter {
  subscriptionKey?: string;
  from?: string;
  to?: string;
}

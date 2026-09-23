import { z } from "zod";
const amount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const CreditCurrencyConfigSchema = z.object({
  key: z.string().min(1),
  displayName: z.string().min(1),
  archived: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export const CreditRuleConfigSchema = z.object({
  currencyKey: z.string().min(1),
  creditsPerUnit: amount,
});
export const PlanGrantConfigSchema = z.object({
  currencyKey: z.string().min(1),
  amount,
  cadence: z.enum(["once", "monthly", "yearly", "billing_period"]),
  expiryPolicy: z.enum(["none", "grant_period_end"]).optional(),
  cancellationPolicy: z.enum(["retain", "expire"]).optional(),
});
export const AddonConfigSchema = z.object({
  key: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  compositionMode: z.enum(["additive", "override"]).optional(),
  priority: z.number().int().optional(),
  archived: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  featureValues: z.record(z.string(), z.string()).optional(),
});
export const FeatureResolutionConfigSchema = z.object({
  addonRule: z.enum(["additive", "most_generous", "override_wins"]).optional(),
  subscriptionRule: z
    .enum(["additive", "most_generous", "override_wins"])
    .nullable()
    .optional(),
});
export const SubscriptionOverrideConfigSchema = z.object({
  key: z.string().min(1),
  featureOverrides: z.array(
    z.union([
      z
        .object({ featureKey: z.string().min(1), remove: z.literal(true) })
        .strict(),
      z
        .object({
          featureKey: z.string().min(1),
          value: z.string(),
          type: z.enum(["permanent", "temporary", "timed"]),
          expiresAt: z
            .string()
            .datetime({ offset: true })
            .nullable()
            .optional(),
          remove: z.literal(false).optional(),
        })
        .strict(),
    ]),
  ),
});

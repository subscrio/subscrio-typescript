export type FeatureValueRule = "additive" | "most_generous" | "override_wins";

export interface FeatureResolutionOptions {
  addonRule?: FeatureValueRule;
  subscriptionRule?: FeatureValueRule | null;
}

export interface FeatureValueSourceDto {
  kind: "override" | "plan" | "addon" | "default";
  key: string;
  value: string;
  quantity?: number;
  expiresAt?: string | null;
  applied: boolean;
  reason?: string;
}

export interface FeatureValueExplanationDto {
  evaluatedAt: string;
  effectiveValue: string;
  resolution: FeatureResolutionOptions;
  subscriptions: Array<{
    subscriptionKey: string;
    value: string;
    sources: FeatureValueSourceDto[];
  }>;
}

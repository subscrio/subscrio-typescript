export interface CreateAddonDto {
  featureValues?: Record<string, string>;
  key: string;
  productKey: string;
  displayName: string;
  description?: string;
  compositionMode?: "additive" | "override";
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateAddonDto extends Partial<
  Omit<CreateAddonDto, "key" | "productKey" | "featureValues">
> {
  featureValues?: Record<string, string | null>;
}

export interface AddonDto extends CreateAddonDto {
  featureValues: Record<string, string>;
  status: "active" | "archived";
  compositionMode: "additive" | "override";
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionAddonDto {
  addon: AddonDto;
  subscriptionKey: string;
  addonKey: string;
  quantity: number;
  status: "active" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

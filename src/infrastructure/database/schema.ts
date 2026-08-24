import { pgSchema, text, integer, timestamp, jsonb, boolean, unique, bigserial, bigint } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const subscrioSchema = pgSchema('subscrio');

export const products = subscrioSchema.table('products', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  key: text('key').notNull().unique(),
  display_name: text('display_name').notNull(),
  description: text('description'),
  status: text('status').notNull(),
  metadata: jsonb('metadata'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow()
});

export const features = subscrioSchema.table('features', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  key: text('key').notNull().unique(),
  display_name: text('display_name').notNull(),
  description: text('description'),
  value_type: text('value_type').notNull(),
  default_value: text('default_value').notNull(),
  group_name: text('group_name'),
  status: text('status').notNull(),
  validator: jsonb('validator'),
  metadata: jsonb('metadata'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow()
});

export const product_features = subscrioSchema.table('product_features', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  product_id: bigint('product_id', { mode: 'number' }).notNull().references(() => products.id, { onDelete: 'cascade' }),
  feature_id: bigint('feature_id', { mode: 'number' }).notNull().references(() => features.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at').notNull().defaultNow()
}, (table) => ({
  uniqueProductFeature: unique().on(table.product_id, table.feature_id)
}));

export const plans = subscrioSchema.table('plans', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  product_id: bigint('product_id', { mode: 'number' }).notNull().references(() => products.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  display_name: text('display_name').notNull(),
  description: text('description'),
  status: text('status').notNull(),
  // Note: on_expire_transition_to_billing_cycle_id FK is added manually in installer.ts to handle circular dependency
  on_expire_transition_to_billing_cycle_id: bigint('on_expire_transition_to_billing_cycle_id', { mode: 'number' }),
  metadata: jsonb('metadata'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow()
}, (table) => ({
  uniqueProductKey: unique().on(table.product_id, table.key)
}));

export const plan_features = subscrioSchema.table('plan_features', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  plan_id: bigint('plan_id', { mode: 'number' }).notNull().references(() => plans.id, { onDelete: 'cascade' }),
  feature_id: bigint('feature_id', { mode: 'number' }).notNull().references(() => features.id, { onDelete: 'cascade' }),
  value: text('value').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow()
}, (table) => ({
  uniquePlanFeature: unique().on(table.plan_id, table.feature_id)
}));


export const customers = subscrioSchema.table('customers', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  key: text('key').notNull().unique(),
  display_name: text('display_name'),
  email: text('email'),
  external_billing_id: text('external_billing_id').unique(),
  status: text('status').notNull(),
  metadata: jsonb('metadata'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow()
});

export const subscriptions = subscrioSchema.table('subscriptions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  key: text('key').notNull().unique(),  // External reference key
  customer_id: bigint('customer_id', { mode: 'number' }).notNull().references(() => customers.id, { onDelete: 'cascade' }),
  plan_id: bigint('plan_id', { mode: 'number' }).notNull().references(() => plans.id, { onDelete: 'cascade' }),
  billing_cycle_id: bigint('billing_cycle_id', { mode: 'number' }).notNull().references(() => billing_cycles.id, { onDelete: 'cascade' }),
  activation_date: timestamp('activation_date', { withTimezone: true }),
  expiration_date: timestamp('expiration_date', { withTimezone: true }),
  cancellation_date: timestamp('cancellation_date', { withTimezone: true }),
  trial_end_date: timestamp('trial_end_date', { withTimezone: true }),
  current_period_start: timestamp('current_period_start', { withTimezone: true }),
  current_period_end: timestamp('current_period_end', { withTimezone: true }),
  stripe_subscription_id: text('stripe_subscription_id').unique(),
  metadata: jsonb('metadata'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  is_archived: boolean('is_archived').notNull().default(false),
  transitioned_at: timestamp('transitioned_at', { withTimezone: true })
});

export const subscriptionStatusView = subscrioSchema.view('subscription_status_view').as((qb) =>
  qb
    .select({
      id: subscriptions.id,
      key: subscriptions.key,
      customer_id: subscriptions.customer_id,
      plan_id: subscriptions.plan_id,
      billing_cycle_id: subscriptions.billing_cycle_id,
      activation_date: subscriptions.activation_date,
      expiration_date: subscriptions.expiration_date,
      cancellation_date: subscriptions.cancellation_date,
      trial_end_date: subscriptions.trial_end_date,
      current_period_start: subscriptions.current_period_start,
      current_period_end: subscriptions.current_period_end,
      stripe_subscription_id: subscriptions.stripe_subscription_id,
      metadata: subscriptions.metadata,
      created_at: subscriptions.created_at,
      updated_at: subscriptions.updated_at,
      is_archived: subscriptions.is_archived,
      transitioned_at: subscriptions.transitioned_at,
      computed_status: sql<string>`
        CASE
          WHEN ${subscriptions.cancellation_date} IS NOT NULL AND ${subscriptions.cancellation_date} > NOW() THEN 'cancellation_pending'
          WHEN ${subscriptions.cancellation_date} IS NOT NULL AND ${subscriptions.cancellation_date} <= NOW() THEN 'cancelled'
          WHEN ${subscriptions.expiration_date} IS NOT NULL AND ${subscriptions.expiration_date} <= NOW() THEN 'expired'
          WHEN ${subscriptions.activation_date} IS NOT NULL AND ${subscriptions.activation_date} > NOW() THEN 'pending'
          WHEN ${subscriptions.trial_end_date} IS NOT NULL AND ${subscriptions.trial_end_date} > NOW() THEN 'trial'
          ELSE 'active'
        END
      `.as('computed_status')
    })
    .from(subscriptions)
);

export const subscription_feature_overrides = subscrioSchema.table('subscription_feature_overrides', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  subscription_id: bigint('subscription_id', { mode: 'number' }).notNull().references(() => subscriptions.id, { onDelete: 'cascade' }),
  feature_id: bigint('feature_id', { mode: 'number' }).notNull().references(() => features.id, { onDelete: 'cascade' }),
  value: text('value').notNull(),
  override_type: text('override_type').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow()
}, (table) => ({
  uniqueSubscriptionFeature: unique().on(table.subscription_id, table.feature_id)
}));

export const billing_cycles = subscrioSchema.table('billing_cycles', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  plan_id: bigint('plan_id', { mode: 'number' }).notNull().references(() => plans.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  display_name: text('display_name').notNull(),
  description: text('description'),
  status: text('status').notNull(),
  duration_value: integer('duration_value'),
  duration_unit: text('duration_unit').notNull(),
  external_product_id: text('external_product_id'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow()
}, (table) => ({
  uniquePlanKey: unique().on(table.plan_id, table.key)
}));

export const system_config = subscrioSchema.table('system_config', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  config_key: text('config_key').notNull().unique(),
  config_value: text('config_value').notNull(),
  encrypted: boolean('encrypted').notNull().default(false),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow()
});


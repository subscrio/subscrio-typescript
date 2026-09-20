import { ISubscriptionRepository } from '../repositories/ISubscriptionRepository.js';
import { ICustomerRepository } from '../repositories/ICustomerRepository.js';
import { IPlanRepository } from '../repositories/IPlanRepository.js';
import { IBillingCycleRepository } from '../repositories/IBillingCycleRepository.js';
import { Subscription } from '../../domain/entities/Subscription.js';
import { BillingCycle } from '../../domain/entities/BillingCycle.js';
import { Plan } from '../../domain/entities/Plan.js';
import { Customer } from '../../domain/entities/Customer.js';
import { generateKey } from '../../infrastructure/utils/uuid.js';
import Stripe from 'stripe';
import { NotFoundError, ValidationError, ConfigurationError, ConflictError } from '../errors/index.js';
import { SubscriptionStatus } from '../../domain/value-objects/SubscriptionStatus.js';
import { now } from '../../infrastructure/utils/date.js';
import { HookDispatcher } from '../hooks/HookDispatcher.js';
import { HookEvents, type CustomerMutationHookEvent, type SubscriptionMutationHookEvent } from '../hooks/types.js';
import { cloneJson } from '../hooks/cloneJson.js';
import { applyCustomerDtoMutation } from '../hooks/applyCustomerDtoMutation.js';
import { applySubscriptionDtoMutation } from '../hooks/applySubscriptionDtoMutation.js';
import { compactDefined, revalidateAfterHook } from '../utils/ValidationGuard.js';
import { CreateCustomerDtoSchema, UpdateCustomerDtoSchema } from '../dtos/CustomerDto.js';
import { CreateSubscriptionDtoSchema, UpdateSubscriptionDtoSchema } from '../dtos/SubscriptionDto.js';
import { CustomerMapper } from '../mappers/CustomerMapper.js';
import { SubscriptionMapper } from '../mappers/SubscriptionMapper.js';
import type { CustomerDto } from '../dtos/CustomerDto.js';
import type { SubscriptionDto } from '../dtos/SubscriptionDto.js';

const SUBSCRIO_CUSTOMER_KEY_METADATA_KEYS = ['subscrioCustomerKey', 'subscrio_customer_key'];
const SUBSCRIO_SUBSCRIPTION_KEY_METADATA_KEYS = ['subscrioSubscriptionKey', 'subscrio_subscription_key'];

export class StripeIntegrationService {
  constructor(
    private readonly subscriptionRepository: ISubscriptionRepository,
    private readonly customerRepository: ICustomerRepository,
    private readonly planRepository: IPlanRepository,
    private readonly billingCycleRepository: IBillingCycleRepository,
    private readonly config?: { stripe?: { secretKey?: string; webhookSecret?: string } },
    private readonly hooks: HookDispatcher = new HookDispatcher()
  ) {}

  private async emitCustomerBefore(
    type: CustomerMutationHookEvent['type'],
    customer: Customer,
    oldDto: CustomerDto | null,
    newDto: CustomerDto | null
  ): Promise<CustomerDto | null> {
    if (!this.hooks.hasListeners(type)) return newDto;
    const payload: CustomerMutationHookEvent = {
      type,
      phase: 'before',
      source: 'stripe',
      occurredAt: new Date().toISOString(),
      entityId: customer.id ?? null,
      old: oldDto ? cloneJson(oldDto) : null,
      new: newDto ? cloneJson(newDto) : null,
    };
    await this.hooks.emit(type, payload);
    return payload.new;
  }

  private async emitCustomerAfter(
    type: CustomerMutationHookEvent['type'],
    customer: Customer,
    oldDto: CustomerDto | null,
    newDto: CustomerDto | null
  ): Promise<void> {
    if (!this.hooks.hasListeners(type)) return;
    await this.hooks.emit(type, {
      type,
      phase: 'after',
      source: 'stripe',
      occurredAt: new Date().toISOString(),
      entityId: customer.id ?? null,
      old: oldDto ? cloneJson(oldDto) : null,
      new: newDto ? cloneJson(newDto) : null,
    });
  }

  private async toSubscriptionDto(subscription: Subscription): Promise<SubscriptionDto> {
    const customer = await this.customerRepository.findById(subscription.customerId);
    const plan = await this.planRepository.findById(subscription.planId);
    const cycle = await this.billingCycleRepository.findById(subscription.props.billingCycleId);
    if (!customer || !plan || !cycle) {
      throw new NotFoundError(
        `Unable to resolve keys for subscription '${subscription.key}' while emitting hooks.`
      );
    }
    return SubscriptionMapper.toDto(
      subscription,
      customer.key,
      plan.productKey,
      plan.key,
      cycle.key
    );
  }

  private async emitSubscriptionBefore(
    type: SubscriptionMutationHookEvent['type'],
    subscription: Subscription,
    oldDto: SubscriptionDto | null,
    newDto: SubscriptionDto | null
  ): Promise<SubscriptionDto | null> {
    if (!this.hooks.hasListeners(type)) return newDto;
    const payload: SubscriptionMutationHookEvent = {
      type,
      phase: 'before',
      source: 'stripe',
      occurredAt: new Date().toISOString(),
      entityId: subscription.id ?? null,
      customerId: subscription.customerId,
      old: oldDto ? cloneJson(oldDto) : null,
      new: newDto ? cloneJson(newDto) : null,
    };
    await this.hooks.emit(type, payload);
    return payload.new;
  }

  private async emitSubscriptionAfter(
    type: SubscriptionMutationHookEvent['type'],
    subscription: Subscription,
    oldDto: SubscriptionDto | null,
    newDto: SubscriptionDto | null
  ): Promise<void> {
    if (!this.hooks.hasListeners(type)) return;
    await this.hooks.emit(type, {
      type,
      phase: 'after',
      source: 'stripe',
      occurredAt: new Date().toISOString(),
      entityId: subscription.id ?? null,
      customerId: subscription.customerId,
      old: oldDto ? cloneJson(oldDto) : null,
      new: newDto ? cloneJson(newDto) : null,
    });
  }

  private async saveSubscriptionWithHooks(
    beforeType: typeof HookEvents.SubscriptionCreatedBefore | typeof HookEvents.SubscriptionUpdatedBefore,
    afterType: typeof HookEvents.SubscriptionCreatedAfter | typeof HookEvents.SubscriptionUpdatedAfter,
    subscription: Subscription,
    oldDto: SubscriptionDto | null
  ): Promise<Subscription> {
    let newDto = await this.toSubscriptionDto(subscription);
    newDto = (await this.emitSubscriptionBefore(beforeType, subscription, oldDto, newDto)) ?? newDto;
    if (newDto) {
      const isCreate = beforeType === HookEvents.SubscriptionCreatedBefore;
      revalidateAfterHook(
        isCreate ? CreateSubscriptionDtoSchema : UpdateSubscriptionDtoSchema,
        compactDefined(
          isCreate
            ? {
                key: newDto.key,
                customerKey: newDto.customerKey,
                billingCycleKey: newDto.billingCycleKey,
                activationDate: newDto.activationDate,
                expirationDate: newDto.expirationDate,
                cancellationDate: newDto.cancellationDate,
                trialEndDate: newDto.trialEndDate,
                currentPeriodStart: newDto.currentPeriodStart,
                currentPeriodEnd: newDto.currentPeriodEnd,
                stripeSubscriptionId: newDto.stripeSubscriptionId,
                metadata: newDto.metadata,
              }
            : {
                billingCycleKey: newDto.billingCycleKey,
                expirationDate: newDto.expirationDate,
                cancellationDate: newDto.cancellationDate,
                trialEndDate: newDto.trialEndDate,
                currentPeriodStart: newDto.currentPeriodStart,
                currentPeriodEnd: newDto.currentPeriodEnd,
                stripeSubscriptionId: newDto.stripeSubscriptionId,
                metadata: newDto.metadata,
              }
        ),
        isCreate ? 'subscription data' : 'subscription update'
      );
      applySubscriptionDtoMutation(subscription, newDto, {
        allowKeyChange: isCreate,
      });
    }
    const saved = await this.subscriptionRepository.save(subscription);
    await this.emitSubscriptionAfter(afterType, saved, oldDto, await this.toSubscriptionDto(saved));
    return saved;
  }

  private async saveCustomerWithHooks(
    beforeType: typeof HookEvents.CustomerCreatedBefore | typeof HookEvents.CustomerUpdatedBefore,
    afterType: typeof HookEvents.CustomerCreatedAfter | typeof HookEvents.CustomerUpdatedAfter,
    customer: Customer,
    oldDto: CustomerDto | null
  ): Promise<Customer> {
    let newDto = CustomerMapper.toDto(customer);
    newDto = (await this.emitCustomerBefore(beforeType, customer, oldDto, newDto)) ?? newDto;
    if (newDto) {
      const isCreate = beforeType === HookEvents.CustomerCreatedBefore;
      revalidateAfterHook(
        isCreate ? CreateCustomerDtoSchema : UpdateCustomerDtoSchema,
        compactDefined(
          isCreate
            ? {
                key: newDto.key,
                displayName: newDto.displayName,
                email: newDto.email,
                externalBillingId: newDto.externalBillingId,
                metadata: newDto.metadata,
              }
            : {
                displayName: newDto.displayName,
                email: newDto.email,
                externalBillingId: newDto.externalBillingId,
                metadata: newDto.metadata,
              }
        ),
        isCreate ? 'customer data' : 'customer update'
      );
      applyCustomerDtoMutation(customer, newDto, {
        allowKeyChange: isCreate,
      });
    }
    const saved = await this.customerRepository.save(customer);
    await this.emitCustomerAfter(afterType, saved, oldDto, CustomerMapper.toDto(saved));
    return saved;
  }

  /**
   * Process a verified Stripe event
   * NOTE: Signature verification MUST be done by implementor before calling this
   */
  async processStripeEvent(event: Stripe.Event): Promise<void> {
    const stripeRefs = this.extractStripeEventRefs(event);
    if (this.hooks.hasListeners(HookEvents.StripeReceivedBefore)) {
      await this.hooks.emit(HookEvents.StripeReceivedBefore, {
        type: HookEvents.StripeReceivedBefore,
        phase: 'before',
        occurredAt: new Date().toISOString(),
        data: cloneJson(event),
        ...stripeRefs,
      });
    }

    const eventToProcess = cloneJson(event);

    switch (eventToProcess.type) {
      case 'customer.created':
      case 'customer.updated':
        await this.handleCustomerUpsert(eventToProcess.data.object as Stripe.Customer);
        break;

      case 'customer.deleted':
        await this.handleCustomerDeleted(eventToProcess.data.object as Stripe.Customer | Stripe.DeletedCustomer);
        break;

      case 'customer.subscription.created':
        await this.handleSubscriptionCreated(
          eventToProcess.data.object as Stripe.Subscription
        );
        break;

      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(
          eventToProcess.data.object as Stripe.Subscription
        );
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(
          eventToProcess.data.object as Stripe.Subscription
        );
        break;

      case 'invoice.payment_succeeded':
        await this.handlePaymentSucceeded(
          eventToProcess.data.object as Stripe.Invoice
        );
        break;

      default:
        break;
    }

    if (this.hooks.hasListeners(HookEvents.StripeReceivedAfter)) {
      await this.hooks.emit(HookEvents.StripeReceivedAfter, {
        type: HookEvents.StripeReceivedAfter,
        phase: 'after',
        occurredAt: new Date().toISOString(),
        data: cloneJson(event),
        ...stripeRefs,
      });
    }
  }

  private async handleSubscriptionCreated(
    stripeSubscription: Stripe.Subscription
  ): Promise<void> {
    const stripeCustomerId = this.extractCustomerId(stripeSubscription.customer);
    const customer = await this.resolveCustomer(
      stripeCustomerId,
      stripeSubscription.metadata
    );

    const { billingCycle, plan } = await this.resolvePlanFromSubscription(stripeSubscription);

    // First check if subscription already linked by Stripe ID
    const existingByStripeId = await this.subscriptionRepository.findByStripeId(stripeSubscription.id);
    if (existingByStripeId) {
      const oldDto = this.hooks.hasListeners(HookEvents.SubscriptionUpdatedBefore) || this.hooks.hasListeners(HookEvents.SubscriptionUpdatedAfter)
        ? await this.toSubscriptionDto(existingByStripeId)
        : null;
      this.applyStripeSubscriptionFields(
        existingByStripeId, 
        customer.id!, 
        plan.id!, 
        billingCycle.id!, 
        stripeSubscription,
        billingCycle.props.externalProductId!
      );
      await this.saveSubscriptionWithHooks(HookEvents.SubscriptionUpdatedBefore, HookEvents.SubscriptionUpdatedAfter, existingByStripeId, oldDto);
      return;
    }

    // Check metadata for existing subscription to link
    const existingByMetadata = await this.findSubscriptionByMetadata(
      stripeSubscription.metadata,
      customer.id!
    );

    if (existingByMetadata) {
      // Link existing subscription to Stripe
      const oldDto = this.hooks.hasListeners(HookEvents.SubscriptionUpdatedBefore) || this.hooks.hasListeners(HookEvents.SubscriptionUpdatedAfter)
        ? await this.toSubscriptionDto(existingByMetadata)
        : null;
      this.applyStripeSubscriptionFields(
        existingByMetadata, 
        customer.id!, 
        plan.id!, 
        billingCycle.id!, 
        stripeSubscription,
        billingCycle.props.externalProductId!
      );
      await this.saveSubscriptionWithHooks(HookEvents.SubscriptionUpdatedBefore, HookEvents.SubscriptionUpdatedAfter, existingByMetadata, oldDto);
      return;
    }

    // No existing subscription found, create new one
    const subscriptionKey =
      this.getMetadataValue(stripeSubscription.metadata, SUBSCRIO_SUBSCRIPTION_KEY_METADATA_KEYS) ??
      generateKey('sub');

    const activationDate = new Date(stripeSubscription.created * 1000);
    
    // Get period dates from matching subscription item
    const { periodStart, periodEnd } = this.getPeriodDatesFromStripeSubscription(
      stripeSubscription,
      billingCycle.props.externalProductId!
    );
    
    const currentPeriodStart = this.toDateOrDefault(periodStart, activationDate);
    const currentPeriodEnd = this.toDateOrUndefined(periodEnd) ??
      billingCycle.calculateNextPeriodEnd(currentPeriodStart) ??
      undefined;

    // Merge Stripe metadata with schedule ID
    const metadata = this.mergeScheduleIntoMetadata(
      stripeSubscription.metadata,
      stripeSubscription.schedule
    );

    const subscription = new Subscription({
      key: subscriptionKey,
      customerId: customer.id!,
      planId: plan.id!,
      billingCycleId: billingCycle.id!,
      status: this.mapStripeStatus(stripeSubscription.status),
      isArchived: false,
      activationDate,
      expirationDate: undefined,
      cancellationDate: stripeSubscription.canceled_at ? new Date(stripeSubscription.canceled_at * 1000) : undefined,
      trialEndDate: this.toDateOrUndefined(stripeSubscription.trial_end),
      currentPeriodStart,
      currentPeriodEnd,
      stripeSubscriptionId: stripeSubscription.id,
      featureOverrides: [],
      metadata,
      createdAt: now(),
      updatedAt: now()
    });

    await this.saveSubscriptionWithHooks(HookEvents.SubscriptionCreatedBefore, HookEvents.SubscriptionCreatedAfter, subscription, null);
  }

  private async handleSubscriptionUpdated(
    stripeSubscription: Stripe.Subscription
  ): Promise<void> {
    const existing = await this.subscriptionRepository.findByStripeId(
      stripeSubscription.id
    );
    if (!existing) {
      // If not found, treat as creation
      return this.handleSubscriptionCreated(stripeSubscription);
    }

    const oldDto = this.hooks.hasListeners(HookEvents.SubscriptionUpdatedBefore) || this.hooks.hasListeners(HookEvents.SubscriptionUpdatedAfter)
      ? await this.toSubscriptionDto(existing)
      : null;

    const stripeCustomerId = this.extractCustomerId(stripeSubscription.customer);
    const customer = await this.resolveCustomer(
      stripeCustomerId,
      stripeSubscription.metadata
    );

    const { billingCycle, plan } = await this.resolvePlanFromSubscription(stripeSubscription);
    this.applyStripeSubscriptionFields(
      existing, 
      customer.id!, 
      plan.id!, 
      billingCycle.id!, 
      stripeSubscription,
      billingCycle.props.externalProductId!
    );
    await this.saveSubscriptionWithHooks(HookEvents.SubscriptionUpdatedBefore, HookEvents.SubscriptionUpdatedAfter, existing, oldDto);
  }

  private async handleSubscriptionDeleted(
    stripeSubscription: Stripe.Subscription
  ): Promise<void> {
    const subscription = await this.subscriptionRepository.findByStripeId(
      stripeSubscription.id
    );
    if (!subscription) {
      return; // Already deleted or never existed
    }

    const oldDto = this.hooks.hasListeners(HookEvents.SubscriptionUpdatedBefore) || this.hooks.hasListeners(HookEvents.SubscriptionUpdatedAfter)
      ? await this.toSubscriptionDto(subscription)
      : null;
    subscription.expire();
    await this.saveSubscriptionWithHooks(HookEvents.SubscriptionUpdatedBefore, HookEvents.SubscriptionUpdatedAfter, subscription, oldDto);
  }

  private getInvoiceSubscriptionId(stripeInvoice: Stripe.Invoice): string | undefined {
    const subscription = stripeInvoice.parent?.subscription_details?.subscription;
    if (!subscription) {
      return undefined;
    }
    return typeof subscription === 'string' ? subscription : subscription.id;
  }

  private getInvoiceLinePriceId(line: Stripe.InvoiceLineItem): string | undefined {
    const price = line.pricing?.price_details?.price;
    if (!price) {
      return undefined;
    }
    return typeof price === 'string' ? price : price.id;
  }

  private async handlePaymentSucceeded(
    stripeInvoice: Stripe.Invoice
  ): Promise<void> {
    const stripeSubscriptionId = this.getInvoiceSubscriptionId(stripeInvoice);
    if (!stripeSubscriptionId) {
      return; // Not a subscription invoice
    }

    const subscription = await this.subscriptionRepository.findByStripeId(
      stripeSubscriptionId
    );
    if (!subscription) {
      return; // Subscription not found
    }

    // Get the subscription's billing cycle to find matching line item
    const billingCycle = await this.billingCycleRepository.findById(subscription.props.billingCycleId);
    if (!billingCycle || !billingCycle.props.externalProductId) {
      return; // Can't match without externalProductId
    }

    // Find the invoice line item that matches this billing cycle's Stripe price ID
    const matchingLineItem = stripeInvoice.lines?.data?.find(
      line => this.getInvoiceLinePriceId(line) === billingCycle.props.externalProductId
    );

    const period = matchingLineItem?.period ?? stripeInvoice.lines?.data?.[0]?.period;
    const oldDto = this.hooks.hasListeners(HookEvents.SubscriptionUpdatedBefore) || this.hooks.hasListeners(HookEvents.SubscriptionUpdatedAfter)
      ? await this.toSubscriptionDto(subscription)
      : null;
    if (period) {
      subscription.props.currentPeriodStart = this.toDateOrDefault(
        period.start, 
        subscription.props.currentPeriodStart ?? now()
      );
      // Preserve existing value if period.end is not provided
      subscription.props.currentPeriodEnd = period.end !== undefined && period.end !== null
        ? new Date(period.end * 1000)
        : subscription.props.currentPeriodEnd;
    }

    subscription.props.updatedAt = now();
    await this.saveSubscriptionWithHooks(HookEvents.SubscriptionUpdatedBefore, HookEvents.SubscriptionUpdatedAfter, subscription, oldDto);
  }

  /**
   * Find billing cycle by Stripe price ID (stored in externalProductId)
   */
  private async findBillingCycleByStripePriceId(stripePriceId: string): Promise<BillingCycle | null> {
    // Search all billing cycles for one with matching externalProductId
    const allCycles = await this.billingCycleRepository.findAll();
    return allCycles.find(cycle => cycle.props.externalProductId === stripePriceId) || null;
  }

  /**
   * Creating Stripe subscriptions from Subscrio is not supported.
   * Use `createCheckoutSession` or `processStripeEvent` instead.
   * @deprecated Use processStripeEvent or createCheckoutSession instead.
   */
  async createStripeSubscription(
    _customerKey: string,
    _planKey: string,
    _billingCycleKey: string,
    _stripePriceId: string
  ): Promise<Subscription> {
    throw new ValidationError(
      'createStripeSubscription is not supported. ' +
      'Use createCheckoutSession to start a Stripe Checkout session, ' +
      'or processStripeEvent to sync verified Stripe webhook events into Subscrio.'
    );
  }

  /**
   * Verify a Stripe webhook signature and construct an Event.
   * Requires `config.stripe.webhookSecret` (`whsec_...`).
   */
  constructStripeEvent(payload: string | Buffer, signatureHeader: string): Stripe.Event {
    const secret = this.config?.stripe?.webhookSecret;
    if (!secret) {
      throw new ConfigurationError(
        'Stripe webhook secret is not set. Configure stripe.webhookSecret before calling constructStripeEvent.'
      );
    }
    return Stripe.webhooks.constructEvent(payload, signatureHeader, secret);
  }

  private async resolveCustomer(
    stripeCustomerId: string,
    metadata?: Stripe.Metadata | null
  ): Promise<Customer> {
    const existing = await this.customerRepository.findByExternalBillingId(stripeCustomerId);
    if (existing) {
      return existing;
    }

    const customerKey = this.getMetadataValue(metadata, SUBSCRIO_CUSTOMER_KEY_METADATA_KEYS);
    if (!customerKey) {
      throw new NotFoundError(
        `Customer not found for Stripe customer ID '${stripeCustomerId}'. ` +
        `Provide 'subscrioCustomerKey' metadata when creating Stripe customers or subscriptions.`
      );
    }

    const fallbackCustomer = await this.customerRepository.findByKey(customerKey);
    if (!fallbackCustomer) {
      throw new NotFoundError(
        `Customer with key '${customerKey}' not found while handling Stripe customer '${stripeCustomerId}'.`
      );
    }

    if (
      fallbackCustomer.externalBillingId &&
      fallbackCustomer.externalBillingId !== stripeCustomerId
    ) {
      throw new ConflictError(
        `Customer '${customerKey}' is already linked to a different Stripe customer. ` +
        `Refusing to overwrite externalBillingId from webhook metadata.`
      );
    }

    const oldDto = this.hooks.hasListeners(HookEvents.CustomerUpdatedBefore) || this.hooks.hasListeners(HookEvents.CustomerUpdatedAfter)
      ? CustomerMapper.toDto(fallbackCustomer)
      : null;
    fallbackCustomer.setExternalBillingId(stripeCustomerId);
    return await this.saveCustomerWithHooks(HookEvents.CustomerUpdatedBefore, HookEvents.CustomerUpdatedAfter, fallbackCustomer, oldDto);
  }

  private getMetadataValue(
    metadata: Stripe.Metadata | null | undefined,
    keys: string[]
  ): string | null {
    if (!metadata) {
      return null;
    }

    for (const key of keys) {
      const value = metadata[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return null;
  }

  private extractCustomerId(
    customer: string | Stripe.Customer | Stripe.DeletedCustomer
  ): string {
    if (typeof customer === 'string') {
      return customer;
    }

    return customer.id;
  }

  private extractStripeEventRefs(event: Stripe.Event): {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  } {
    const obj = event.data.object;

    if (event.type.startsWith('customer.subscription.')) {
      const subscription = obj as Stripe.Subscription;
      return {
        stripeCustomerId: this.extractOptionalCustomerId(subscription.customer),
        stripeSubscriptionId: subscription.id,
      };
    }

    if (event.type.startsWith('customer.')) {
      return { stripeCustomerId: (obj as Stripe.Customer | Stripe.DeletedCustomer).id };
    }

    if (event.type.startsWith('invoice.')) {
      const invoice = obj as Stripe.Invoice;
      return {
        stripeCustomerId: this.extractOptionalCustomerId(invoice.customer),
        stripeSubscriptionId: this.getInvoiceSubscriptionId(invoice),
      };
    }

    if (event.type.startsWith('checkout.session.')) {
      const session = obj as Stripe.Checkout.Session;
      return {
        stripeCustomerId: this.extractOptionalCustomerId(session.customer),
        stripeSubscriptionId:
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id,
      };
    }

    return {};
  }

  private extractOptionalCustomerId(
    customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
  ): string | undefined {
    return customer ? this.extractCustomerId(customer) : undefined;
  }

  private async resolvePlanFromSubscription(stripeSubscription: Stripe.Subscription): Promise<{
    billingCycle: BillingCycle;
    plan: Plan;
  }> {
    const firstItem = stripeSubscription.items.data[0];
    if (!firstItem || !firstItem.price || !firstItem.price.id) {
      throw new ValidationError('Stripe subscription payload is missing price information');
    }

    const stripePriceId = firstItem.price.id;
    const billingCycle = await this.findBillingCycleByStripePriceId(stripePriceId);
    if (!billingCycle) {
      throw new NotFoundError(
        `Billing cycle not found for Stripe price ID '${stripePriceId}'. ` +
        `Create a billing cycle with externalProductId='${stripePriceId}' to complete the mapping.`
      );
    }

    const plan = await this.planRepository.findById(billingCycle.props.planId);
    if (!plan || plan.id === undefined) {
      throw new NotFoundError(`Plan not found for billing cycle '${billingCycle.key}'`);
    }

    return { billingCycle, plan };
  }

  /**
   * Find the subscription item that matches the billing cycle's Stripe price ID
   * and extract period dates from it
   */
  private getPeriodDatesFromStripeSubscription(
    stripeSubscription: Stripe.Subscription,
    billingCycleExternalProductId: string
  ): { periodStart?: number; periodEnd?: number } {
    // Find the subscription item that matches this billing cycle's Stripe price ID
    const matchingItem = stripeSubscription.items?.data?.find(
      item => item.price?.id === billingCycleExternalProductId
    ) ?? stripeSubscription.items?.data?.[0];

    return {
      periodStart: matchingItem?.current_period_start,
      periodEnd: matchingItem?.current_period_end
    };
  }

  private applyStripeSubscriptionFields(
    subscription: Subscription,
    customerId: number,
    planId: number,
    billingCycleId: number,
    stripeSubscription: Stripe.Subscription,
    billingCycleExternalProductId: string
  ) {
    subscription.props.customerId = customerId;
    subscription.props.planId = planId;
    subscription.props.billingCycleId = billingCycleId;
    subscription.props.activationDate = subscription.props.activationDate ?? new Date(stripeSubscription.created * 1000);
    
    // Get period dates from matching subscription item
    const { periodStart, periodEnd } = this.getPeriodDatesFromStripeSubscription(
      stripeSubscription,
      billingCycleExternalProductId
    );
    
    subscription.props.currentPeriodStart = this.toDateOrDefault(
      periodStart,
      subscription.props.currentPeriodStart ?? now()
    );
    
    // Preserve existing value if Stripe doesn't provide one
    subscription.props.currentPeriodEnd = periodEnd !== undefined && periodEnd !== null
      ? new Date(periodEnd * 1000)
      : subscription.props.currentPeriodEnd;
    subscription.props.trialEndDate = this.toDateOrUndefined(stripeSubscription.trial_end);
    subscription.props.cancellationDate = stripeSubscription.canceled_at
      ? new Date(stripeSubscription.canceled_at * 1000)
      : stripeSubscription.cancel_at_period_end
        ? subscription.props.cancellationDate
        : undefined;
    subscription.props.stripeSubscriptionId = stripeSubscription.id;
    subscription.props.metadata = this.mergeScheduleIntoMetadata(
      stripeSubscription.metadata,
      stripeSubscription.schedule,
      subscription.props.metadata
    );
    subscription.props.status = this.mapStripeStatus(stripeSubscription.status);
    subscription.props.updatedAt = now();
  }

  private mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
    switch (status) {
      case 'active':
        return SubscriptionStatus.Active;
      case 'trialing':
        return SubscriptionStatus.Trial;
      case 'canceled':
        return SubscriptionStatus.Cancelled;
      case 'past_due':
      case 'unpaid':
        return SubscriptionStatus.CancellationPending;
      case 'incomplete':
        return SubscriptionStatus.Pending;
      case 'incomplete_expired':
        return SubscriptionStatus.Expired;
      case 'paused':
        return SubscriptionStatus.Pending;
      default:
        throw new ValidationError(`Unsupported Stripe subscription status '${status}'`);
    }
  }

  private toDateOrUndefined(timestamp?: number | null): Date | undefined {
    if (!timestamp) {
      return undefined;
    }

    return new Date(timestamp * 1000);
  }

  private toDateOrDefault(timestamp: number | null | undefined, fallback: Date): Date {
    if (!timestamp) {
      return fallback;
    }

    return new Date(timestamp * 1000);
  }

  /**
   * Merge Stripe schedule ID into subscription metadata
   * If schedule is present, adds it to metadata as 'stripeScheduleId'
   * If schedule is null/undefined, removes it from metadata
   */
  private mergeScheduleIntoMetadata(
    stripeMetadata: Stripe.Metadata | null | undefined,
    schedule: string | Stripe.SubscriptionSchedule | null | undefined,
    existingMetadata?: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    // Merge existing metadata with Stripe metadata (Stripe metadata takes precedence)
    const merged: Record<string, unknown> = existingMetadata 
      ? { ...existingMetadata }
      : {};

    // Overlay Stripe metadata on top
    if (stripeMetadata) {
      Object.assign(merged, stripeMetadata);
    }

    // Extract schedule ID (could be string or object)
    const scheduleId = typeof schedule === 'string' 
      ? schedule 
      : schedule?.id 
        ? schedule.id 
        : null;

    // Add or remove schedule ID from metadata
    if (scheduleId) {
      merged.stripeScheduleId = scheduleId;
    } else {
      // Remove schedule ID if it exists
      delete merged.stripeScheduleId;
    }

    // Return undefined if metadata is empty, otherwise return the merged object
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  private async handleCustomerUpsert(
    stripeCustomer: Stripe.Customer
  ): Promise<void> {
    await this.resolveCustomer(stripeCustomer.id, stripeCustomer.metadata);
  }

  private async handleCustomerDeleted(
    stripeCustomer: Stripe.Customer | Stripe.DeletedCustomer
  ): Promise<void> {
    const existing = await this.customerRepository.findByExternalBillingId(stripeCustomer.id);
    if (!existing) {
      return;
    }

    const oldDto = this.hooks.hasListeners(HookEvents.CustomerUpdatedBefore) || this.hooks.hasListeners(HookEvents.CustomerUpdatedAfter)
      ? CustomerMapper.toDto(existing)
      : null;
    existing.setExternalBillingId(undefined);
    await this.saveCustomerWithHooks(HookEvents.CustomerUpdatedBefore, HookEvents.CustomerUpdatedAfter, existing, oldDto);
  }

  /**
   * Find subscription by metadata (subscription key)
   * Verifies the subscription belongs to the specified customer
   */
  private async findSubscriptionByMetadata(
    metadata: Stripe.Metadata | null | undefined,
    customerId: number
  ): Promise<Subscription | null> {
    // Look up by subscription key (external ID)
    const subscriptionKey = this.getMetadataValue(
      metadata,
      SUBSCRIO_SUBSCRIPTION_KEY_METADATA_KEYS
    );

    if (subscriptionKey) {
      const subscription = await this.subscriptionRepository.findByKey(subscriptionKey);
      // Verify it belongs to the customer
      if (subscription && subscription.props.customerId === customerId) {
        return subscription;
      }
    }

    return null;
  }

  /**
   * Get Stripe client instance
   * Uses provided secret key or falls back to config
   */
  private getStripeClient(secretKey?: string): Stripe {
    const key = secretKey || this.config?.stripe?.secretKey;
    if (!key) {
      throw new ConfigurationError(
        'Stripe secret key is required. Provide it in config.stripe.secretKey or pass stripeSecretKey parameter.'
      );
    }
    return new Stripe(key, {
      apiVersion: '2026-07-29.dahlia'
    });
  }

  /**
   * Create a Stripe Checkout Session URL for subscription purchase
   * 
   * This helper method:
   * - Ensures the customer exists in Stripe (creates if needed)
   * - Sets proper metadata for webhook linking
   * - Supports linking to existing Subscrio subscriptions
   * - Provides full access to Stripe Checkout options
   */
  async createCheckoutSession(params: {
    customerKey: string;
    billingCycleKey: string;
    subscriptionKey?: string;  // Optional: existing subscription key to update
    stripeSecretKey?: string;  // Optional: override config Stripe key
    successUrl: string;
    cancelUrl: string;
    // Convenience options
    quantity?: number;
    customerEmail?: string;
    customerName?: string;
    allowPromotionCodes?: boolean;
    billingAddressCollection?: 'auto' | 'required';
    paymentMethodTypes?: Stripe.Checkout.SessionCreateParams.PaymentMethodType[];
    trialPeriodDays?: number;
    metadata?: Record<string, string>;  // Additional custom metadata
    // Full Stripe API access
    stripeOptions?: Partial<Stripe.Checkout.SessionCreateParams>;
  }): Promise<{ url: string; sessionId: string }> {
    // Get Stripe client
    const stripe = this.getStripeClient(params.stripeSecretKey);

    // Find customer
    const customer = await this.customerRepository.findByKey(params.customerKey);
    if (!customer) {
      throw new NotFoundError(`Customer with key '${params.customerKey}' not found`);
    }

    // Find billing cycle
    const billingCycle = await this.billingCycleRepository.findByKey(params.billingCycleKey);
    if (!billingCycle) {
      throw new NotFoundError(`Billing cycle with key '${params.billingCycleKey}' not found`);
    }

    // Validate billing cycle has Stripe price ID
    if (!billingCycle.props.externalProductId) {
      throw new ValidationError(
        `Billing cycle '${params.billingCycleKey}' does not have externalProductId set. ` +
        `Set it to a Stripe price ID to enable checkout.`
      );
    }

    // If subscription key provided, verify it exists and belongs to customer
    if (params.subscriptionKey) {
      const existingSubscription = await this.subscriptionRepository.findByKey(params.subscriptionKey);
      if (!existingSubscription) {
        throw new NotFoundError(`Subscription with key '${params.subscriptionKey}' not found`);
      }
      if (existingSubscription.props.customerId !== customer.id!) {
        throw new ConflictError(
          `Subscription '${params.subscriptionKey}' does not belong to customer '${params.customerKey}'`
        );
      }
    }

    // Ensure Stripe customer exists
    let stripeCustomerId = customer.externalBillingId;
    if (!stripeCustomerId) {
      // Create Stripe customer
      const stripeCustomer = await stripe.customers.create({
        email: params.customerEmail,
        name: params.customerName,
        metadata: {
          subscrioCustomerKey: customer.key
        }
      });
      stripeCustomerId = stripeCustomer.id;

      // Update customer with Stripe ID
      const oldDto = this.hooks.hasListeners(HookEvents.CustomerUpdatedBefore) || this.hooks.hasListeners(HookEvents.CustomerUpdatedAfter)
        ? CustomerMapper.toDto(customer)
        : null;
      customer.setExternalBillingId(stripeCustomerId);
      await this.saveCustomerWithHooks(HookEvents.CustomerUpdatedBefore, HookEvents.CustomerUpdatedAfter, customer, oldDto);
    } else {
      // Update existing Stripe customer metadata if needed
      try {
        await stripe.customers.update(stripeCustomerId, {
          email: params.customerEmail,
          name: params.customerName,
          metadata: {
            subscrioCustomerKey: customer.key
          }
        });
      } catch (error) {
        // If customer doesn't exist in Stripe, create it
        if (error instanceof Stripe.errors.StripeError && error.code === 'resource_missing') {
          const stripeCustomer = await stripe.customers.create({
            email: params.customerEmail,
            name: params.customerName,
            metadata: {
              subscrioCustomerKey: customer.key
            }
          });
          stripeCustomerId = stripeCustomer.id;
          const oldDto = this.hooks.hasListeners(HookEvents.CustomerUpdatedBefore) || this.hooks.hasListeners(HookEvents.CustomerUpdatedAfter)
            ? CustomerMapper.toDto(customer)
            : null;
          customer.setExternalBillingId(stripeCustomerId);
          await this.saveCustomerWithHooks(HookEvents.CustomerUpdatedBefore, HookEvents.CustomerUpdatedAfter, customer, oldDto);
        } else {
          throw error;
        }
      }
    }

    // Build metadata for checkout session
    const sessionMetadata: Record<string, string> = {
      subscrioCustomerKey: customer.key,
      ...(params.subscriptionKey && {
        subscrioSubscriptionKey: params.subscriptionKey
      }),
      ...params.metadata
    };

    // Build line items
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{
      price: billingCycle.props.externalProductId,
      quantity: params.quantity ?? 1
    }];

    // Build subscription data metadata (this goes on the subscription, not the session)
    const subscriptionMetadata: Record<string, string> = {
      subscrioCustomerKey: customer.key,
      ...(params.subscriptionKey && {
        subscrioSubscriptionKey: params.subscriptionKey
      }),
      ...params.metadata
    };

    // Build base checkout session params
    // Note: Cannot specify both 'customer' and 'customer_email' - we always use 'customer' since we ensure customer exists
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: stripeCustomerId,
      mode: 'subscription',
      line_items: lineItems,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: sessionMetadata,
      subscription_data: {
        metadata: subscriptionMetadata,
        ...(params.trialPeriodDays && { trial_period_days: params.trialPeriodDays })
      },
      // Do NOT set customer_email when customer is set - Stripe doesn't allow both
      // If customer_email was provided, it was already used when creating/updating the Stripe customer
      ...(params.allowPromotionCodes !== undefined && { allow_promotion_codes: params.allowPromotionCodes }),
      ...(params.billingAddressCollection && { billing_address_collection: params.billingAddressCollection }),
      ...(params.paymentMethodTypes && { payment_method_types: params.paymentMethodTypes }),
      // Merge in any additional Stripe options
      ...params.stripeOptions
    };

    // Create checkout session
    const session = await stripe.checkout.sessions.create(sessionParams);

    if (!session.url) {
      throw new ValidationError('Stripe checkout session was created but did not return a URL');
    }

    return {
      url: session.url,
      sessionId: session.id
    };
  }

}

import type { Subscription } from '../../domain/entities/Subscription.js';
import type { SubscriptionDto } from '../dtos/SubscriptionDto.js';
import { ValidationError } from '../errors/index.js';
import { now } from '../../infrastructure/utils/date.js';

export interface ApplySubscriptionDtoMutationOptions {
  /** When false (updates), changing key via hook throws. Default true for create. */
  allowKeyChange?: boolean;
}

/**
 * Applies mutable fields from a before-hook `new` DTO onto the domain entity.
 * Relationship keys (customer/plan/billing cycle) are not remapped via hooks.
 * Archive flag transitions should still be applied by entity methods after this when needed.
 */
export function applySubscriptionDtoMutation(
  subscription: Subscription,
  dto: SubscriptionDto,
  options: ApplySubscriptionDtoMutationOptions = {}
): void {
  const allowKeyChange = options.allowKeyChange ?? true;

  if (dto.key !== subscription.key) {
    if (!allowKeyChange) {
      throw new ValidationError('Subscription key cannot be changed via hooks');
    }
    subscription.props.key = dto.key;
  }

  subscription.props.expirationDate = dto.expirationDate ? new Date(dto.expirationDate) : undefined;
  subscription.props.cancellationDate = dto.cancellationDate ? new Date(dto.cancellationDate) : undefined;
  subscription.props.trialEndDate = dto.trialEndDate ? new Date(dto.trialEndDate) : undefined;
  subscription.props.currentPeriodStart = dto.currentPeriodStart
    ? new Date(dto.currentPeriodStart)
    : undefined;
  subscription.props.currentPeriodEnd = dto.currentPeriodEnd
    ? new Date(dto.currentPeriodEnd)
    : dto.currentPeriodEnd === null
      ? null
      : undefined;
  subscription.props.stripeSubscriptionId = dto.stripeSubscriptionId ?? undefined;
  subscription.props.metadata = dto.metadata ?? undefined;
  subscription.props.updatedAt = now();
}

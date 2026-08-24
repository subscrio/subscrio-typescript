import type { Customer } from '../../domain/entities/Customer.js';
import type { CustomerDto } from '../dtos/CustomerDto.js';
import { ValidationError } from '../errors/index.js';
import { now } from '../../infrastructure/utils/date.js';

export interface ApplyCustomerDtoMutationOptions {
  /** When false (updates), changing key via hook throws. Default true for create. */
  allowKeyChange?: boolean;
}

/**
 * Applies mutable fields from a before-hook `new` DTO onto the domain entity.
 * Status transitions for archive/unarchive should still be applied by entity methods after this.
 */
export function applyCustomerDtoMutation(
  customer: Customer,
  dto: CustomerDto,
  options: ApplyCustomerDtoMutationOptions = {}
): void {
  const allowKeyChange = options.allowKeyChange ?? true;

  if (dto.key !== customer.key) {
    if (!allowKeyChange) {
      throw new ValidationError('Customer key cannot be changed via hooks');
    }
    customer.props.key = dto.key;
  }

  customer.props.displayName = dto.displayName ?? undefined;
  customer.props.email = dto.email ?? undefined;
  customer.props.externalBillingId = dto.externalBillingId ?? undefined;
  customer.props.metadata = dto.metadata ?? undefined;
  customer.props.updatedAt = now();
}

import { Customer } from '../../domain/entities/Customer.js';
import { CustomerDto } from '../dtos/CustomerDto.js';
import { CustomerStatus } from '../../domain/value-objects/CustomerStatus.js';

export class CustomerMapper {
  static toDto(customer: Customer): CustomerDto {
    return {
      key: customer.key,
      displayName: customer.props.displayName ?? null,
      email: customer.props.email ?? null,
      externalBillingId: customer.externalBillingId ?? null,
      status: customer.status,
      metadata: customer.props.metadata ?? null,
      createdAt: customer.props.createdAt.toISOString(),
      updatedAt: customer.props.updatedAt.toISOString()
    };
  }

  static toDomain(raw: any): Customer {
    return new Customer(
      {
        key: raw.key,
        displayName: raw.display_name,
        email: raw.email,
        externalBillingId: raw.external_billing_id,
        status: raw.status as CustomerStatus,
        metadata: raw.metadata,
        createdAt: new Date(raw.created_at),
        updatedAt: new Date(raw.updated_at)
      },
      raw.id as number | undefined
    );
  }

  static toPersistence(customer: Customer): any {
    const record: any = {
      key: customer.key,
      display_name: customer.props.displayName,
      email: customer.props.email,
      external_billing_id: customer.externalBillingId ?? null,
      status: customer.status,
      metadata: customer.props.metadata,
      created_at: customer.props.createdAt,
      updated_at: customer.props.updatedAt
    };
    
    // Only include id for updates (not inserts)
    if (customer.id !== undefined) {
      record.id = customer.id;
    }
    
    return record;
  }
}


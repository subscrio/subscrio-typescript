import { ICustomerRepository } from '../repositories/ICustomerRepository.js';
import {
  CreateCustomerDto,
  CreateCustomerDtoSchema,
  UpdateCustomerDto,
  UpdateCustomerDtoSchema,
  CustomerFilterDto,
  CustomerFilterDtoSchema,
  CustomerDto
} from '../dtos/CustomerDto.js';
import { CustomerMapper } from '../mappers/CustomerMapper.js';
import { Customer } from '../../domain/entities/Customer.js';
import { CustomerStatus } from '../../domain/value-objects/CustomerStatus.js';
import { now } from '../../infrastructure/utils/date.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError
} from '../errors/index.js';
import { HookDispatcher } from '../hooks/HookDispatcher.js';
import { HookEvents, type HookSource, type CustomerMutationHookEvent } from '../hooks/types.js';
import { cloneJson } from '../hooks/cloneJson.js';
import { applyCustomerDtoMutation } from '../hooks/applyCustomerDtoMutation.js';

export class CustomerManagementService {
  constructor(
    private readonly customerRepository: ICustomerRepository,
    private readonly hooks: HookDispatcher = new HookDispatcher()
  ) {}

  private async emitCustomerBefore(
    type: CustomerMutationHookEvent['type'],
    source: HookSource,
    entityId: number | null,
    oldDto: CustomerDto | null,
    newDto: CustomerDto | null
  ): Promise<CustomerDto | null> {
    if (!this.hooks.hasListeners(type)) return newDto;
    const payload: CustomerMutationHookEvent = {
      type,
      phase: 'before',
      source,
      occurredAt: new Date().toISOString(),
      entityId,
      old: oldDto ? cloneJson(oldDto) : null,
      new: newDto ? cloneJson(newDto) : null,
    };
    await this.hooks.emit(type, payload);
    return payload.new;
  }

  private async emitCustomerAfter(
    type: CustomerMutationHookEvent['type'],
    source: HookSource,
    entityId: number | null,
    oldDto: CustomerDto | null,
    newDto: CustomerDto | null
  ): Promise<void> {
    if (!this.hooks.hasListeners(type)) return;
    await this.hooks.emit(type, {
      type,
      phase: 'after',
      source,
      occurredAt: new Date().toISOString(),
      entityId,
      old: oldDto ? cloneJson(oldDto) : null,
      new: newDto ? cloneJson(newDto) : null,
    });
  }

  async createCustomer(dto: CreateCustomerDto): Promise<CustomerDto> {
    const validationResult = CreateCustomerDtoSchema.safeParse(dto);
    if (!validationResult.success) {
      throw new ValidationError(
        'Invalid customer data',
        validationResult.error.issues
      );
    }
    const validatedDto = validationResult.data;

    const existing = await this.customerRepository.findByKey(validatedDto.key);
    if (existing) {
      throw new ConflictError(`Customer with key '${validatedDto.key}' already exists`);
    }

    if (validatedDto.externalBillingId) {
      const existingBilling = await this.customerRepository.findByExternalBillingId(validatedDto.externalBillingId);
      if (existingBilling) {
        throw new ConflictError(`Customer with external billing ID '${validatedDto.externalBillingId}' already exists`);
      }
    }

    const customer = new Customer({
      key: validatedDto.key,
      displayName: validatedDto.displayName,
      email: validatedDto.email,
      externalBillingId: validatedDto.externalBillingId,
      status: CustomerStatus.Active,
      metadata: validatedDto.metadata,
      createdAt: now(),
      updatedAt: now()
    });

    let proposed = CustomerMapper.toDto(customer);
    proposed = (await this.emitCustomerBefore(
      HookEvents.CustomerCreatedBefore,
      'api',
      null,
      null,
      proposed
    )) ?? proposed;

    applyCustomerDtoMutation(customer, proposed, { allowKeyChange: true });

    if (customer.key !== validatedDto.key) {
      const keyTaken = await this.customerRepository.findByKey(customer.key);
      if (keyTaken) {
        throw new ConflictError(`Customer with key '${customer.key}' already exists`);
      }
    }
    if (customer.props.externalBillingId && customer.props.externalBillingId !== validatedDto.externalBillingId) {
      const billingTaken = await this.customerRepository.findByExternalBillingId(customer.props.externalBillingId);
      if (billingTaken) {
        throw new ConflictError(
          `Customer with external billing ID '${customer.props.externalBillingId}' already exists`
        );
      }
    }

    const savedCustomer = await this.customerRepository.save(customer);
    const savedDto = CustomerMapper.toDto(savedCustomer);
    await this.emitCustomerAfter(
      HookEvents.CustomerCreatedAfter,
      'api',
      savedCustomer.id ?? null,
      null,
      savedDto
    );
    return savedDto;
  }

  async updateCustomer(key: string, dto: UpdateCustomerDto): Promise<CustomerDto> {
    const validationResult = UpdateCustomerDtoSchema.safeParse(dto);
    if (!validationResult.success) {
      throw new ValidationError(
        'Invalid update data',
        validationResult.error.issues
      );
    }
    const validatedDto = validationResult.data;

    const customer = await this.customerRepository.findByKey(key);
    if (!customer) {
      throw new NotFoundError(`Customer with key '${key}' not found. Please check the customer key and try again.`);
    }

    const oldDto = CustomerMapper.toDto(customer);

    if (validatedDto.externalBillingId && validatedDto.externalBillingId !== customer.props.externalBillingId) {
      const existing = await this.customerRepository.findByExternalBillingId(validatedDto.externalBillingId);
      if (existing && existing.id !== customer.id) {
        throw new ConflictError(`Customer with external billing ID '${validatedDto.externalBillingId}' already exists`);
      }
    }

    let proposed: CustomerDto = {
      ...oldDto,
      displayName: validatedDto.displayName !== undefined ? validatedDto.displayName ?? null : oldDto.displayName,
      email: validatedDto.email !== undefined ? validatedDto.email ?? null : oldDto.email,
      externalBillingId: validatedDto.externalBillingId !== undefined
        ? validatedDto.externalBillingId ?? null
        : oldDto.externalBillingId,
      metadata: validatedDto.metadata !== undefined ? validatedDto.metadata ?? null : oldDto.metadata,
      updatedAt: now().toISOString(),
    };

    proposed = (await this.emitCustomerBefore(
      HookEvents.CustomerUpdatedBefore,
      'api',
      customer.id ?? null,
      oldDto,
      proposed
    )) ?? proposed;

    applyCustomerDtoMutation(customer, proposed, { allowKeyChange: false });

    if (
      customer.props.externalBillingId &&
      customer.props.externalBillingId !== oldDto.externalBillingId
    ) {
      const existing = await this.customerRepository.findByExternalBillingId(customer.props.externalBillingId);
      if (existing && existing.id !== customer.id) {
        throw new ConflictError(
          `Customer with external billing ID '${customer.props.externalBillingId}' already exists`
        );
      }
    }

    const savedCustomer = await this.customerRepository.save(customer);
    const savedDto = CustomerMapper.toDto(savedCustomer);
    await this.emitCustomerAfter(
      HookEvents.CustomerUpdatedAfter,
      'api',
      savedCustomer.id ?? null,
      oldDto,
      savedDto
    );
    return savedDto;
  }

  async getCustomer(key: string): Promise<CustomerDto | null> {
    const customer = await this.customerRepository.findByKey(key);
    return customer ? CustomerMapper.toDto(customer) : null;
  }

  async listCustomers(filters: CustomerFilterDto = { limit: 50, offset: 0 }): Promise<CustomerDto[]> {
    const validationResult = CustomerFilterDtoSchema.safeParse(filters);
    if (!validationResult.success) {
      throw new ValidationError(
        'Invalid filter parameters',
        validationResult.error.issues
      );
    }

    const customers = await this.customerRepository.findAll(validationResult.data);
    return customers.map(CustomerMapper.toDto);
  }

  async archiveCustomer(key: string): Promise<void> {
    const customer = await this.customerRepository.findByKey(key);
    if (!customer) {
      throw new NotFoundError(`Customer with key '${key}' not found. Please check the customer key and try again.`);
    }

    const oldDto = CustomerMapper.toDto(customer);
    let proposed: CustomerDto = {
      ...oldDto,
      status: CustomerStatus.Archived,
      updatedAt: now().toISOString(),
    };

    proposed = (await this.emitCustomerBefore(
      HookEvents.CustomerArchivedBefore,
      'api',
      customer.id ?? null,
      oldDto,
      proposed
    )) ?? proposed;

    applyCustomerDtoMutation(customer, proposed, { allowKeyChange: false });
    customer.archive();
    const saved = await this.customerRepository.save(customer);
    await this.emitCustomerAfter(
      HookEvents.CustomerArchivedAfter,
      'api',
      saved.id ?? null,
      oldDto,
      CustomerMapper.toDto(saved)
    );
  }

  async unarchiveCustomer(key: string): Promise<void> {
    const customer = await this.customerRepository.findByKey(key);
    if (!customer) {
      throw new NotFoundError(`Customer with key '${key}' not found. Please check the customer key and try again.`);
    }

    const oldDto = CustomerMapper.toDto(customer);
    let proposed: CustomerDto = {
      ...oldDto,
      status: CustomerStatus.Active,
      updatedAt: now().toISOString(),
    };

    proposed = (await this.emitCustomerBefore(
      HookEvents.CustomerUnarchivedBefore,
      'api',
      customer.id ?? null,
      oldDto,
      proposed
    )) ?? proposed;

    applyCustomerDtoMutation(customer, proposed, { allowKeyChange: false });
    customer.unarchive();
    const saved = await this.customerRepository.save(customer);
    await this.emitCustomerAfter(
      HookEvents.CustomerUnarchivedAfter,
      'api',
      saved.id ?? null,
      oldDto,
      CustomerMapper.toDto(saved)
    );
  }

  async deleteCustomer(key: string): Promise<void> {
    const customer = await this.customerRepository.findByKey(key);
    if (!customer) {
      throw new NotFoundError(`Customer with key '${key}' not found. Please check the customer key and try again.`);
    }

    if (!customer.canDelete()) {
      throw new ValidationError(
        `Cannot delete customer with status '${customer.status}'. ` +
        'Customer must be archived before permanent deletion.'
      );
    }

    const oldDto = CustomerMapper.toDto(customer);
    const entityId = customer.id ?? null;
    await this.emitCustomerBefore(
      HookEvents.CustomerDeletedBefore,
      'api',
      entityId,
      oldDto,
      null
    );

    await this.customerRepository.delete(customer.id!);

    await this.emitCustomerAfter(
      HookEvents.CustomerDeletedAfter,
      'api',
      entityId,
      oldDto,
      null
    );
  }
}

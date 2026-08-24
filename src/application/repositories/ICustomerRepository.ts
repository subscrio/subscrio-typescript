import { Customer } from '../../domain/entities/Customer.js';
import { CustomerFilterDto } from '../dtos/CustomerDto.js';

export interface ICustomerRepository {
  save(customer: Customer): Promise<Customer>;
  findById(id: number): Promise<Customer | null>;
  findByKey(key: string): Promise<Customer | null>;
  findByExternalBillingId(externalBillingId: string): Promise<Customer | null>;
  findAll(filters?: CustomerFilterDto): Promise<Customer[]>;
  delete(id: number): Promise<void>;
  exists(id: number): Promise<boolean>;
}


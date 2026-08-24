import { ICustomerRepository } from '../../application/repositories/ICustomerRepository.js';
import { Customer } from '../../domain/entities/Customer.js';
import { CustomerMapper } from '../../application/mappers/CustomerMapper.js';
import { DrizzleDb } from '../database/drizzle.js';
import { customers } from '../database/schema.js';
import { eq, and, like, or, desc, asc } from 'drizzle-orm';
import { CustomerFilterDto } from '../../application/dtos/CustomerDto.js';

export class DrizzleCustomerRepository implements ICustomerRepository {
  constructor(private readonly db: DrizzleDb) {}

  async save(customer: Customer): Promise<Customer> {
    const record = CustomerMapper.toPersistence(customer);
    
    if (customer.id === undefined) {
      // Insert new entity
      const [inserted] = await this.db
        .insert(customers)
        .values(record)
        .returning({ id: customers.id });
      
      // Update entity with generated ID
      return new Customer(customer.props, inserted.id);
    } else {
      // Update existing entity
      await this.db
        .update(customers)
        .set({
          key: record.key,
          display_name: record.display_name,
          email: record.email,
          external_billing_id: record.external_billing_id,
          status: record.status,
          metadata: record.metadata,
          updated_at: record.updated_at
        })
        .where(eq(customers.id, customer.id));
      
      return customer;
    }
  }

  async findById(id: number): Promise<Customer | null> {
    const [record] = await this.db
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);
    
    return record ? CustomerMapper.toDomain(record) : null;
  }

  async findByKey(key: string): Promise<Customer | null> {
    const [record] = await this.db
      .select()
      .from(customers)
      .where(eq(customers.key, key))
      .limit(1);
    
    return record ? CustomerMapper.toDomain(record) : null;
  }

  async findByExternalBillingId(externalBillingId: string): Promise<Customer | null> {
    const [record] = await this.db
      .select()
      .from(customers)
      .where(eq(customers.external_billing_id, externalBillingId))
      .limit(1);
    
    return record ? CustomerMapper.toDomain(record) : null;
  }

  async findAll(filters?: CustomerFilterDto): Promise<Customer[]> {
    let query = this.db.select().from(customers);

    if (filters) {
      const conditions = [];

      if (filters.status) {
        conditions.push(eq(customers.status, filters.status));
      }

      if (filters.search) {
        // Drizzle handles parameterized queries automatically - no manual sanitization needed
        conditions.push(
          or(
            like(customers.key, `%${filters.search}%`),
            like(customers.display_name, `%${filters.search}%`),
            like(customers.email, `%${filters.search}%`)
          )
        );
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }

      // Apply sorting
      const sortBy = filters.sortBy || 'createdAt';
      const sortOrder = filters.sortOrder || 'desc';
      
      if (sortBy === 'displayName') {
        query = query.orderBy(sortOrder === 'desc' ? desc(customers.display_name) : asc(customers.display_name)) as typeof query;
      } else if (sortBy === 'key') {
        query = query.orderBy(sortOrder === 'desc' ? desc(customers.key) : asc(customers.key)) as typeof query;
      } else {
        query = query.orderBy(sortOrder === 'desc' ? desc(customers.created_at) : asc(customers.created_at)) as typeof query;
      }

      // Apply pagination
      if (filters.limit) {
        query = query.limit(filters.limit) as typeof query;
      }
      if (filters.offset) {
        query = query.offset(filters.offset) as typeof query;
      }
    } else {
      query = query.orderBy(desc(customers.created_at)) as typeof query;
    }

    const records = await query;
    return records.map(CustomerMapper.toDomain);
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(customers).where(eq(customers.id, id));
  }

  async exists(id: number): Promise<boolean> {
    const [record] = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);
    
    return !!record;
  }
}

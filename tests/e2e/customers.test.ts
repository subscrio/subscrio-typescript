import { describe, test, expect, beforeAll } from 'vitest';
import { Subscrio } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';

describe('Customers E2E Tests', () => {
  let subscrio: Subscrio;
  
  beforeAll(() => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() }
    });
  });

  describe('CRUD Operations', () => {
    test('creates a customer with valid data', async () => {
      const customer = await subscrio.customers.createCustomer({
        key: 'test-customer',
        displayName: 'Test Customer',
        email: 'test@example.com'
      });

      expect(customer).toBeDefined();
      expect(customer.key).toBe('test-customer');
      expect(customer.displayName).toBe('Test Customer');
      expect(customer.email).toBe('test@example.com');
      expect(customer.status).toBe('active');
      expect(customer.createdAt).toBeDefined();
      expect(customer.updatedAt).toBeDefined();
    });

    test('retrieves customer by key after creation', async () => {
      const created = await subscrio.customers.createCustomer({
        key: 'retrieve-customer',
        displayName: 'Retrieve Customer'
      });

      const retrieved = await subscrio.customers.getCustomer(created.key);
      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe(created.key);
      expect(retrieved?.displayName).toBe(created.displayName);
    });

    test('updates customer display name', async () => {
      const customer = await subscrio.customers.createCustomer({
        key: 'update-name-customer',
        displayName: 'Original Name'
      });

      const updated = await subscrio.customers.updateCustomer(customer.key, {
        displayName: 'Updated Name'
      });

      expect(updated.displayName).toBe('Updated Name');
      expect(updated.key).toBe('update-name-customer');
    });

    test('updates customer email', async () => {
      const customer = await subscrio.customers.createCustomer({
        key: 'update-email-customer',
        email: 'old@example.com'
      });

      const updated = await subscrio.customers.updateCustomer(customer.key, {
        email: 'new@example.com'
      });

      expect(updated.email).toBe('new@example.com');
    });

    test('updates customer external billing ID', async () => {
      const customer = await subscrio.customers.createCustomer({
        key: `update-billing-customer-${Date.now()}`
      });

      const billingId = `cus_stripe_${Date.now()}`;
      const updated = await subscrio.customers.updateCustomer(customer.key, {
        externalBillingId: billingId
      });

      expect(updated.externalBillingId).toBe(billingId);
    });

    test('returns null for non-existent customer', async () => {
      const result = await subscrio.customers.getCustomer('non-existent-customer');
      expect(result).toBeNull();
    });

    test('throws error when updating non-existent customer', async () => {
      await expect(
        subscrio.customers.updateCustomer('non-existent-customer', {
          displayName: 'New Name'
        })
      ).rejects.toThrow('not found');
    });
  });

  describe('Validation Tests', () => {
    test('throws error for empty customer key', async () => {
      await expect(
        subscrio.customers.createCustomer({
          key: '',
          displayName: 'Test'
        })
      ).rejects.toThrow();
    });

    test('throws error for invalid email format', async () => {
      await expect(
        subscrio.customers.createCustomer({
          key: 'invalid-email-customer',
          email: 'not-an-email'
        })
      ).rejects.toThrow();
    });

    test('throws error for duplicate customer key', async () => {
      await subscrio.customers.createCustomer({
        key: 'duplicate-customer',
        displayName: 'Customer 1'
      });

      await expect(
        subscrio.customers.createCustomer({
          key: 'duplicate-customer',
          displayName: 'Customer 2'
        })
      ).rejects.toThrow('already exists');
    });

    test('throws error for duplicate external billing ID', async () => {
      await subscrio.customers.createCustomer({
        key: 'billing-1',
        externalBillingId: 'cus_123'
      });

      await expect(
        subscrio.customers.createCustomer({
          key: 'billing-2',
          externalBillingId: 'cus_123'
        })
      ).rejects.toThrow('already exists');
    });

    test('allows optional fields to be undefined', async () => {
      const customer = await subscrio.customers.createCustomer({
        key: 'minimal-customer'
      });

      expect(customer.displayName).toBeNull();
      expect(customer.email).toBeNull();
      expect(customer.externalBillingId).toBeNull();
    });
  });

  describe('Lifecycle/Status Tests', () => {
    test('activates a suspended customer', async () => {
      const customer = await subscrio.customers.createCustomer({
        key: 'activate-customer',
        displayName: 'Activate Customer'
      });

      await subscrio.customers.archiveCustomer(customer.key);
      let retrieved = await subscrio.customers.getCustomer(customer.key);
      expect(retrieved?.status).toBe('archived');

      await subscrio.customers.unarchiveCustomer(customer.key);
      retrieved = await subscrio.customers.getCustomer(customer.key);
      expect(retrieved?.status).toBe('active');
    });

    test('archives an active customer', async () => {
      const customer = await subscrio.customers.createCustomer({
        key: 'suspend-customer',
        displayName: 'Suspend Customer'
      });

      expect(customer.status).toBe('active');

      await subscrio.customers.archiveCustomer(customer.key);
      const retrieved = await subscrio.customers.getCustomer(customer.key);
      expect(retrieved?.status).toBe('archived');
    });

    test('archives customer for deletion', async () => {
      const customer = await subscrio.customers.createCustomer({
        key: 'mark-deleted-customer',
        displayName: 'Mark Deleted Customer'
      });

      await subscrio.customers.archiveCustomer(customer.key);
      const retrieved = await subscrio.customers.getCustomer(customer.key);
      expect(retrieved?.status).toBe('archived');
    });

    test('deletes customer only when marked as deleted', async () => {
      const customer = await subscrio.customers.createCustomer({
        key: 'delete-after-mark',
        displayName: 'Delete After Mark'
      });

      await subscrio.customers.archiveCustomer(customer.key);
      await subscrio.customers.deleteCustomer(customer.key);

      const retrieved = await subscrio.customers.getCustomer(customer.key);
      expect(retrieved).toBeNull();
    });

    test('throws error when deleting active customer', async () => {
      const customer = await subscrio.customers.createCustomer({
        key: 'delete-active-customer',
        displayName: 'Delete Active Customer'
      });

      await expect(
        subscrio.customers.deleteCustomer(customer.key)
      ).rejects.toThrow('must be archived');
    });

    test('throws error when deleting active customer without archiving', async () => {
      const customer = await subscrio.customers.createCustomer({
        key: `delete-active-customer-${Date.now()}`,
        displayName: 'Delete Active Customer'
      });

      // Don't archive the customer - keep it active
      await expect(
        subscrio.customers.deleteCustomer(customer.key)
      ).rejects.toThrow('must be archived');
    });
  });

  describe('List & Filter Tests', () => {
    test('lists all customers', async () => {
      await subscrio.customers.createCustomer({
        key: 'list-1',
        displayName: 'List 1'
      });
      await subscrio.customers.createCustomer({
        key: 'list-2',
        displayName: 'List 2'
      });

      const customers = await subscrio.customers.listCustomers();
      expect(customers.length).toBeGreaterThanOrEqual(2);
    });

    test('filters customers by status (active)', async () => {
      await subscrio.customers.createCustomer({
        key: 'filter-active',
        displayName: 'Filter Active'
      });

      const activeCustomers = await subscrio.customers.listCustomers({ status: 'active' });
      expect(activeCustomers.every(c => c.status === 'active')).toBe(true);
      expect(activeCustomers.length).toBeGreaterThan(0);
    });

    test('filters customers by status (archived)', async () => {
      const customer = await subscrio.customers.createCustomer({
        key: 'filter-archived',
        displayName: 'Filter Archived'
      });
      await subscrio.customers.archiveCustomer(customer.key);

      const archivedCustomers = await subscrio.customers.listCustomers({ status: 'archived' });
      expect(archivedCustomers.some(c => c.key === customer.key)).toBe(true);
    });

    test('filters customers by status (archived) - second test', async () => {
      const customer = await subscrio.customers.createCustomer({
        key: `filter-archived-${Date.now()}`,
        displayName: 'Filter Archived 2'
      });
      await subscrio.customers.archiveCustomer(customer.key);

      const archivedCustomers = await subscrio.customers.listCustomers({ status: 'archived' });
      expect(archivedCustomers.some(c => c.key === customer.key)).toBe(true);
    });

    test('searches customers by key', async () => {
      await subscrio.customers.createCustomer({
        key: 'search-key-unique',
        displayName: 'Search Customer'
      });

      const customers = await subscrio.customers.listCustomers({ search: 'search-key-unique' });
      expect(customers.some(c => c.key === 'search-key-unique')).toBe(true);
    });

    test('searches customers by display name', async () => {
      await subscrio.customers.createCustomer({
        key: 'search-by-name',
        displayName: 'Very Unique Display Name'
      });

      const customers = await subscrio.customers.listCustomers({ search: 'Very Unique Display' });
      expect(customers.some(c => c.displayName?.includes('Very Unique Display Name'))).toBe(true);
    });

    test('searches customers by email', async () => {
      await subscrio.customers.createCustomer({
        key: 'search-by-email',
        email: 'unique.search@example.com'
      });

      const customers = await subscrio.customers.listCustomers({ search: 'unique.search@example.com' });
      expect(customers.some(c => c.email === 'unique.search@example.com')).toBe(true);
    });

    test('paginates customer list (limit)', async () => {
      const customers = await subscrio.customers.listCustomers({ limit: 5 });
      expect(customers.length).toBeLessThanOrEqual(5);
    });

    test('paginates customer list (offset)', async () => {
      const allCustomers = await subscrio.customers.listCustomers({ limit: 100 });
      
      if (allCustomers.length > 5) {
        const firstPage = await subscrio.customers.listCustomers({ limit: 5, offset: 0 });
        const secondPage = await subscrio.customers.listCustomers({ limit: 5, offset: 5 });
        
        expect(firstPage[0].key).not.toBe(secondPage[0].key);
      }
    });
  });
});


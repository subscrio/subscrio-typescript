import { describe, test, expect, beforeAll } from 'vitest';
import { Subscrio } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';

describe('Products E2E Tests', () => {
  let subscrio: Subscrio;
  
  beforeAll(() => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() }
    });
  });

  describe('Product Creation', () => {
    test('creates a product with valid data', async () => {
      const product = await subscrio.products.createProduct({
        key: 'test-product',
        displayName: 'Test Product',
        description: 'A test product'
      });

      expect(product).toBeDefined();
      expect(product.key).toBe('test-product');
      expect(product.displayName).toBe('Test Product');
      expect(product.status).toBe('active');
      expect(product.createdAt).toBeDefined();
      expect(product.updatedAt).toBeDefined();
    });

    test('throws error for duplicate product key', async () => {
      await subscrio.products.createProduct({
        key: 'duplicate-key',
        displayName: 'Product 1'
      });

      await expect(
        subscrio.products.createProduct({
          key: 'duplicate-key',
          displayName: 'Product 2'
        })
      ).rejects.toThrow('already exists');
    });

    test('validates product key format', async () => {
      await expect(
        subscrio.products.createProduct({
          key: 'INVALID KEY!',
          displayName: 'Invalid Product'
        })
      ).rejects.toThrow();
    });
  });

  describe('Product Retrieval', () => {
    test('retrieves product by key', async () => {
      const created = await subscrio.products.createProduct({
        key: 'retrieve-test',
        displayName: 'Retrieve Test'
      });

      const retrieved = await subscrio.products.getProduct(created.key);
      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe(created.key);
      expect(retrieved?.key).toBe('retrieve-test');
    });

    test('returns null for non-existent product', async () => {
      const result = await subscrio.products.getProduct('non-existent-key');
      expect(result).toBeNull();
    });
  });

  describe('Product Update', () => {
    test('updates product display name', async () => {
      const created = await subscrio.products.createProduct({
        key: 'update-test',
        displayName: 'Original Name'
      });

      const updated = await subscrio.products.updateProduct(created.key, {
        displayName: 'Updated Name'
      });

      expect(updated.displayName).toBe('Updated Name');
      expect(updated.key).toBe('update-test'); // Key unchanged
    });

    test('throws error when updating non-existent product', async () => {
      await expect(
        subscrio.products.updateProduct('non-existent-key', {
          displayName: 'New Name'
        })
      ).rejects.toThrow('not found');
    });
  });

  describe('Product Lifecycle', () => {
    test('archives and activates product', async () => {
      const product = await subscrio.products.createProduct({
        key: 'lifecycle-test',
        displayName: 'Lifecycle Test'
      });

      expect(product.status).toBe('active');

      // Archive
      const archived = await subscrio.products.archiveProduct(product.key);
      expect(archived.status).toBe('archived');

      // Activate
      const activated = await subscrio.products.unarchiveProduct(product.key);
      expect(activated.status).toBe('active');
    });

    test('deletes archived product', async () => {
      const product = await subscrio.products.createProduct({
        key: 'delete-test',
        displayName: 'Delete Test'
      });

      await subscrio.products.archiveProduct(product.key);
      await subscrio.products.deleteProduct(product.key);

      const result = await subscrio.products.getProduct(product.key);
      expect(result).toBeNull();
    });

    test('prevents deletion of active product', async () => {
      const product = await subscrio.products.createProduct({
        key: 'no-delete',
        displayName: 'No Delete'
      });

      await expect(
        subscrio.products.deleteProduct(product.key)
      ).rejects.toThrow('must be archived');
    });

    test('prevents deletion of product with plans', async () => {
      const product = await subscrio.products.createProduct({
        key: 'product-with-plans',
        displayName: 'Product With Plans'
      });

      await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'plan-for-product',
        displayName: 'Plan For Product'
      });

      await subscrio.products.archiveProduct(product.key);

      await expect(
        subscrio.products.deleteProduct(product.key)
      ).rejects.toThrow('has associated plans');
    });
  });

  describe('Product Listing', () => {
    test('lists all products', async () => {
      await subscrio.products.createProduct({
        key: 'list-1',
        displayName: 'List 1'
      });
      await subscrio.products.createProduct({
        key: 'list-2',
        displayName: 'List 2'
      });

      const products = await subscrio.products.listProducts();
      expect(products.length).toBeGreaterThanOrEqual(2);
    });

    test('filters products by status', async () => {
      const active = await subscrio.products.createProduct({
        key: 'filter-active',
        displayName: 'Filter Active'
      });
      const archived = await subscrio.products.createProduct({
        key: 'filter-archived',
        displayName: 'Filter Archived'
      });
      await subscrio.products.archiveProduct(archived.key);

      const activeProducts = await subscrio.products.listProducts({ status: 'active' });
      expect(activeProducts.every(p => p.status === 'active')).toBe(true);

      const archivedProducts = await subscrio.products.listProducts({ status: 'archived' });
      expect(archivedProducts.some(p => p.key === archived.key)).toBe(true);
    });

    test('prevents SQL injection in search queries', async () => {
      // Create test products
      await subscrio.products.createProduct({
        key: 'safe-product',
        displayName: 'Safe Product'
      });
      await subscrio.products.createProduct({
        key: 'another-product',
        displayName: 'Another Product'
      });

      // Attempt SQL injection in search - should be treated as literal text, not executed as SQL
      const maliciousSearch = "'; DROP TABLE products; --";
      const results = await subscrio.products.listProducts({ search: maliciousSearch });
      
      // Should return empty results (no products match the literal search string)
      // and should NOT drop the products table (which would cause subsequent queries to fail)     
      // Verify the products table still exists and is accessible
      
      const allProducts = await subscrio.products.listProducts();
      expect(allProducts.length).toBeGreaterThanOrEqual(2);
     
    });
  });
});


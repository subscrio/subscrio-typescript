import { describe, test, expect, beforeAll } from 'vitest';
import { Subscrio } from '../../src/index.js';
import { getTestConnectionString } from '../setup/get-connection.js';

describe('Features E2E Tests', () => {
  let subscrio: Subscrio;
  
  beforeAll(() => {
    subscrio = new Subscrio({
      database: { connectionString: getTestConnectionString() }
    });
  });

  describe('CRUD Operations', () => {
    test('creates a feature with valid data (toggle type)', async () => {
      const feature = await subscrio.features.createFeature({
        key: 'toggle-feature',
        displayName: 'Toggle Feature',
        description: 'A toggle feature',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      expect(feature).toBeDefined();
      expect(feature.key).toBe('toggle-feature');
      expect(feature.displayName).toBe('Toggle Feature');
      expect(feature.valueType).toBe('toggle');
      expect(feature.defaultValue).toBe('false');
      expect(feature.status).toBe('active');
    });

    test('creates a feature with valid data (numeric type)', async () => {
      const feature = await subscrio.features.createFeature({
        key: 'numeric-feature',
        displayName: 'Numeric Feature',
        valueType: 'numeric',
        defaultValue: '100'
      });

      expect(feature.valueType).toBe('numeric');
      expect(feature.defaultValue).toBe('100');
    });

    test('creates a feature with valid data (text type)', async () => {
      const feature = await subscrio.features.createFeature({
        key: 'text-feature',
        displayName: 'Text Feature',
        valueType: 'text',
        defaultValue: 'default-text'
      });

      expect(feature.valueType).toBe('text');
      expect(feature.defaultValue).toBe('default-text');
    });

    test('retrieves feature by key after creation', async () => {
      const created = await subscrio.features.createFeature({
        key: 'retrieve-feature',
        displayName: 'Retrieve Feature',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      const retrieved = await subscrio.features.getFeature(created.key);
      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe(created.key);
      expect(retrieved?.displayName).toBe(created.displayName);
    });

    test('updates feature display name', async () => {
      const feature = await subscrio.features.createFeature({
        key: 'update-name-feature',
        displayName: 'Original Name',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      const updated = await subscrio.features.updateFeature(feature.key, {
        displayName: 'Updated Name'
      });

      expect(updated.displayName).toBe('Updated Name');
    });

    test('updates feature default value', async () => {
      const feature = await subscrio.features.createFeature({
        key: `update-value-feature-${Date.now()}`,
        displayName: 'Update Value',
        valueType: 'numeric',
        defaultValue: '10'
      });

      const updated = await subscrio.features.updateFeature(feature.key, {
        defaultValue: '20'
      });

      expect(updated.defaultValue).toBe('20');
    });

    test('updates feature description', async () => {
      const feature = await subscrio.features.createFeature({
        key: 'update-desc-feature',
        displayName: 'Update Desc',
        valueType: 'toggle',
        defaultValue: 'false',
        description: 'Old description'
      });

      const updated = await subscrio.features.updateFeature(feature.key, {
        description: 'New description'
      });

      expect(updated.description).toBe('New description');
    });

    test('returns null for non-existent feature', async () => {
      const result = await subscrio.features.getFeature('non-existent-feature');
      expect(result).toBeNull();
    });

    test('throws error when updating non-existent feature', async () => {
      await expect(
        subscrio.features.updateFeature('non-existent', {
          displayName: 'New Name'
        })
      ).rejects.toThrow('not found');
    });
  });

  describe('Validation Tests', () => {
    test('throws error for empty feature key', async () => {
      await expect(
        subscrio.features.createFeature({
          key: '',
          displayName: 'Test',
          valueType: 'toggle',
          defaultValue: 'false'
        })
      ).rejects.toThrow();
    });

    test('throws error for invalid key format (spaces)', async () => {
      await expect(
        subscrio.features.createFeature({
          key: 'invalid key with spaces',
          displayName: 'Invalid',
          valueType: 'toggle',
          defaultValue: 'false'
        })
      ).rejects.toThrow();
    });

    test('throws error for invalid key format (special chars)', async () => {
      await expect(
        subscrio.features.createFeature({
          key: 'invalid@key!',
          displayName: 'Invalid',
          valueType: 'toggle',
          defaultValue: 'false'
        })
      ).rejects.toThrow();
    });

    test('throws error for duplicate feature key', async () => {
      await subscrio.features.createFeature({
        key: 'duplicate-feature',
        displayName: 'Feature 1',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await expect(
        subscrio.features.createFeature({
          key: 'duplicate-feature',
          displayName: 'Feature 2',
          valueType: 'toggle',
          defaultValue: 'false'
        })
      ).rejects.toThrow('already exists');
    });

    test('throws error for invalid valueType', async () => {
      await expect(
        subscrio.features.createFeature({
          key: 'invalid-type',
          displayName: 'Invalid Type',
          valueType: 'invalid' as any,
          defaultValue: 'false'
        })
      ).rejects.toThrow();
    });

    test('throws error for empty default value', async () => {
      await expect(
        subscrio.features.createFeature({
          key: 'empty-default',
          displayName: 'Empty Default',
          valueType: 'toggle',
          defaultValue: ''
        })
      ).rejects.toThrow();
    });

    test('allows valid key with hyphens and underscores', async () => {
      const feature = await subscrio.features.createFeature({
        key: 'valid-key_with-both',
        displayName: 'Valid Key',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      expect(feature.key).toBe('valid-key_with-both');
    });
  });

  describe('Lifecycle/Status Tests', () => {
    test('archives a feature', async () => {
      const feature = await subscrio.features.createFeature({
        key: 'archive-feature',
        displayName: 'Archive Feature',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      expect(feature.status).toBe('active');

      await subscrio.features.archiveFeature(feature.key);
      const retrieved = await subscrio.features.getFeature(feature.key);
      expect(retrieved?.status).toBe('archived');
    });

    test('unarchives a feature', async () => {
      const feature = await subscrio.features.createFeature({
        key: 'unarchive-feature',
        displayName: 'Unarchive Feature',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.features.archiveFeature(feature.key);
      await subscrio.features.unarchiveFeature(feature.key);
      
      const retrieved = await subscrio.features.getFeature(feature.key);
      expect(retrieved?.status).toBe('active');
    });

    test('deletes an archived feature', async () => {
      const feature = await subscrio.features.createFeature({
        key: 'delete-archived-feature',
        displayName: 'Delete Archived',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.features.archiveFeature(feature.key);
      await subscrio.features.deleteFeature(feature.key);

      const retrieved = await subscrio.features.getFeature(feature.key);
      expect(retrieved).toBeNull();
    });

    test('throws error when deleting active feature', async () => {
      const feature = await subscrio.features.createFeature({
        key: 'delete-active-feature',
        displayName: 'Delete Active',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await expect(
        subscrio.features.deleteFeature(feature.key)
      ).rejects.toThrow('archived');
    });

    test('prevents deletion of feature with product associations', async () => {
      const product = await subscrio.products.createProduct({
        key: 'feature-test-product',
        displayName: 'Feature Test Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'feature-with-product',
        displayName: 'Feature With Product',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      await subscrio.products.associateFeature(product.key, feature.key);
      await subscrio.features.archiveFeature(feature.key);

      await expect(
        subscrio.features.deleteFeature(feature.key)
      ).rejects.toThrow('associated with products');
    });

    test('prevents deletion of feature with plan feature values', async () => {
      const product = await subscrio.products.createProduct({
        key: 'plan-feature-test-product',
        displayName: 'Plan Feature Test Product'
      });

      const feature = await subscrio.features.createFeature({
        key: 'feature-with-plan-values',
        displayName: 'Feature With Plan Values',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      // Dissociate from product first so we can test plan feature values check
      const plan = await subscrio.plans.createPlan({
        productKey: product.key,
        key: 'plan-with-feature',
        displayName: 'Plan With Feature'
      });

      // Associate feature to product, then set plan feature value
      await subscrio.products.associateFeature(product.key, feature.key);
      await subscrio.plans.setFeatureValue(plan.key, feature.key, 'true');
      
      // Dissociate from product to test plan feature values check
      await subscrio.products.dissociateFeature(product.key, feature.key);
      
      await subscrio.features.archiveFeature(feature.key);

      await expect(
        subscrio.features.deleteFeature(feature.key)
      ).rejects.toThrow('used in plan feature values');
    });
  });

  describe('List & Filter Tests', () => {
    test('lists all features', async () => {
      await subscrio.features.createFeature({
        key: 'list-feature-1',
        displayName: 'List Feature 1',
        valueType: 'toggle',
        defaultValue: 'false'
      });
      await subscrio.features.createFeature({
        key: 'list-feature-2',
        displayName: 'List Feature 2',
        valueType: 'numeric',
        defaultValue: '10'
      });

      const features = await subscrio.features.listFeatures();
      expect(features.length).toBeGreaterThanOrEqual(2);
    });

    test('filters features by status (active)', async () => {
      await subscrio.features.createFeature({
        key: 'filter-active-feature',
        displayName: 'Filter Active',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      const activeFeatures = await subscrio.features.listFeatures({ status: 'active' });
      expect(activeFeatures.every(f => f.status === 'active')).toBe(true);
      expect(activeFeatures.length).toBeGreaterThan(0);
    });

    test('filters features by status (archived)', async () => {
      const feature = await subscrio.features.createFeature({
        key: 'filter-archived-feature',
        displayName: 'Filter Archived',
        valueType: 'toggle',
        defaultValue: 'false'
      });
      await subscrio.features.archiveFeature(feature.key);

      const archivedFeatures = await subscrio.features.listFeatures({ status: 'archived' });
      expect(archivedFeatures.some(f => f.key === feature.key)).toBe(true);
    });

    test('filters features by valueType (toggle)', async () => {
      await subscrio.features.createFeature({
        key: 'filter-toggle',
        displayName: 'Filter Toggle',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      const toggleFeatures = await subscrio.features.listFeatures({ valueType: 'toggle' });
      expect(toggleFeatures.every(f => f.valueType === 'toggle')).toBe(true);
    });

    test('filters features by valueType (numeric)', async () => {
      await subscrio.features.createFeature({
        key: 'filter-numeric',
        displayName: 'Filter Numeric',
        valueType: 'numeric',
        defaultValue: '100'
      });

      const numericFeatures = await subscrio.features.listFeatures({ valueType: 'numeric' });
      expect(numericFeatures.every(f => f.valueType === 'numeric')).toBe(true);
    });

    test('filters features by valueType (text)', async () => {
      await subscrio.features.createFeature({
        key: 'filter-text',
        displayName: 'Filter Text',
        valueType: 'text',
        defaultValue: 'text'
      });

      const textFeatures = await subscrio.features.listFeatures({ valueType: 'text' });
      expect(textFeatures.every(f => f.valueType === 'text')).toBe(true);
    });

    test('filters features by groupName', async () => {
      await subscrio.features.createFeature({
        key: 'group-feature-1',
        displayName: 'Group Feature 1',
        valueType: 'toggle',
        defaultValue: 'false',
        groupName: 'premium'
      });

      const groupFeatures = await subscrio.features.listFeatures({ groupName: 'premium' });
      expect(groupFeatures.every(f => f.groupName === 'premium')).toBe(true);
    });

    test('searches features by key', async () => {
      await subscrio.features.createFeature({
        key: 'search-unique-key',
        displayName: 'Search Feature',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      const features = await subscrio.features.listFeatures({ search: 'search-unique-key' });
      expect(features.some(f => f.key === 'search-unique-key')).toBe(true);
    });

    test('searches features by display name', async () => {
      await subscrio.features.createFeature({
        key: 'search-by-name',
        displayName: 'Very Unique Feature Name',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      const features = await subscrio.features.listFeatures({ search: 'Very Unique Feature' });
      expect(features.some(f => f.displayName.includes('Very Unique Feature'))).toBe(true);
    });

    test('paginates feature list', async () => {
      const features = await subscrio.features.listFeatures({ limit: 5 });
      expect(features.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Product Relationship Tests', () => {
    test('gets features by product key', async () => {
      const product = await subscrio.products.createProduct({
        key: 'feature-product',
        displayName: 'Feature Product'
      });

      const feature1 = await subscrio.features.createFeature({
        key: 'product-feature-1',
        displayName: 'Product Feature 1',
        valueType: 'toggle',
        defaultValue: 'false'
      });

      const feature2 = await subscrio.features.createFeature({
        key: 'product-feature-2',
        displayName: 'Product Feature 2',
        valueType: 'numeric',
        defaultValue: '10'
      });

      await subscrio.products.associateFeature(product.key, feature1.key);
      await subscrio.products.associateFeature(product.key, feature2.key);

      const features = await subscrio.features.getFeaturesByProduct(product.key);
      expect(features.length).toBe(2);
      expect(features.some(f => f.key === feature1.key)).toBe(true);
      expect(features.some(f => f.key === feature2.key)).toBe(true);
    });

    test('returns empty array for product with no features', async () => {
      const product = await subscrio.products.createProduct({
        key: 'empty-product',
        displayName: 'Empty Product'
      });

      const features = await subscrio.features.getFeaturesByProduct(product.key);
      expect(features).toEqual([]);
    });

    test('throws error when getting features for non-existent product', async () => {
      await expect(
        subscrio.features.getFeaturesByProduct('non-existent-product')
      ).rejects.toThrow('not found');
    });
  });
});


import { describe, test, expect } from 'vitest';
import { FeatureValueValidator } from '../../src/application/utils/FeatureValueValidator.js';
import { FeatureValueType } from '../../src/domain/value-objects/FeatureValueType.js';
import { ValidationError } from '../../src/application/errors/index.js';

describe('FeatureValueValidator', () => {
  describe('validate', () => {
    describe('Toggle features', () => {
      test('validates true value', () => {
        expect(() => {
          FeatureValueValidator.validate('true', FeatureValueType.Toggle);
        }).not.toThrow();
      });

      test('validates false value', () => {
        expect(() => {
          FeatureValueValidator.validate('false', FeatureValueType.Toggle);
        }).not.toThrow();
      });

      test('validates TRUE (case insensitive)', () => {
        expect(() => {
          FeatureValueValidator.validate('TRUE', FeatureValueType.Toggle);
        }).not.toThrow();
      });

      test('validates False (case insensitive)', () => {
        expect(() => {
          FeatureValueValidator.validate('False', FeatureValueType.Toggle);
        }).not.toThrow();
      });

      test('throws for invalid toggle value', () => {
        expect(() => {
          FeatureValueValidator.validate('maybe', FeatureValueType.Toggle);
        }).toThrow(ValidationError);
      });

      test('throws for numeric toggle value', () => {
        expect(() => {
          FeatureValueValidator.validate('1', FeatureValueType.Toggle);
        }).toThrow(ValidationError);
      });
    });

    describe('Numeric features', () => {
      test('validates positive integer', () => {
        expect(() => {
          FeatureValueValidator.validate('42', FeatureValueType.Numeric);
        }).not.toThrow();
      });

      test('validates zero', () => {
        expect(() => {
          FeatureValueValidator.validate('0', FeatureValueType.Numeric);
        }).not.toThrow();
      });

      test('validates negative number', () => {
        expect(() => {
          FeatureValueValidator.validate('-5', FeatureValueType.Numeric);
        }).not.toThrow();
      });

      test('validates decimal number', () => {
        expect(() => {
          FeatureValueValidator.validate('3.14', FeatureValueType.Numeric);
        }).not.toThrow();
      });

      test('throws for non-numeric value', () => {
        expect(() => {
          FeatureValueValidator.validate('not-a-number', FeatureValueType.Numeric);
        }).toThrow(ValidationError);
      });

      test('throws for NaN', () => {
        expect(() => {
          FeatureValueValidator.validate('NaN', FeatureValueType.Numeric);
        }).toThrow(ValidationError);
      });

      test('throws for Infinity', () => {
        expect(() => {
          FeatureValueValidator.validate('Infinity', FeatureValueType.Numeric);
        }).toThrow(ValidationError);
      });
    });

    describe('Text features', () => {
      test('validates any string value', () => {
        expect(() => {
          FeatureValueValidator.validate('any text', FeatureValueType.Text);
        }).not.toThrow();
      });

      test('validates empty string', () => {
        expect(() => {
          FeatureValueValidator.validate('', FeatureValueType.Text);
        }).not.toThrow();
      });

      test('validates special characters', () => {
        expect(() => {
          FeatureValueValidator.validate('!@#$%^&*()', FeatureValueType.Text);
        }).not.toThrow();
      });

      test('validates unicode characters', () => {
        expect(() => {
          FeatureValueValidator.validate('🚀 emoji text', FeatureValueType.Text);
        }).not.toThrow();
      });
    });

    describe('Unknown feature types', () => {
      test('throws for unknown feature type', () => {
        expect(() => {
          FeatureValueValidator.validate('value', 'unknown' as FeatureValueType);
        }).toThrow(ValidationError);
      });
    });
  });
});

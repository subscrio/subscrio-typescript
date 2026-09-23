import { FeatureValueType } from "../../domain/value-objects/FeatureValueType.js";
import { ValidationError } from "../errors/index.js";

/**
 * Shared utility for validating feature values based on their type
 */
export class FeatureValueValidator {
  /**
   * Validate a feature value against its type
   * @param value - The value to validate
   * @param valueType - The type of the feature
   * @throws {ValidationError} If the value is invalid for the type
   */
  static tryValidate(
    value: string,
    valueType: FeatureValueType,
  ): { ok: true } | { ok: false; message: string } {
    try {
      this.validate(value, valueType);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  static isValid(value: string, valueType: FeatureValueType): boolean {
    return this.tryValidate(value, valueType).ok;
  }

  static validate(value: string, valueType: FeatureValueType): void {
    switch (valueType) {
      case FeatureValueType.Toggle:
        if (!["true", "false"].includes(value.toLowerCase())) {
          throw new ValidationError(
            'Toggle features must have value "true" or "false"',
          );
        }
        break;
      case FeatureValueType.Numeric:
        const num = Number(value);
        if (isNaN(num) || !isFinite(num)) {
          throw new ValidationError(
            "Numeric features must have a valid number value",
          );
        }
        break;
      case FeatureValueType.Metered:
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
          throw new ValidationError(
            "Metered values must be nonnegative safe integers",
          );
        break;
      case FeatureValueType.Text:
        break;
      default:
        throw new ValidationError(`Unknown feature value type: ${valueType}`);
    }
  }
}

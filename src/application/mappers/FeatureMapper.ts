import { Feature } from '../../domain/entities/Feature.js';
import { FeatureDto } from '../dtos/FeatureDto.js';
import { FeatureStatus } from '../../domain/value-objects/FeatureStatus.js';
import { FeatureValueType } from '../../domain/value-objects/FeatureValueType.js';

export class FeatureMapper {
  static toDto(feature: Feature): FeatureDto {
    return {
      key: feature.key,
      displayName: feature.displayName,
      description: feature.props.description ?? null,
      valueType: feature.valueType,
      defaultValue: feature.defaultValue,
      groupName: feature.props.groupName ?? null,
      status: feature.status,
      validator: feature.props.validator ?? null,
      metadata: feature.props.metadata ?? null,
      createdAt: feature.props.createdAt.toISOString(),
      updatedAt: feature.props.updatedAt.toISOString()
    };
  }

  static toDomain(raw: any): Feature {
    return new Feature(
      {
        key: raw.key,
        displayName: raw.display_name,
        description: raw.description,
        valueType: raw.value_type as FeatureValueType,
        defaultValue: raw.default_value,
        groupName: raw.group_name,
        status: raw.status as FeatureStatus,
        validator: raw.validator,
        metadata: raw.metadata,
        createdAt: new Date(raw.created_at),
        updatedAt: new Date(raw.updated_at)
      },
      raw.id as number | undefined
    );
  }

  static toPersistence(feature: Feature): any {
    const record: any = {
      key: feature.key,
      display_name: feature.displayName,
      description: feature.props.description,
      value_type: feature.valueType,
      default_value: feature.defaultValue,
      group_name: feature.props.groupName,
      status: feature.status,
      validator: feature.props.validator,
      metadata: feature.props.metadata,
      created_at: feature.props.createdAt,
      updated_at: feature.props.updatedAt
    };
    
    // Only include id for updates (not inserts)
    if (feature.id !== undefined) {
      record.id = feature.id;
    }
    
    return record;
  }
}


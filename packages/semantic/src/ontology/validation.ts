// Runtime validation driven by the ontology definitions.
//
// The API calls `validateActionParameters` before dispatching a write, so a
// malformed payload is rejected with a readable message instead of reaching
// Prisma. Front-ends can call the same function to validate a form before it is
// ever sent.

import type {
  ActionTypeDefinition,
  BaseType,
  ObjectTypeDefinition,
  ValidationIssue,
  ValidationResult,
} from './types';
import { getValueType } from './valueTypes';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function describeType(baseType: BaseType): string {
  return baseType;
}

/**
 * Checks a single value against a base type. Returns null when the value fits,
 * otherwise a message describing what was expected.
 */
export function checkBaseType(value: unknown, baseType: BaseType): string | null {
  switch (baseType) {
    case 'string':
      return typeof value === 'string' ? null : 'expected a string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
        ? null
        : 'expected an integer';
    case 'double':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : 'expected a number';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected a boolean';
    case 'date':
    case 'timestamp':
      if (value instanceof Date) return null;
      return typeof value === 'string' ? null : 'expected a date string';
    case 'string[]':
      if (!Array.isArray(value)) return 'expected an array of strings';
      return value.every((entry) => typeof entry === 'string')
        ? null
        : 'expected every entry to be a string';
    case 'integer[]':
      if (!Array.isArray(value)) return 'expected an array of integers';
      return value.every((entry) => Number.isInteger(entry))
        ? null
        : 'expected every entry to be an integer';
    case 'struct':
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? null
        : 'expected an object';
    case 'struct[]':
      if (!Array.isArray(value)) return 'expected an array of objects';
      return value.every(
        (entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      )
        ? null
        : 'expected every entry to be an object';
    case 'json':
      return value === undefined ? 'expected a value' : null;
    default:
      return null;
  }
}

function checkValueType(
  value: unknown,
  valueTypeName: string,
  baseType: BaseType
): string | null {
  const valueType = getValueType(valueTypeName);
  if (!valueType) return null;

  const members = Array.isArray(value) ? value : [value];
  const offender = members.find(
    (member) => !valueType.values.some((allowed) => allowed === member)
  );
  if (offender === undefined) return null;

  return `${JSON.stringify(offender)} is not a valid ${valueTypeName}; expected one of ${valueType.values
    .map((allowed) => JSON.stringify(allowed))
    .join(', ')}${baseType.endsWith('[]') ? ' for every entry' : ''}`;
}

function looksLikeDate(value: unknown): boolean {
  return typeof value !== 'string' || ISO_DATE.test(value);
}

function ok(errors: ValidationIssue[], warnings: ValidationIssue[]): ValidationResult {
  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates an action payload against its definition.
 *
 * Missing required parameters, wrong scalar shapes and out-of-enum values are
 * errors. Unknown parameters are warnings — handlers are free to accept extra
 * context, and we would rather surface drift than break a caller.
 */
export function validateActionParameters(
  action: ActionTypeDefinition,
  params: unknown
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    errors.push({ field: 'params', message: 'expected an object of parameters' });
    return ok(errors, warnings);
  }

  const payload = params as Record<string, unknown>;

  for (const definition of Object.values(action.parameters)) {
    const value = payload[definition.apiName];
    const absent = value === undefined || value === null;

    if (absent) {
      if (definition.required) {
        errors.push({
          field: definition.apiName,
          message: `${definition.displayName} is required`,
        });
      }
      continue;
    }

    const typeError = checkBaseType(value, definition.baseType);
    if (typeError) {
      errors.push({
        field: definition.apiName,
        message: `${definition.displayName}: ${typeError}`,
      });
      continue;
    }

    if (definition.valueType) {
      const valueError = checkValueType(value, definition.valueType, definition.baseType);
      if (valueError) {
        errors.push({
          field: definition.apiName,
          message: `${definition.displayName}: ${valueError}`,
        });
        continue;
      }
    }

    if (definition.baseType === 'date' && !looksLikeDate(value)) {
      warnings.push({
        field: definition.apiName,
        message: `${definition.displayName}: expected YYYY-MM-DD, got ${JSON.stringify(value)}`,
      });
    }
  }

  for (const key of Object.keys(payload)) {
    if (!action.parameters[key]) {
      warnings.push({
        field: key,
        message: `${key} is not a declared parameter of ${action.apiName}`,
      });
    }
  }

  return ok(errors, warnings);
}

/**
 * Validates a bag of properties against an object type. Used for seed data and
 * sync payloads; `partial` skips the "missing property" check so it can also
 * validate a patch.
 */
export function validateObjectProperties(
  objectType: ObjectTypeDefinition,
  properties: unknown,
  options: { partial?: boolean } = {}
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
    errors.push({ field: 'properties', message: 'expected an object of properties' });
    return ok(errors, warnings);
  }

  const payload = properties as Record<string, unknown>;

  for (const definition of Object.values(objectType.properties)) {
    const value = payload[definition.apiName];
    const absent = value === undefined || value === null;

    if (absent) {
      if (!options.partial && !definition.nullable) {
        errors.push({
          field: definition.apiName,
          message: `${definition.displayName} is missing`,
        });
      }
      continue;
    }

    const typeError = checkBaseType(value, definition.baseType);
    if (typeError) {
      errors.push({
        field: definition.apiName,
        message: `${definition.displayName}: ${typeError} (${describeType(definition.baseType)})`,
      });
      continue;
    }

    if (definition.valueType) {
      const valueError = checkValueType(value, definition.valueType, definition.baseType);
      if (valueError) {
        errors.push({
          field: definition.apiName,
          message: `${definition.displayName}: ${valueError}`,
        });
      }
    }
  }

  for (const key of Object.keys(payload)) {
    if (!objectType.properties[key]) {
      warnings.push({
        field: key,
        message: `${key} is not a declared property of ${objectType.apiName}`,
      });
    }
  }

  return ok(errors, warnings);
}

/** Joins validation errors into a single message for HTTP responses. */
export function formatValidationErrors(result: ValidationResult): string {
  return result.errors.map((issue) => issue.message).join('; ');
}

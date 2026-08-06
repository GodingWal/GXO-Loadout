import { describe, expect, it } from 'vitest';
import {
  ACTION_TYPES,
  LINK_TYPES,
  OBJECT_TYPES,
  VALUE_TYPES,
  getActionType,
  getActionsForObjectType,
  getLinksForObjectType,
  getObjectType,
  getObjectTypeByApiPath,
  getOntologyMetadata,
  getValueLabel,
  isAllowedValue,
  listReadableApiPaths,
  resolveLink,
  validateActionParameters,
  validateObjectProperties,
} from '../src/ontology';

const objectTypes = Object.values(OBJECT_TYPES);
const linkTypes = Object.values(LINK_TYPES);
const actionTypes = Object.values(ACTION_TYPES);
const valueTypes = Object.values(VALUE_TYPES);

describe('ontology integrity', () => {
  it('keys every registry by its own apiName', () => {
    for (const [key, definition] of Object.entries(OBJECT_TYPES)) {
      expect(definition.apiName).toBe(key);
    }
    for (const [key, definition] of Object.entries(LINK_TYPES)) {
      expect(definition.apiName).toBe(key);
    }
    for (const [key, definition] of Object.entries(ACTION_TYPES)) {
      expect(definition.apiName).toBe(key);
    }
    for (const [key, definition] of Object.entries(VALUE_TYPES)) {
      expect(definition.apiName).toBe(key);
    }
  });

  it('keys every property and parameter by its own apiName', () => {
    for (const objectType of objectTypes) {
      for (const [key, property] of Object.entries(objectType.properties)) {
        expect(property.apiName).toBe(key);
      }
    }
    for (const action of actionTypes) {
      for (const [key, parameter] of Object.entries(action.parameters)) {
        expect(parameter.apiName).toBe(key);
      }
    }
  });

  it('gives every object type a unique api path', () => {
    const paths = listReadableApiPaths();
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('points title and status properties at declared properties', () => {
    for (const objectType of objectTypes) {
      expect(
        objectType.titleProperty === objectType.primaryKey ||
          objectType.properties[objectType.titleProperty]
      ).toBeTruthy();
      if (objectType.statusProperty) {
        expect(objectType.properties[objectType.statusProperty]).toBeDefined();
      }
    }
  });

  it('resolves every value type reference', () => {
    for (const objectType of objectTypes) {
      for (const property of Object.values(objectType.properties)) {
        if (property.valueType) {
          expect(VALUE_TYPES, `${objectType.apiName}.${property.apiName}`).toHaveProperty(
            property.valueType
          );
        }
      }
    }
    for (const action of actionTypes) {
      for (const parameter of Object.values(action.parameters)) {
        if (parameter.valueType) {
          expect(VALUE_TYPES, `${action.apiName}.${parameter.apiName}`).toHaveProperty(
            parameter.valueType
          );
        }
      }
    }
  });

  it('resolves every object type reference on links and actions', () => {
    for (const link of linkTypes) {
      expect(getObjectType(link.sourceObjectType), link.apiName).toBeDefined();
      expect(getObjectType(link.targetObjectType), link.apiName).toBeDefined();
      const target = getObjectType(link.targetObjectType)!;
      const source = getObjectType(link.sourceObjectType)!;
      // The foreign key lives on one side or the other, depending on direction.
      expect(
        target.properties[link.foreignKeyProperty] ??
          source.properties[link.foreignKeyProperty],
        `${link.apiName}.${link.foreignKeyProperty}`
      ).toBeDefined();
    }

    for (const action of actionTypes) {
      for (const objectTypeApiName of action.appliesTo) {
        expect(getObjectType(objectTypeApiName), action.apiName).toBeDefined();
      }
      for (const effect of action.effects) {
        expect(getObjectType(effect.objectType), action.apiName).toBeDefined();
      }
      for (const parameter of Object.values(action.parameters)) {
        if (parameter.referencesObjectType) {
          expect(getObjectType(parameter.referencesObjectType), action.apiName).toBeDefined();
        }
      }
    }
  });

  it('declares non-empty value types with labels that resolve', () => {
    for (const valueType of valueTypes) {
      expect(valueType.values.length, valueType.apiName).toBeGreaterThan(0);
      for (const value of valueType.values) {
        expect(isAllowedValue(valueType.apiName, value)).toBe(true);
        expect(getValueLabel(valueType.apiName, value)).toBeTruthy();
      }
    }
  });

  it('exposes every relational object type over HTTP', () => {
    for (const objectType of objectTypes) {
      if (objectType.storage === 'RELATIONAL') {
        expect(objectType.apiPath, objectType.apiName).not.toBeNull();
        expect(objectType.backingModel, objectType.apiName).toBeDefined();
      }
    }
  });
});

describe('lookups', () => {
  it('finds object types by apiName and api path', () => {
    expect(getObjectType('StagingLane')?.displayName).toBe('Staging Lane');
    expect(getObjectTypeByApiPath('staging-lanes')?.apiName).toBe('StagingLane');
    expect(getObjectTypeByApiPath('nope')).toBeUndefined();
  });

  it('finds the links touching an object type', () => {
    const apiNames = getLinksForObjectType('Pallet').map((link) => link.apiName);
    expect(apiNames).toContain('load-pallets');
    expect(apiNames).toContain('lane-pallets');
    expect(apiNames).toContain('pallet-inspections');
  });

  it('resolves traversal in both directions', () => {
    expect(resolveLink('Load', 'Pallet')).toMatchObject({
      direction: 'SOURCE_TO_TARGET',
      accessor: 'pallets',
      foreignKeyProperty: 'loadId',
    });
    expect(resolveLink('Pallet', 'Load')).toMatchObject({
      direction: 'TARGET_TO_SOURCE',
      accessor: 'load',
    });
    expect(resolveLink('Pallet', 'Contact')).toBeUndefined();
  });

  it('finds the actions that write an object type', () => {
    const apiNames = getActionsForObjectType('Contact').map((action) => action.apiName);
    expect(apiNames).toEqual(['CreateContact', 'UpdateContact', 'DeleteContact']);
  });

  it('serializes a metadata snapshot', () => {
    const metadata = getOntologyMetadata();
    expect(metadata.objectTypes.length).toBe(objectTypes.length);
    expect(metadata.linkTypes.length).toBe(linkTypes.length);
    expect(metadata.actionTypes.length).toBe(actionTypes.length);
    expect(metadata.valueTypes.length).toBe(valueTypes.length);
    expect(() => JSON.stringify(metadata)).not.toThrow();
  });
});

describe('action parameter validation', () => {
  it('accepts a well-formed payload', () => {
    const result = validateActionParameters(getActionType('CreateRating')!, {
      employeeId: 4,
      skill: 'Cycle counting',
      rating: 3,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects missing required parameters', () => {
    const result = validateActionParameters(getActionType('CheckInAppointment')!, {});
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('appointmentId');
  });

  it('rejects the wrong scalar shape', () => {
    const result = validateActionParameters(getActionType('DeleteSkill')!, { id: '7' });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('expected an integer');
  });

  it('rejects values outside a value type', () => {
    const result = validateActionParameters(getActionType('UpdateCoachingStatus')!, {
      id: 1,
      status: 'Archived',
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('not a valid CoachingStatus');
  });

  it('treats undeclared parameters as warnings, not errors', () => {
    const result = validateActionParameters(getActionType('DeleteContact')!, {
      id: 1,
      updatedBy: 'kiosk-3',
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.map((warning) => warning.field)).toEqual(['updatedBy']);
  });

  it('allows optional parameters to be absent or null', () => {
    const result = validateActionParameters(getActionType('CreatePitTask')!, {
      appointmentId: 12,
      type: null,
    });
    expect(result.valid).toBe(true);
  });
});

describe('object property validation', () => {
  const pallet = getObjectType('Pallet')!;

  it('accepts a complete record', () => {
    const result = validateObjectProperties(pallet, {
      barcode: 'LPN-0001',
      productType: 'Corn',
      packagingType: '48x40',
      isFlagged: false,
      loadId: 'load-1',
      stagingLaneId: null,
    });
    expect(result.valid).toBe(true);
  });

  it('flags a missing non-nullable property', () => {
    const result = validateObjectProperties(pallet, { isFlagged: false });
    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.field)).toContain('barcode');
  });

  it('skips the missing check in partial mode but still checks types', () => {
    expect(validateObjectProperties(pallet, { isFlagged: false }, { partial: true }).valid).toBe(
      true
    );
    const bad = validateObjectProperties(pallet, { isFlagged: 'no' }, { partial: true });
    expect(bad.valid).toBe(false);
  });
});

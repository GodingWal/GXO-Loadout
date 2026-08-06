// The GXO ontology: one description of every object type, link and action in
// the system, shared by the API, the four front-ends and the offline-first
// Loadout records.
//
//   ontology.objectTypes  — what we store
//   ontology.linkTypes    — how records relate
//   ontology.actionTypes  — how records change
//   ontology.valueTypes   — the closed sets a field may hold
//
// Definitions live in sibling files; this module adds lookup and traversal
// helpers, plus the serializable `getOntologyMetadata()` snapshot the API serves
// at `GET /api/ontology/$metadata`.

import { OBJECT_TYPES } from './objectTypes';
import { LINK_TYPES } from './linkTypes';
import { ACTION_TYPES } from './actionTypes';
import { VALUE_TYPES } from './valueTypes';
import type {
  ActionTypeDefinition,
  LinkTypeDefinition,
  ObjectTypeDefinition,
  OntologyDomain,
  PropertyDefinition,
  ValueTypeDefinition,
} from './types';

export * from './types';
export * from './valueTypes';
export { OBJECT_TYPES, type ObjectTypeApiName } from './objectTypes';
export { LINK_TYPES, type LinkTypeApiName } from './linkTypes';
export { ACTION_TYPES, type ActionTypeApiName } from './actionTypes';
export * from './validation';

export const ONTOLOGY_VERSION = '1.0.0';

const objectTypeList = Object.values(OBJECT_TYPES) as readonly ObjectTypeDefinition[];
const linkTypeList = Object.values(LINK_TYPES) as readonly LinkTypeDefinition[];
const actionTypeList = Object.values(ACTION_TYPES) as readonly ActionTypeDefinition[];
const valueTypeList = Object.values(VALUE_TYPES) as readonly ValueTypeDefinition[];

// ─── Object types ────────────────────────────────────────────────────

export function listObjectTypes(domain?: OntologyDomain): readonly ObjectTypeDefinition[] {
  return domain ? objectTypeList.filter((type) => type.domain === domain) : objectTypeList;
}

/** Look up an object type by its PascalCase apiName, e.g. `StagingLane`. */
export function getObjectType(apiName: string): ObjectTypeDefinition | undefined {
  return (OBJECT_TYPES as Record<string, ObjectTypeDefinition>)[apiName];
}

/** Look up an object type by its URL segment, e.g. `staging-lanes`. */
export function getObjectTypeByApiPath(apiPath: string): ObjectTypeDefinition | undefined {
  return objectTypeList.find((type) => type.apiPath === apiPath);
}

/** URL segments served by `GET /api/ontology/{apiPath}`, in registry order. */
export function listReadableApiPaths(): string[] {
  return objectTypeList
    .map((type) => type.apiPath)
    .filter((apiPath): apiPath is string => apiPath !== null);
}

export function getProperty(
  objectTypeApiName: string,
  propertyApiName: string
): PropertyDefinition | undefined {
  return getObjectType(objectTypeApiName)?.properties[propertyApiName];
}

// ─── Links ───────────────────────────────────────────────────────────

export function listLinkTypes(): readonly LinkTypeDefinition[] {
  return linkTypeList;
}

export function getLinkType(apiName: string): LinkTypeDefinition | undefined {
  return (LINK_TYPES as Record<string, LinkTypeDefinition>)[apiName];
}

/** Every link that touches the given object type, in either direction. */
export function getLinksForObjectType(objectTypeApiName: string): readonly LinkTypeDefinition[] {
  return linkTypeList.filter(
    (link) =>
      link.sourceObjectType === objectTypeApiName ||
      link.targetObjectType === objectTypeApiName
  );
}

/**
 * Resolves how to traverse from one object type to another: the link to follow,
 * the accessor name and the foreign key that carries the relationship.
 * Returns undefined when the two types are not directly linked.
 */
export function resolveLink(
  fromObjectType: string,
  toObjectType: string
):
  | {
      link: LinkTypeDefinition;
      direction: 'SOURCE_TO_TARGET' | 'TARGET_TO_SOURCE';
      accessor: string;
      foreignKeyProperty: string;
    }
  | undefined {
  for (const link of linkTypeList) {
    if (link.sourceObjectType === fromObjectType && link.targetObjectType === toObjectType) {
      return {
        link,
        direction: 'SOURCE_TO_TARGET',
        accessor: link.sourceToTarget,
        foreignKeyProperty: link.foreignKeyProperty,
      };
    }
    if (link.targetObjectType === fromObjectType && link.sourceObjectType === toObjectType) {
      return {
        link,
        direction: 'TARGET_TO_SOURCE',
        accessor: link.targetToSource,
        foreignKeyProperty: link.foreignKeyProperty,
      };
    }
  }
  return undefined;
}

// ─── Actions ─────────────────────────────────────────────────────────

export function listActionTypes(domain?: OntologyDomain): readonly ActionTypeDefinition[] {
  return domain ? actionTypeList.filter((action) => action.domain === domain) : actionTypeList;
}

export function getActionType(apiName: string): ActionTypeDefinition | undefined {
  return (ACTION_TYPES as Record<string, ActionTypeDefinition>)[apiName];
}

/** Actions that write the given object type. */
export function getActionsForObjectType(objectTypeApiName: string): readonly ActionTypeDefinition[] {
  return actionTypeList.filter((action) =>
    action.effects.some((effect) => effect.objectType === objectTypeApiName)
  );
}

// ─── Metadata snapshot ───────────────────────────────────────────────

export interface OntologyMetadata {
  version: string;
  objectTypes: readonly ObjectTypeDefinition[];
  linkTypes: readonly LinkTypeDefinition[];
  actionTypes: readonly ActionTypeDefinition[];
  valueTypes: readonly ValueTypeDefinition[];
}

/** JSON-serializable description of the whole ontology. */
export function getOntologyMetadata(): OntologyMetadata {
  return {
    version: ONTOLOGY_VERSION,
    objectTypes: objectTypeList,
    linkTypes: linkTypeList,
    actionTypes: actionTypeList,
    valueTypes: valueTypeList,
  };
}

/** Convenience aggregate for callers that prefer one import. */
export const ontology = {
  version: ONTOLOGY_VERSION,
  objectTypes: OBJECT_TYPES,
  linkTypes: LINK_TYPES,
  actionTypes: ACTION_TYPES,
  valueTypes: VALUE_TYPES,
  getObjectType,
  getObjectTypeByApiPath,
  getLinkType,
  getLinksForObjectType,
  getActionType,
  getActionsForObjectType,
  resolveLink,
  getMetadata: getOntologyMetadata,
} as const;

// The metadata model that describes the GXO ontology.
//
// Everything under `src/ontology/` is *data about our data*: which object types
// exist, what properties they carry, how they link together, and which actions
// are allowed to mutate them. The hand-written interfaces in `types/ontology.ts`
// stay the compile-time face of the ontology; the definitions here are the
// runtime face — routable, validatable, and introspectable over HTTP.

/** Operational domain an object/action belongs to. Maps to the apps in /apps. */
export type OntologyDomain = 'loadout' | 'dockx' | 'opshub';

/** Where the records of an object type actually live. */
export type StorageKind =
  /** Prisma/SQLite behind the Azure Functions API. */
  | 'RELATIONAL'
  /** IndexedDB on the device, synced up later (offline-first Loadout records). */
  | 'LOCAL_FIRST';

/** Scalar shapes a property or action parameter can take. */
export type BaseType =
  | 'string'
  | 'integer'
  | 'double'
  | 'boolean'
  | 'date' // calendar date, 'YYYY-MM-DD'
  | 'timestamp' // ISO-8601 instant
  | 'string[]'
  | 'integer[]'
  | 'struct'
  | 'struct[]'
  | 'json';

// ─── Value types (shared enumerations) ───────────────────────────────

/**
 * A named, closed set of allowed values plus display labels. Value types are
 * declared once and referenced by properties and action parameters, so a status
 * string means the same thing on the tablet, in the API and in the database.
 */
export interface ValueTypeDefinition {
  apiName: string;
  displayName: string;
  description: string;
  /** Allowed values, in display order. */
  values: readonly (string | number)[];
  /** Human labels keyed by value. Falls back to the raw value when absent. */
  labels?: Readonly<Record<string | number, string>>;
}

// ─── Object types ────────────────────────────────────────────────────

export interface PropertyDefinition {
  apiName: string;
  displayName: string;
  baseType: BaseType;
  /** True when the property may be null/absent on a stored record. */
  nullable?: boolean;
  /** References a ValueTypeDefinition apiName; constrains the allowed values. */
  valueType?: string;
  description?: string;
}

export interface ObjectTypeDefinition {
  /** Stable identifier, PascalCase. Matches the `objectType` on SDK objects. */
  apiName: string;
  displayName: string;
  pluralDisplayName: string;
  description: string;
  domain: OntologyDomain;
  storage: StorageKind;
  /**
   * URL segment served by `GET /api/ontology/{apiPath}`. Null for object types
   * that are not (yet) exposed as a read endpoint.
   */
  apiPath: string | null;
  /** Underlying Prisma model name, when the object type is relational. */
  backingModel?: string;
  primaryKey: string;
  primaryKeyType: 'string' | 'integer';
  /** Property used when rendering a single record as a label. */
  titleProperty: string;
  /** Property holding lifecycle state, if the object type has one. */
  statusProperty?: string;
  properties: Readonly<Record<string, PropertyDefinition>>;
}

// ─── Link types ──────────────────────────────────────────────────────

export type LinkCardinality = 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_ONE';

/**
 * A traversable relationship between two object types. The link is always
 * declared from the "one" side: `source` holds the parent, `target` the child,
 * and `foreignKeyProperty` is the property on the *target* pointing back.
 */
export interface LinkTypeDefinition {
  apiName: string;
  displayName: string;
  description: string;
  cardinality: LinkCardinality;
  sourceObjectType: string;
  targetObjectType: string;
  /** Property on the target object type holding the source's primary key. */
  foreignKeyProperty: string;
  /** Accessor name when traversing source → target. */
  sourceToTarget: string;
  /** Accessor name when traversing target → source. */
  targetToSource: string;
}

// ─── Action types ────────────────────────────────────────────────────

export type MutationKind = 'CREATE' | 'MODIFY' | 'DELETE';

export interface ActionParameterDefinition {
  apiName: string;
  displayName: string;
  baseType: BaseType;
  required: boolean;
  /** References a ValueTypeDefinition apiName; constrains the allowed values. */
  valueType?: string;
  /** Set when the parameter carries the primary key of another object type. */
  referencesObjectType?: string;
  description?: string;
}

export interface ActionEffect {
  objectType: string;
  kind: MutationKind;
}

/**
 * A verb. Every write in the system goes through
 * `POST /api/ontology/actions` with one of these `apiName`s, so this registry
 * is the complete list of ways our data can change.
 */
export interface ActionTypeDefinition {
  apiName: string;
  displayName: string;
  description: string;
  domain: OntologyDomain;
  /** Object types this action reads or is invoked on. */
  appliesTo: readonly string[];
  /** What the action writes. */
  effects: readonly ActionEffect[];
  parameters: Readonly<Record<string, ActionParameterDefinition>>;
}

// ─── Validation ──────────────────────────────────────────────────────

export interface ValidationIssue {
  /** Parameter or property name the issue is about. */
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  /** Problems that must block the write. */
  errors: ValidationIssue[];
  /** Non-blocking observations, e.g. parameters not in the definition. */
  warnings: ValidationIssue[];
}

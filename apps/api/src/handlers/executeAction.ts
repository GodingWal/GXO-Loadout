import { actionRegistry } from '../actions';
import { InvocationContext } from '@azure/functions';
import {
    formatValidationErrors,
    getActionType,
    validateActionParameters,
    type ActionTypeApiName,
} from '@gxo/semantic';

export async function executeActionHandler(payload: any, context?: InvocationContext) {
    const { actionType, params } = payload ?? {};

    // The ontology is the contract: an action must be declared there and a
    // handler must be registered for it before anything touches the database.
    const definition = getActionType(actionType);
    if (!definition) {
        throw new Error(`Action type '${actionType}' is not part of the ontology.`);
    }

    const matchedAction = actionRegistry[definition.apiName as ActionTypeApiName];
    if (!matchedAction) {
        throw new Error(`Action type '${actionType}' is not supported by the local backend.`);
    }

    const validation = validateActionParameters(definition, params ?? {});
    if (!validation.valid) {
        throw new Error(`${definition.apiName}: ${formatValidationErrors(validation)}`);
    }
    for (const warning of validation.warnings) {
        context?.warn?.(`${definition.apiName}: ${warning.message}`);
    }

    // Pass the parameters directly into your isolated action file
    return await matchedAction(params);
}

export let jsonObjMetaData: any = null;
export const stringLiteralTypes: { [name: string]: string } = {};

/**
 * Supplies the runtime Serializer (survey-core `Serializer`) whose metadata is
 * joined onto the AST members. Optional: survey-creator generates docs without one.
 */
export function setJsonObj(obj: any): void {
  jsonObjMetaData = obj;
}

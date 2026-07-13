import { GenerationContext } from "./context";
import { DocEntry } from "./types";

/**
 * Builds the JSON definition from the **AST** doc model (`--json-definition=ast`).
 *
 * This is not the same document as `Serializer.generateSchema()`
 * (`--json-definition=runtime`): it is derived from the TypeScript sources
 * rather than from what the library actually serializes. Both are kept; see the
 * README for which one a consumer wants.
 */
export function addClassIntoJSONDefinition(
  ctx: GenerationContext,
  className: string,
  isRoot: boolean = false
): void {
  if (className == "IElement") {
    className = "SurveyElement";
  }
  if (!!ctx.generateJSONDefinitionClasses[className]) return;
  ctx.generateJSONDefinitionClasses[className] = true;
  const cur = ctx.classesHash[className];
  if (!isRoot && (!cur || !hasSerializedProperties(ctx, className))) {
    addChildrenClasses(ctx, className);
    return;
  }
  if (!cur || (!isRoot && hasClassInJSONDefinition(ctx, <string>cur.jsonName))) return;
  let root = ctx.outputDefinition;
  if (!isRoot) {
    if (!ctx.outputDefinition["definitions"]) {
      ctx.outputDefinition["definitions"] = {};
    }
    ctx.outputDefinition["definitions"][<string>cur.jsonName] = {};
    root = ctx.outputDefinition["definitions"][<string>cur.jsonName];
    root["$id"] = "#" + cur.jsonName;
  }
  root["type"] = "object";
  addPropertiesIntoJSONDefinion(ctx, cur, root);
  if (!isRoot) {
    addParentClass(ctx, cur, root);
    addChildrenClasses(ctx, <string>cur.name);
  }
}
function addParentClass(ctx: GenerationContext, cur: DocEntry, root: any): void {
  if (!cur.baseType) return;
  addClassIntoJSONDefinition(ctx, cur.baseType);
  const parentClass = ctx.classesHash[cur.baseType];
  if (!!parentClass && hasClassInJSONDefinition(ctx, <string>parentClass.jsonName)) {
    const properties = root["properties"];
    delete root["properties"];
    root["allOff"] = [
      { $ref: "#" + parentClass.jsonName },
      { properties: properties },
    ];
  }
}
function addChildrenClasses(ctx: GenerationContext, className: string): void {
  for (let i = 0; i < ctx.outputClasses.length; i++) {
    if (ctx.outputClasses[i].baseType == className) {
      addClassIntoJSONDefinition(ctx, <string>ctx.outputClasses[i].name);
    }
  }
}

function hasClassInJSONDefinition(ctx: GenerationContext, className: string): boolean {
  return (
    !!ctx.outputDefinition["definitions"] &&
    !!ctx.outputDefinition["definitions"][className]
  );
}
function addPropertiesIntoJSONDefinion(ctx: GenerationContext, cur: DocEntry, jsonDef: any): void {
  for (let i = 0; i < ctx.outputPMEs.length; i++) {
    const property = ctx.outputPMEs[i];
    if (property.className !== cur.name || !property.isSerialized)
      continue;
    addPropertyIntoJSONDefinion(ctx, property, jsonDef);
  }
}
function hasSerializedProperties(ctx: GenerationContext, className: string): boolean {
  for (let i = 0; i < ctx.outputPMEs.length; i++) {
    const property = ctx.outputPMEs[i];
    if (property.className == className && property.isSerialized) return true;
  }
  return false;
}
function addPropertyIntoJSONDefinion(ctx: GenerationContext, property: DocEntry, jsonDef: any): void {
  if (!jsonDef.properties) {
    jsonDef.properties = {};
  }
  const properties = jsonDef.properties;
  const typeName = property.type;
  const isArray = !!typeName && typeName.indexOf("[]") > -1;
  if (!!property.jsonClassName || isArray) {
    addClassIntoJSONDefinition(ctx, (<string>typeName).replace("[]", ""));
  }
  const typeInfo: any = getTypeValue(ctx, property);
  let propInfo: any = { type: typeInfo };
  if (isArray) {
    propInfo = { type: "array", items: typeInfo };
  }
  if (
    !!property.serializedChoices &&
    Array.isArray(property.serializedChoices) &&
    property.serializedChoices.length > 1
  ) {
    propInfo["enum"] = property.serializedChoices;
  }
  properties[<string>property.name] = propInfo;
}
function getTypeValue(ctx: GenerationContext, property: DocEntry): any {
  const propType = <string>property.type;
  if (propType.indexOf("|") > 0) return ["boolean", "string"];
  if (propType == "any") return ["string", "numeric", "boolean"];
  if (propType == "string" || propType == "numeric" || propType == "boolean")
    return propType;
  const childrenTypes: string[] = [];
  addChildrenTypes(ctx, propType.replace("[]", ""), childrenTypes);
  if (childrenTypes.length == 1) return getReferenceType(ctx, childrenTypes[0]);
  if (childrenTypes.length > 1) {
    const res = [];
    for (let i = 0; i < childrenTypes.length; i++) {
      res.push(getReferenceType(ctx, childrenTypes[i]));
    }
    return res;
  }
  return getReferenceType(ctx, propType.replace("[]", ""));
}
function addChildrenTypes(ctx: GenerationContext, type: string, childrenTypes: Array<string>): void {
  if (type == "IElement") type = "SurveyElement";
  for (let i = 0; i < ctx.outputClasses.length; i++) {
    if (ctx.outputClasses[i].baseType == type) {
      const count = childrenTypes.length;
      addChildrenTypes(ctx, <string>ctx.outputClasses[i].name, childrenTypes);
      if (count == childrenTypes.length) {
        childrenTypes.push(<string>ctx.outputClasses[i].name);
      }
    }
  }
}
function getReferenceType(ctx: GenerationContext, type: string): any {
  const curClass = ctx.classesHash[type];
  if (!curClass) return type;
  return { $href: "#" + curClass.jsonName };
}

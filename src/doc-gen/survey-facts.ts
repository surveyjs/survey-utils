import { DocEntry } from "./types";
import { DocModel } from "./generator";
import { SurveyBundle } from "./serializer-module";
import { summary, demoLinks } from "./doc-utils";
import { extractOperators, readOperatorNames, OperatorFact } from "./operators";

/**
 * Extracts every fact the LLM guide states from survey-core itself: the runtime
 * bundle for the metadata, the doc model (AST + JSDoc) for the prose.
 *
 * Nothing here is hand-maintained. A question type, property, operator or function
 * that survey-core drops disappears from the guide on the next run, which is the
 * point: a stale guide teaches an LLM to write JSON that no longer loads.
 */

export interface PropertyFact {
  name: string;
  /** The JSON type as the serializer reports it (`schemaType()`), e.g. "string", "number". */
  jsonType: string;
  /** For a structural property, the class of its value/items (e.g. `elements` -> "question"). */
  className?: string;
  isArray: boolean;
  isRequired: boolean;
  isUnique: boolean;
  isLocalizable: boolean;
  /** True when the value is an expression/condition, which has its own syntax rules. */
  isExpression: boolean;
  defaultValue?: any;
  /** The allowed values, when the property has a static choice list. */
  choices?: any[];
  /** First sentence of the JSDoc on the backing class member; "" when undocumented. */
  summary: string;
  hasDoc: boolean;
}

export interface ClassFact {
  /** The name used in JSON, e.g. "text" -- not the TypeScript class name. */
  name: string;
  parentName?: string;
  /** The backing TypeScript class, e.g. "QuestionTextModel". Absent when metadata-only. */
  tsName?: string;
  summary: string;
  demos: string[];
  /** Properties this class declares: the ones inherited from `parentName` are not repeated. */
  ownProperties: PropertyFact[];
  required: string[];
}

export type ClassKind = "root" | "base" | "type" | "structural" | "trigger" | "validator";

export { OperatorFact };

export interface SurveyFacts {
  version: string;
  questionTypes: string[];
  classes: ClassFact[];
  kinds: { [className: string]: ClassKind };
  operators: OperatorFact[];
  functions: string[];
  triggers: string[];
  validators: string[];
  /** Legacy `alternativeName` aliases: parsed by the library, never to be emitted. */
  legacyAliases: { alias: string; real: string }[];
  /** Deprecated properties, documented once as "do not emit" rather than per class. */
  deprecated: { className: string; name: string }[];
  /** Serializable properties with no JSDoc: the guide's documentation-coverage gap. */
  undocumented: number;
  documented: number;
  /** Non-fatal problems. One bad property must never abort the run. */
  warnings: string[];
}

export function buildFacts(model: DocModel, bundle: SurveyBundle): SurveyFacts {
  const warnings: string[] = [];
  const serializer = bundle.Serializer;
  const questionTypes: string[] = bundle.ElementFactory
    ? bundle.ElementFactory.Instance.getAllTypes().slice().sort()
    : [];

  const triggers = childrenOf(serializer, "trigger");
  const validators = childrenOf(serializer, "surveyvalidator");

  const docIndex = buildDocIndex(model);
  const kinds: { [name: string]: ClassKind } = {};
  const names = collectClasses(serializer, questionTypes, triggers, validators, kinds);

  const facts: SurveyFacts = {
    version: String(bundle.Serializer && (<any>bundle).Version || ""),
    questionTypes: questionTypes,
    classes: [],
    kinds: kinds,
    // The names come from the source that declares them, the spellings from the public parser.
    operators: extractOperators(readOperatorNames(model.sourceFiles, warnings), bundle, warnings),
    functions: bundle.FunctionFactory
      ? bundle.FunctionFactory.Instance.getAll().slice().sort()
      : [],
    triggers: triggers,
    validators: validators,
    legacyAliases: [],
    deprecated: [],
    undocumented: 0,
    documented: 0,
    warnings: warnings
  };

  const aliases: { [alias: string]: string } = {};
  for (let i = 0; i < names.length; i++) {
    facts.classes.push(buildClassFact(names[i], serializer, docIndex, facts, aliases));
  }
  // An alias is only legacy on the class that declares it. `image.altText` is aliased as
  // `text`, but `text` is also the real name of a choice item's label -- so a blanket "never
  // emit `text`" rule would break every choices list. Only the aliases that collide with
  // nothing can be stated as a global rule; the rest are covered by the per-class tables.
  const real: { [name: string]: boolean } = {};
  facts.classes.forEach((cls) => cls.ownProperties.forEach((p) => { real[p.name] = true; }));
  facts.legacyAliases = Object.keys(aliases).sort()
    .filter((alias) => !real[alias])
    .map((alias) => ({ alias: alias, real: aliases[alias] }));
  return facts;
}

/** The classes the guide documents: the question types, the survey shell, and everything
 *  reachable from them through inheritance or a structural (`className`) property. */
function collectClasses(
  serializer: any, questionTypes: string[], triggers: string[], validators: string[],
  kinds: { [name: string]: ClassKind }
): string[] {
  const roots = ["survey", "page"].concat(questionTypes, triggers, validators);
  const seen: { [name: string]: boolean } = {};
  const queue = roots.slice();
  const all: string[] = [];
  while (queue.length > 0) {
    const name = <string>queue.shift();
    if (!name || seen[name]) continue;
    const info = serializer.findClass(name);
    if (!info) continue;
    seen[name] = true;
    all.push(name);
    if (info.parentName) queue.push(info.parentName);
    const props = serializer.getProperties(name) || [];
    for (let i = 0; i < props.length; i++) {
      if (props[i].className) queue.push(props[i].className);
    }
  }
  // An ancestor of a question type is a shared base: its properties are documented once.
  const bases: { [name: string]: boolean } = {};
  for (let i = 0; i < questionTypes.length; i++) {
    let info = serializer.findClass(questionTypes[i]);
    info = info && info.parentName ? serializer.findClass(info.parentName) : null;
    while (info) {
      bases[info.name] = true;
      info = info.parentName ? serializer.findClass(info.parentName) : null;
    }
  }
  for (let i = 0; i < all.length; i++) {
    const name = all[i];
    if (name === "survey" || name === "page") kinds[name] = "root";
    else if (questionTypes.indexOf(name) > -1) kinds[name] = "type";
    else if (bases[name]) kinds[name] = "base";
    else if (triggers.indexOf(name) > -1 || name === "trigger" || name === "surveytrigger") kinds[name] = "trigger";
    else if (validators.indexOf(name) > -1 || name === "surveyvalidator") kinds[name] = "validator";
    else kinds[name] = "structural";
  }
  // Section order: the shell, the shared bases, the types, then the pieces they refer to.
  const rank: { [kind: string]: number } = {
    root: 0, base: 1, type: 2, structural: 3, trigger: 4, validator: 5
  };
  return all.sort((a, b) =>
    (rank[kinds[a]] - rank[kinds[b]]) || a.localeCompare(b));
}

function buildClassFact(
  name: string, serializer: any, docIndex: DocIndex, facts: SurveyFacts,
  aliases: { [alias: string]: string }
): ClassFact {
  const info = serializer.findClass(name);
  const parentName = info && info.parentName ? info.parentName : undefined;
  const entry = docIndex.classByJson[name];
  const props = serializer.getProperties(name) || [];
  const own: PropertyFact[] = [];
  const required: string[] = [];

  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    // Dedup by inheritance: a property is documented by the class that declares it.
    if (parentName && serializer.findProperty(parentName, prop.name)) continue;
    if (prop.isSerializable === false) continue;
    if (prop.alternativeName) aliases[prop.alternativeName] = name + "." + prop.name;
    if (!callSafely(() => prop.isVisible(""), true, facts.warnings, name + "." + prop.name)) continue;

    const member = docIndex.find(name, prop.name, entry);
    const text = member ? member.documentation : "";
    if (member && member.isDeprecated) {
      facts.deprecated.push({ className: name, name: prop.name });
      continue;
    }
    const fact = toPropertyFact(prop, text, facts, name, serializer);
    if (fact.hasDoc) facts.documented++; else facts.undocumented++;
    if (fact.isRequired) required.push(fact.name);
    own.push(fact);
  }
  return {
    name: name,
    parentName: parentName,
    tsName: entry ? entry.name : undefined,
    summary: entry ? summary(entry.documentation) : "",
    demos: entry ? demoLinks(entry.documentation) : [],
    ownProperties: own.sort(compareProperties),
    required: required.sort()
  };
}

function toPropertyFact(
  prop: any, doc: any, facts: SurveyFacts, className: string, serializer: any
): PropertyFact {
  const where = className + "." + prop.name;
  const type = String(prop.type || "");
  const jsonType = callSafely(
    () => (typeof prop.schemaType === "function" ? prop.schemaType() : "") || type,
    type, facts.warnings, where
  );
  const isExpression = type === "expression" || type === "condition";
  let choices: any[] | undefined = undefined;
  if (prop.hasChoices) {
    choices = readChoices(prop, facts.warnings, where);
  }
  // `className` is only a class when the serializer knows it: some properties carry a
  // primitive there (`dataList` is a `string[]` whose className is "string"), and printing
  // that as a nested object would send an author looking for a class that does not exist.
  const nested = prop.className && serializer.findClass(String(prop.className))
    ? String(prop.className) : undefined;
  const text = String(doc || "");
  return {
    name: String(prop.name),
    jsonType: String(jsonType),
    className: nested,
    // The serializer spells an array either as "itemvalues"/"array" or as "<item>[]".
    isArray: type === "array" || /\[\]$/.test(type) || type === "itemvalues"
      || (!!nested && jsonType === "array"),
    isRequired: prop.isRequired === true,
    isUnique: prop.isUnique === true,
    isLocalizable: prop.isLocalizable === true,
    isExpression: isExpression,
    defaultValue: prop.defaultValue,
    choices: choices,
    summary: summary(text),
    hasDoc: !!text.trim()
  };
}

/**
 * The allowed values of a property with a choice list.
 *
 * `getChoices()` can return a function or throw for choices that are computed from a
 * live object, so it is retried against an instance and then given up on: the property
 * is still worth documenting without its enum, and one bad property must not end the run.
 */
function readChoices(prop: any, warnings: string[], where: string): any[] | undefined {
  const choices = callSafely(() => prop.getChoices(null), undefined, warnings, where);
  const usable = toPrimitiveList(choices);
  if (usable) return usable;
  warnings.push("no static choice list for " + where + ": documented without its allowed values.");
  return undefined;
}

/** Choice lists are only usable when every item is a primitive we can print. */
function toPrimitiveList(choices: any): any[] | undefined {
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const res: any[] = [];
  for (let i = 0; i < choices.length; i++) {
    const item = choices[i];
    const value = item !== null && typeof item === "object" ? item.value : item;
    if (value === undefined || value === null) return undefined;
    if (typeof value === "object" || typeof value === "function") return undefined;
    // The empty choice means "not set" (`autocomplete` leads with one). The guide already
    // tells the model to omit a property rather than send an empty value for it.
    if (value === "") continue;
    res.push(value);
  }
  return res.length > 0 ? res : undefined;
}

function callSafely<T>(fn: () => T, fallback: T, warnings: string[], where: string): T {
  try {
    const res = fn();
    return res === undefined ? fallback : res;
  } catch (error) {
    warnings.push(where + ": " + String(error instanceof Error ? error.message : error));
    return fallback;
  }
}

/**
 * Orders properties so the ones an author needs come first.
 *
 * `JsonObjectProperty.category` would be the right signal, but survey-core never sets it
 * -- the categories live in survey-creator's property grid, and the survey-core-only rule
 * puts them out of reach (see the README). These are the proxies that are in the library:
 * required first, then structure, then expressions, then enums, then whatever is documented.
 */
function compareProperties(a: PropertyFact, b: PropertyFact): number {
  return (propertyRank(a) - propertyRank(b)) || a.name.localeCompare(b.name);
}
function propertyRank(p: PropertyFact): number {
  if (p.isRequired) return 0;
  if (p.className) return 1;
  if (p.isExpression) return 2;
  if (p.choices) return 3;
  if (p.hasDoc) return 4;
  return 5;
}

function childrenOf(serializer: any, base: string): string[] {
  const classes = serializer.getChildrenClasses(base, true) || [];
  return classes.map((c: any) => String(c.name)).sort();
}

interface DocIndex {
  classByJson: { [jsonName: string]: DocEntry };
  find(jsonName: string, propName: string, cls?: DocEntry): DocEntry | undefined;
}

/**
 * The metadata-to-JSDoc join.
 *
 * A serializer property is keyed by its class's JSON name (`text`) and its own name
 * (`placeholder`); the doc model keys the same member by the TypeScript class that
 * declares it (`QuestionTextModel`). Members are matched on the JSON name first and,
 * when the member is declared further up the TypeScript chain than the serializer class
 * suggests, along that class's inheritance chain.
 */
function buildDocIndex(model: DocModel): DocIndex {
  const classByJson: { [jsonName: string]: DocEntry } = {};
  const byJson: { [key: string]: DocEntry } = {};
  const byTs: { [key: string]: DocEntry } = {};
  for (let i = 0; i < model.classes.length; i++) {
    const cls = model.classes[i];
    if (cls.jsonName && !classByJson[cls.jsonName]) classByJson[cls.jsonName] = cls;
  }
  for (let i = 0; i < model.pmes.length; i++) {
    const pme = model.pmes[i];
    if (pme.pmeType !== "property" || !pme.name) continue;
    if (pme.jsonName) {
      const key = pme.jsonName + "." + pme.name;
      if (!byJson[key] || !byJson[key].documentation) byJson[key] = pme;
    }
    if (pme.className) {
      const key = pme.className + "." + pme.name;
      if (!byTs[key] || !byTs[key].documentation) byTs[key] = pme;
    }
  }
  return {
    classByJson: classByJson,
    find: (jsonName: string, propName: string, cls?: DocEntry): DocEntry | undefined => {
      const direct = byJson[jsonName + "." + propName];
      if (direct && (direct.documentation || "").trim()) return direct;
      const chain = cls && Array.isArray(cls.allTypes) ? cls.allTypes : [];
      for (let i = 0; i < chain.length; i++) {
        const member = byTs[chain[i] + "." + propName];
        if (member && (member.documentation || "").trim()) return member;
      }
      return direct;
    }
  };
}

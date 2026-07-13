import Ajv, { ValidateFunction } from "ajv";
import { SurveyBundle } from "./serializer-module";
import { SurveyFacts } from "./survey-facts";

/**
 * The JSON snippets in the guide.
 *
 * Every one is built through the library's own API and serialized with toJSON(), never
 * typed out: a snippet cannot then drift from what survey-core actually loads. Each is
 * checked before it is emitted, and a snippet that fails the check fails the run.
 */

export interface Example {
  /** Heading the guide prints above the snippet. */
  title: string;
  json: any;
}

export interface ExampleSet {
  minimal: Example;
  /** One per question type, keyed by the `type` string. */
  byType: { [type: string]: Example };
  choices: Example[];
  triggers: Example[];
  validators: Example[];
  composites: Example[];
  endToEnd: Example[];
  warnings: string[];
}

/** Everything a snippet must satisfy to be emitted. */
export interface Checker {
  /** Why the snippet is not emittable; empty when it is fine. */
  check(json: any, isSurvey: boolean): string[];
}

/**
 * Checks a snippet three ways, because no one of them is sufficient.
 *
 * The JSON Schema is the weakest of the three today: `Serializer.generateSchema()` never
 * emits a schema for `elements`, so the per-type definitions it generates are unreachable
 * and an unknown question type validates clean (see the README). The type check and the
 * SurveyModel round-trip are what actually prove a snippet loads and survives
 * re-serialization -- and both are derived from the library, not from a list kept here.
 */
export function createChecker(bundle: SurveyBundle, facts: SurveyFacts, schema: any): Checker {
  let validate: ValidateFunction | null = null;
  try {
    validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
  } catch (error) {
    validate = null;
  }
  // Which `type` strings are legal depends on the array the object sits in. All three sets
  // come from the library: a trigger is a `complete`, not a question type.
  const allowed: { [arrayName: string]: string[] } = {
    elements: facts.questionTypes,
    templateElements: facts.questionTypes,
    triggers: facts.triggers.map((name) => name.replace(/trigger$/, "")),
    validators: facts.validators.map((name) => name.replace(/validator$/, ""))
  };
  return {
    check: (json: any, isSurvey: boolean): string[] => {
      const errors: string[] = [];
      if (isSurvey && validate && !validate(json)) {
        (validate.errors || []).forEach((e) => {
          errors.push("schema: " + (e.instancePath || "/") + " " + e.message);
        });
      }
      collectTypes(json).forEach((found) => {
        const legal = allowed[found.within];
        if (legal && legal.indexOf(found.type) < 0) {
          errors.push("unknown " + found.within + " type: '" + found.type + "'");
        }
      });
      if (isSurvey && bundle.SurveyModel) {
        // The real proof: the library loads it, and writes back what it was given.
        try {
          const reserialized = new bundle.SurveyModel(clone(json)).toJSON();
          if (!deepEqual(reserialized, json)) {
            errors.push("does not round-trip through SurveyModel: " + diffKeys(json, reserialized));
          }
        } catch (error) {
          errors.push("SurveyModel failed to load it: " + message(error));
        }
      }
      return errors;
    }
  };
}

/** Every `type` string in a snippet, with the name of the array it was found in. */
function collectTypes(json: any): { type: string; within: string }[] {
  const res: { type: string; within: string }[] = [];
  const walk = (node: any, within: string): void => {
    if (Array.isArray(node)) return node.forEach((item) => walk(item, within));
    if (!node || typeof node !== "object") return;
    if (typeof node.type === "string" && node.type) res.push({ type: node.type, within: within });
    Object.keys(node).forEach((key) => walk(node[key], key));
  };
  walk(json, "");
  return res;
}

export function buildExamples(bundle: SurveyBundle, facts: SurveyFacts, checker: Checker): ExampleSet {
  const set: ExampleSet = {
    minimal: { title: "A minimal survey", json: {} },
    byType: {},
    choices: [],
    triggers: [],
    validators: [],
    composites: [],
    endToEnd: [],
    warnings: []
  };
  const emit = (title: string, build: () => any, isSurvey: boolean = true): Example | null => {
    let json: any;
    try {
      json = build();
    } catch (error) {
      set.warnings.push("example '" + title + "' could not be built: " + message(error));
      return null;
    }
    const errors = checker.check(json, isSurvey);
    if (errors.length > 0) {
      // A snippet that fails the check is never emitted: the guide would be teaching it.
      set.warnings.push("example '" + title + "' rejected: " + errors.join("; "));
      return null;
    }
    return { title: title, json: json };
  };

  const minimal = emit("A minimal survey", () => surveyJson(bundle, {
    title: "Customer feedback",
    pages: [{ name: "page1", elements: [{ type: "text", name: "fullName", title: "Your name" }] }]
  }));
  if (minimal) set.minimal = minimal;

  facts.questionTypes.forEach((type) => {
    const example = emit(type, () => elementJson(bundle, facts, type), false);
    if (example) set.byType[type] = example;
  });

  const choicesShorthand = emit("Choices as strings (shorthand)", () => elementOf(bundle, {
    type: "radiogroup", name: "color", title: "Pick a color",
    choices: ["Red", "Green", "Blue"]
  }), false);
  if (choicesShorthand) set.choices.push(choicesShorthand);

  const choicesObjects = emit("Choices as objects (value differs from text)", () => elementOf(bundle, {
    type: "dropdown", name: "country", title: "Country",
    choices: [
      { value: "us", text: "United States" },
      { value: "de", text: "Germany" }
    ]
  }), false);
  if (choicesObjects) set.choices.push(choicesObjects);

  facts.triggers.forEach((name) => {
    const example = emit(name, () => triggerJson(bundle, name));
    if (example) set.triggers.push(example);
  });

  facts.validators.forEach((name) => {
    const example = emit(name, () => validatorJson(bundle, name), false);
    if (example) set.validators.push(example);
  });

  const dynamicPanel = emit("paneldynamic: a repeating group of questions", () => surveyJson(bundle, {
    elements: [{
      type: "paneldynamic", name: "children", title: "Children",
      templateElements: [
        { type: "text", name: "childName", title: "Name" },
        { type: "text", name: "childAge", title: "Age", inputType: "number" }
      ],
      panelCount: 1
    }]
  }));
  if (dynamicPanel) set.composites.push(dynamicPanel);

  const matrixDynamic = emit("matrixdynamic: rows the respondent adds", () => surveyJson(bundle, {
    elements: [{
      type: "matrixdynamic", name: "employers", title: "Employers",
      columns: [
        { name: "company", cellType: "text", title: "Company" },
        { name: "years", cellType: "text", inputType: "number", title: "Years" }
      ],
      rowCount: 1
    }]
  }));
  if (matrixDynamic) set.composites.push(matrixDynamic);

  const matrixDropdown = emit("matrixdropdown: fixed rows, typed columns", () => surveyJson(bundle, {
    elements: [{
      type: "matrixdropdown", name: "ratings", title: "Rate each area",
      columns: [{ name: "score", cellType: "rating" }],
      rows: [{ value: "support", text: "Support" }, { value: "docs", text: "Documentation" }]
    }]
  }));
  if (matrixDropdown) set.composites.push(matrixDropdown);

  const simple = emit("1. A simple form", () => surveyJson(bundle, {
    title: "Contact us",
    elements: [
      { type: "text", name: "fullName", title: "Your name", isRequired: true },
      { type: "text", name: "email", title: "Email", inputType: "email", isRequired: true },
      { type: "comment", name: "message", title: "How can we help?" }
    ]
  }));
  if (simple) set.endToEnd.push(simple);

  const branching = emit("2. Multiple pages, a branch, and a trigger", () => surveyJson(bundle, {
    title: "Net Promoter Score",
    pages: [
      {
        name: "score",
        elements: [{
          type: "rating", name: "nps", title: "How likely are you to recommend us?",
          rateMin: 0, rateMax: 10, isRequired: true
        }]
      },
      {
        name: "followUp",
        elements: [{
          type: "comment", name: "reason", title: "What went wrong?",
          visibleIf: "{nps} < 7"
        }]
      }
    ],
    triggers: [{ type: "complete", expression: "{nps} >= 9" }]
  }));
  if (branching) set.endToEnd.push(branching);

  const advanced = emit("3. A matrix, a dynamic panel, and validators", () => surveyJson(bundle, {
    title: "Team review",
    pages: [
      {
        name: "team",
        elements: [{
          type: "paneldynamic", name: "members", title: "Team members",
          templateElements: [
            { type: "text", name: "memberName", title: "Name", isRequired: true },
            {
              type: "text", name: "memberEmail", title: "Email",
              validators: [{ type: "email" }]
            }
          ],
          panelCount: 1
        }]
      },
      {
        name: "scores",
        elements: [{
          type: "matrixdynamic", name: "areas", title: "Score each area",
          columns: [
            { name: "area", cellType: "text", isRequired: true },
            { name: "score", cellType: "text", inputType: "number", validators: [{ type: "numeric", minValue: 1, maxValue: 5 }] }
          ],
          rowCount: 1
        }]
      }
    ]
  }));
  if (advanced) set.endToEnd.push(advanced);

  return set;
}

/** A survey, as the library serializes it: what is written here is only the input. */
function surveyJson(bundle: SurveyBundle, json: any): any {
  if (!bundle.SurveyModel) throw new Error("the bundle has no SurveyModel");
  return new bundle.SurveyModel(json).toJSON();
}

/** One element, taken out of the survey the library serialized it into. */
function elementOf(bundle: SurveyBundle, element: any): any {
  const json = surveyJson(bundle, { elements: [element] });
  const elements = json.elements || (json.pages && json.pages[0] && json.pages[0].elements);
  if (!Array.isArray(elements) || elements.length === 0) {
    throw new Error("the survey serialized without its element");
  }
  return elements[0];
}

/**
 * The minimal JSON of a question type, produced by the library rather than written out.
 *
 * The type's own metadata says what it needs to be meaningful: a class with a `choices`
 * property gets choices, one with `columns` gets a column, and so on. That keeps this a
 * rule about the metadata instead of a table of the 22 types, which would rot.
 */
function elementJson(bundle: SurveyBundle, facts: SurveyFacts, type: string): any {
  const serializer = bundle.Serializer;
  const element: any = { type: type, name: exampleName(type) };
  const has = (name: string): boolean => !!serializer.findProperty(type, name);
  if (has("title")) element.title = "Question title";
  if (has("choices")) element.choices = ["Item 1", "Item 2", "Item 3"];
  if (has("columns") && has("rows")) {
    element.columns = [{ name: "col1" }];
    element.rows = ["Row 1"];
  } else if (has("columns")) {
    element.columns = [{ name: "col1", cellType: "text" }];
  }
  if (has("templateElements")) {
    element.templateElements = [{ type: "text", name: "nestedQuestion" }];
  }
  if (has("items") && type === "multipletext") {
    element.items = [{ name: "item1" }, { name: "item2" }];
  }
  if (has("html")) element.html = "<p>Some text</p>";
  if (has("imageLink")) element.imageLink = "https://surveyjs.io/logo.png";
  if (has("expression") && type === "expression") element.expression = "{q1} + 1";
  return elementOf(bundle, element);
}

/** A trigger, serialized by the library inside the survey that owns it. */
function triggerJson(bundle: SurveyBundle, name: string): any {
  const type = name.replace(/trigger$/, "");
  const trigger: any = { type: type, expression: "{q1} = 'yes'" };
  // What a trigger needs beyond its expression is asked of the serializer, not assumed.
  const has = (prop: string): boolean => !!bundle.Serializer.findProperty(name, prop);
  if (has("setToName")) trigger.setToName = "q2";
  if (has("setValue")) trigger.setValue = "ok";
  if (has("fromName")) trigger.fromName = "q1";
  if (has("runExpression")) trigger.runExpression = "{q1} + 1";
  if (has("gotoName")) trigger.gotoName = "q2";
  return surveyJson(bundle, {
    elements: [{ type: "text", name: "q1" }, { type: "text", name: "q2" }],
    triggers: [trigger]
  });
}

/** A validator, serialized by the library on the question that carries it. */
function validatorJson(bundle: SurveyBundle, name: string): any {
  const type = name.replace(/validator$/, "");
  const validator: any = { type: type };
  const has = (prop: string): boolean => !!bundle.Serializer.findProperty(name, prop);
  if (has("minValue")) { validator.minValue = 1; validator.maxValue = 10; }
  if (has("minLength")) { validator.minLength = 2; validator.maxLength = 20; }
  if (has("minCount")) { validator.minCount = 1; validator.maxCount = 3; }
  if (has("regex")) validator.regex = "^[0-9]+$";
  if (has("expression")) validator.expression = "{q1} > 0";
  // answercount only means anything on a question that takes several answers.
  const questionType = has("minCount") ? "checkbox" : "text";
  const element: any = { type: questionType, name: "q1", validators: [validator] };
  if (questionType === "checkbox") element.choices = ["Item 1", "Item 2"];
  return elementOf(bundle, element);
}

function exampleName(type: string): string {
  return type === "html" || type === "image" ? type + "1" : "question1";
}

function clone(json: any): any {
  return JSON.parse(JSON.stringify(json));
}

function deepEqual(a: any, b: any): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

/** Key order is not part of the JSON's meaning; the round-trip compares content. */
function sortKeys(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  const res: any = {};
  Object.keys(value).sort().forEach((key) => { res[key] = sortKeys(value[key]); });
  return res;
}

/** The property names that differ, so a failing round-trip says what changed. */
function diffKeys(before: any, after: any): string {
  const keys = Object.keys(Object.assign({}, before, after));
  const changed = keys.filter((key) => !deepEqual(before[key], after[key]));
  return changed.length > 0 ? changed.join(", ") : "the two documents differ";
}

function message(error: any): string {
  return String(error instanceof Error ? error.message : error);
}

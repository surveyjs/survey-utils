import * as path from "path";
import { FileMap } from "./types";
import { DocModel } from "./generator";
import { SurveyBundle } from "./serializer-module";
import { resolveDir } from "./file-utils";
import { detectProduct, sourceUrl } from "./doc-utils";
import { buildFacts, ClassFact, ClassKind, PropertyFact, SurveyFacts } from "./survey-facts";
import { buildExamples, createChecker, Example, ExampleSet } from "./examples";

/**
 * `--llm-guide`: the markdown an LLM is given as context so that the SurveyJS JSON it
 * writes loads and behaves correctly. A third emitter over the doc model, alongside the
 * Markdown API reference and the JSON Schema.
 *
 * The schema constrains and verifies; this teaches. Everything it states is extracted
 * from survey-core at generation time -- see promts/01-schema-and-llm-guide.md.
 */

export interface LLMGuideOptions {
  outputDir?: string;
  fileNames?: string[];
  product?: string;
  sourceBaseUrl?: string;
  /** Fail the run when the guide is bigger than this. Default: 96 KB, see DEFAULT_MAX_BYTES. */
  maxBytes?: number;
  /** Also emit one file per question type, where the budget is per file. */
  split?: boolean;
  /** Member-level API links. Only in the split files: ~400 of them cost 6-10k tokens. */
  withMemberLinks?: boolean;
  /** Emitted into the llms.txt section so a model can fetch the schema and self-check. */
  schemaUrl?: string;
  guideUrl?: string;
}

export interface LLMGuideResult {
  files: FileMap;
  bytes: number;
  /** Rough token count: the guide is spent from a context window, so the run reports it. */
  approxTokens: number;
  warnings: string[];
  facts: SurveyFacts;
}

/**
 * The only hand-written prose in the artifact.
 *
 * Everything else is generated. Keeping the fixed text in one constant is what lets a
 * reviewer confirm at a glance that no question type, property or example was typed out
 * by hand -- those go stale the moment survey-core changes, and a stale guide teaches an
 * LLM to write JSON that no longer loads.
 */
const OUTPUT_RULES = [
  "When you are asked for a survey, reply with **one JSON object and nothing else**:",
  "",
  "- No Markdown fences, no prose before or after, no comments, no trailing commas.",
  "- Omit any property whose value equals the default listed in this guide.",
  "- Use only the `type` strings listed under \"Question types\". There are no others.",
  "- Give every question a `name` that is unique in the document; it is the key in the result data.",
  "- An expression may only reference the `name` of a question that exists in the document."
].join("\n");

const BYTES_PER_TOKEN = 3.6;

/**
 * The size gate. It exists to catch the guide growing without anyone noticing, not to be
 * hit in normal operation -- the run fails above it.
 *
 * The question types, the shared bases and the survey/page shell come to ~57 KB, inside the
 * <= 60 KB the design targets. The rest is the triggers, the validators and the nested
 * objects (choice items, matrix columns, input masks) that an author also has to get right:
 * ~16 KB more, which the original budget did not count. Dropping them would cost real facts
 * to meet a number, so the gate sits above the whole thing instead.
 */
export const DEFAULT_MAX_BYTES = 96 * 1024;

export function buildLLMGuide(
  model: DocModel, bundle: SurveyBundle, options: LLMGuideOptions = {}
): LLMGuideResult {
  const facts = buildFacts(model, bundle);
  const schema = typeof bundle.Serializer.generateSchema === "function"
    ? bundle.Serializer.generateSchema() : {};
  const checker = createChecker(bundle, facts, schema);
  const examples = buildExamples(bundle, facts, checker);
  const warnings = facts.warnings.concat(examples.warnings);

  const product = options.product || detectProduct(options.fileNames, process.cwd());
  const baseUrl = options.sourceBaseUrl;
  const outputDir = resolveDir(options.outputDir || path.join(process.cwd(), "docs"));

  const guide = renderGuide(facts, examples, product, baseUrl);
  const files: FileMap = {};
  files[path.join(outputDir, "llm-guide.md")] = guide;
  if (options.split) {
    Object.assign(files, renderSplit(facts, examples, product, baseUrl, outputDir, options));
  }
  files[path.join(outputDir, "llms.txt")] = renderLlmsTxt(facts, options);

  const bytes = Buffer.byteLength(guide, "utf8");
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  if (bytes > maxBytes) {
    throw new Error(
      "the LLM guide is " + kb(bytes) + ", over the " + kb(maxBytes) + " budget. "
      + "It is spent from a context window: either raise --max-bytes or cut what is emitted."
    );
  }
  return {
    files: files,
    bytes: bytes,
    approxTokens: Math.round(bytes / BYTES_PER_TOKEN),
    warnings: warnings,
    facts: facts
  };
}

function renderGuide(
  facts: SurveyFacts, examples: ExampleSet, product: string, baseUrl?: string
): string {
  const out: string[] = [];
  const add = (...lines: string[]): void => { out.push(...lines); };

  add("# SurveyJS survey JSON: an authoring guide");
  add("");
  add(
    "Generated from survey-core " + facts.version + " by `survey-utils generate-doc --llm-guide`. "
    + "Do not hand-edit: every fact below is extracted from the library, and the next run "
    + "overwrites this file."
  );
  add("");
  add("## Output rules");
  add("");
  add(OUTPUT_RULES);
  add("");

  add("## The shape of a survey");
  add("");
  add(
    "A survey is one JSON object. It holds `pages`, each page holds `elements`, and each "
    + "element is a question or a panel. A survey with no page structure may put `elements` "
    + "at the root instead; the library wraps them in a page."
  );
  addExample(add, examples.minimal);
  add(
    "`name` is required on a question, must be unique across the survey, and is the key the "
    + "answer appears under in the result data and the name expressions refer to. `title` is "
    + "what the respondent reads; when it is missing the `name` is shown instead."
  );
  add("");

  addSection(add, facts, examples, "root", "Survey and page properties", product, baseUrl,
    "The survey object itself, and the pages inside it.");
  addSection(add, facts, examples, "base", "Shared question properties", product, baseUrl,
    "Every question has these. They are listed once, on the class that declares them, and "
    + "are **not** repeated under the individual types below.");

  add("## Question types");
  add("");
  add(
    "These are the only `type` values that exist: `" + facts.questionTypes.join("`, `") + "`. "
    + "Each section lists only the properties that type adds on top of the shared ones above."
  );
  add("");
  facts.classes
    .filter((cls) => facts.kinds[cls.name] === "type")
    .forEach((cls) => addClass(add, cls, facts, examples.byType[cls.name], product, baseUrl));

  add("## Choices");
  add("");
  add(
    "A choice may be a plain string, which is used as both the stored value and the visible "
    + "text. Use the object form when the two differ, or when an item needs its own "
    + "`visibleIf`/`enableIf`. Mixing the two forms in one list is allowed."
  );
  examples.choices.forEach((example) => addExample(add, example));

  add("## Localizable strings");
  add("");
  add(
    "A property marked *(loc)* in the tables below is localizable: it accepts either a plain "
    + "string or an object keyed by locale, `{ \"default\": \"Your name\", \"de\": \"Ihr Name\" }`. "
    + "Prefer the plain string unless the request actually asks for more than one language."
  );
  add("");

  addExpressions(add, facts);

  addSection(add, facts, examples, "trigger", "Triggers", product, baseUrl,
    "A trigger sits in the survey's `triggers` array and fires when its `expression` becomes "
    + "true. The `type` is the trigger name without the `trigger` suffix.");
  addSection(add, facts, examples, "validator", "Validators", product, baseUrl,
    "A validator sits in a question's `validators` array. The `type` is the validator name "
    + "without the `validator` suffix.");
  addSection(add, facts, examples, "structural", "Nested objects", product, baseUrl,
    "The objects that appear inside a question: choice items, matrix columns, and the like.");

  add("## Composite structures");
  add("");
  add(
    "Nesting is where generated JSON most often goes wrong. A `paneldynamic` repeats its "
    + "`templateElements` once per entry; a `matrixdynamic` repeats its `columns` once per row; "
    + "a `matrixdropdown` crosses fixed `rows` with typed `columns`. Inside a dynamic panel a "
    + "question refers to its siblings as `{panel.otherQuestion}`, and inside a matrix a column "
    + "refers to its row as `{row.otherColumn}`."
  );
  examples.composites.forEach((example) => addExample(add, example));

  add("## Rules");
  add("");
  add(rules(facts));
  add("");

  add("## Complete examples");
  add("");
  examples.endToEnd.forEach((example) => addExample(add, example));

  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

/** One `##` section covering every class of a kind. */
function addSection(
  add: (...lines: string[]) => void, facts: SurveyFacts, examples: ExampleSet,
  kind: ClassKind, title: string, product: string, baseUrl: string | undefined, intro: string
): void {
  const classes = facts.classes.filter((cls) => facts.kinds[cls.name] === kind);
  if (classes.length === 0) return;
  add("## " + title);
  add("");
  add(intro);
  add("");
  classes.forEach((cls) => {
    const example = kind === "trigger"
      ? examples.triggers.find((e) => e.title === cls.name)
      : kind === "validator"
        ? examples.validators.find((e) => e.title === cls.name)
        : undefined;
    addClass(add, cls, facts, example, product, baseUrl);
  });
}

/** One `###` block: the class, its properties, its example. */
function addClass(
  add: (...lines: string[]) => void, cls: ClassFact, facts: SurveyFacts,
  example: Example | undefined, product: string, baseUrl?: string
): void {
  add("### `" + cls.name + "`");
  add("");
  const parts: string[] = [];
  if (cls.summary) parts.push(cls.summary);
  if (cls.parentName && facts.kinds[cls.parentName]) {
    parts.push("Inherits the properties of `" + cls.parentName + "`.");
  }
  if (cls.required.length > 0) {
    parts.push("Required: `" + cls.required.join("`, `") + "`.");
  }
  if (parts.length > 0) { add(parts.join(" ")); add(""); }
  if (cls.tsName) {
    // Class-level links only, and a demo only for the types someone actually authors:
    // ~60 links is noise-level cost, one per property would be 6-10k tokens.
    const links = ["[API](" + sourceUrl(product, cls.tsName, baseUrl) + ")"];
    if (facts.kinds[cls.name] === "type") {
      cls.demos.slice(0, 1).forEach((url) => links.push("[Demo](" + url + ")"));
    }
    add(links.join(" · "));
    add("");
  }
  if (cls.ownProperties.length > 0) {
    add("| Property | Type | Default | Description |");
    add("| --- | --- | --- | --- |");
    cls.ownProperties.forEach((prop) => add(propertyRow(prop)));
    add("");
  }
  if (example) addExample(add, example, false);
}

function propertyRow(prop: PropertyFact): string {
  const name = "`" + prop.name + "`" + (prop.isLocalizable ? " *(loc)*" : "");
  let type = "`" + prop.jsonType + "`";
  if (prop.choices) {
    // One code span, comma separated: a pipe between values would have to be escaped in
    // the table, and at ~470 rows those four bytes a value are not free.
    type = "`" + prop.choices.map((c) => String(c)).join(", ") + "`";
  } else if (prop.className) {
    type = prop.isArray
      ? "`array` of `" + prop.className + "`"
      : "`" + prop.className + "`";
  } else if (prop.isExpression) {
    type = "`expression`";
  }
  const defaultValue = prop.defaultValue === undefined || prop.defaultValue === null
    ? "" : "`" + JSON.stringify(prop.defaultValue) + "`";
  const notes: string[] = [];
  if (prop.isUnique) notes.push("Unique.");
  const description = cell([prop.summary].concat(notes).filter((s) => !!s).join(" "));
  return "| " + name + " | " + cell(type) + " | " + defaultValue + " | " + description + " |";
}

function addExpressions(add: (...lines: string[]) => void, facts: SurveyFacts): void {
  add("## Expressions");
  add("");
  add(
    "`visibleIf`, `enableIf`, `requiredIf`, `setValueIf`, a trigger's `expression` and an "
    + "`expression` question all take an expression."
  );
  add("");
  add(
    "Write a question's value as its name in braces: `{age}`. String literals are quoted: "
    + "`{country} = 'us'`. The expression as a whole is **not** wrapped in braces -- "
    + "`{age} > 18 and {country} notempty` is right, `{{age} > 18}` is not. Inside a dynamic "
    + "panel use `{panel.question}` and inside a matrix `{row.column}` to reach a sibling."
  );
  add("");
  if (facts.operators.length > 0) {
    // The canonical spelling first, its aliases after it: `==` (or `=`, `equal`).
    add("**Operators.** " + facts.operators
      .map((op) => {
        const canonical = "`" + op.forms[0] + "`";
        const aliases = op.forms.slice(1);
        return aliases.length > 0
          ? canonical + " (or " + aliases.map((f) => "`" + f + "`").join(", ") + ")"
          : canonical;
      })
      .join(", ") + ".");
    add("");
  }
  if (facts.functions.length > 0) {
    add("**Functions.** `" + facts.functions.join("()`, `") + "()`.");
    add("");
  }
}

function rules(facts: SurveyFacts): string {
  const lines = [
    "- The `type` of a question must be one of the types listed above. `radio`, "
    + "`dropdownlist` and `multiselect` are **not** SurveyJS types; the equivalents are "
    + "`radiogroup`, `dropdown` and `tagbox`.",
    "- Every `name` in the document is unique, and an expression may only reference a name "
    + "that exists.",
    "- Leave out any property that would be set to its default value.",
    "- Emit the JSON object on its own: no fences, no comments, no trailing commas."
  ];
  if (facts.legacyAliases.length > 0) {
    lines.push(
      "- Never emit these legacy aliases -- the library still parses them, but they are not "
      + "the property names: `" + facts.legacyAliases.map((a) => a.alias).sort().join("`, `") + "`."
    );
  }
  if (facts.deprecated.length > 0) {
    const names = facts.deprecated.map((d) => d.name)
      .filter((name, i, all) => all.indexOf(name) === i).sort();
    lines.push("- Deprecated, do not emit: `" + names.join("`, `") + "`.");
  }
  return lines.join("\n");
}

function addExample(
  add: (...lines: string[]) => void, example: Example, withTitle: boolean = true
): void {
  if (withTitle && example.title) { add("**" + example.title + "**"); add(""); }
  add("```json");
  add(stableJson(example.json));
  add("```");
  add("");
}

/** One file per question type, for a reader that retrieves rather than reads it all. */
function renderSplit(
  facts: SurveyFacts, examples: ExampleSet, product: string, baseUrl: string | undefined,
  outputDir: string, options: LLMGuideOptions
): FileMap {
  const files: FileMap = {};
  facts.classes
    .filter((cls) => facts.kinds[cls.name] === "type")
    .forEach((cls) => {
      const out: string[] = [];
      const add = (...lines: string[]): void => { out.push(...lines); };
      add("# `" + cls.name + "`");
      add("");
      add("Generated from survey-core " + facts.version + ". Part of the SurveyJS authoring guide.");
      add("");
      addClass(add, cls, facts, examples.byType[cls.name], product, baseUrl);
      if (options.withMemberLinks && cls.tsName) {
        add("## API");
        add("");
        cls.ownProperties.forEach((prop) => {
          const url = sourceUrl(product, <string>cls.tsName, baseUrl) + ".md#" + prop.name;
          add("- [`" + prop.name + "`](" + url + ")");
        });
        add("");
      }
      files[path.join(outputDir, "llm-guide", cls.name + ".md")] =
        out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
    });
  return files;
}

/**
 * The llms.txt section for both artifacts.
 *
 * The schema URL matters as much as the guide's: a model that can fetch the schema can
 * check its own output against it instead of only being told the rules.
 */
function renderLlmsTxt(facts: SurveyFacts, options: LLMGuideOptions): string {
  const guideUrl = options.guideUrl || "https://surveyjs.io/llms/llm-guide.md";
  const schemaUrl = options.schemaUrl || "https://surveyjs.io/llms/surveyjs_definition.json";
  return [
    "## Survey JSON",
    "",
    "Generated from survey-core " + facts.version + ".",
    "",
    "- [Survey JSON authoring guide](" + guideUrl + "): every question type, property, "
    + "operator and function, with worked examples. Written to be given to a model as context.",
    "- [Survey JSON Schema](" + schemaUrl + "): the JSON Schema of a survey definition. "
    + "Validate generated JSON against it.",
    ""
  ].join("\n");
}

/** Deterministic: stable key order, 2-space indent, LF, no timestamps -- `--check` needs it. */
function stableJson(json: any): string {
  return JSON.stringify(json, null, 2);
}

function cell(text: string): string {
  return String(text || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(1) + " KB";
}

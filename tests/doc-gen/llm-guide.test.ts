import * as path from "path";
import * as fs from "fs";
import {
  buildModel, buildLLMGuide, buildFacts, extractOperators, readOperatorNames, wordlessOperators,
  createChecker, loadBundle, setJsonObj, DocModel, SurveyBundle, SurveyFacts, LLMGuideResult
} from "../../src/doc-gen";

/**
 * The guide is generated from survey-core, so these tests need the built bundle and the
 * TypeScript sources next to it. When the checkout is not there the suite is skipped rather
 * than failed: survey-utils is also published on its own.
 */
const CORE = path.resolve(__dirname, "../../../survey-library/packages/survey-core");
const BUNDLE = path.join(CORE, "build/survey.core.js");
const ENTRY = path.join(CORE, "entries/chunks/model.ts");
const available = fs.existsSync(BUNDLE) && fs.existsSync(ENTRY);
const itCore = available ? test : test.skip;

let bundle: SurveyBundle;
let model: DocModel;
let facts: SurveyFacts;
let guide: LLMGuideResult;
let text: string;

beforeAll(() => {
  if (!available) return;
  bundle = loadBundle(BUNDLE);
  try {
    setJsonObj(bundle.Serializer);
    const built = buildModel([ENTRY], {});
    if (!built) throw new Error("the survey-core doc model did not build");
    model = built;
  } finally {
    setJsonObj(null);
  }
  facts = buildFacts(model, bundle);
  guide = buildLLMGuide(model, bundle, { outputDir: "docs" });
  text = guide.files[path.join(process.cwd(), "docs", "survey-json-authoring.md")];
});

describe("the facts come from survey-core, not from a table", () => {
  itCore("the question types are the ones the library registers", () => {
    expect(facts.questionTypes.length).toBeGreaterThan(0);
    ["text", "checkbox", "radiogroup", "dropdown", "matrixdynamic", "paneldynamic"]
      .forEach((type) => expect(facts.questionTypes).toContain(type));
    expect(facts.questionTypes).toEqual(bundle.ElementFactory.Instance.getAllTypes().slice().sort());
  });

  itCore("non-serializable and designer-internal properties are left out", () => {
    const serializer = bundle.Serializer;
    facts.classes.forEach((cls) => {
      cls.ownProperties.forEach((prop) => {
        const meta = serializer.findProperty(cls.name, prop.name);
        expect(meta.isSerializable).not.toBe(false);
        expect(meta.isVisible("")).not.toBe(false);
      });
    });
  });

  itCore("an inherited property is not repeated in the subclass that inherits it", () => {
    // `isRequired` is declared on `question`; `text` must not list it again.
    const question = facts.classes.find((c) => c.name === "question");
    const textType = facts.classes.find((c) => c.name === "text");
    expect(question && question.ownProperties.some((p) => p.name === "isRequired")).toBe(true);
    expect(textType && textType.ownProperties.some((p) => p.name === "isRequired")).toBe(false);
    // And the dedup is the serializer's own answer, for every class.
    facts.classes.forEach((cls) => {
      if (!cls.parentName) return;
      cls.ownProperties.forEach((prop) => {
        expect(bundle.Serializer.findProperty(<string>cls.parentName, prop.name)).toBeFalsy();
      });
    });
  });

  itCore("the JSDoc join resolves a known member end to end", () => {
    const textType = facts.classes.find((c) => c.name === "text");
    const placeholder = textType!.ownProperties.find((p) => p.name === "placeholder");
    expect(placeholder).toBeDefined();
    expect(placeholder!.summary).toBe("A placeholder for the input field.");
    // The demo link is stripped from the prose and captured separately.
    expect(placeholder!.summary).not.toContain("http");
    expect(textType!.demos.join(" ")).toContain("https://surveyjs.io/form-library/examples/");
    expect(textType!.demos.join(" ")).not.toContain("linkStyle");
  });

  itCore("a property with no JSDoc still renders, metadata-only", () => {
    expect(facts.undocumented).toBeGreaterThan(0);
    const undocumented = facts.classes
      .reduce((all, cls) => all.concat(cls.ownProperties.filter((p) => !p.hasDoc)), <any[]>[]);
    expect(undocumented.length).toBe(facts.undocumented);
    // It has no description, but it is still in the guide with its name and type.
    expect(undocumented[0].summary).toBe("");
    expect(text).toContain("`" + undocumented[0].name + "`");
  });

  itCore("the legacy aliases are reported and never documented as properties", () => {
    const aliases = facts.legacyAliases.map((a) => a.alias);
    expect(aliases).toContain("hasOther");
    expect(aliases).toContain("hasNone");
    aliases.forEach((alias) => {
      facts.classes.forEach((cls) => {
        expect(cls.ownProperties.some((p) => p.name === alias)).toBe(false);
      });
    });
    expect(text).toContain("Never emit these legacy aliases");
  });

  itCore("an alias that is a real property name elsewhere is not banned outright", () => {
    // `image.altText` is aliased as `text`, and `panelbase.elements` as `questions` -- but
    // `text` is the real name of a choice item's label. Telling a model never to emit `text`
    // would break every choices list, so a colliding alias stays out of the global rule.
    const aliases = facts.legacyAliases.map((a) => a.alias);
    expect(aliases).not.toContain("text");
    expect(aliases).not.toContain("questions");
    const itemvalue = facts.classes.find((c) => c.name === "itemvalue");
    expect(itemvalue!.ownProperties.some((p) => p.name === "text")).toBe(true);
  });
});

describe("expressions", () => {
  itCore("the operators are the ones the grammar accepts, with their symbols", () => {
    const tokens = facts.operators.map((op) => op.name);
    ["and", "or", "contains", "anyof", "empty", "notempty"].forEach((op) =>
      expect(tokens).toContain(op));
    // The arithmetic and comparison operators are written as symbols, not as names.
    ["+", "-", "*", "/", "%", ">", ">=", "<", "<=", "==", "!="].forEach((op) =>
      expect(tokens).toContain(op));
    // The word spellings survive as aliases of the canonical symbol.
    const equal = facts.operators.find((op) => op.name === "==");
    expect(equal!.forms).toEqual(expect.arrayContaining(["==", "=", "equal"]));
  });

  itCore("the internal helpers in OperandMaker are not offered as operators", () => {
    const tokens = facts.operators.map((op) => op.name);
    expect(tokens).not.toContain("arithmeticOp");
    expect(tokens).not.toContain("containsCore");
    expect(text).not.toContain("arithmeticOp");
  });

  itCore("the operator names are read from survey-core's source, not from its exports", () => {
    // OperandMaker is internal and stays internal: exporting it would make a docs generator's
    // convenience a permanent public API commitment. The names are values in a source file,
    // so they are read from the file survey-utils already parses for the JSDoc.
    expect((<any>bundle).OperandMaker).toBeUndefined();
    const names = readOperatorNames(model.sourceFiles, []);
    expect(names.binary).toContain("greaterorequal");
    expect(names.binary).toContain("arithmeticOp");
    expect(names.unary).toContain("notempty");
  });

  itCore("every operator the library implements is either spelled or a known helper", () => {
    // The tripwire: an operator added to survey-core with a brand-new symbol and no word
    // form would silently miss the guide. It would land here instead, and fail.
    const names = readOperatorNames(model.sourceFiles, []);
    expect(wordlessOperators(names, bundle).sort()).toEqual(
      ["arithmeticOp", "containsCore", "div", "minus", "mod", "mul", "negate", "plus"]
    );
  });

  itCore("the functions come from the FunctionFactory", () => {
    expect(facts.functions).toEqual(bundle.FunctionFactory.Instance.getAll().slice().sort());
    expect(text).toContain("`iif()`");
  });
});

describe("the generated snippets", () => {
  /** Every fenced json block in the guide. */
  function snippets(markdown: string): any[] {
    const blocks = markdown.match(/```json\n([\s\S]*?)```/g) || [];
    return blocks.map((block) => JSON.parse(block.replace(/```json\n/, "").replace(/```$/, "")));
  }

  itCore("the guide carries snippets for the survey, every type, the triggers and the validators", () => {
    expect(snippets(text).length).toBeGreaterThanOrEqual(
      facts.questionTypes.length + facts.triggers.length + facts.validators.length
    );
  });

  /**
   * The test that matters. Every snippet the guide teaches is parsed, checked against the
   * generated schema, loaded with SurveyModel and re-serialized -- so the guide cannot
   * teach JSON that the library does not actually accept.
   */
  itCore("every snippet parses, validates, loads and round-trips", () => {
    const schema = bundle.Serializer.generateSchema();
    const checker = createChecker(bundle, facts, schema);
    const failures: string[] = [];
    snippets(text).forEach((json, i) => {
      // A survey has pages/elements at the root; the per-type snippets are single elements.
      const isSurvey = !!json.pages || !!json.elements;
      const errors = checker.check(json, isSurvey);
      if (errors.length > 0) failures.push("snippet " + i + ": " + errors.join("; "));
    });
    expect(failures).toEqual([]);
  });

  itCore("a snippet that names a type the library does not have is rejected", () => {
    const checker = createChecker(bundle, facts, bundle.Serializer.generateSchema());
    // The check the JSON Schema cannot make: generateSchema() never emits a schema for
    // `elements`, so an unknown question type validates clean against it. See the README.
    const errors = checker.check({ elements: [{ type: "radio", name: "q1" }] }, true);
    expect(errors.join(" ")).toContain("unknown elements type: 'radio'");
  });
});

describe("the schema", () => {
  itCore("has its header, its locstring definition, and no dangling $ref", () => {
    const schema = bundle.Serializer.generateSchema();
    expect(schema["$schema"]).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema.definitions.locstring).toBeDefined();
    const ids = Object.keys(schema.definitions);
    const refs: string[] = [];
    const walk = (node: any): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      if (typeof node.$ref === "string") refs.push(node.$ref.replace("#/definitions/", ""));
      Object.keys(node).forEach((key) => walk(node[key]));
    };
    walk(schema);
    expect(refs.length).toBeGreaterThan(0);
    refs.forEach((ref) => expect(ids).toContain(ref));
  });
});

describe("the emitted files", () => {
  itCore("the guide reports its size and stays inside the budget", () => {
    expect(guide.bytes).toBeGreaterThan(0);
    expect(guide.approxTokens).toBeGreaterThan(0);
    expect(() => buildLLMGuide(model, bundle, { maxBytes: 1024 })).toThrow(/over the/);
  });

  itCore("the output rules ban invented names and point at the version-pinned schema", () => {
    expect(text).toContain("never invent one");
    expect(text).toContain("Use enum values exactly");
    // The self-check URL is pinned to the survey-core the guide was generated from.
    expect(text).toContain("https://unpkg.com/survey-core@" + facts.version + "/surveyjs_definition.json");
  });

  itCore("llms.txt points at both artifacts", () => {
    const llms = guide.files[path.join(process.cwd(), "docs", "llms.txt")];
    expect(llms).toContain("authoring guide");
    expect(llms).toContain("JSON Schema");
    expect(llms).toContain(facts.version);
  });

  itCore("--split emits one file per question type, and member links only when asked", () => {
    const split = buildLLMGuide(model, bundle, { outputDir: "docs", split: true });
    const textFile = path.join(process.cwd(), "docs", "survey-json-authoring", "text.md");
    expect(Object.keys(split.files)).toContain(textFile);
    expect(split.files[textFile]).not.toContain("#placeholder");

    const linked = buildLLMGuide(model, bundle, {
      outputDir: "docs", split: true, withMemberLinks: true
    });
    expect(linked.files[textFile]).toContain("#placeholder");
  });

  itCore("guideOutputDir moves only the guide file; split and llms.txt stay in outputDir", () => {
    const moved = buildLLMGuide(model, bundle, {
      outputDir: "docs", guideOutputDir: "llms", split: true
    });
    const keys = Object.keys(moved.files);
    // The guide file lands under the override, not under outputDir.
    expect(keys).toContain(path.join(process.cwd(), "llms", "survey-json-authoring.md"));
    expect(keys).not.toContain(path.join(process.cwd(), "docs", "survey-json-authoring.md"));
    // Its companions do not move.
    expect(keys).toContain(path.join(process.cwd(), "docs", "llms.txt"));
    expect(keys).toContain(path.join(process.cwd(), "docs", "survey-json-authoring", "text.md"));
  });

  itCore("without guideOutputDir the guide stays in outputDir", () => {
    const keys = Object.keys(guide.files);
    expect(keys).toContain(path.join(process.cwd(), "docs", "survey-json-authoring.md"));
  });

  itCore("two runs are byte-identical -- --check depends on it", () => {
    const first = buildLLMGuide(model, bundle, { outputDir: "docs" });
    const second = buildLLMGuide(model, bundle, { outputDir: "docs" });
    expect(second.files).toEqual(first.files);
    // No timestamp: a timestamp would make every run a diff.
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
  });

  itCore("one bad property does not end the run", () => {
    // survey.locale computes its choices from a live object, so getChoices(null) yields
    // nothing usable. The property is still documented; the run records a warning.
    expect(guide.warnings.join(" ")).toContain("no static choice list");
    const survey = facts.classes.find((c) => c.name === "survey");
    expect(survey!.ownProperties.some((p) => p.name === "locale")).toBe(true);
  });
});

describe("operator extraction when survey-core is not there", () => {
  test("no sources: a warning, not a throw", () => {
    const warnings: string[] = [];
    expect(readOperatorNames([], warnings)).toEqual({ binary: [], unary: [] });
    expect(warnings.join(" ")).toContain("expressions.ts");
  });

  test("no parser: a warning, not a throw", () => {
    const warnings: string[] = [];
    const names = { binary: ["greater"], unary: ["empty"] };
    expect(extractOperators(names, <any>{ Serializer: {} }, warnings)).toEqual([]);
    expect(warnings.join(" ")).toContain("ConditionsParser");
  });
});

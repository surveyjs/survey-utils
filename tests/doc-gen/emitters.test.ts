import * as path from "path";
import {
  buildModel, buildDocModelJSON, buildJSONDefinitionAST, buildMDFiles, setJsonObj, DocModel
} from "../../src/doc-gen";
import { entryFile } from "./helper";

/** A serializer stand-in for the definition fixture. The AST definition is rooted at SurveyModel. */
function createFakeSerializer() {
  const classes: any = {
    survey: {
      name: "survey",
      properties: [
        { name: "title" },
        { name: "mode", defaultValue: "edit", choices: ["edit", "display"] },
        { name: "pages", className: "page" }
      ]
    },
    page: { name: "page", parentName: "base", properties: [{ name: "name" }] }
  };
  return {
    findClass: (name: string) => classes[name],
    getProperties: (name: string) => (classes[name] ? classes[name].properties : []),
    findProperty: (className: string, propName: string) => {
      const cls = classes[className];
      if (!cls) return undefined;
      return cls.properties.find((p: any) => p.name === propName);
    }
  };
}

function build(fixture: string, jsonObj: any = null): DocModel {
  try {
    setJsonObj(jsonObj);
    const model = buildModel([entryFile(fixture)], {});
    if (!model) throw new Error("no model for " + fixture);
    return model;
  } finally {
    setJsonObj(null);
  }
}

describe("emitters over one doc model", () => {
  test("every emitter runs off a single build -- Markdown and JSON are no longer exclusive", () => {
    const model = build("definition", createFakeSerializer());
    const json = buildDocModelJSON(model, "docs");
    const md = buildMDFiles(model.classes, model.pmes, { outputDir: path.join("docs", "api") });
    const definition = buildJSONDefinitionAST(model, "docs");

    expect(Object.keys(json).map((p) => path.basename(p)).sort()).toEqual(["classes.json", "pmes.json"]);
    expect(Object.keys(md).map((p) => path.basename(p))).toContain("surveymodel.md");
    expect(Object.keys(definition).map((p) => path.basename(p))).toEqual(["surveyjs_definition.json"]);
  });

  test("emitted paths resolve against the working directory", () => {
    const model = build("smoke");
    const json = buildDocModelJSON(model, "out/json");
    expect(Object.keys(json)[0]).toBe(path.join(process.cwd(), "out", "json", "classes.json"));
  });

  test("buildDocModelJSON emits the model verbatim, 4-space indented", () => {
    const model = build("smoke");
    const files = buildDocModelJSON(model, "docs");
    const classes = files[path.join(process.cwd(), "docs", "classes.json")];
    expect(classes).toBe(JSON.stringify(model.classes, undefined, 4));
    expect(JSON.parse(classes).find((c: any) => c.name === "SimpleModel")).toBeDefined();
  });

  test("the AST JSON definition carries the draft-07 header and the serialized properties", () => {
    const model = build("definition", createFakeSerializer());
    const file = buildJSONDefinitionAST(model, "docs")[path.join(process.cwd(), "docs", "surveyjs_definition.json")];
    const definition = JSON.parse(file);
    expect(definition["$schema"]).toBe("http://json-schema.org/draft-07/schema#");
    expect(definition["title"]).toBe("SurveyJS Library json schema");
    expect(definition.type).toBe("object");
    expect(definition.properties.title).toEqual({ type: "string" });
    expect(definition.properties.mode.enum).toEqual(["edit", "display"]);
    // A class-typed array property references the definition of its item class.
    expect(definition.properties.pages).toEqual({ type: "array", items: { $href: "#page" } });
    expect(definition.definitions.page.$id).toBe("#page");
    expect(definition.definitions.page.properties.name).toEqual({ type: "string" });
  });

  test("emitting the AST JSON definition twice from one model is deterministic", () => {
    // The AST emitter accumulates into the context; --check compares runs, so it must reset.
    const model = build("definition", createFakeSerializer());
    const first = buildJSONDefinitionAST(model, "docs");
    const second = buildJSONDefinitionAST(model, "docs");
    expect(second).toEqual(first);
  });

  test("two independent builds of the same entry produce the same bytes", () => {
    const first = buildDocModelJSON(build("tags"), "docs");
    const second = buildDocModelJSON(build("tags"), "docs");
    expect(second).toEqual(first);
  });

  test("@since reaches classes.json and pmes.json", () => {
    const files = buildDocModelJSON(build("tags"), "docs");
    const classes = JSON.parse(files[path.join(process.cwd(), "docs", "classes.json")]);
    const pmes = JSON.parse(files[path.join(process.cwd(), "docs", "pmes.json")]);
    expect(classes.find((c: any) => c.name === "ElementBase").since).toBe("1.9.0");
    expect(pmes.find((p: any) => p.className === "ElementBase" && p.name === "isVisible").since).toBe("1.9.100");
  });

  test("buildModel returns null for a missing entry file", () => {
    expect(buildModel(["tests/doc-gen/fixtures/nope.entry.ts"], {})).toBeNull();
  });
});

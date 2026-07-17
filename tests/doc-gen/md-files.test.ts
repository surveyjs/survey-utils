import * as path from "path";
import { runDocGenerator, runMDGenerator, runFullGenerator, lastWrittenPaths } from "./helper";
import { detectProduct, generateIndexMD, sourceUrl } from "../../src/doc-gen";

/** Directory the last runFullGenerator call wrote the given file into. */
function dirOf(fileName: string): string {
  const filePath = lastWrittenPaths.find((p) => path.basename(p) === fileName);
  return filePath ? path.dirname(filePath) : "";
}

describe("generateMDFiles", () => {
  describe("class file (smoke fixture)", () => {
    let files: { [name: string]: string };
    let md: string;
    beforeAll(() => {
      const docs = runDocGenerator("smoke");
      files = runMDGenerator(docs.classes, docs.pmes);
      md = files["SimpleModel.md"];
    });

    test("a file is generated per documented class, named <ClassName>.md", () => {
      expect(files["SimpleModel.md"]).toBeDefined();
    });

    test("undocumented classes do not produce a file", () => {
      expect(files["NotDocumented.md"]).toBeUndefined();
    });

    test("classes and interfaces without a description do not produce a file", () => {
      const classes = [
        { name: "Documented", entryType: 1, documentation: "A documented class." },
        { name: "NoDocClass", entryType: 1, documentation: "   " },
        { name: "IDocumented", entryType: 2, documentation: "A documented interface." },
        { name: "INoDocIface", entryType: 2, documentation: "" }
      ];
      const out = runMDGenerator(classes as any, []);
      expect(out["Documented.md"]).toBeDefined();
      expect(out["IDocumented.md"]).toBeDefined();
      expect(out["NoDocClass.md"]).toBeUndefined();
      expect(out["INoDocIface.md"]).toBeUndefined();
    });

    test("front matter carries the title, product and api-type", () => {
      expect(md).toContain("---\n");
      expect(md).toContain("title: SimpleModel");
      expect(md).toContain("product: Form Library");
      expect(md).toContain("api-type: class");
    });

    test("front matter carries the source URL, unquoted", () => {
      expect(md).toContain("source: https://surveyjs.io/form-library/documentation/api-reference/simplemodel");
    });

    test("front matter description is only the first sentence, without links", () => {
      const classes = [{
        name: "EmailValidator", entryType: 1,
        documentation: "A class that implements a validator for e-mail addresses. [View Demo](https://surveyjs.io/form-library/examples/javascript-form-validation/ (linkStyle))"
      }];
      const out = runMDGenerator(classes as any, [])["EmailValidator.md"];
      // Inspect only the front-matter block; the body keeps the full documentation.
      const frontMatter = out.split("---")[1];
      expect(frontMatter).toContain("description: A class that implements a validator for e-mail addresses.");
      expect(frontMatter).not.toContain("View Demo");
      expect(frontMatter).not.toContain("](");
      expect(frontMatter).not.toContain("https://surveyjs.io/form-library/examples");
    });

    test("heading and class description are rendered", () => {
      expect(md).toContain("# `SimpleModel`");
      expect(md).toContain("A simple model class.");
    });

    test("properties are listed with description and type", () => {
      expect(md).toContain("## Properties");
      expect(md).toContain("### `title`");
      expect(md).toContain("The model title.");
      expect(md).toContain("**Type**: `string`");
    });

    test("property block order is name, then type, then description", () => {
      const heading = md.indexOf("### `title`");
      const type = md.indexOf("**Type**: `string`");
      const desc = md.indexOf("The model title.");
      expect(heading).toBeLessThan(type);
      expect(type).toBeLessThan(desc);
    });

    test("methods are listed with return value and a parameters table", () => {
      expect(md).toContain("## Methods");
      expect(md).toContain("### `greet()`");
      expect(md).toContain("Returns a greeting for the specified name.");
      expect(md).toContain("**Return value:** `string` &ndash; The greeting text.");
      expect(md).toContain("**Parameters:**");
      expect(md).toContain("| `name` | `string` | A person name. |");
    });

    test("method block order is name, then type (return value), then description", () => {
      const heading = md.indexOf("### `greet()`");
      const returnValue = md.indexOf("**Return value:** `string`");
      const desc = md.indexOf("Returns a greeting for the specified name.");
      const params = md.indexOf("**Parameters:**");
      expect(heading).toBeLessThan(returnValue);
      expect(returnValue).toBeLessThan(desc);
      expect(desc).toBeLessThan(params);
    });

    test("members within a section are listed in alphabetical order", () => {
      const classes = [{ name: "Sample", entryType: 1, documentation: "A sample class." }];
      const pmes = [
        { className: "Sample", name: "zebra", pmeType: "property", type: "string", documentation: "Z prop." },
        { className: "Sample", name: "apple", pmeType: "property", type: "string", documentation: "A prop." },
        { className: "Sample", name: "mango", pmeType: "property", type: "string", documentation: "M prop." },
        { className: "Sample", name: "run", pmeType: "method", returnType: "void", documentation: "R method." },
        { className: "Sample", name: "brake", pmeType: "method", returnType: "void", documentation: "B method." }
      ];
      const out = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      expect(out.indexOf("`apple`")).toBeLessThan(out.indexOf("`mango`"));
      expect(out.indexOf("`mango`")).toBeLessThan(out.indexOf("`zebra`"));
      expect(out.indexOf("`brake()`")).toBeLessThan(out.indexOf("`run()`"));
    });

    test("members without a description are not rendered", () => {
      const classes = [{ name: "Sample", entryType: 1, documentation: "A sample class." }];
      const pmes = [
        { className: "Sample", name: "documentedProp", pmeType: "property", type: "string", documentation: "A documented property." },
        { className: "Sample", name: "silentProp", pmeType: "property", type: "string", documentation: "" },
        { className: "Sample", name: "documentedMethod", pmeType: "method", returnType: "void", documentation: "A documented method." },
        { className: "Sample", name: "silentMethod", pmeType: "method", returnType: "void", documentation: "   " }
      ];
      const out = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      expect(out).toContain("### `documentedProp`");
      expect(out).toContain("### `documentedMethod()`");
      expect(out).not.toContain("silentProp");
      expect(out).not.toContain("silentMethod");
    });
  });

  describe("members declared with several types", () => {
    const classes = [{ name: "Sample", entryType: 1, documentation: "A sample class." }];

    test("a property declared with several types is listed once with the union of its types", () => {
      // The doc generator emits one entry per declaration, so an overloaded
      // getter/setter reaches the renderer several times under the same name.
      const pmes = [
        { className: "Sample", name: "raw", pmeType: "property", type: "string", documentation: "The raw value." },
        { className: "Sample", name: "raw", pmeType: "property", type: "ArrayBuffer", documentation: "The raw value." },
        { className: "Sample", name: "raw", pmeType: "property", type: "Blob", documentation: "The raw value." }
      ];
      const md = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      // Exactly one heading for the member.
      expect(md.match(/### `raw`/g)?.length).toBe(1);
      // A single Type line carries the union of all declared types.
      expect(md).toContain("**Type**: `string | ArrayBuffer | Blob`");
    });

    test("duplicate property entries with the same type collapse to a single type", () => {
      const pmes = [
        { className: "Sample", name: "count", pmeType: "property", type: "number", documentation: "A count." },
        { className: "Sample", name: "count", pmeType: "property", type: "number", documentation: "A count." }
      ];
      const md = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      expect(md.match(/### `count`/g)?.length).toBe(1);
      expect(md).toContain("**Type**: `number`");
    });

    test("a method declared with several return types is listed once with the union", () => {
      const pmes = [
        {
          className: "Sample", name: "getData", pmeType: "method", returnType: "string",
          documentation: "Gets the data."
        },
        {
          className: "Sample", name: "getData", pmeType: "method", returnType: "ArrayBuffer",
          documentation: "Gets the data."
        }
      ];
      const md = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      expect(md.match(/### `getData\(\)`/g)?.length).toBe(1);
      expect(md).toContain("**Return value:** `string | ArrayBuffer`");
    });

    test("distinct members are not merged", () => {
      const pmes = [
        { className: "Sample", name: "alpha", pmeType: "property", type: "string", documentation: "Alpha." },
        { className: "Sample", name: "beta", pmeType: "property", type: "number", documentation: "Beta." }
      ];
      const md = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      expect(md).toContain("### `alpha`");
      expect(md).toContain("### `beta`");
      expect(md).toContain("**Type**: `string`");
      expect(md).toContain("**Type**: `number`");
    });
  });

  describe("interface file (members fixture)", () => {
    let files: { [name: string]: string };
    beforeAll(() => {
      const docs = runDocGenerator("members");
      files = runMDGenerator(docs.classes, docs.pmes);
    });

    test("an interface produces a <InterfaceName>.md file marked api-type: interface", () => {
      const md = files["IPanel.md"];
      expect(md).toBeDefined();
      expect(md).toContain("api-type: interface");
      expect(md).toContain("# `IPanel`");
      expect(md).toContain("### `name`");
      expect(md).toContain("### `description`");
    });

    test("a class with different member kinds is rendered", () => {
      const md = files["MemberKinds.md"];
      expect(md).toBeDefined();
      expect(md).toContain("api-type: class");
      expect(md).toContain("### `readOnlyValue`");
      expect(md).toContain("### `calculate()`");
    });
  });

  describe("variable file (variable fixture)", () => {
    let files: { [name: string]: string };
    beforeAll(() => {
      const docs = runDocGenerator("variable");
      files = runMDGenerator(docs.classes, docs.pmes);
    });

    test("an exported documented variable produces a <name>.md file marked api-type: variable", () => {
      const md = files["settings.md"];
      expect(md).toBeDefined();
      expect(md).toContain("title: settings");
      expect(md).toContain("api-type: variable");
      expect(md).toContain("source: https://surveyjs.io/form-library/documentation/api-reference/settings");
      expect(md).toContain("# `settings`");
      expect(md).toContain("Global settings that control the library behavior.");
    });

    test("the variable's members are rendered as properties", () => {
      const md = files["settings.md"];
      expect(md).toContain("## Properties");
      expect(md).toContain("### `commentSuffix`");
      expect(md).toContain("**Type**: `string`");
      expect(md).toContain("### `confirmDelete`");
      expect(md).toContain("**Type**: `boolean`");
    });

    test("a variable without a description does not produce a file", () => {
      const entries = [
        { name: "documentedVar", entryType: 4, documentation: "A documented variable." },
        { name: "silentVar", entryType: 4, documentation: "   " }
      ];
      const out = runMDGenerator(entries as any, []);
      expect(out["documentedVar.md"]).toBeDefined();
      expect(out["silentVar.md"]).toBeUndefined();
    });
  });

  describe("inheritance chain (inheritance fixture)", () => {
    test("the Inheritance section lists base types from the root down to the class", () => {
      const docs = runDocGenerator("inheritance");
      const files = runMDGenerator(docs.classes, docs.pmes);
      const md = files["QuestionText.md"];
      const base = "https://surveyjs.io/form-library/documentation/api-reference";
      expect(md).toContain("## Inheritance");
      expect(md).toContain(
        "[`Base`](" + base + "/base.md) &rarr; [`Question`](" + base + "/question.md) &rarr; `QuestionText`"
      );
    });

    test("a root class without a base type has no Inheritance section", () => {
      const docs = runDocGenerator("inheritance");
      const files = runMDGenerator(docs.classes, docs.pmes);
      expect(files["Base.md"]).not.toContain("## Inheritance");
    });
  });

  describe("related APIs (@see tags)", () => {
    const classes = [{ name: "Sample", entryType: 1, documentation: "A sample class." }];

    test("a property with @see tags ends with a Related APIs line", () => {
      const pmes = [{
        className: "Sample", name: "name", pmeType: "property", type: "string",
        documentation: "The element name.", see: ["width", "widthValue"]
      }];
      const md = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      expect(md).toContain("**Related APIs:** [`width`](#width), [`widthValue`](#widthValue)");
    });

    test("the Related APIs line is the last part of a property block", () => {
      const pmes = [
        {
          className: "Sample", name: "aaa", pmeType: "property", type: "string",
          documentation: "The A description.", see: ["width"]
        },
        {
          className: "Sample", name: "bbb", pmeType: "property", type: "string",
          documentation: "The B description."
        }
      ];
      const md = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      const related = md.indexOf("**Related APIs:**");
      expect(md.indexOf("The A description.")).toBeLessThan(related);
      expect(related).toBeLessThan(md.indexOf("### `bbb`"));
    });

    test("a method renders Related APIs after its parameters table", () => {
      const pmes = [{
        className: "Sample", name: "greet", pmeType: "method", returnType: "string",
        documentation: "Greets someone.", returnDocumentation: "The greeting text.",
        parameters: [{ name: "who", type: "string", documentation: "A person name." }],
        see: ["name"]
      }];
      const md = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      expect(md).toContain("**Related APIs:** [`name`](#name)");
      expect(md.indexOf("**Parameters:**")).toBeLessThan(md.indexOf("**Related APIs:**"));
    });

    test("an event renders Related APIs after its description", () => {
      const pmes = [{
        className: "Sample", name: "onComplete", pmeType: "event",
        documentation: "An event raised on complete.", see: ["onStarted"]
      }];
      const md = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      expect(md).toContain("**Related APIs:** [`onStarted`](#onStarted)");
      expect(md.indexOf("An event raised on complete.")).toBeLessThan(md.indexOf("**Related APIs:**"));
    });

    test("members without @see tags get no Related APIs line", () => {
      const pmes = [
        {
          className: "Sample", name: "noSee", pmeType: "property", type: "string",
          documentation: "No see tags."
        },
        {
          className: "Sample", name: "emptySee", pmeType: "property", type: "string",
          documentation: "Empty see array.", see: []
        },
        {
          className: "Sample", name: "blankSee", pmeType: "property", type: "string",
          documentation: "Blank see entries.", see: ["", "   ", null]
        }
      ];
      const md = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      expect(md).not.toContain("**Related APIs:**");
    });

    test("a see entry given as a plain string is rendered as a single link", () => {
      const pmes = [{
        className: "Sample", name: "name", pmeType: "property", type: "string",
        documentation: "The element name.", see: "width"
      }];
      const md = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      expect(md).toContain("**Related APIs:** [`width`](#width)");
    });

    test("the TypeScript trailing asterisk is stripped from a see entry", () => {
      const pmes = [{
        className: "Sample", name: "name", pmeType: "property", type: "string",
        documentation: "The element name.", see: ["width *", "widthValue"]
      }];
      const md = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      expect(md).toContain("**Related APIs:** [`width`](#width), [`widthValue`](#widthValue)");
      expect(md).not.toContain("width *");
    });

    test("the tags fixture renders the @see tags of ElementBase.name", () => {
      const docs = runDocGenerator("tags");
      const files = runMDGenerator(docs.classes, docs.pmes);
      expect(files["ElementBase.md"]).toContain(
        "**Related APIs:** [`width`](#width), [`widthValue`](#widthValue)"
      );
    });
  });

  describe("since (@since tags)", () => {
    const classes = [{
      name: "Sample", entryType: 1, documentation: "A sample class.", since: "1.9.0"
    }];

    test("a class with @since renders a Since line after its description", () => {
      const md = runMDGenerator(classes as any, [])["Sample.md"];
      expect(md).toContain("**Since:** 1.9.0");
      expect(md.indexOf("A sample class.")).toBeLessThan(md.indexOf("**Since:** 1.9.0"));
    });

    test("a class without @since has no Since line", () => {
      const bare = [{ name: "Sample", entryType: 1, documentation: "A sample class." }];
      expect(runMDGenerator(bare as any, [])["Sample.md"]).not.toContain("**Since:**");
    });

    test("a property with @since renders a Since line after its description", () => {
      const pmes = [{
        className: "Sample", name: "isVisible", pmeType: "property", type: "boolean",
        documentation: "Specifies the visibility.", since: "1.9.100"
      }];
      const md = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      expect(md).toContain("**Since:** 1.9.100");
      expect(md.indexOf("Specifies the visibility.")).toBeLessThan(md.indexOf("**Since:** 1.9.100"));
    });

    test("a method with @since renders its Since line before the parameters table", () => {
      const pmes = [{
        className: "Sample", name: "greet", pmeType: "method", returnType: "string",
        documentation: "Greets someone.", since: "2.0.0",
        parameters: [{ name: "who", type: "string", documentation: "A person name." }]
      }];
      const md = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      expect(md.indexOf("**Since:** 2.0.0")).toBeLessThan(md.indexOf("**Parameters:**"));
    });

    test("an event with @since renders a Since line", () => {
      const pmes = [{
        className: "Sample", name: "onComplete", pmeType: "event",
        documentation: "An event raised on complete.", since: "3.1.0"
      }];
      const md = runMDGenerator(classes as any, pmes as any)["Sample.md"];
      expect(md).toContain("**Since:** 3.1.0");
    });

    test("the tags fixture renders the @since of the class and its member", () => {
      const docs = runDocGenerator("tags");
      const md = runMDGenerator(docs.classes, docs.pmes)["ElementBase.md"];
      expect(md).toContain("**Since:** 1.9.0");
      expect(md).toContain("**Since:** 1.9.100");
    });
  });

  describe("events (events fixture)", () => {
    test("events are rendered under an Events section with their documentation", () => {
      const docs = runDocGenerator("events");
      const files = runMDGenerator(docs.classes, docs.pmes);
      const md = files["SurveyModel.md"];
      expect(md).toContain("## Events");
      expect(md).toContain("### `onComplete`");
      expect(md).toContain("An event raised when the survey is completed.");
      // The event documentation already carries the resolved parameter list.
      expect(md).toContain("- `options.data`: `any`");
    });
  });

  describe("options", () => {
    test("the product name can be overridden", () => {
      const docs = runDocGenerator("smoke");
      const files = runMDGenerator(docs.classes, docs.pmes, { product: "Survey Creator" });
      expect(files["SimpleModel.md"]).toContain("product: Survey Creator");
    });
  });

  describe("index file", () => {
    // Hand-built entries give full control over member counts and descriptions.
    const classes = [
      { name: "SmallHelper", entryType: 1, documentation: "A small helper class. Extra sentence here." },
      { name: "SurveyModel", entryType: 1, documentation: "The main survey model. It does a lot of things." },
      { name: "MidClass", entryType: 1, documentation: "A mid-sized class. Second sentence." },
      { name: "NoDescription", entryType: 1, documentation: "   " },
      { name: "IPanel", entryType: 2, documentation: "A panel interface. Second sentence." },
      { name: "ISmallOne", entryType: 2, documentation: "A small interface. Second sentence." },
      { name: "INoDescription", entryType: 2, documentation: "   " },
      { name: "settings", entryType: 4, documentation: "Global settings. Second sentence." }
    ];
    const pmes = [
      { className: "SurveyModel", name: "a", pmeType: "property", documentation: "Prop a." },
      { className: "SurveyModel", name: "b", pmeType: "property", documentation: "Prop b." },
      { className: "SurveyModel", name: "c", pmeType: "method", documentation: "Method c." },
      { className: "MidClass", name: "m1", pmeType: "property", documentation: "Prop m1." },
      { className: "MidClass", name: "m2", pmeType: "property", documentation: "Prop m2." },
      { className: "SmallHelper", name: "x", pmeType: "property", documentation: "Prop x." },
      { className: "IPanel", name: "name", pmeType: "property", documentation: "Name." },
      { className: "IPanel", name: "title", pmeType: "property", documentation: "Title." },
      { className: "ISmallOne", name: "id", pmeType: "property", documentation: "Id." }
    ];
    const md = generateIndexMD(classes as any, pmes as any);

    test("lists a class with only the first sentence of its description", () => {
      expect(md).toContain("`SurveyModel`");
      expect(md).toContain("The main survey model.");
      expect(md).not.toContain("It does a lot of things.");
      expect(md).toContain("A small helper class.");
      expect(md).not.toContain("Extra sentence here.");
    });

    test("classes are ordered by API member count, most members first", () => {
      const posSurvey = md.indexOf("SurveyModel");
      const posMid = md.indexOf("MidClass");
      const posSmall = md.indexOf("SmallHelper");
      expect(posSurvey).toBeGreaterThan(-1);
      expect(posSurvey).toBeLessThan(posMid);
      expect(posMid).toBeLessThan(posSmall);
    });

    test("the index file starts with the front matter and API-reference heading", () => {
      expect(md).toContain("---\ntitle: Classes and Interfaces\nproduct: Form Library\n---");
      expect(md).toContain("# SurveyJS Form Library API Reference");
      expect(md.indexOf("# SurveyJS Form Library API Reference")).toBeLessThan(md.indexOf("## Classes"));
    });

    test("the front-matter product and heading follow the given product", () => {
      const out = generateIndexMD(classes as any, pmes as any, "Survey Creator");
      expect(out).toContain("product: Survey Creator");
      expect(out).toContain("# SurveyJS Survey Creator API Reference");
    });

    test("the section titles use level-two headings", () => {
      expect(md).toContain("## Classes");
      expect(md).toContain("## Interfaces");
      expect(md).toContain("## Variables");
      expect(md).not.toContain("\n# Classes");
      expect(md).not.toContain("\n# Interfaces");
      expect(md).not.toContain("\n# Variables");
    });

    test("interfaces are listed in their own section, after the classes", () => {
      const posClasses = md.indexOf("## Classes");
      const posInterfaces = md.indexOf("## Interfaces");
      expect(posClasses).toBeGreaterThan(-1);
      expect(posClasses).toBeLessThan(posInterfaces);
      expect(md.indexOf("SurveyModel")).toBeLessThan(posInterfaces);
      expect(md.indexOf("IPanel")).toBeGreaterThan(posInterfaces);
    });

    test("interfaces follow the class rules: first sentence, member count order, link", () => {
      expect(md).toContain(
        "- [`IPanel`](https://surveyjs.io/form-library/documentation/api-reference/ipanel.md) — A panel interface."
      );
      expect(md.indexOf("IPanel")).toBeLessThan(md.indexOf("ISmallOne"));
    });

    test("classes and interfaces without a description are not listed", () => {
      expect(md).not.toContain("NoDescription");
    });

    test("variables are listed in their own section, after the interfaces", () => {
      const posInterfaces = md.indexOf("## Interfaces");
      const posVariables = md.indexOf("## Variables");
      expect(posInterfaces).toBeGreaterThan(-1);
      expect(posInterfaces).toBeLessThan(posVariables);
      expect(md).toContain(
        "- [`settings`](https://surveyjs.io/form-library/documentation/api-reference/settings.md) — Global settings."
      );
    });

    test("each class name is a link to its api-reference page", () => {
      expect(md).toContain(
        "- [`SurveyModel`](https://surveyjs.io/form-library/documentation/api-reference/surveymodel.md) — The main survey model."
      );
    });

    test("the link uses the given product's library slug", () => {
      const out = generateIndexMD(classes as any, pmes as any, "Survey Creator");
      expect(out).toContain("(https://surveyjs.io/survey-creator/documentation/api-reference/surveymodel.md)");
    });

    test("the description sentence itself stays link-free", () => {
      const linked = [
        { name: "Linked", entryType: 1, documentation: "See the [`PanelModel`](https://example.com/panel) class for details." }
      ];
      const line = generateIndexMD(linked as any, [])
        .split("\n").find((l) => l.indexOf("Linked") > -1) || "";
      const sentence = line.split(" — ")[1] || "";
      expect(sentence).toBe("See the `PanelModel` class for details.");
      expect(sentence).not.toContain("](");
      expect(sentence).not.toContain("https://");
    });

    test("generateMDFiles writes an index.md alongside the class files", () => {
      const docs = runDocGenerator("smoke");
      const files = runMDGenerator(docs.classes, docs.pmes);
      expect(files["index.md"]).toBeDefined();
      expect(files["index.md"]).toContain(
        "[`SimpleModel`](https://surveyjs.io/form-library/documentation/api-reference/simplemodel.md)"
      );
      expect(files["index.md"]).toContain("A simple model class.");
    });
  });

  describe("generateDocumentation integration", () => {
    test("generateMDFiles: true writes Markdown and skips the JSON files", () => {
      const files = runFullGenerator("smoke", { generateMDFiles: true });
      expect(files["SimpleModel.md"]).toBeDefined();
      expect(files["classes.json"]).toBeUndefined();
      expect(files["pmes.json"]).toBeUndefined();
    });

    test("without generateMDFiles the JSON files are written and no Markdown", () => {
      const files = runFullGenerator("smoke", {});
      expect(files["classes.json"]).toBeDefined();
      expect(files["pmes.json"]).toBeDefined();
      expect(files["SimpleModel.md"]).toBeUndefined();
    });

    test("without outputDir the files go to docs (Markdown to docs/api-reference)", () => {
      runFullGenerator("smoke", {});
      expect(dirOf("classes.json")).toBe(path.join(process.cwd(), "docs"));
      runFullGenerator("smoke", { generateMDFiles: true });
      expect(dirOf("SimpleModel.md")).toBe(path.join(process.cwd(), "docs", "api-reference"));
    });

    test("outputDir sets the directory of the JSON files", () => {
      const outputDir = path.join(process.cwd(), "out", "json");
      runFullGenerator("smoke", { outputDir: outputDir });
      expect(dirOf("classes.json")).toBe(outputDir);
      expect(dirOf("pmes.json")).toBe(outputDir);
    });

    test("outputDir sets the directory of the Markdown files", () => {
      const outputDir = path.join(process.cwd(), "out", "md");
      runFullGenerator("smoke", { generateMDFiles: true, outputDir: outputDir });
      expect(dirOf("SimpleModel.md")).toBe(outputDir);
      expect(dirOf("index.md")).toBe(outputDir);
    });

    test("a relative outputDir is resolved against the working directory", () => {
      runFullGenerator("smoke", { generateMDFiles: true, outputDir: "out/relative" });
      expect(dirOf("SimpleModel.md")).toBe(path.join(process.cwd(), "out", "relative"));
    });

    test("mdOptions.outputDir wins over outputDir for the Markdown files", () => {
      const mdDir = path.join(process.cwd(), "out", "md-options");
      runFullGenerator("smoke", {
        generateMDFiles: true,
        outputDir: path.join(process.cwd(), "out"),
        mdOptions: { outputDir: mdDir }
      });
      expect(dirOf("SimpleModel.md")).toBe(mdDir);
    });
  });

  describe("source URL", () => {
    test("maps each product to its library slug and lowercases the class name", () => {
      expect(sourceUrl("Form Library", "SurveyModel"))
        .toBe("https://surveyjs.io/form-library/documentation/api-reference/surveymodel");
      expect(sourceUrl("Survey Creator", "SurveyCreatorModel"))
        .toBe("https://surveyjs.io/survey-creator/documentation/api-reference/surveycreatormodel");
      expect(sourceUrl("Dashboard", "VisualizationPanel"))
        .toBe("https://surveyjs.io/dashboard/documentation/api-reference/visualizationpanel");
      expect(sourceUrl("PDF Generator", "SurveyPDF"))
        .toBe("https://surveyjs.io/pdf-generator/documentation/api-reference/surveypdf");
    });

    test("falls back to the Form Library slug for an unknown product", () => {
      expect(sourceUrl("Unknown", "Foo"))
        .toBe("https://surveyjs.io/form-library/documentation/api-reference/foo");
    });

    test("honours a custom base URL (without a trailing slash)", () => {
      expect(sourceUrl("Form Library", "Foo", "https://example.com/docs/"))
        .toBe("https://example.com/docs/form-library/documentation/api-reference/foo");
    });

    test("the detected/overridden product drives the source URL in the file", () => {
      const docs = runDocGenerator("smoke");
      const files = runMDGenerator(docs.classes, docs.pmes, { product: "PDF Generator" });
      expect(files["SimpleModel.md"])
        .toContain("source: https://surveyjs.io/pdf-generator/documentation/api-reference/simplemodel");
    });
  });

  describe("product detection", () => {
    test("defaults to Form Library when nothing matches", () => {
      expect(detectProduct(["entries/chunks/model.ts"])).toBe("Form Library");
      expect(detectProduct([])).toBe("Form Library");
      expect(detectProduct(undefined)).toBe("Form Library");
    });

    test("detects the PDF Generator from the entry path", () => {
      expect(detectProduct(["src/entries/pdf.ts"])).toBe("PDF Generator");
    });

    test("detects the PDF Generator with Windows-style separators", () => {
      expect(detectProduct(["src\\entries\\pdf.ts"])).toBe("PDF Generator");
    });

    test("detects Survey Creator from the working directory", () => {
      expect(detectProduct(["src/entries/index.ts"], "c:/survey.js/Lib/survey-creator")).toBe("Survey Creator");
    });

    test("detects the Dashboard from analytics/dashboard paths", () => {
      expect(detectProduct(["src/entries/analytics.ts"])).toBe("Dashboard");
      expect(detectProduct(["src/dashboard.ts"])).toBe("Dashboard");
    });

    test("generateMDFiles derives the product from options.fileNames", () => {
      const docs = runDocGenerator("smoke");
      const files = runMDGenerator(docs.classes, docs.pmes, { fileNames: ["src/entries/pdf.ts"] });
      expect(files["SimpleModel.md"]).toContain("product: PDF Generator");
    });

    test("an explicit product option wins over detection", () => {
      const docs = runDocGenerator("smoke");
      const files = runMDGenerator(docs.classes, docs.pmes, {
        product: "Form Library", fileNames: ["src/entries/pdf.ts"]
      });
      expect(files["SimpleModel.md"]).toContain("product: Form Library");
    });
  });
});

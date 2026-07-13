#!/usr/bin/env node
import * as ts from "typescript";
import * as path from "path";
import {
  buildModel, buildDocModelJSON, buildJSONDefinitionAST, buildMDFiles,
  buildJSONDefinitionRuntime, loadSerializer, setJsonObj, diffFiles, writeFiles, resolveDir, FileMap
} from "./doc-gen";
import { runCheckUnusedStrings } from "./checkUnusedStrings";
import { runTranslate, TranslateUsageError, translateProducts } from "./translate";

const USAGE = `survey-utils <command> [options]

Commands:
  generate-doc <entry...>   Generate API documentation from TypeScript entry files.
  check-strings [product]   Report localization strings no product source reaches any more.
  translate <product>       Translate the localization files of a product.

survey-utils generate-doc <entry...> [options]

  <entry...>                One or more TS entry files, relative to the working directory
                            (survey-core: ./entries/chunks/model.ts, creator: src/entries/index.ts).

  --serializer <path>       Module to require for Serializer metadata (e.g. ./build/survey.core).
                            Optional: without it the docs are AST/JSDoc only, and every
                            serializer-derived section is skipped.

  Emitters -- independently selectable, at least one required:
  --md                      Markdown API docs: <ClassName>.md per class + index.md.
  --json                    The raw doc model: classes.json + pmes.json.
  --json-definition[=runtime|ast]
                            JSON Schema. 'runtime' (default) is Serializer.generateSchema() and
                            requires --serializer; 'ast' is the doc-generator's AST-derived
                            document of the same name -- a different, larger schema.

  Markdown options:
  --product <name>          Front-matter product. Default: detected from the entry path.
  --md-out <dir>            Default: <out>/api
  --source-base-url <url>   Default: https://surveyjs.io

  --out <dir>               Output root. Default: ./docs
  --check                   Generate in memory, diff against what is on disk, exit 1 if they differ.

survey-utils check-strings [product] [--list-dead]

survey-utils translate <product> [--key <key>] [--path <dir>]

  <product>                 ${translateProducts.join(" | ")}

  --key <key>               Azure Translator subscription key. Without it the key is read
                            from TRANSLATION_API_KEY (environment or .env); --key wins.
  --path <dir>              Localization folder to translate, resolved against the working
                            directory. Overrides the product's default folder, which is
                            looked up next to survey-utils in a local SurveyJS checkout.
`;

interface DocArgs {
  entries: string[];
  serializer?: string;
  md: boolean;
  json: boolean;
  jsonDefinition?: "runtime" | "ast";
  product?: string;
  mdOut?: string;
  sourceBaseUrl?: string;
  out: string;
  check: boolean;
}

class UsageError extends Error { }

function parseDocArgs(args: string[]): DocArgs {
  const res: DocArgs = { entries: [], md: false, json: false, out: "docs", check: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = (): string => {
      const next = args[++i];
      if (next === undefined || next.indexOf("--") === 0) throw new UsageError(arg + " needs a value");
      return next;
    };
    if (arg.indexOf("--") !== 0) {
      res.entries.push(arg);
    } else if (arg === "--md") {
      res.md = true;
    } else if (arg === "--json") {
      res.json = true;
    } else if (arg === "--json-definition") {
      res.jsonDefinition = "runtime";
    } else if (arg.indexOf("--json-definition=") === 0) {
      const kind = arg.substring("--json-definition=".length);
      if (kind !== "runtime" && kind !== "ast") {
        throw new UsageError("--json-definition must be 'runtime' or 'ast', got '" + kind + "'");
      }
      res.jsonDefinition = kind;
    } else if (arg === "--llm-guide") {
      throw new UsageError(
        "--llm-guide is not implemented yet: it is the deliverable of promts/01-schema-and-llm-guide.md, "
        + "a third emitter over the same doc model."
      );
    } else if (arg === "--serializer") {
      res.serializer = value();
    } else if (arg === "--product") {
      res.product = value();
    } else if (arg === "--md-out") {
      res.mdOut = value();
    } else if (arg === "--source-base-url") {
      res.sourceBaseUrl = value();
    } else if (arg === "--out") {
      res.out = value();
    } else if (arg === "--check") {
      res.check = true;
    } else {
      throw new UsageError("Unknown option: " + arg);
    }
  }
  if (res.entries.length === 0) {
    throw new UsageError("No entry file. Example: survey-utils generate-doc ./entries/chunks/model.ts --md");
  }
  if (!res.md && !res.json && !res.jsonDefinition) {
    // Deliberately not inheriting doc-generator's implicit markdown-or-JSON default.
    throw new UsageError("No emitter selected. Pass at least one of --md, --json, --json-definition.");
  }
  if (res.jsonDefinition === "runtime" && !res.serializer) {
    throw new UsageError(
      "--json-definition needs --serializer: the schema comes from Serializer.generateSchema() in the "
      + "built bundle. Use --json-definition=ast for the AST-derived document, which needs no bundle."
    );
  }
  return res;
}

function generateDoc(args: DocArgs): number {
  const serializer = !!args.serializer ? loadSerializer(args.serializer) : null;
  const files: FileMap = {};

  const needsModel = args.md || args.json || args.jsonDefinition === "ast";
  if (needsModel) {
    if (!!serializer) setJsonObj(serializer);
    const model = buildModel(args.entries, {
      target: ts.ScriptTarget.ES5, module: ts.ModuleKind.CommonJS
    });
    if (!model) return 1;
    if (args.json) Object.assign(files, buildDocModelJSON(model, args.out));
    if (args.md) {
      Object.assign(files, buildMDFiles(model.classes, model.pmes, {
        product: args.product,
        fileNames: args.entries,
        outputDir: args.mdOut || path.join(args.out, "api"),
        sourceBaseUrl: args.sourceBaseUrl
      }));
    }
    if (args.jsonDefinition === "ast") Object.assign(files, buildJSONDefinitionAST(model, args.out));
  }
  if (args.jsonDefinition === "runtime") {
    files[path.join(resolveDir(args.out), "surveyjs_definition.json")] =
      buildJSONDefinitionRuntime(serializer);
  }

  if (args.check) {
    const changed = diffFiles(files);
    console.log(`${Object.keys(files).length} file(s) generated, ${changed.length} differ from disk.`);
    changed.forEach((file) => console.error("differs: " + file));
    return changed.length > 0 ? 1 : 0;
  }
  const written = writeFiles(files);
  console.log(`${written.length} file(s) written.`);
  return 0;
}

function main(): void {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(command ? 0 : 2);
  }
  try {
    if (command === "generate-doc") {
      process.exit(generateDoc(parseDocArgs(argv.slice(1))));
    }
    if (command === "check-strings") {
      process.exit(runCheckUnusedStrings(argv.slice(1)));
    }
    if (command === "translate") {
      // No process.exit on success: the translation requests are still in flight, and
      // exiting would kill them. Node ends the process once the event loop drains.
      const code = runTranslate(argv.slice(1));
      if (code !== 0) process.exit(code);
      return;
    }
    throw new UsageError("Unknown command: " + command);
  } catch (error) {
    const usage = error instanceof UsageError || error instanceof TranslateUsageError;
    console.error(usage ? String(error.message) : String(error instanceof Error ? error.stack : error));
    if (usage) console.error("\n" + USAGE);
    process.exit(usage ? 2 : 1);
  }
}

main();

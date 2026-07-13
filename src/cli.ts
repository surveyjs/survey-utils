#!/usr/bin/env node
import * as ts from "typescript";
import * as path from "path";
import {
  buildModel, buildDocModelJSON, buildJSONDefinitionAST, buildMDFiles, buildLLMGuide,
  buildJSONDefinitionRuntime, loadBundle, setJsonObj, diffFiles, writeFiles, resolveDir, FileMap
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
  --llm-guide               llm-guide.md: the authoring guide an LLM is given as context so the
                            SurveyJS JSON it writes loads. Needs --serializer. Also emits
                            llms.txt, listing the guide and the schema.

  Markdown options:
  --product <name>          Front-matter product. Default: detected from the entry path.
  --md-out <dir>            Default: <out>/api
  --source-base-url <url>   Default: https://surveyjs.io

  LLM guide options:
  --max-bytes <n>           Fail when the guide exceeds this. Default: 98304 (96 KB).
  --split                   Also emit one file per question type into <out>/llm-guide/.
  --with-member-links       Member-level API links in the split files. Off by default: ~400
                            links cost 6-10k tokens, and only a reader that can fetch them pays off.

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
  llmGuide: boolean;
  maxBytes?: number;
  split: boolean;
  withMemberLinks: boolean;
  product?: string;
  mdOut?: string;
  sourceBaseUrl?: string;
  out: string;
  check: boolean;
}

class UsageError extends Error { }

function parseDocArgs(args: string[]): DocArgs {
  const res: DocArgs = {
    entries: [], md: false, json: false, llmGuide: false, split: false,
    withMemberLinks: false, out: "docs", check: false
  };
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
      res.llmGuide = true;
    } else if (arg === "--split") {
      res.split = true;
    } else if (arg === "--with-member-links") {
      res.withMemberLinks = true;
    } else if (arg === "--max-bytes") {
      const bytes = parseInt(value(), 10);
      if (!(bytes > 0)) throw new UsageError("--max-bytes needs a positive number of bytes");
      res.maxBytes = bytes;
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
  if (!res.md && !res.json && !res.jsonDefinition && !res.llmGuide) {
    // Deliberately not inheriting doc-generator's implicit markdown-or-JSON default.
    throw new UsageError(
      "No emitter selected. Pass at least one of --md, --json, --json-definition, --llm-guide."
    );
  }
  if (res.jsonDefinition === "runtime" && !res.serializer) {
    throw new UsageError(
      "--json-definition needs --serializer: the schema comes from Serializer.generateSchema() in the "
      + "built bundle. Use --json-definition=ast for the AST-derived document, which needs no bundle."
    );
  }
  if (res.llmGuide && !res.serializer) {
    throw new UsageError(
      "--llm-guide needs --serializer: the question types, properties, operators and examples all "
      + "come from the built bundle, e.g. --serializer ./build/survey.core"
    );
  }
  if ((res.split || res.withMemberLinks) && !res.llmGuide) {
    throw new UsageError("--split and --with-member-links only apply to --llm-guide.");
  }
  return res;
}

function generateDoc(args: DocArgs): number {
  const bundle = !!args.serializer ? loadBundle(args.serializer) : null;
  const serializer = bundle ? bundle.Serializer : null;
  const files: FileMap = {};

  const needsModel = args.md || args.json || args.jsonDefinition === "ast" || args.llmGuide;
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
    if (args.llmGuide) {
      const guide = buildLLMGuide(model, <any>bundle, {
        outputDir: args.out,
        fileNames: args.entries,
        product: args.product,
        sourceBaseUrl: args.sourceBaseUrl,
        maxBytes: args.maxBytes,
        split: args.split,
        withMemberLinks: args.withMemberLinks
      });
      Object.assign(files, guide.files);
      console.log(
        `LLM guide: ${(guide.bytes / 1024).toFixed(1)} KB, ~${guide.approxTokens} tokens; `
        + `${guide.facts.documented} documented properties, ${guide.facts.undocumented} without JSDoc.`
      );
      guide.warnings.forEach((warning) => console.warn("warning: " + warning));
    }
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

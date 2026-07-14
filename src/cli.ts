#!/usr/bin/env node
import * as ts from "typescript";
import * as path from "path";
import {
  buildModel, buildDocModelJSON, buildJSONDefinitionAST, buildMDFiles, buildLLMGuide,
  buildJSONDefinitionRuntime, loadBundle, setJsonObj, diffFiles, writeFiles, resolveDir, FileMap
} from "./doc-gen";
import { runCheckUnusedStrings } from "./checkUnusedStrings";
import { products } from "./loc-lint";
import { PathError, requireDir, requireEntryFile } from "./paths";
import { runTranslate, TranslateUsageError, translateProducts } from "./translate";

/**
 * The emitters, in one place: the usage text lists them, and so does the error a run that
 * selected none reports. Nothing generates without one, so that error has to answer "which
 * flags are there, then" on the spot rather than point at the usage text.
 */
const EMITTERS = `  --md                      Markdown API docs: <ClassName>.md per class + index.md.
  --json                    The raw doc model: classes.json + pmes.json.
  --json-definition[=runtime|ast]
                            JSON Schema. 'runtime' (default) is Serializer.generateSchema() and
                            requires --serializer; 'ast' is the doc-generator's AST-derived
                            document of the same name -- a different, larger schema.
  --llm-guide               llm-guide.md: the authoring guide an LLM is given as context so the
                            SurveyJS JSON it writes loads. Needs --serializer. Also emits
                            llms.txt, listing the guide and the schema.`;

const USAGE = `survey-utils <command> [options]

Commands:
  generate-doc <entry...>   Generate API documentation from TypeScript entry files.
  check-strings [product]   Report localization strings no product source reaches any more.
  translate <product>       Translate the localization files of a product.

--path <dir> means the same thing in all three: the root of the product's repo -- the
folder that holds its package.json, not a folder inside it. Each command joins its own
subfolders onto it. Without --path, generate-doc works from the working directory, and
check-strings and translate look the repo up next to survey-utils (a local SurveyJS
checkout, where survey-utils sits beside survey-library, survey-creator, survey-analytics).

survey-utils generate-doc <entry...> [options]

  <entry...>                One or more TS entry files, relative to --path, or to the working
                            directory without it (survey-core: ./entries/chunks/model.ts,
                            creator: src/entries/index.ts).

  --path <dir>              Repo root every relative path below is resolved against:
                            <entry...>, --serializer, --out and --md-out. Default: the
                            working directory, so a product calling the bin from its own
                            package.json needs no --path.

  --serializer <path>       Module to require for Serializer metadata (e.g. ./build/survey.core).
                            Optional: without it the docs are AST/JSDoc only, and every
                            serializer-derived section is skipped.

  Emitters -- independently selectable, at least one required:
${EMITTERS}

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

survey-utils check-strings [product] [--list-dead] [--path <dir>]

  [product]                 ${Object.keys(products).join(" | ")}. Default: every one of them.

  --list-dead               Print the cleanup backlog: strings already recorded as dead.
  --path <dir>              Repo root of the product. It names one repo, so name the product
                            with it. The locale file, the source roots and the built bundle
                            are all found under it.

survey-utils translate <product> [--key <key>] [--path <dir>]

  <product>                 ${translateProducts.join(" | ")}

  --key <key>               Azure Translator subscription key. Without it the key is read
                            from TRANSLATION_API_KEY (environment or .env); --key wins.
  --path <dir>              Repo root of the product. The product's localization folder is
                            joined onto it (library -> packages/survey-core/src/localization).
`;

interface DocArgs {
  entries: string[];
  /** Repo root the relative paths below resolve against. Default: the working directory. */
  path?: string;
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

class UsageError extends Error {
  /**
   * @param selfContained The message already says everything the caller needs, so the usage
   * text is not appended: it would bury the report it is supposed to support.
   */
  constructor(message: string, public readonly selfContained: boolean = false) {
    super(message);
  }
}

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
    } else if (arg === "--path") {
      res.path = value();
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
    // Deliberately not inheriting doc-generator's implicit markdown-or-JSON default: a run
    // that names no emitter writes nothing, so it is a mistake, not a default. The flags are
    // the whole answer to it, so report them here instead of pointing at the usage text.
    throw new UsageError(
      "No emitter selected: generate-doc writes nothing on its own. Pass at least one of:\n\n"
      + EMITTERS + "\n\nExample: survey-utils generate-doc ./entries/chunks/model.ts --md --json",
      true
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
  // The repo root of --path. Without it every path stays as the caller typed it and
  // resolves against the working directory, which is what a product's own script wants.
  const root = !!args.path ? requireDir(args.path) : undefined;
  const at = (target: string): string => (!root ? target : path.resolve(root, target));

  // Before the bundle: an entry that is not there is the caller's mistake, and it is the one
  // the report should name. Checked for every emitter, including the ones that never build the
  // model, so an entry is never quietly ignored.
  const entries = args.entries.map((entry) => requireEntryFile(entry, root));
  const out = at(args.out);
  const mdOut = !!args.mdOut ? at(args.mdOut) : path.join(out, "api");

  const bundle = !!args.serializer ? loadBundle(args.serializer, root) : null;
  const serializer = bundle ? bundle.Serializer : null;
  const files: FileMap = {};

  const needsModel = args.md || args.json || args.jsonDefinition === "ast" || args.llmGuide;
  if (needsModel) {
    if (!!serializer) setJsonObj(serializer);
    const model = buildModel(entries, {
      target: ts.ScriptTarget.ES5, module: ts.ModuleKind.CommonJS
    });
    if (!model) return 1;
    if (args.json) Object.assign(files, buildDocModelJSON(model, out));
    if (args.md) {
      Object.assign(files, buildMDFiles(model.classes, model.pmes, {
        product: args.product,
        fileNames: entries,
        outputDir: mdOut,
        sourceBaseUrl: args.sourceBaseUrl
      }));
    }
    if (args.jsonDefinition === "ast") Object.assign(files, buildJSONDefinitionAST(model, out));
    if (args.llmGuide) {
      const guide = buildLLMGuide(model, <any>bundle, {
        outputDir: out,
        fileNames: entries,
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
    files[path.join(resolveDir(out), "surveyjs_definition.json")] =
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
    // A path that is not there -- a --path, an entry file -- is the caller's mistake, and the
    // message names it: report it like a usage error, without the usage text or a stack.
    if (error instanceof PathError) {
      console.error(error.message);
      process.exit(2);
    }
    const usage = error instanceof UsageError || error instanceof TranslateUsageError;
    console.error(usage ? String(error.message) : String(error instanceof Error ? error.stack : error));
    // A self-contained usage error listed what the caller has to choose from: appending the
    // whole usage text below it would only push that list off the screen.
    const selfContained = error instanceof UsageError && error.selfContained;
    if (usage && !selfContained) console.error("\n" + USAGE);
    process.exit(usage ? 2 : 1);
  }
}

main();

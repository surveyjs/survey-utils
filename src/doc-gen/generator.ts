import * as ts from "typescript";
import * as path from "path";
import { DocEntry, FileMap } from "./types";
import { GenerationContext } from "./context";
import { getTsOptions } from "./options";
import { checkFiles, resolveDir, writeFiles } from "./file-utils";
import { generateVueTSFiles, deleteVueTSFiles, isNonEnglishLocalizationFile } from "./vue-files";
import { setAllParentTypes } from "./inheritance";
import { visit } from "./visitor";
import { updateEventsDocumentation, updateHiddenForEntriesDoc } from "./event-docs";
import { addClassIntoJSONDefinition } from "./json-definition";
import { buildMDFiles, MDGenerationOptions } from "./md-generator";

/** The doc model: every emitter is a function of this and nothing else. */
export interface DocModel {
  classes: DocEntry[];
  pmes: DocEntry[];
  /** Class/PME lookups the AST JSON-definition emitter walks. */
  context: GenerationContext;
  /**
   * The sources the model was built from.
   *
   * An emitter that needs a fact the doc model does not carry -- the expression operators
   * live in a static object literal, which is a value, not an API member -- can go back to
   * the file it came from instead of reaching for a class survey-core does not export.
   */
  sourceFiles: string[];
}

export interface DocOptions {
  outputDir?: string;
  generateMDFiles?: boolean;
  generateJSONDefinition?: boolean;
  mdOptions?: MDGenerationOptions;
}

/**
 * Walks the TypeScript sources reachable from `fileNames` and joins them with the
 * Serializer metadata supplied via setJsonObj(), producing the doc model that every
 * emitter consumes. Returns null when an entry file does not exist.
 */
export function buildModel(fileNames: string[], options: ts.CompilerOptions): DocModel | null {
  const vueGeneratedFiles: string[] = [];
  const tsOptions: ts.CompilerOptions = getTsOptions(options);
  if (!checkFiles(fileNames, "File for compiling is not found")) return null;
  generateVueTSFiles(vueGeneratedFiles, fileNames);
  try {
    const host = ts.createCompilerHost(tsOptions);
    // Build a program using the set of root file names in fileNames
    const program = ts.createProgram(fileNames, tsOptions, host);
    const ctx: GenerationContext = {
      // Get the checker, we will use it to find more about classes
      checker: program.getTypeChecker(),
      outputClasses: <DocEntry[]>[],
      outputPMEs: <DocEntry[]>[],
      pmesHash: {},
      classesHash: {},
      curClass: null,
      curJsonName: null,
      generateJSONDefinitionClasses: {},
      outputDefinition: {},
      vueGeneratedFiles: vueGeneratedFiles
    };
    // Visit every sourceFile in the program
    const sourceFiles: string[] = [];
    for (const sourceFile of program.getSourceFiles()) {
      if (sourceFile.fileName.indexOf("node_modules") > 0) continue;
      if (isNonEnglishLocalizationFile(sourceFile.fileName)) continue;
      sourceFiles.push(sourceFile.fileName);
      // Walk the tree to search for classes
      ts.forEachChild(sourceFile, (node: ts.Node) => visit(ctx, node));
    }
    for (let i = 0; i < fileNames.length; i++) {
      const sourceFile = program.getSourceFile(fileNames[i]);
      if (!!sourceFile) {
        ts.forEachChild(sourceFile, (node: ts.Node) => visit(ctx, node));
      }
    }
    for (const key in ctx.classesHash) {
      setAllParentTypes(ctx, key);
    }
    updateEventsDocumentation(ctx);
    updateHiddenForEntriesDoc(ctx);
    return {
      classes: ctx.outputClasses, pmes: ctx.outputPMEs, context: ctx, sourceFiles: sourceFiles
    };
  } finally {
    deleteVueTSFiles(vueGeneratedFiles);
  }
}

/** The raw doc model: `classes.json` + `pmes.json`. */
export function buildDocModelJSON(model: DocModel, outputDir: string): FileMap {
  const dir = resolveDir(outputDir);
  const files: FileMap = {};
  files[path.join(dir, "classes.json")] = JSON.stringify(model.classes, undefined, 4);
  files[path.join(dir, "pmes.json")] = JSON.stringify(model.pmes, undefined, 4);
  return files;
}

/**
 * `surveyjs_definition.json` derived from the AST doc model.
 *
 * Not the same document as the runtime `Serializer.generateSchema()` one that
 * shares its file name -- see json-definition.ts.
 */
export function buildJSONDefinitionAST(model: DocModel, outputDir: string): FileMap {
  const ctx = model.context;
  // Reset, so that emitting twice from one model yields the same document.
  ctx.generateJSONDefinitionClasses = {};
  ctx.outputDefinition = {};
  ctx.outputDefinition["$schema"] = "http://json-schema.org/draft-07/schema#";
  ctx.outputDefinition["title"] = "SurveyJS Library json schema";
  addClassIntoJSONDefinition(ctx, "SurveyModel", true);
  const files: FileMap = {};
  files[path.join(resolveDir(outputDir), "surveyjs_definition.json")] =
    JSON.stringify(ctx.outputDefinition, undefined, 4);
  return files;
}

/**
 * Generate documentation for all classes in a set of .ts files.
 *
 * Kept for consumers that still call the surveyjs-doc-generator API directly:
 * same file names, same defaults, same mutually exclusive Markdown-or-JSON
 * behaviour. New callers should use the `survey-utils generate-doc` CLI, or
 * buildModel() plus the emitters, which can produce both at once.
 *
 * `docOptions.outputDir` sets the directory for the generated files. It may be
 * absolute or relative to the working directory and is created when missing.
 * When it is not set, the files go to `<cwd>/docs` (Markdown to `<cwd>/docs/api`).
 */
export function generateDocumentation(
  fileNames: string[], options: ts.CompilerOptions, docOptions: DocOptions = {}
): DocModel | null {
  const model = buildModel(fileNames, options);
  if (!model) return null;
  const outputDir = resolveDir(docOptions.outputDir || path.join(process.cwd(), "docs"));
  let files: FileMap = {};
  if (docOptions.generateMDFiles === true) {
    // Generate Markdown documentation instead of the intermediate JSON files.
    const mdOptions: MDGenerationOptions = Object.assign({ fileNames: fileNames }, docOptions.mdOptions);
    if (!mdOptions.outputDir && !!docOptions.outputDir) mdOptions.outputDir = outputDir;
    files = buildMDFiles(model.classes, model.pmes, mdOptions);
  } else {
    files = buildDocModelJSON(model, outputDir);
  }
  if (docOptions.generateJSONDefinition === true) {
    Object.assign(files, buildJSONDefinitionAST(model, outputDir));
  }
  writeFiles(files);
  return model;
}

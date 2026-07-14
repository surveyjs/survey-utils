import * as path from "path";
import { installDom } from "../loc-lint/dom";

/**
 * The parts of the built survey-core bundle the emitters read. Every fact in the
 * generated artifacts comes from one of these -- see promts/01-schema-and-llm-guide.md.
 */
export interface SurveyBundle {
  Serializer: any;
  /** Question types. Absent in products that are not survey-core. */
  ElementFactory?: any;
  /** Expression functions. */
  FunctionFactory?: any;
  /**
   * Parses an expression. This is what settles which operator spellings are real and how they
   * are written; the candidate names are read from survey-core's source, because the class
   * that holds them is internal and is not worth making public for a docs generator.
   */
  ConditionsParser?: any;
  /** Round-trips the generated examples, proving the guide teaches loadable JSON. */
  SurveyModel?: any;
}

/**
 * Loads the built product bundle named by `--serializer` (e.g. ./build/survey.core)
 * and returns its `Serializer`.
 *
 * The bundle touches `window`/`document` while it initializes, so a DOM is
 * installed first -- the wrappers that used to require it got away without one
 * only by accident.
 */
export function loadSerializer(modulePath: string, base?: string): any {
  return loadBundle(modulePath, base).Serializer;
}

/**
 * The whole bundle, not just its Serializer.
 *
 * The LLM guide needs the factories and the expression machinery alongside the
 * metadata, and they have to come from the *same* module instance: a second
 * require() of the same bundle would re-run its registration side effects.
 */
export function loadBundle(modulePath: string, base?: string): SurveyBundle {
  installDom();
  const required = require(resolveModule(modulePath, base));
  const mod = required && !required.Serializer && required.default ? required.default : required;
  const serializer = mod && mod.Serializer;
  if (!serializer) {
    throw new Error(
      "Module '" + modulePath + "' does not export a Serializer. "
      + "Point --serializer at the built product bundle, e.g. ./build/survey.core"
    );
  }
  return mod;
}

/**
 * The file `modulePath` names, or undefined when there is none.
 *
 * The bundle is optional, and a default one is only used when it has been built -- so whether it
 * is there has to be answerable without require()ing it, which would run the whole bundle.
 * require.resolve does the extension search (./build/survey.core -> survey.core.js) that a plain
 * existsSync would miss.
 */
export function findBundle(modulePath: string, base?: string): string | undefined {
  try {
    return require.resolve(resolveModule(modulePath, base));
  } catch (error) {
    return undefined;
  }
}

/**
 * Paths resolve against `base` -- the repo root `--path` named, or the working
 * directory; bare names resolve as node modules of it.
 */
function resolveModule(modulePath: string, base?: string): string {
  const from = base || process.cwd();
  if (path.isAbsolute(modulePath)) return modulePath;
  if (modulePath.indexOf("./") === 0 || modulePath.indexOf("../") === 0
    || modulePath.indexOf(".\\") === 0 || modulePath.indexOf("..\\") === 0) {
    return path.resolve(from, modulePath);
  }
  return require.resolve(modulePath, { paths: [from] });
}

/**
 * The JSON Schema of the survey JSON, as the library actually serializes it.
 *
 * This is `--json-definition` (runtime). It reproduces survey-core's
 * `docs/generate_definition.js` byte for byte, including its 2-space indent.
 */
export function buildJSONDefinitionRuntime(serializer: any): string {
  if (typeof serializer.generateSchema !== "function") {
    throw new Error("The Serializer of this product has no generateSchema(): --json-definition needs survey-core.");
  }
  return JSON.stringify(serializer.generateSchema(), null, 2);
}

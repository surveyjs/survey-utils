import * as path from "path";
import { installDom } from "../loc-lint/dom";

/**
 * Loads the built product bundle named by `--serializer` (e.g. ./build/survey.core)
 * and returns its `Serializer`.
 *
 * The bundle touches `window`/`document` while it initializes, so a DOM is
 * installed first -- the wrappers that used to require it got away without one
 * only by accident.
 */
export function loadSerializer(modulePath: string): any {
  installDom();
  const mod = require(resolveModule(modulePath));
  const serializer = mod && (mod.Serializer || (mod.default && mod.default.Serializer));
  if (!serializer) {
    throw new Error(
      "Module '" + modulePath + "' does not export a Serializer. "
      + "Point --serializer at the built product bundle, e.g. ./build/survey.core"
    );
  }
  return serializer;
}

/** Paths resolve against the working directory; bare names resolve as node modules of it. */
function resolveModule(modulePath: string): string {
  if (path.isAbsolute(modulePath)) return modulePath;
  if (modulePath.indexOf("./") === 0 || modulePath.indexOf("../") === 0
    || modulePath.indexOf(".\\") === 0 || modulePath.indexOf("..\\") === 0) {
    return path.resolve(process.cwd(), modulePath);
  }
  return require.resolve(modulePath, { paths: [process.cwd()] });
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

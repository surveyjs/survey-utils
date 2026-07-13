import * as fs from "fs";
import * as path from "path";
import { surveyUtilsRoot } from "../paths";

/** The repo roots and `--path` resolution are shared with the other commands. */
export { productRoot, ProductRootError, siblingRepo, siblingsRoot, surveyUtilsRoot } from "../paths";

export function allowlistPath(product: string): string {
  return path.join(surveyUtilsRoot, "allowlists", `${product}.json`);
}

export function readAllowlist(product: string): Record<string, string> {
  const file = allowlistPath(product);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Requires a product's built bundle, failing with an actionable message rather
 * than a MODULE_NOT_FOUND. Registries are read from the build, so the product
 * must be built before its strings can be checked.
 */
export function requireBundle(bundlePath: string, buildHint: string): any {
  if (!fs.existsSync(bundlePath)) {
    throw new Error(
      `Bundle not found: ${bundlePath}\n` +
      `loc-lint reads the question types, serializer properties and themes from the\n` +
      `built bundle. Build it first:\n  ${buildHint}`
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(bundlePath);
}

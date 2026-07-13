import * as fs from "fs";
import * as path from "path";

/** Repo root, whether this file runs from `src/loc-lint` (ts-jest) or `dist/loc-lint` (node). */
export const surveyUtilsRoot = path.resolve(__dirname, "..", "..");

/** The folder that holds survey-utils and its sibling product repos. */
export const siblingsRoot = path.resolve(surveyUtilsRoot, "..");

/** Absolute path inside a sibling repo, e.g. `siblingRepo("survey-creator", "packages")`. */
export function siblingRepo(repo: string, ...segments: Array<string>): string {
  return path.join(siblingsRoot, repo, ...segments);
}

/**
 * Root of a product repo checkout: the explicit `--repo` value (resolved
 * against the working directory), or the repo checked out next to survey-utils.
 */
export function productRoot(repo: string, repoRoot?: string): string {
  return repoRoot ? path.resolve(repoRoot) : path.join(siblingsRoot, repo);
}

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

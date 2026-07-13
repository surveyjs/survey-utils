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

/** A checkout the caller pointed at is not there. The message is the whole report. */
export class ProductRootError extends Error { }

/**
 * Root of a product's repo: the folder `--path <dir>` names, resolved against the
 * working directory, or the sibling checkout when the caller named none. Fails
 * here rather than on the first missing file inside it.
 */
export function productRoot(repo: string, root?: string): string {
  const dir = !root
    ? siblingRepo(repo)
    : (path.isAbsolute(root) ? root : path.resolve(process.cwd(), root));
  if (!fs.existsSync(dir)) {
    throw new ProductRootError(
      `${repo} not found: ${dir}\n` +
      (!!root
        ? "--path must name the root of the checkout, the folder that holds its package.json."
        : `Check ${repo} out next to survey-utils, or name it with --path <dir>.`)
    );
  }
  return dir;
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

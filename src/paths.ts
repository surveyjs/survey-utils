import * as fs from "fs";
import * as path from "path";

/**
 * Where every command finds the repo it works on.
 *
 * `--path <dir>` means the same thing in all of them: the **root of the product's
 * repo** -- the folder that holds its package.json, not a folder inside it. Each
 * command joins its own subfolders onto that root (the localization folder, the
 * locale file and source roots, the entry files), so the option reads the same way
 * everywhere:
 *
 *   survey-utils check-strings library --path ../../LibV3/survey-library
 *   survey-utils translate     library --path ../../LibV3/survey-library
 *   survey-utils generate-doc  packages/survey-core/entries/chunks/model.ts --md --path ../../LibV3/survey-library
 *
 * Without it, the repo is looked up next to survey-utils -- the layout of a local
 * SurveyJS checkout, where survey-utils sits beside survey-library, survey-creator
 * and survey-analytics.
 */

/** survey-utils' own root, whether this file runs from `src/` (ts-jest) or `dist/` (node). */
export const surveyUtilsRoot = path.resolve(__dirname, "..");

/** The folder that holds survey-utils and its sibling product repos. */
export const siblingsRoot = path.resolve(surveyUtilsRoot, "..");

/** Absolute path inside a sibling repo, e.g. `siblingRepo("survey-creator", "packages")`. */
export function siblingRepo(repo: string, ...segments: Array<string>): string {
  return path.join(siblingsRoot, repo, ...segments);
}

/** A path the caller typed, resolved against the working directory. */
export function resolvePath(target: string): string {
  return path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
}

/**
 * A path the caller named is not on disk. The message is the whole report: the caller
 * typed a folder or a file that is not there, so there is nothing to print but where we
 * looked -- no stack, and no usage text the mistake has nothing to do with.
 */
export class PathError extends Error { }

/** A directory the caller pointed `--path` at is not there. */
export class ProductRootError extends PathError { }

/** An entry file the caller named is not there, once resolved against the repo root. */
export class EntryFileError extends PathError { }

/**
 * The repo root a command works against: `--path <dir>` when the caller named one,
 * the sibling checkout otherwise. Fails here rather than on the first missing file
 * inside it, so the report names the folder that is wrong.
 */
export function productRoot(repo: string, root?: string): string {
  const dir = !root ? siblingRepo(repo) : resolvePath(root);
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

/** A `--path` that names no product's repo: generate-doc's root is any directory. */
export function requireDir(dir: string): string {
  const resolved = resolvePath(dir);
  if (!fs.existsSync(resolved)) {
    throw new ProductRootError(
      `--path not found: ${resolved}\n` +
      "--path must name the root of the checkout, the folder that holds its package.json."
    );
  }
  return resolved;
}

/**
 * An entry file, resolved against the repo root `--path` named, or against the working
 * directory when it named none.
 *
 * Checked here rather than inside the TypeScript program, so a mistyped entry is reported
 * before the serializer bundle is loaded -- otherwise a run that gets both wrong blames the
 * bundle. The root and the entry are printed apart from each other because either one can be
 * the mistake, and the joined path alone does not say which.
 */
export function requireEntryFile(entry: string, root?: string): string {
  const resolved = !root ? resolvePath(entry) : path.resolve(root, entry);
  if (fs.existsSync(resolved)) return resolved;
  throw new EntryFileError(
    `Entry file not found: ${resolved}\n` +
    (!!root
      ? `  --path: ${root}\n  entry:  ${entry}\n` +
        "An entry is resolved against --path, so name it relative to the repo root."
      : `  entry: ${entry}\n` +
        `Without --path an entry is resolved against the working directory (${process.cwd()}).\n` +
        "Name it relative to that, or point --path at the repo root it belongs to.")
  );
}

import * as fs from "fs";
import * as path from "path";
import { PathError, productRoot, resolvePath, surveyUtilsRoot } from "./paths";

/**
 * The relative paths the site-generating commands default to, read from `paths.json` at the
 * root of this repo.
 *
 * A caller names two roots and nothing else -- `--path` the product checkout, `--out` the
 * content checkout -- so everything between them is a layout fact, not a decision: where the
 * default theme sits inside survey-library, which topic holds the token tables inside
 * surveyjs-site-data, which subfolders the generated docs land in. Those facts live in one
 * file here, which is what lets a CI/CD script stay `--path X --out Y` across a layout change
 * upstream: the file moves, this repo's next release follows it, and the pipeline is untouched.
 */

/** Paths relative to `--path`, the product repo root. */
export interface ProductPaths {
  /** The module that declares the default token values: survey-core's base-theme.ts. */
  theme: string;
}

/** The content repo, and the paths relative to `--out` -- its root. */
export interface SitePaths {
  /** The checkout --out defaults to, looked up next to survey-utils: surveyjs-site-data. */
  repo: string;
  /**
   * Where each product's `-site` preset writes, relative to `--out`: one folder per product,
   * keyed by the product name the preset is named after. The names belong to the site rather
   * than to the products -- survey-creator is published as DocsEditor -- which is exactly why
   * a caller should not have to know them.
   */
  docs: { [product: string]: string };
  /** The Markdown topics whose token tables are filled from the theme. At least one. */
  tokenTopics: string[];
  /** Subfolder of `--out` the Markdown API reference is written to. */
  apiReference: string;
  /** Subfolder of `--out` survey-json-authoring.md is written to. */
  llmGuide: string;
}

export interface Paths {
  product: ProductPaths;
  site: SitePaths;
}

/** Where the defaults are declared, so a bad one can be reported by name rather than by value. */
export const PATHS_FILE = path.join(surveyUtilsRoot, "paths.json");

let cached: Paths | undefined = undefined;

function fail(what: string): never {
  throw new PathError(
    `${PATHS_FILE}: ${what}\n`
    + "It holds the relative paths the commands default to -- the theme inside the product repo, "
    + "the topics and doc folders inside the content repo. A survey-utils install without a "
    + "readable one is incomplete: reinstall the package."
  );
}

function requireString(value: any, key: string): string {
  if (typeof value !== "string" || !value) fail(`'${key}' must be a non-empty string`);
  return value;
}

function requireMap(value: any, key: string): { [name: string]: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`'${key}' must be an object`);
  const res: { [name: string]: string } = {};
  Object.keys(value).forEach((name) => {
    res[name] = requireString(value[name], `${key}.${name}`);
  });
  if (Object.keys(res).length === 0) fail(`'${key}' must name at least one product`);
  return res;
}

function requireStrings(value: any, key: string): string[] {
  if (!Array.isArray(value) || value.length === 0) fail(`'${key}' must be a non-empty array`);
  return value.map((entry, i) => requireString(entry, `${key}[${i}]`));
}

/**
 * The defaults, parsed and checked once. Checked rather than trusted because a missing key here
 * would otherwise surface as `undefined` joined onto a root -- a path nobody typed, blamed on
 * the caller who typed neither half of it.
 */
export function paths(): Paths {
  if (!!cached) return cached;
  let json: any;
  try {
    json = JSON.parse(fs.readFileSync(PATHS_FILE, "utf8"));
  } catch (error) {
    fail(error instanceof SyntaxError ? "not valid JSON -- " + error.message : "not readable");
  }
  const product = json.product || {};
  const site = json.site || {};
  cached = {
    product: { theme: requireString(product.theme, "product.theme") },
    site: {
      repo: requireString(site.repo, "site.repo"),
      docs: requireMap(site.docs, "site.docs"),
      tokenTopics: requireStrings(site.tokenTopics, "site.tokenTopics"),
      apiReference: requireString(site.apiReference, "site.apiReference"),
      llmGuide: requireString(site.llmGuide, "site.llmGuide")
    }
  };
  return cached;
}

/** The default theme, relative to the survey-library repo root. */
export function themePath(): string {
  return paths().product.theme;
}

/**
 * The root the site artifacts are written into.
 *
 * `--out` is resolved exactly the way `--path` is -- against the working directory, with the
 * checkout next to survey-utils as the fallback -- because it means the same kind of thing: a
 * repo root the caller has in hand. The two options being one rule is what makes `--out .` from
 * inside surveyjs-site-data, `--out ../surveyjs-site-data` from a sibling, and the absolute path
 * a pipeline passes all read the same way.
 */
export function siteRoot(out?: string): string {
  return !!out ? resolvePath(out) : productRoot(paths().site.repo);
}

/**
 * The folder a product's site artifacts go in, relative to the content repo root: DocsLibrary
 * for the Form Library, DocsEditor for Survey Creator.
 *
 * A pipeline used to spell this out -- `--out .../surveyjs-site-data/DocsLibrary` -- which put
 * the site's own naming into every script that publishes to it, and made `--out` mean the repo
 * in one command and a folder inside it in another. It is derived from the preset now, so both
 * commands take the same root and the mapping lives here.
 */
export function siteDocsDir(product: string): string {
  const docs = paths().site.docs;
  const dir = docs[product];
  if (!!dir) return dir;
  throw new PathError(
    `No site folder for '${product}': 'site.docs' in ${PATHS_FILE} names `
    + Object.keys(docs).join(", ") + ".\n"
    + "A product with a -site preset needs a folder there for its artifacts to be published to."
  );
}

/** The token-table topics, relative to the content repo root. */
export function tokenTopicPaths(): string[] {
  return paths().site.tokenTopics;
}

/** Where the Markdown API reference goes, relative to the output root. */
export function apiReferenceDir(): string {
  return paths().site.apiReference;
}

/** Where survey-json-authoring.md goes, relative to the output root. */
export function llmGuideDir(): string {
  return paths().site.llmGuide;
}

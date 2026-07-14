import * as fs from "fs";
import * as path from "path";
import { EntryFileError, productRoot, requireDir } from "./paths";

/**
 * What `generate-doc <product>` has to know about a product, so that the caller does not.
 *
 * The entry files are a fact of each repo's layout, not a decision the caller makes: survey-core
 * is documented from `entries/chunks/model.ts`, survey-pdf from two entries at once. Naming the
 * product is therefore enough -- the same way `check-strings` and `translate` take a product and
 * find the folders themselves.
 */

/**
 * One place a product can be documented from, identified by the `name` in the package.json that
 * sits at its root.
 *
 * The name is what makes the root *this* product's rather than merely a folder shaped like it:
 * `src/index.ts` is survey-analytics' entry and also survey-utils' own file, so a layout that
 * matched on the entry alone would happily document the wrong repo -- it did, until this check.
 */
interface DocLayout {
  /** The `name` field of the package.json at the root the entries are relative to. */
  pkg: string;
  /** The entries, relative to that root. Several when a product documents them together. */
  entries: string[];
  /**
   * Where the docs go without --out, relative to that root. The folder is the same one either
   * way -- the package's own `docs` -- so a repo-root layout has to name the package to reach
   * it, and a package-root layout is already there. Default: DEFAULT_DOCS.
   */
  docs?: string;
  /**
   * The built bundle --serializer names when the caller does not, relative to that root. Only
   * survey-core has one: the schema and the guide are generated from its Serializer, and
   * survey-creator has none of its own -- which is why this is a layout's to declare, not a
   * default every product would silently inherit.
   */
  bundle?: string;
}

export interface DocProduct {
  /** The repo the product lives in, looked up next to survey-utils when there is no `--path`. */
  repo: string;
  /** The name the Markdown front matter and the documentation URLs use. */
  docProduct: string;
  /**
   * Where the product can be documented from, repo root first and the package inside it second:
   * a caller has one or the other in hand -- `--path ../survey-library`, or a script running in
   * `packages/survey-core` with no `--path` at all -- and both should work.
   */
  layouts: DocLayout[];
}

/** Where a layout that names no folder of its own writes: the docs of the root it ran from. */
export const DEFAULT_DOCS = "docs";

export const docProducts: { [key: string]: DocProduct } = {
  library: {
    repo: "survey-library",
    docProduct: "Form Library",
    layouts: [
      {
        pkg: "survey-library",
        entries: ["packages/survey-core/entries/chunks/model.ts"],
        docs: "packages/survey-core/docs",
        bundle: "./packages/survey-core/build/survey.core"
      },
      {
        pkg: "survey-core",
        entries: ["entries/chunks/model.ts"],
        bundle: "./build/survey.core"
      }
    ]
  },
  creator: {
    repo: "survey-creator",
    docProduct: "Survey Creator",
    layouts: [
      {
        pkg: "survey-creator",
        entries: ["packages/survey-creator-core/src/entries/index.ts"],
        docs: "packages/survey-creator-core/docs"
      },
      { pkg: "survey-creator-core", entries: ["src/entries/index.ts"] }
    ]
  },
  analytics: {
    repo: "survey-analytics",
    docProduct: "Dashboard",
    layouts: [{ pkg: "survey-analytics", entries: ["src/index.ts"] }]
  },
  pdf: {
    repo: "survey-pdf",
    docProduct: "PDF Generator",
    layouts: [{ pkg: "survey-pdf", entries: ["src/entries/pdf.ts", "src/entries/forms.ts"] }]
  }
};

export const docProductNames = Object.keys(docProducts);

/** The schema and the LLM guide are survey-core's, whatever else a run documents. */
export const SERIALIZER_PRODUCT = "library";

/** The `name` of the package rooted at `dir`, or undefined when there is no readable one. */
export function packageName(dir: string): string | undefined {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return typeof json.name === "string" ? json.name : undefined;
  } catch (error) {
    return undefined;
  }
}

/** The product's layout at `root`: the package.json there is its, and every entry is on disk. */
function layoutAt(product: DocProduct, root: string): DocLayout | undefined {
  const name = packageName(root);
  if (!name) return undefined;
  return product.layouts.find((layout) =>
    layout.pkg === name
    && layout.entries.every((entry) => fs.existsSync(path.resolve(root, entry)))
  );
}

/**
 * The root a product's docs are generated from: `--path` when the caller named one; otherwise the
 * working directory when that is the product's own package -- a script running in it names
 * nothing -- and the sibling checkout otherwise, which is how check-strings and translate find a
 * product they were not told the way to.
 */
export function docRoot(key: string, root?: string): string {
  if (!!root) return requireDir(root);
  const product = docProducts[key];
  if (!!layoutAt(product, process.cwd())) return process.cwd();
  return productRoot(product.repo);
}

/**
 * The entry files of a product under its root, absolute. Fails naming the package it found there
 * against the ones it wanted, because a root that holds the wrong package is the whole mistake.
 */
export function docEntries(key: string, root: string): string[] {
  const product = docProducts[key];
  const layout = layoutAt(product, root);
  if (!!layout) return layout.entries.map((entry) => path.resolve(root, entry));

  const found = packageName(root);
  throw new EntryFileError(
    `${key}: ${root} is not where it is documented from.\n`
    + `  package.json there: ${found || "none"}\n`
    + "  expected:\n"
    + product.layouts
      .map((l) => `    ${l.pkg} -- ${l.entries.join(", ")}`)
      .join("\n")
    + `\n--path must name the root of ${product.repo}, or the package inside it that holds the entry.`
  );
}

/**
 * Where the run writes without --out, relative to `root`: the docs folder of the package the
 * product is documented from -- packages/survey-core/docs, packages/survey-creator-core/docs --
 * named from wherever the run started, so both roots land in the same folder. A root no layout
 * claims (--entry documenting a fork) has none to take, and writes ./docs as before.
 */
export function docOut(key: string, root: string): string {
  const layout = layoutAt(docProducts[key], root);
  return !!layout && !!layout.docs ? layout.docs : DEFAULT_DOCS;
}

/**
 * The built bundle the run reads its Serializer from without --serializer, relative to `root`:
 * survey-core's, the one product that has one. Undefined for the rest -- survey-creator generates
 * its docs without a bundle at all, so there is nothing to point at and nothing to demand.
 */
export function docBundle(key: string, root: string): string | undefined {
  const layout = layoutAt(docProducts[key], root);
  return !!layout ? layout.bundle : undefined;
}

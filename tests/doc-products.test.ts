import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  docEntries, docOut, docProductNames, docProducts, docRoot, packageName
} from "../src/doc-products";
import { EntryFileError, ProductRootError, surveyUtilsRoot } from "../src/paths";

/** A root that looks like `pkg`: a package.json with that name, and the files under it. */
function fakeRoot(pkg: string, files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-products-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: pkg }));
  files.forEach((file) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "export const x = 1;\n");
  });
  roots.push(root);
  return root;
}

const roots: string[] = [];
afterAll(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

test("the products are the ones the other commands know, plus pdf", () => {
  expect(docProductNames).toEqual(["library", "creator", "analytics", "pdf"]);
});

test("packageName reads the name of the package rooted at a directory", () => {
  expect(packageName(surveyUtilsRoot)).toEqual("survey-utils");
  expect(packageName(path.join(surveyUtilsRoot, "src"))).toBeUndefined();
});

test("a product is documented from its repo root", () => {
  const root = fakeRoot("survey-library", ["packages/survey-core/entries/chunks/model.ts"]);
  expect(docEntries("library", root))
    .toEqual([path.resolve(root, "packages/survey-core/entries/chunks/model.ts")]);
});

test("a product is documented from the package inside the repo, which is where its script runs", () => {
  const root = fakeRoot("survey-core", ["entries/chunks/model.ts"]);
  expect(docEntries("library", root)).toEqual([path.resolve(root, "entries/chunks/model.ts")]);
});

test("one product can name several entries: survey-pdf documents pdf.ts and forms.ts together", () => {
  const root = fakeRoot("survey-pdf", ["src/entries/pdf.ts", "src/entries/forms.ts"]);
  expect(docEntries("pdf", root)).toEqual([
    path.resolve(root, "src/entries/pdf.ts"),
    path.resolve(root, "src/entries/forms.ts")
  ]);
});

test("a root is the product's only when its package.json says so, not when a file lines up", () => {
  // survey-utils has a src/index.ts of its own, which is analytics' entry path exactly. Matching
  // on the entry alone documented survey-utils under the analytics name; the package name is what
  // tells the two apart.
  const impostor = fakeRoot("survey-utils", ["src/index.ts"]);
  expect(() => docEntries("analytics", impostor)).toThrow(EntryFileError);
  expect(() => docEntries("analytics", impostor)).toThrow(/package\.json there: survey-utils/);

  const real = fakeRoot("survey-analytics", ["src/index.ts"]);
  expect(docEntries("analytics", real)).toEqual([path.resolve(real, "src/index.ts")]);
});

test("a root that holds the right package but not the entry is reported, not guessed past", () => {
  const empty = fakeRoot("survey-creator-core", []);
  expect(() => docEntries("creator", empty)).toThrow(EntryFileError);
});

test("docRoot takes --path as the root, and rejects one that is not there", () => {
  const root = fakeRoot("survey-analytics", ["src/index.ts"]);
  expect(docRoot("analytics", root)).toEqual(root);
  expect(() => docRoot("analytics", path.join(root, "nope"))).toThrow(ProductRootError);
});

test("without --out a product writes the docs of the package it is documented from", () => {
  // The same folder from either root: packages/survey-core/docs named from the repo, ./docs named
  // from inside the package -- so the script in survey-core and a run at the repo root agree.
  expect(docOut("library", fakeRoot("survey-library", ["packages/survey-core/entries/chunks/model.ts"])))
    .toEqual("packages/survey-core/docs");
  expect(docOut("library", fakeRoot("survey-core", ["entries/chunks/model.ts"]))).toEqual("docs");

  expect(docOut("creator", fakeRoot("survey-creator", ["packages/survey-creator-core/src/entries/index.ts"])))
    .toEqual("packages/survey-creator-core/docs");
  expect(docOut("creator", fakeRoot("survey-creator-core", ["src/entries/index.ts"]))).toEqual("docs");
});

test("a product whose repo is the package writes ./docs, and so does a root no layout claims", () => {
  expect(docOut("analytics", fakeRoot("survey-analytics", ["src/index.ts"]))).toEqual("docs");
  expect(docOut("pdf", fakeRoot("survey-pdf", ["src/entries/pdf.ts", "src/entries/forms.ts"])))
    .toEqual("docs");
  // --entry documenting a fork: no layout matches, so there is no docs folder to take from one.
  expect(docOut("library", fakeRoot("survey-fork", ["src/index.ts"]))).toEqual("docs");
});

test("every product carries the front-matter name the Markdown emitter writes", () => {
  expect(docProducts.library.docProduct).toEqual("Form Library");
  expect(docProducts.creator.docProduct).toEqual("Survey Creator");
  expect(docProducts.analytics.docProduct).toEqual("Dashboard");
  expect(docProducts.pdf.docProduct).toEqual("PDF Generator");
});

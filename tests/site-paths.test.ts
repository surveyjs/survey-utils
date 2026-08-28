import * as fs from "fs";
import * as path from "path";
import {
  apiReferenceDir, llmGuideDir, paths, PATHS_FILE, siteDocsDir, siteRoot, themePath, tokenTopicPaths
} from "../src/site-paths";
import { topicFiles } from "../src/token-tables";
import { docProductNames } from "../src/doc-products";
import { PathError, siblingRepo, surveyUtilsRoot } from "../src/paths";

test("paths.json ships at the root of the package, where an install can find it", () => {
  expect(PATHS_FILE).toEqual(path.join(surveyUtilsRoot, "paths.json"));
  expect(fs.existsSync(PATHS_FILE)).toBe(true);
});

test("every default a command reads is declared, and none of them is absolute", () => {
  const declared = [
    themePath(), apiReferenceDir(), llmGuideDir(),
    ...tokenTopicPaths(), ...docProductNames.map(siteDocsDir)
  ];
  declared.forEach((target) => {
    expect(target).toBeTruthy();
    // The whole point of the file is that each entry is a path *inside* a root the caller names:
    // an absolute one here would silently ignore --path or --out.
    expect(path.isAbsolute(target)).toBe(false);
  });
});

test("the theme is survey-core's base-theme.ts, the one file the tokens are declared in", () => {
  expect(themePath().split(path.sep).join("/"))
    .toEqual("packages/survey-core/src/default-theme/base-theme.ts");
});

test("the defaults are parsed once and handed back as the same object", () => {
  expect(paths()).toBe(paths());
});

test("every product with a -site preset has a folder to publish to", () => {
  docProductNames.forEach((product) => expect(siteDocsDir(product)).toBeTruthy());
});

test("the site folders are the site's names, which is why a caller should not have to know them", () => {
  expect(siteDocsDir("library")).toEqual("DocsLibrary");
  expect(siteDocsDir("creator")).toEqual("DocsEditor");
  expect(siteDocsDir("analytics")).toEqual("DocsAnalytics");
  expect(siteDocsDir("pdf")).toEqual("DocsPdf");
});

test("a product with no folder is reported against the ones that have one", () => {
  let error: any = undefined;
  try {
    siteDocsDir("nope");
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(PathError);
  expect(error.message).toContain("nope");
  // The products, not the folders: the caller named a product, so that is the list to choose from.
  expect(error.message).toContain("library");
  expect(error.message).toContain(PATHS_FILE);
});

test("--out is resolved the way --path is: against the working directory", () => {
  expect(siteRoot(".")).toEqual(process.cwd());
  expect(siteRoot("../surveyjs-site-data"))
    .toEqual(path.resolve(process.cwd(), "../surveyjs-site-data"));
});

test("an absolute --out is taken as it stands -- the form a CI pipeline passes", () => {
  const out = path.resolve("/agent/_work/surveyjs-site-data");
  expect(siteRoot(out)).toEqual(out);
});

test("without --out, the content root is the checkout next to survey-utils", () => {
  expect(siteRoot()).toEqual(siblingRepo(paths().site.repo));
});

test("the content repo is surveyjs-site-data, so a sibling layout needs neither root named", () => {
  expect(paths().site.repo).toEqual("surveyjs-site-data");
});

test("the doc subfolders are the ones the site serves from", () => {
  expect(apiReferenceDir()).toEqual("api-reference");
  expect(llmGuideDir()).toEqual("llms");
});

test("the topics sit beside the docs folders in the content repo, not inside one", () => {
  const out = path.resolve("/repos/surveyjs-site-data");
  const files = topicFiles(out);
  expect(files).toEqual(tokenTopicPaths().map((topic) => path.resolve(out, topic)));
  files.forEach((file) => {
    docProductNames.forEach((product) => {
      expect(file.split(path.sep)).not.toContain(siteDocsDir(product));
    });
  });
});

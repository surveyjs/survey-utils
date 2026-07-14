import * as path from "path";
import { EntryFileError, ProductRootError, requireDir, requireEntryFile, surveyUtilsRoot } from "../src/paths";

const entry = "tests/doc-gen/fixtures/smoke.entry.ts";

test("requireEntryFile resolves an entry against the root --path named", () => {
  expect(requireEntryFile(entry, surveyUtilsRoot)).toEqual(path.resolve(surveyUtilsRoot, entry));
});

test("requireEntryFile resolves an entry against the working directory without a root", () => {
  expect(requireEntryFile(entry)).toEqual(path.resolve(process.cwd(), entry));
});

test("requireEntryFile reports the root and the entry apart, so which one is wrong is visible", () => {
  let error: any = undefined;
  try {
    requireEntryFile("src/entries/index.ts", surveyUtilsRoot);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(EntryFileError);
  expect(error.message).toContain(path.resolve(surveyUtilsRoot, "src/entries/index.ts"));
  expect(error.message).toContain("--path: " + surveyUtilsRoot);
  expect(error.message).toContain("entry:  src/entries/index.ts");
});

test("requireEntryFile names the working directory when there is no --path to blame", () => {
  expect(() => requireEntryFile("no/such/entry.ts")).toThrow(EntryFileError);
  expect(() => requireEntryFile("no/such/entry.ts")).toThrow(/without --path/i);
});

test("requireDir rejects a --path that is not there", () => {
  expect(() => requireDir(path.join(surveyUtilsRoot, "no-such-repo"))).toThrow(ProductRootError);
});

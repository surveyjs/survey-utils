import { parseInjectDocsArgs, UsageError } from "../../src/cli";

describe("parseInjectDocsArgs", () => {
  test("topics, --out and --check", () => {
    expect(parseInjectDocsArgs(["Docs/a.md", "--out", "../site", "Docs/b.md", "--check"])).toEqual({
      topics: ["Docs/a.md", "Docs/b.md"], out: "../site", check: true
    });
  });

  test("nothing at all: the paths.json topics, the default --out, write mode", () => {
    expect(parseInjectDocsArgs([])).toEqual({ topics: [], check: false });
  });

  test("an unknown flag is a usage error, not a topic", () => {
    expect(() => parseInjectDocsArgs(["--dry-run"])).toThrow(UsageError);
    expect(() => parseInjectDocsArgs(["--dry-run"])).toThrow("Unknown option: --dry-run");
  });

  test.each([[["--out"]], [["--out", "--check"]]])("--out without a value is a usage error: %j", (args) => {
    expect(() => parseInjectDocsArgs(args)).toThrow(UsageError);
    expect(() => parseInjectDocsArgs(args)).toThrow("--out needs a value");
  });
});

describe("site.injectTopics in paths.json", () => {
  /** paths() as it would read a paths.json whose injectTopics is `value`. */
  function pathsWith(value: any): () => any {
    let paths: () => any = () => undefined;
    jest.isolateModules(() => {
      // The module itself, not an `import * as` namespace: that one's properties cannot be spied
      // on, and site-paths reads through to this object.
      const fs = require("fs");
      const sitePaths = require("../../src/site-paths");
      const real = fs.readFileSync(sitePaths.PATHS_FILE, "utf8");
      const json = JSON.parse(real);
      if (value === undefined) delete json.site.injectTopics;
      else json.site.injectTopics = value;
      const readFileSync = fs.readFileSync;
      jest.spyOn(fs, "readFileSync").mockImplementation(((file: any, ...rest: any[]) =>
        file === sitePaths.PATHS_FILE ? JSON.stringify(json) : (readFileSync as any)(file, ...rest)) as any);
      paths = sitePaths.paths;
    });
    return paths;
  }

  afterEach(() => jest.restoreAllMocks());

  test.each([
    ["missing", undefined],
    ["not an array", "Docs/backend-integration-php.md"],
    ["empty", []]
  ])("%s: reported against site.injectTopics", (_kind, value) => {
    expect(pathsWith(value)).toThrow("'site.injectTopics' must be a non-empty array");
  });

  test("an entry that is not a string is reported by its index", () => {
    expect(pathsWith(["Docs/a.md", 3])).toThrow("'site.injectTopics[1]' must be a non-empty string");
  });

  test("the shipped list is read as it stands", () => {
    expect(pathsWith(["Docs/a.md"])().site.injectTopics).toEqual(["Docs/a.md"]);
  });
});

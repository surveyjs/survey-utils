import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findSilentFailures, formatMessage, runInjectDocs } from "../../src/inject-docs";
import { loadInjectMarkdown } from "../../src/inject-docs/load";
import { PathError } from "../../src/paths";
import { injectTopicPaths } from "../../src/site-paths";

// ts-jest runs CommonJS and cannot load the ESM-only library, so the one module that imports it
// is replaced by a fake whose results are shaped the way inject-markdown 6.2.0's really are.
jest.mock("../../src/inject-docs/load", () => ({ loadInjectMarkdown: jest.fn() }));

interface FakeResult {
  content?: string;
  updated?: boolean;
  errors?: Array<{ message: string; line?: number; column?: number }>;
  warnings?: Array<{ message: string; line?: number; column?: number }>;
}

/** What the fake returns for each topic, keyed by the topic's file name. Default: unchanged. */
let results: { [name: string]: FakeResult } = {};
const injectMarkdown = jest.fn(async (document: { file: string; content: string }, _options: any) => {
  const result = results[path.basename(document.file)] || {};
  return {
    document: { file: document.file, content: result.content !== undefined ? result.content : document.content },
    updated: !!result.updated,
    errors: result.errors || [],
    warnings: result.warnings || []
  };
});
(loadInjectMarkdown as jest.Mock).mockResolvedValue({ injectMarkdown });

const DIRECTIVE = "<!--- @@inject: ../DocsShared/common.md#heading=Run Forms --->";
const END = "<!--- @@inject-end: ../DocsShared/common.md#heading=Run Forms --->";
const PERMALINK = "https://github.com/surveyjs/surveyjs-php/blob/2544e31/shared/client/save-response.js#L5-L23";

/** A topic whose one section holds `body`, the way inject-markdown writes it. */
function section(body: string, reference: string = "../DocsShared/common.md#heading=Run Forms"): string {
  return `# Topic\n\n<!--- @@inject: ${reference} --->\n\n${body}\n\n<!--- @@inject-end: ${reference} --->\n`;
}

const ORIGINAL = `# Topic\n\n${DIRECTIVE}\n`;
const REFRESHED = section("## Run Forms\n\nShared text.");

/** The silent failures and the read failure, as 6.2.0 reports (or does not report) them. */
const FAILURES: { [kind: string]: FakeResult } = {
  "read failure": {
    updated: true,
    content: section("<!---\n  Failed to read \"DocsShared/missing.md\"\n--->", "../DocsShared/missing.md"),
    warnings: [{ message: "Failed to read \"DocsShared/missing.md\"" }]
  },
  "missing heading": {
    updated: true,
    content: section("<!--- header: \"Run Formz\" not found.  --->", "../DocsShared/common.md#heading=Run Formz")
  },
  "404 permalink": {
    updated: true,
    content: section("```js\n404: Not Found\n```", PERMALINK.replace(/#.*/, ""))
  },
  "404 permalink with a line range": {
    updated: true,
    content: section("```js\n```", PERMALINK)
  }
};

let root: string;
let output: string[];

function write(topic: string, content: string = ORIGINAL): string {
  const file = path.join(root, topic);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function printed(): string {
  return output.join("\n");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "inject-docs-"));
  results = {};
  output = [];
  injectMarkdown.mockClear();
  const capture = (...args: any[]) => { output.push(args.join(" ")); };
  jest.spyOn(console, "log").mockImplementation(capture);
  jest.spyOn(console, "warn").mockImplementation(capture);
  jest.spyOn(console, "error").mockImplementation(capture);
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("topics", () => {
  test("a named topic is resolved against --out, not the working directory", async () => {
    const file = write("Docs/a.md");
    expect(await runInjectDocs({ topics: ["Docs/a.md"], out: root })).toBe(0);
    expect(injectMarkdown).toHaveBeenCalledTimes(1);
    expect(injectMarkdown.mock.calls[0][0].file).toEqual(file);
  });

  test("an absolute topic is taken as it stands", async () => {
    const file = write("Elsewhere/b.md");
    await runInjectDocs({ topics: [file], out: root });
    expect(injectMarkdown.mock.calls[0][0].file).toEqual(file);
  });

  test("with no topics named, paths.json's list is used", async () => {
    const files = injectTopicPaths().map((topic) => write(topic));
    expect(await runInjectDocs({ topics: [], out: root })).toBe(0);
    expect(injectMarkdown.mock.calls.map((call) => call[0].file)).toEqual(files);
  });

  test("a paths.json topic the checkout has not got is reported and skipped", async () => {
    expect(await runInjectDocs({ topics: [], out: root })).toBe(0);
    expect(injectMarkdown).not.toHaveBeenCalled();
    expect(printed()).toContain("warning: no topic at " + path.resolve(root, injectTopicPaths()[0]));
  });

  test("a named topic that is not there is the caller's mistake: a PathError naming it and --out", async () => {
    write("Docs/a.md");
    const run = runInjectDocs({ topics: ["Docs/a.md", "Docs/nope.md"], out: root });
    await expect(run).rejects.toBeInstanceOf(PathError);
    await expect(runInjectDocs({ topics: ["Docs/nope.md"], out: root }))
      .rejects.toThrow(path.resolve(root, "Docs/nope.md"));
    await expect(runInjectDocs({ topics: ["Docs/nope.md"], out: root })).rejects.toThrow("--out: " + root);
    // Checked before anything is processed.
    expect(injectMarkdown).not.toHaveBeenCalled();
  });

  test("an --out that is not there fails rather than skipping every topic", async () => {
    await expect(runInjectDocs({ topics: [], out: path.join(root, "nope") })).rejects.toBeInstanceOf(PathError);
  });
});

describe("the library call", () => {
  test.each([false, true])("absolute file, the repo root as cwd and strictVars (check: %s)", async (check) => {
    const file = write("Docs/a.md");
    await runInjectDocs({ topics: ["Docs/a.md"], out: root, check });
    const [document, options] = injectMarkdown.mock.calls[0];
    expect(path.isAbsolute(document.file)).toBe(true);
    expect(document).toEqual({ file, content: ORIGINAL });
    // The repo root, not Docs/: references go up and across to ../DocsShared.
    expect(options).toEqual({ cwd: root, strictVars: true });
  });
});

describe("write mode", () => {
  test("writes the updated topics, only those, and exits 0", async () => {
    const a = write("Docs/a.md");
    const b = write("Docs/b.md");
    results["a.md"] = { updated: true, content: REFRESHED };
    expect(await runInjectDocs({ topics: ["Docs/a.md", "Docs/b.md"], out: root })).toBe(0);
    expect(read(a)).toEqual(REFRESHED);
    expect(read(b)).toEqual(ORIGINAL);
    expect(printed()).toContain(`${a}: written`);
    expect(printed()).toContain(`${b}: unchanged`);
    expect(printed()).toContain("2 topic(s) processed, 1 written.");
  });

  test("all or nothing: one failed topic and no topic is written, the later ones still reported", async () => {
    const files = ["a.md", "b.md", "c.md"].map((name) => write("Docs/" + name));
    results["a.md"] = { updated: true, content: REFRESHED };
    results["b.md"] = FAILURES["missing heading"];
    results["c.md"] = {
      updated: true,
      content: REFRESHED,
      errors: [{ message: "Unresolved placeholder \"{@ who @}\": no value source defines it", line: 3, column: 1 }]
    };
    expect(await runInjectDocs({ topics: files, out: root })).toBe(1);
    files.forEach((file) => expect(read(file)).toEqual(ORIGINAL));
    expect(injectMarkdown).toHaveBeenCalledTimes(3);
    expect(printed()).toContain(`${files[1]}: ../DocsShared/common.md#heading=Run Formz: header "Run Formz" not found`);
    expect(printed()).toContain(`${files[2]}:3:1: Unresolved placeholder`);
    // The topic that succeeded is stale and says so, rather than claiming to have been written.
    expect(printed()).toContain(`${files[0]}: differs`);
    expect(printed()).toContain(`${files[1]}: 1 failure(s)`);
    expect(printed()).toContain("3 topic(s) processed, 2 failed -- nothing written.");
  });
});

describe("failures inject-markdown does not report as errors", () => {
  Object.keys(FAILURES).forEach((kind) => {
    test.each([false, true])(`a ${kind} fails the run and leaves every file as it was (check: %s)`, async (check) => {
      const good = write("Docs/good.md");
      const bad = write("Docs/bad.md");
      results["good.md"] = { updated: true, content: REFRESHED };
      results["bad.md"] = FAILURES[kind];
      expect(await runInjectDocs({ topics: [good, bad], out: root, check })).toBe(1);
      expect(read(good)).toEqual(ORIGINAL);
      expect(read(bad)).toEqual(ORIGINAL);
      expect(printed()).toContain(`${bad}: 1 failure(s)`);
      expect(printed()).toContain("1 failed -- nothing written.");
    });
  });

  test("a warning is printed as one, without coordinates it has not got", async () => {
    const file = write("Docs/a.md");
    results["a.md"] = FAILURES["read failure"];
    await runInjectDocs({ topics: [file], out: root });
    expect(printed()).toContain(`warning: ${file}: Failed to read "DocsShared/missing.md"`);
    expect(printed()).not.toContain("undefined");
  });
});

describe("findSilentFailures", () => {
  test("finds a missing heading and a 404 inside injected sections", () => {
    const content = section("<!--- header: \"Run Formz\" not found.  --->")
      + "\n" + section("```js\n404: Not Found\n```", PERMALINK)
      + "\n" + section("```php\n```", PERMALINK);
    expect(findSilentFailures(content)).toEqual([
      { reference: "../DocsShared/common.md#heading=Run Forms", found: "header \"Run Formz\" not found" },
      { reference: PERMALINK, found: "a code block holding \"404: Not Found\"" },
      { reference: PERMALINK, found: "an empty code block" }
    ]);
  });

  test("ignores the same text outside a section: it is the topic's own", () => {
    const content = [
      "# Troubleshooting",
      "",
      "<!--- header: \"Run Formz\" not found.  --->",
      "",
      "```",
      "404: Not Found",
      "```",
      "",
      "```js",
      "```",
      "",
      section("```js\nconst ok = true;\n```"),
      "<!--- header: \"After\" not found.  --->"
    ].join("\n");
    expect(findSilentFailures(content)).toEqual([]);
  });

  test("a directive quoted inside a code block does not open a section", () => {
    const content = "```md\n<!--- @@inject: ../x.md --->\n<!--- header: \"X\" not found.  --->\n```\n\n"
      + "<!--- header: \"Y\" not found.  --->\n\n```js\n```\n";
    expect(findSilentFailures(content)).toEqual([]);
  });

  test("reads CRLF topics the same way", () => {
    expect(findSilentFailures(section("```js\n404: Not Found\n```").replace(/\n/g, "\r\n"))).toHaveLength(1);
  });

  test("a healthy section holds nothing to report", () => {
    expect(findSilentFailures(REFRESHED)).toEqual([]);
  });
});

describe("formatMessage", () => {
  test("a diagnostic with coordinates prints as file:line:column: message", () => {
    expect(formatMessage("Docs/a.md", { message: "Unresolved placeholder", line: 3, column: 1 }))
      .toEqual("Docs/a.md:3:1: Unresolved placeholder");
  });

  test("one without them prints as file: message, never undefined", () => {
    const text = formatMessage("Docs/a.md", { message: "Failed to read \"x.md\"" });
    expect(text).toEqual("Docs/a.md: Failed to read \"x.md\"");
    expect(text).not.toContain("undefined");
  });

  test("a line without a column keeps the line", () => {
    expect(formatMessage("a.md", { message: "m", line: 7 })).toEqual("a.md:7: m");
  });
});

describe("--check", () => {
  test("never writes; exits 1 when a topic is stale and names it", async () => {
    const a = write("Docs/a.md");
    results["a.md"] = { updated: true, content: REFRESHED };
    expect(await runInjectDocs({ topics: [a], out: root, check: true })).toBe(1);
    expect(read(a)).toEqual(ORIGINAL);
    expect(printed()).toContain(`${a}: differs`);
    expect(printed()).toContain("1 topic(s) checked, 1 differ from their sources.");
  });

  test("exits 0 when every topic is up to date", async () => {
    const a = write("Docs/a.md");
    expect(await runInjectDocs({ topics: [a], out: root, check: true })).toBe(0);
    expect(printed()).toContain(`${a}: unchanged`);
  });

  test("exits 1 when a topic failed even though none is stale", async () => {
    const a = write("Docs/a.md");
    results["a.md"] = { updated: false, warnings: [{ message: "Failed to read \"DocsShared/x.md\"" }] };
    expect(await runInjectDocs({ topics: [a], out: root, check: true })).toBe(1);
  });
});

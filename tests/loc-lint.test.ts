import { test, expect } from "@jest/globals";
import { analyze, getEvidence } from "../src/loc-lint/analyze";
import { collectLocaleKeys } from "../src/loc-lint/inventory";
import { collectDynamicNamespaces, collectStringLiterals } from "../src/loc-lint/literals";
import { deadStrings, dynamicStrings, formatErrors, formatSummary } from "../src/loc-lint/run";
import { LocLintConfig, LocLintProduct } from "../src/loc-lint/types";

const emptyConfig: LocLintConfig = { resolvers: {}, allowlist: {} };

function fakeProduct(allowlist: Record<string, string>): LocLintProduct {
  return {
    name: "fake",
    referenceLocaleFile: "/repo/english.ts",
    referenceLocaleExport: "enStrings",
    sourceRoots: [],
    sourceExtensions: [".ts"],
    skipDirs: [],
    resolvers: {},
    allowlist: allowlist,
    allowlistFile: "/repo/allowlist.json",
  };
}

function fakeReader(files: Record<string, string>): (file: string) => string {
  return (file: string) => files[file];
}

test("collectLocaleKeys flattens nested objects into dotted paths", () => {
  const keys = collectLocaleKeys(`
export var enStrings = {
  ed: {
    save: "Save",
    lg: { noActionError: "Oops" }
  },
  qt: { text: "Single-Line Input" }
};
`, "enStrings");
  expect(keys.map((key) => key.path)).toEqual(["ed.save", "ed.lg.noActionError", "qt.text"]);
});

test("collectLocaleKeys reports 1-based line numbers", () => {
  const keys = collectLocaleKeys("export var s = {\n  a: \"1\",\n  b: \"2\"\n};", "s");
  expect(keys).toEqual([{ path: "a", line: 2 }, { path: "b", line: 3 }]);
});

test("collectLocaleKeys keeps quoted and hyphenated keys", () => {
  const keys = collectLocaleKeys("export var s = { \"--sjs-x\": \"1\", names: { \"default-dark\": \"Dark\" } };", "s");
  expect(keys.map((key) => key.path)).toEqual(["--sjs-x", "names.default-dark"]);
});

test("collectLocaleKeys picks the named export when several exist", () => {
  const source = "export var other = { a: \"1\" };\nexport var enStrings = { b: \"2\" };";
  expect(collectLocaleKeys(source, "enStrings").map((key) => key.path)).toEqual(["b"]);
});

test("collectLocaleKeys throws when the export is missing", () => {
  expect(() => collectLocaleKeys("export var s = { a: \"1\" };", "missing")).toThrow(/Cannot find/);
});

test("collectStringLiterals ignores literals inside comments", () => {
  const literals = collectStringLiterals(["a.ts"], fakeReader({
    "a.ts": "// getString(\"ed.dead\");\n/* \"ed.alsoDead\" */\ngetString(\"ed.alive\");",
  }));
  expect(literals.has("ed.alive")).toBe(true);
  expect(literals.has("ed.dead")).toBe(false);
  expect(literals.has("ed.alsoDead")).toBe(false);
});

test("collectStringLiterals reads template heads so dynamic prefixes survive", () => {
  const literals = collectStringLiterals(["a.ts"], fakeReader({ "a.ts": "getString(`ed.lg.${name}`);" }));
  expect(literals.has("ed.lg.")).toBe(true);
});

test("collectStringLiterals scans markup with a regex", () => {
  const literals = collectStringLiterals(["a.html"], fakeReader({
    "a.html": "<!-- \"ed.dead\" -->\n<div title=\"ed.alive\"></div>",
  }));
  expect(literals.has("ed.alive")).toBe(true);
  expect(literals.has("ed.dead")).toBe(false);
});

test("collectDynamicNamespaces finds prefixes built by concatenation", () => {
  const namespaces = collectDynamicNamespaces(new Set(["qt.", "ed.lg.", "ed.save", "not a key.", "."]));
  expect(Array.from(namespaces).sort()).toEqual(["ed", "qt"]);
});

test("getEvidence prefers a literal, then a resolver, then the allowlist", () => {
  const config: LocLintConfig = {
    resolvers: { qt: (_path, segments) => segments[1] === "text" },
    allowlist: { "ed.legacy": "dynamic" },
  };
  const literals = new Set(["ed.save"]);
  expect(getEvidence("ed.save", literals, config)).toBe("literal");
  expect(getEvidence("qt.text", literals, config)).toBe("resolver");
  expect(getEvidence("ed.legacy", literals, config)).toBe("allowlist");
  expect(getEvidence("ed.gone", literals, config)).toBe(null);
});

test("analyze reports only keys no provider vouches for", () => {
  const keys = [
    { path: "ed.save", line: 1 },
    { path: "qt.text", line: 2 },
    { path: "ed.legacy", line: 3 },
    { path: "ed.gone", line: 4 },
  ];
  const config: LocLintConfig = {
    resolvers: { qt: (_path, segments) => segments[1] === "text" },
    allowlist: { "ed.legacy": "dynamic" },
  };
  const result = analyze(keys, new Set(["ed.save"]), config);
  expect(result.unused).toEqual([{ path: "ed.gone", line: 4 }]);
  expect(result.obsoleteAllowlist).toEqual([]);
});

test("analyze flags an allowlist entry whose key was deleted", () => {
  const result = analyze([{ path: "ed.save", line: 1 }], new Set(["ed.save"]), {
    resolvers: {},
    allowlist: { "ed.deletedLongAgo": "baseline" },
  });
  expect(result.obsoleteAllowlist).toEqual(["ed.deletedLongAgo"]);
});

test("analyze flags an allowlist entry that became reachable again", () => {
  const result = analyze([{ path: "ed.save", line: 1 }], new Set(["ed.save"]), {
    resolvers: {},
    allowlist: { "ed.save": "baseline" },
  });
  expect(result.obsoleteAllowlist).toEqual(["ed.save"]);
});

test("analyze demands a resolver for every namespace built dynamically", () => {
  const keys = [{ path: "qt.text", line: 1 }, { path: "ed.save", line: 2 }];
  const literals = new Set(["qt.", "ed.", "ed.save"]);
  const withoutResolver = analyze(keys, literals, emptyConfig);
  expect(withoutResolver.unresolvedDynamicNamespaces).toEqual(["ed", "qt"]);

  const withResolver = analyze(keys, literals, { resolvers: { qt: () => true, ed: () => false }, allowlist: {} });
  expect(withResolver.unresolvedDynamicNamespaces).toEqual([]);
});

test("a catch-all resolver vouches for flat keys with no namespace resolver", () => {
  // survey-core keys are flat: the whole key is one segment.
  const config: LocLintConfig = {
    resolvers: { "*": (key) => key === "completeText" },
    allowlist: {},
  };
  expect(getEvidence("completeText", new Set(), config)).toBe("resolver");
  expect(getEvidence("savingExceedSize", new Set(), config)).toBe(null);
});

test("a namespace resolver takes precedence over the catch-all", () => {
  const config: LocLintConfig = {
    resolvers: {
      qt: (_key, segments) => segments[1] === "text",
      "*": () => true,
    },
    allowlist: {},
  };
  // qt.image: qt resolver runs (returns false) and the catch-all is NOT consulted.
  expect(getEvidence("qt.image", new Set(), config)).toBe(null);
  expect(getEvidence("qt.text", new Set(), config)).toBe("resolver");
  // A key whose namespace has no resolver falls through to the catch-all.
  expect(getEvidence("anything", new Set(), config)).toBe("resolver");
});

test("the dashboard resolver matches prefix families the way analytics builds keys", () => {
  // Mirrors products/dashboard.ts: visualizer/chart/download suffixes are source
  // literals; interval modes and top-N are closed enums.
  const INTERVAL_MODES = new Set(["auto", "decades", "years", "quarters", "months", "days"]);
  const TOP_N = new Set(["-1", "5", "10", "20"]);
  const resolver = (key: string, _s: Array<string>, ctx: { literals: Set<string> }): boolean => {
    if (key.startsWith("visualizer_")) return ctx.literals.has(key.slice("visualizer_".length));
    if (key.startsWith("chartType_")) return ctx.literals.has(key.slice("chartType_".length));
    if (key.endsWith("DownloadCaption")) return ctx.literals.has(key.slice(0, -"DownloadCaption".length));
    if (key.startsWith("intervalMode_")) return INTERVAL_MODES.has(key.slice("intervalMode_".length));
    if (key.startsWith("topNValueText")) return TOP_N.has(key.slice("topNValueText".length));
    return false;
  };
  const config: LocLintConfig = { resolvers: { "*": resolver }, allowlist: {} };
  // "matrix"/"scatter" are real types (appear as literals); "zzz" is not.
  const literals = new Set(["matrix", "scatter", "pdf"]);
  expect(getEvidence("visualizer_matrix", literals, config)).toBe("resolver");
  expect(getEvidence("chartType_scatter", literals, config)).toBe("resolver");
  expect(getEvidence("pdfDownloadCaption", literals, config)).toBe("resolver");
  expect(getEvidence("intervalMode_years", literals, config)).toBe("resolver");
  expect(getEvidence("topNValueText-1", literals, config)).toBe("resolver");
  // The genuinely dead keys: not literals, not in the enums.
  expect(getEvidence("chartType_zzz", literals, config)).toBe(null);
  expect(getEvidence("intervalMode_default", literals, config)).toBe(null);
  expect(getEvidence("intervalMode_custom", literals, config)).toBe(null);
  expect(getEvidence("groupButton", literals, config)).toBe(null);
});

test("analyze ignores dynamic prefixes that are not locale namespaces", () => {
  const result = analyze([{ path: "ed.save", line: 1 }], new Set(["ed.save", "survey-core."]), emptyConfig);
  expect(result.unresolvedDynamicNamespaces).toEqual([]);
});

test("resolvers receive the literal set so they can check a dynamic base", () => {
  const config: LocLintConfig = {
    // Mirrors `"pe.addNew@" + prop.name` in matrices.ts.
    resolvers: {
      pe: (_path, segments, context) => {
        const at = segments[1].indexOf("@");
        return at > -1 && context.literals.has("pe." + segments[1].slice(0, at));
      },
    },
    allowlist: {},
  };
  const literals = new Set(["pe.addNew"]);
  expect(getEvidence("pe.addNew@choices", literals, config)).toBe("resolver");
  expect(getEvidence("pe.removeAll@choices", literals, config)).toBe(null);
});

test("analyze returns allowlisted keys with their line numbers", () => {
  const keys = [{ path: "ed.save", line: 1 }, { path: "ed.legacy", line: 7 }];
  const result = analyze(keys, new Set(["ed.save"]), { resolvers: {}, allowlist: { "ed.legacy": "baseline: x" } });
  expect(result.allowlisted).toEqual([{ path: "ed.legacy", line: 7 }]);
  expect(result.unused).toEqual([]);
});

test("dead strings are the baseline entries, dynamic ones are excluded", () => {
  const product = fakeProduct({
    "ed.dead": "baseline: waiting to be deleted",
    "ed.alive": "dynamic: getString(\"ed.\" + state)",
  });
  const keys = [{ path: "ed.dead", line: 2 }, { path: "ed.alive", line: 3 }];
  const result = analyze(keys, new Set(), product);

  expect(deadStrings(product, result)).toEqual([{ path: "ed.dead", line: 2 }]);
  expect(dynamicStrings(product, result)).toEqual([{ path: "ed.alive", line: 3 }]);
});

test("a baselined dead string is reported but does not fail the build", () => {
  const product = fakeProduct({ "ed.dead": "baseline: waiting to be deleted" });
  const result = analyze([{ path: "ed.dead", line: 2 }], new Set(), product);

  expect(formatErrors(product, result)).toBe("");
  expect(formatSummary(product, result)).toContain("1 known dead");
  expect(formatSummary(product, result)).toContain("--list-dead");
});

test("the summary never claims everything is used while dead strings remain", () => {
  const product = fakeProduct({ "ed.dead": "baseline: x" });
  const result = analyze([{ path: "ed.dead", line: 2 }, { path: "ed.used", line: 3 }], new Set(["ed.used"]), product);
  expect(formatSummary(product, result)).toMatch(/0 new unused string\(s\), 1 known dead/);
});

test("a new unused string fails the build even when the baseline is clean", () => {
  const product = fakeProduct({});
  const result = analyze([{ path: "ed.brandNew", line: 9 }], new Set(), product);
  expect(formatErrors(product, result)).toContain("ed.brandNew  (english.ts:9)");
  expect(formatErrors(product, result)).toContain("1 NEW localization string(s)");
});

import { formatTokenValue, idPatterns, ThemeToken, updateTokenTables } from "../src/token-tables";

function tokens(pairs: Array<[string, string]>): ThemeToken[] {
  return pairs.map(([name, value]) => ({ name, value }));
}

function topic(...ids: string[]): string {
  return ids.map((id) => `### Section\n\n<div id="${id}">\n\n| Variable | Value |\n| -------- | ----- |\n| TODO | TODO |\n\n</div>\n`).join("\n");
}

test("a table lists every token whose name holds the id, in theme order", () => {
  const result = updateTokenTables(topic("-component-action-"), tokens([
    ["--sjs2-layout-component-action-small-box-gap", "var(--sjs2-spacing-x000)"],
    ["--sjs2-color-component-panel-default-bg", "var(--sjs2-color-bg-basic-primary)"],
    ["--sjs2-color-component-action-brand-primary-default-bg", "var(--sjs2-color-bg-brand-primary)"]
  ]));
  expect(result.tables[0].tokens.map((token) => token.name)).toEqual([
    "--sjs2-layout-component-action-small-box-gap",
    "--sjs2-color-component-action-brand-primary-default-bg"
  ]);
  expect(result.text).toContain(
    "| `--sjs2-layout-component-action-small-box-gap` | spacing-x000 |"
  );
  expect(result.text).not.toContain("TODO");
});

test("an id names several patterns, separated by |", () => {
  expect(idPatterns("-component-panel- | -component-panel-dynamic-"))
    .toEqual(["-component-panel-", "-component-panel-dynamic-"]);
  const result = updateTokenTables(topic("-component-checkbox- | -component-radio-"), tokens([
    ["--sjs2-color-component-checkbox-true-default-bg", "var(--sjs2-color-bg-brand-primary)"],
    ["--sjs2-color-component-radio-true-default-bg", "var(--sjs2-color-bg-brand-primary)"],
    ["--sjs2-color-component-slider-default-bg", "var(--sjs2-color-bg-basic-primary)"]
  ]));
  expect(result.tables[0].tokens).toHaveLength(2);
});

test("a token named for the component and nothing else lands in that component's table", () => {
  // --sjs2-radius-component-action ends where the id does: without the end-of-name match the
  // whole --sjs2-radius-component-* family would be documented nowhere.
  const result = updateTokenTables(topic("-component-action-"), tokens([
    ["--sjs2-radius-component-action", "var(--sjs2-radius-form)"]
  ]));
  expect(result.tables[0].tokens).toHaveLength(1);
  expect(result.unmatched).toHaveLength(0);
});

test("the trailing dash keeps a shorter id from swallowing a longer one's tokens", () => {
  const result = updateTokenTables(topic("-component-label-", "-component-labeled-item-"), tokens([
    ["--sjs2-color-component-label-default-fg", "var(--sjs2-color-fg-basic-primary)"],
    ["--sjs2-color-component-labeled-item-default-fg", "var(--sjs2-color-fg-basic-secondary)"]
  ]));
  expect(result.tables[0].tokens.map((token) => token.name))
    .toEqual(["--sjs2-color-component-label-default-fg"]);
  expect(result.tables[1].tokens.map((token) => token.name))
    .toEqual(["--sjs2-color-component-labeled-item-default-fg"]);
});

test("a component token no table claims is reported rather than dropped", () => {
  const result = updateTokenTables(topic("-component-action-"), tokens([
    ["--sjs2-radius-component-tooltip", "var(--sjs2-radius-x050)"],
    ["--sjs2-color-bg-basic-primary", "var(--sjs2-palette-gray-000)"]
  ]));
  // Only component tokens: a system token belongs to the hand-written sections above.
  expect(result.unmatched.map((token) => token.name)).toEqual(["--sjs2-radius-component-tooltip"]);
});

test("filling twice changes nothing the second time", () => {
  const theme = tokens([
    ["--sjs2-color-component-action-brand-primary-default-bg", "var(--sjs2-color-bg-brand-primary)"]
  ]);
  const once = updateTokenTables(topic("-component-action-"), theme).text;
  expect(updateTokenTables(once, theme).text).toEqual(once);
});

test("the placeholder survives the rewrite, so the next run finds it again", () => {
  const result = updateTokenTables(topic("-component-action-"), []);
  expect(result.text).toContain('<div id="-component-action-">');
  expect(result.text).toContain("</div>");
  expect(result.text).toContain("### Section");
});

test("an unclosed placeholder is an error, not a silently swallowed rest of the file", () => {
  expect(() => updateTokenTables('<div id="-component-action-">\n\n', []))
    .toThrow(/Unclosed <div id="-component-action-">/);
});

test("a value that is one token reference is written as the bare token name", () => {
  expect(formatTokenValue("var(--sjs2-spacing-x025)")).toEqual("spacing-x025");
});

test("a color at an opacity is written the way the semantic tables write it", () => {
  expect(formatTokenValue("rgba(from var(--sjs2-color-bg-alert-tertiary) r g b / var(--sjs2-opacity-hidden))"))
    .toEqual("color-bg-alert-tertiary, opacity-hidden");
});

test("a composite value keeps its structure and only loses the var() wrappers", () => {
  expect(formatTokenValue("inset var(--sjs2-border-offset-x-form-default) var(--sjs2-color-component-formbox-default-border)"))
    .toEqual("inset border-offset-x-form-default color-component-formbox-default-border");
  expect(formatTokenValue("calc(var(--sjs2-spacing-large-vertical) * 2)"))
    .toEqual("calc(spacing-large-vertical * 2)");
});

test("a literal value is left alone, and an empty one becomes the doc's em dash", () => {
  expect(formatTokenValue("transparent")).toEqual("transparent");
  expect(formatTokenValue("0px 0px 0px 0px transparent")).toEqual("0px 0px 0px 0px transparent");
  expect(formatTokenValue("")).toEqual("&mdash;");
});

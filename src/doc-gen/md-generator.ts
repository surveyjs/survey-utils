import * as path from "path";
import { DocEntry, DocEntryType, FileMap } from "./types";
import { resolveDir, writeFiles } from "./file-utils";
import {
  detectProduct, sourceUrl, isVisibleMember, firstSentence, stripMarkdownLinks, hasDescription, oneLine
} from "./doc-utils";

// Re-exported: these used to live here, and the public API keeps naming md-generator as their home.
export { detectProduct, sourceUrl, isVisibleMember, firstSentence, stripMarkdownLinks };

export interface MDGenerationOptions {
  /**
   * Product name written into the `product` front-matter field. When omitted it
   * is inferred from `fileNames`/the working directory (see detectProduct),
   * falling back to "Form Library".
   */
  product?: string;
  /** Entry file paths used to auto-detect the product when `product` is not set. */
  fileNames?: string[];
  /**
   * Target directory for the generated files, absolute or relative to the working
   * directory. Defaults to `<cwd>/docs/api`.
   */
  outputDir?: string;
  /** Value written into the `source` front-matter field (e.g. a base URL to the sources). */
  sourceBaseUrl?: string;
}

/**
 * Builds one Markdown file per documented class/interface following the
 * API-reference template, plus an `index.md`. Returns the files keyed by their
 * absolute path; nothing is written. Use generateMDFiles() to write them, or
 * diff the result to implement `--check`.
 *
 * @param classes The `outputClasses` produced by buildModel (docs/classes.json).
 * @param pmes The `outputPMEs` produced by buildModel (docs/pmes.json).
 * @param options Optional generation settings.
 */
export function buildMDFiles(
  classes: DocEntry[], pmes: DocEntry[], options: MDGenerationOptions = {}
): FileMap {
  const files: FileMap = {};
  if (!Array.isArray(classes)) return files;
  const members = Array.isArray(pmes) ? pmes : [];
  const outputDir = resolveDir(options.outputDir || path.join(process.cwd(), "docs", "api-reference"));
  const product = options.product || detectProduct(options.fileNames, process.cwd());
  for (let i = 0; i < classes.length; i++) {
    const cls = classes[i];
    if (!isDocumentedEntry(cls) || !cls.name || !hasDescription(cls)) continue;
    files[path.join(outputDir, cls.name + ".md")] =
      generateMDForClass(cls, members, product, options.sourceBaseUrl);
  }
  files[path.join(outputDir, "index.md")] =
    generateIndexMD(classes, members, product, options.sourceBaseUrl);
  return files;
}

/**
 * Generates one Markdown file per documented class/interface following the
 * API-reference template. Files are named `<ClassName>.md` / `<InterfaceName>.md`
 * and written into `docs/api` (created when missing).
 */
export function generateMDFiles(
  classes: DocEntry[], pmes: DocEntry[], options: MDGenerationOptions = {}
): void {
  writeFiles(buildMDFiles(classes, pmes, options));
}

/**
 * Builds the content of `index.md`: a list of documented classes followed by a
 * list of documented interfaces. Each entry is shown as a link to its
 * API-reference page plus the first sentence of its description. Entries are
 * ordered by the number of API members they expose, most members first
 * (e.g. `SurveyModel` leads the class list).
 */
export function generateIndexMD(
  classes: DocEntry[], pmes: DocEntry[], product: string = "Form Library", sourceBaseUrl?: string
): string {
  const members = Array.isArray(pmes) ? pmes : [];
  const all = Array.isArray(classes) ? classes : [];
  const lines = [
    "---",
    "title: Classes and Interfaces",
    "product: " + yamlScalar(product),
    "---",
    "",
    "# SurveyJS " + product + " API Reference"
  ];
  addIndexSection(lines, "Classes", all, DocEntryType.classType, members, product, sourceBaseUrl);
  addIndexSection(lines, "Interfaces", all, DocEntryType.interfaceType, members, product, sourceBaseUrl);
  addIndexSection(lines, "Variables", all, DocEntryType.variableType, members, product, sourceBaseUrl);
  return lines.join("\n") + "\n";
}

/** Appends one `## <title>` section listing all entries of the given entry type. */
function addIndexSection(
  lines: string[], title: string, classes: DocEntry[], entryType: DocEntryType,
  members: DocEntry[], product: string, sourceBaseUrl?: string
): void {
  const entries = classes
    .filter((cls) => !!cls && cls.entryType === entryType && !!cls.name && hasDescription(cls))
    .map((cls) => ({
      name: <string>cls.name,
      sentence: firstSentence(stripMarkdownLinks(cls.documentation)),
      count: members.filter((p) => p.className === cls.name && isVisibleMember(p)).length
    }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
  if (entries.length === 0) return;
  lines.push("", "## " + title, "");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const link = "[`" + entry.name + "`](" + sourceUrl(product, entry.name, sourceBaseUrl) + ".md)";
    lines.push("- " + link + (entry.sentence ? " — " + entry.sentence : ""));
  }
}

function isDocumentedEntry(cls: DocEntry): boolean {
  return !!cls
    && (cls.entryType === DocEntryType.classType
      || cls.entryType === DocEntryType.interfaceType
      || cls.entryType === DocEntryType.variableType);
}

/** The `api-type` front-matter value for an entry (`class`, `interface` or `variable`). */
function apiType(cls: DocEntry): string {
  if (cls.entryType === DocEntryType.interfaceType) return "interface";
  if (cls.entryType === DocEntryType.variableType) return "variable";
  return "class";
}

/** Builds the Markdown content for a single class/interface. */
export function generateMDForClass(
  cls: DocEntry, pmes: DocEntry[], product: string, sourceBaseUrl?: string
): string {
  const members = pmes
    .filter((p) => p.className === cls.name && isVisibleMember(p))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const properties = members.filter((p) => p.pmeType === "property");
  const methods = members.filter((p) => p.pmeType === "method");
  const events = members.filter((p) => p.pmeType === "event");

  const parts: string[] = [];
  parts.push(frontMatter(cls, product, apiType(cls), sourceBaseUrl));
  parts.push("# `" + cls.name + "`");
  const description = (cls.documentation || "").trim();
  if (description) parts.push(description);
  const since = sinceLine(cls);
  if (since) parts.push(since);
  const inheritance = inheritanceSection(cls, product, sourceBaseUrl);
  if (inheritance) parts.push(inheritance);
  if (properties.length > 0) parts.push(propertiesSection(properties));
  if (methods.length > 0) parts.push(methodsSection(methods));
  if (events.length > 0) parts.push(eventsSection(events));
  return parts.join("\n\n") + "\n";
}

function frontMatter(
  cls: DocEntry, product: string, apiType: string, sourceBaseUrl?: string
): string {
  const title = cls.metaTitle || cls.name || "";
  const description = firstSentence(stripMarkdownLinks(cls.metaDescription || cls.documentation));
  const source = sourceUrl(product, <string>cls.name, sourceBaseUrl);
  const lines = [
    "---",
    "title: " + yamlScalar(title),
    "product: " + yamlScalar(product),
    "api-type: " + apiType,
    "description: " + yamlScalar(description),
    "source: " + yamlScalar(source),
    "---"
  ];
  return lines.join("\n");
}

function inheritanceSection(cls: DocEntry, product: string, sourceBaseUrl?: string): string {
  const all = Array.isArray(cls.allTypes) && cls.allTypes.length > 0 ? cls.allTypes : [<string>cls.name];
  if (all.length <= 1) return "";
  // The base types link to their API-reference pages; the class itself stays plain.
  const chain = all.slice().reverse().map((t) => {
    const code = "`" + t + "`";
    if (t === cls.name) return code;
    return "[" + code + "](" + sourceUrl(product, t, sourceBaseUrl) + ".md)";
  }).join(" &rarr; ");
  return "## Inheritance\n\n" + chain;
}

function propertiesSection(properties: DocEntry[]): string {
  const blocks = groupByName(properties).map((group) => {
    // Order: name (heading), type, description, then the related APIs.
    const prop = group[0];
    const lines = ["### `" + prop.name + "`"];
    // A member that appears with several types (e.g. a getter/setter declared
    // more than once) is listed once with the union of its types.
    lines.push("**Type**: `" + unionTypeString(group, (p) => typeString(p.type, p.returnTypeGenerics)) + "`");
    const doc = (prop.documentation || "").trim();
    if (doc) lines.push(doc);
    const since = sinceLine(prop);
    if (since) lines.push(since);
    addRelatedAPIs(lines, prop);
    return lines.join("\n\n");
  });
  return "## Properties\n\n" + blocks.join("\n\n");
}

function methodsSection(methods: DocEntry[]): string {
  const blocks = groupByName(methods).map((group) => {
    // Order: name (heading), type (return value), description, parameters, related APIs.
    const method = group[0];
    const lines = ["### `" + method.name + "()`"];
    const returnValue = returnValueLine(method, group);
    if (returnValue) lines.push(returnValue);
    const doc = (method.documentation || "").trim();
    if (doc) lines.push(doc);
    const since = sinceLine(method);
    if (since) lines.push(since);
    const table = parametersTable(<DocEntry[]>method.parameters);
    if (table) lines.push("**Parameters:**\n\n" + table);
    addRelatedAPIs(lines, method);
    return lines.join("\n\n");
  });
  return "## Methods\n\n" + blocks.join("\n\n");
}

function eventsSection(events: DocEntry[]): string {
  const blocks = groupByName(events).map((group) => {
    const event = group[0];
    const lines = ["### `" + event.name + "`"];
    const doc = (event.documentation || "").trim();
    if (doc) lines.push(doc);
    const since = sinceLine(event);
    if (since) lines.push(since);
    addRelatedAPIs(lines, event);
    return lines.join("\n\n");
  });
  return "## Events\n\n" + blocks.join("\n\n");
}

/**
 * Groups members by name, preserving the order of first appearance. The doc
 * generator emits a separate entry for every declaration of a member, so a
 * member declared with several types (e.g. an overloaded getter/setter) reaches
 * the renderer more than once. Grouping collapses those into a single block.
 */
function groupByName(members: DocEntry[]): DocEntry[][] {
  const groups: DocEntry[][] = [];
  const byName: { [name: string]: DocEntry[] } = {};
  for (let i = 0; i < members.length; i++) {
    const name = members[i].name || "";
    let group = byName[name];
    if (!group) {
      group = [];
      byName[name] = group;
      groups.push(group);
    }
    group.push(members[i]);
  }
  return groups;
}

/** Joins the distinct type strings of a member group into a `A | B` union. */
function unionTypeString(group: DocEntry[], toType: (member: DocEntry) => string): string {
  const types: string[] = [];
  for (let i = 0; i < group.length; i++) {
    const type = toType(group[i]);
    if (type && types.indexOf(type) < 0) types.push(type);
  }
  return types.join(" | ");
}

/**
 * Builds the `Available since: v<version>` line from the entry's `@since` tag,
 * or an empty string when the entry carries no `@since`. A leading `v` already
 * present in the tag is not duplicated. Used for both classes and members.
 */
function sinceLine(entry: DocEntry): string {
  let since = oneLine(entry.since).trim();
  if (!since) return "";
  since = since.replace(/^v/i, "");
  return "Available since: v" + since;
}

/**
 * Appends the `**Related APIs:**` line built from the member's `@see` tags, e.g.
 * "**Related APIs:** [`width`](#width), [`widthValue`](#widthValue)". Nothing is
 * appended when the member has no usable `@see` tag.
 */
function addRelatedAPIs(lines: string[], member: DocEntry): void {
  const names = seeNames(member.see);
  if (names.length === 0) return;
  const links = names.map(relatedAPILink);
  lines.push("**Related APIs:** " + links.join(", "));
}

/**
 * Renders a single `@see` entry as a Related APIs link. A plain identifier
 * becomes an in-page anchor (`` [`name`](#name) ``). An entry that is already a
 * markdown link (`[text](url)`, e.g. a cross-product reference) keeps its target
 * URL and only wraps the link text in code formatting.
 */
function relatedAPILink(name: string): string {
  const link = name.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (link) {
    return "[`" + link[1].trim() + "`](" + link[2].trim() + ")";
  }
  return "[`" + name + "`](#" + name + ")";
}

/**
 * Normalizes the `see` field into a list of API names. TypeScript appends the
 * next jsdoc line's `*` to the tag text (`"width *"`) when `@see` is not the last
 * line of the comment -- still true on 5.8 -- so asterisks are stripped.
 */
function seeNames(see: any): string[] {
  if (!see) return [];
  const values = Array.isArray(see) ? see : [see];
  return values
    .map((value) => oneLine(value).replace(/\*/g, "").trim())
    .filter((name) => !!name);
}

function returnValueLine(method: DocEntry, group: DocEntry[] = [method]): string {
  const type = unionTypeString(group, (m) => typeString(m.returnType, m.returnTypeGenerics));
  if (!type || type === "void") return "";
  const returnDoc = oneLine(method.returnDocumentation);
  let line = "**Return value:** `" + type + "`";
  if (returnDoc) line += " &ndash; " + returnDoc;
  return line;
}

function parametersTable(parameters: DocEntry[]): string {
  if (!Array.isArray(parameters) || parameters.length === 0) return "";
  const rows = [
    "| Name | Type | Description |",
    "| ---- | ---- | ----------- |"
  ];
  for (let i = 0; i < parameters.length; i++) {
    const param = parameters[i];
    rows.push(
      "| `" + tableCell(param.name) + "` | `" + tableCell(param.type) + "` | "
      + tableCell(param.documentation) + " |"
    );
  }
  return rows.join("\n");
}

function typeString(type: string | undefined, generics?: string[]): string {
  const base = type || "any";
  if (Array.isArray(generics) && generics.length > 0) {
    return base + "<" + generics.join(", ") + ">";
  }
  return base;
}

/** Escapes a value for use inside a Markdown table cell. */
function tableCell(text: any): string {
  return oneLine(text).replace(/\|/g, "\\|");
}

/** Produces a YAML-safe scalar, quoting only when the value needs it. */
function yamlScalar(value: string): string {
  const text = oneLine(value);
  if (text === "") return "";
  const needsQuoting =
    /:(\s|$)/.test(text)                    // colon that ends a token (a mapping key)
    || /\s#/.test(text)                     // start of a comment
    || /["\\]/.test(text)                   // quote or backslash
    || /^[-?:,\[\]{}#&*!|>'"%@`]/.test(text); // leading YAML indicator
  if (needsQuoting) {
    return "\"" + text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
  }
  return text;
}

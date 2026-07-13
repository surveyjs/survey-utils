import { DocEntry } from "./types";

/**
 * Helpers shared by the emitters (Markdown, LLM guide).
 *
 * They live here rather than in md-generator.ts so that a second emitter does not
 * have to import the first one just to reach firstSentence() or sourceUrl().
 */

/** Keyword rules mapping an entry path (or working directory) to a product name. */
const productRules: { product: string; keywords: string[] }[] = [
  { product: "PDF Generator", keywords: ["pdf"] },
  { product: "Survey Creator", keywords: ["creator"] },
  { product: "Dashboard", keywords: ["dashboard", "analytics"] }
];

/**
 * Infers the product name from the entry file paths (and optionally the working
 * directory), e.g. `src/entries/pdf.ts` &rarr; "PDF Generator". Falls back to
 * "Form Library" when nothing matches.
 */
export function detectProduct(fileNames?: string[], cwd?: string): string {
  const parts: string[] = [];
  if (Array.isArray(fileNames)) parts.push(...fileNames);
  if (cwd) parts.push(cwd);
  const haystack = parts.join(" ").replace(/\\/g, "/").toLowerCase();
  for (let i = 0; i < productRules.length; i++) {
    const rule = productRules[i];
    if (rule.keywords.some((k) => haystack.indexOf(k) > -1)) return rule.product;
  }
  return "Form Library";
}

/** Product name &rarr; the library slug used in surveyjs.io documentation URLs. */
const libraryNames: { [product: string]: string } = {
  "Form Library": "form-library",
  "Survey Creator": "survey-creator",
  "Dashboard": "dashboard",
  "PDF Generator": "pdf-generator"
};

/**
 * Builds the `source` front-matter URL, e.g.
 * `https://surveyjs.io/form-library/documentation/api-reference/surveymodel`.
 */
export function sourceUrl(product: string, className: string, baseUrl?: string): string {
  const base = (baseUrl || "https://surveyjs.io").replace(/\/+$/, "");
  const library = libraryNames[product] || libraryNames["Form Library"];
  return base + "/" + library + "/documentation/api-reference/" + (className || "").toLowerCase();
}

/** Collapses whitespace/newlines into a single line. */
export function oneLine(text: any): string {
  if (!text) return "";
  return String(text).replace(/\s+/g, " ").trim();
}

/** Replaces Markdown links `[label](url)` with just their `label`. */
export function stripMarkdownLinks(text: any): string {
  if (!text) return "";
  return String(text).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

/** Returns the first sentence (up to the first `.`/`!`/`?`) of a text. */
export function firstSentence(text: any): string {
  const line = oneLine(text);
  if (!line) return "";
  const match = line.match(/^.*?[.!?](?=\s|$)/);
  return match ? match[0] : line;
}

/** True when the entry has a non-empty description. */
export function hasDescription(entry: DocEntry): boolean {
  return !!entry && !!(entry.documentation || "").trim();
}

/** Members that belong in the API reference: not hidden, not protected, documented. */
export function isVisibleMember(member: DocEntry): boolean {
  return member.isHidden !== true && member.isProtected !== true && hasDescription(member);
}

/**
 * The URLs of the `[View Demo]`/`[Read more]` links inside a JSDoc comment.
 *
 * The guide strips these links from the prose (they cost tokens in every sentence)
 * but keeps the URLs, which is the only place survey-core records where a feature is
 * demonstrated. Nothing else in the codebase carries them.
 */
export function demoLinks(text: any): string[] {
  if (!text) return [];
  const res: string[] = [];
  // The URL stops at whitespace, not at the first ")": survey-core writes the marker
  // *inside* the parentheses -- `[Text Entry Demo](https://... (linkStyle))` -- and a
  // greedy [^)]+ swallows it into the href.
  const re = /\[[^\]]*\]\((https?:\/\/[^\s)]+)/g;
  let match = re.exec(String(text));
  while (match !== null) {
    if (res.indexOf(match[1]) < 0) res.push(match[1]);
    match = re.exec(String(text));
  }
  return res;
}

/**
 * The one-sentence summary the guide uses for a class or property: the first
 * sentence of the JSDoc, with links flattened to their label and the
 * `(linkStyle)` markers survey-core uses for demo links removed.
 */
export function summary(text: any): string {
  const cleaned = String(text || "").replace(/\(linkStyle\)/g, " ");
  return firstSentence(stripMarkdownLinks(cleaned));
}

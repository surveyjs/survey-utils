/**
 * How a token's declared value is written in the Value column.
 *
 * The tables are read next to the hand-written ones above them in the same topic, so they
 * follow the same shorthand those settled on: a value that is another token is spelled as the
 * bare token name -- no `var()`, no `--sjs2-` prefix, no backticks -- because a column of
 * `var(--sjs2-...)` is 11 characters of noise per row and the reader is already looking at a
 * page about `--sjs2-` tokens.
 */

/** `var(--sjs2-x)` anywhere in a value. */
const VAR_REFERENCE = /var\(\s*(--sjs2-[a-z0-9-]+)\s*\)/g;

/** The whole value is one reference and nothing else. */
const SOLE_REFERENCE = /^var\(\s*--sjs2-[a-z0-9-]+\s*\)$/;

/**
 * `rgba(from var(--sjs2-a) r g b / var(--sjs2-b))` -- a color taken at an opacity, which the
 * theme uses wherever a token is one of the palette colors made translucent.
 */
const COLOR_AT_OPACITY =
  /^rgba\(\s*from\s+var\(\s*(--sjs2-[a-z0-9-]+)\s*\)\s+r\s+g\s+b\s*\/\s*var\(\s*(--sjs2-[a-z0-9-]+)\s*\)\s*\)$/;

/** What the doc writes where a token has no value of its own to show. */
export const NO_VALUE = "&mdash;";

/** `--sjs2-color-bg-brand-primary` -> `color-bg-brand-primary`. */
function bare(name: string): string {
  return name.replace(/^--sjs2-/, "");
}

/**
 * A declared value, written the way the Value column writes it.
 *
 * Three shapes get a form of their own, because the hand-written tables already gave them one
 * and a generated table that spelled them differently would read as a different kind of fact:
 *
 * - a lone reference is the referenced token's name;
 * - `rgba(from var(a) r g b / var(b))` is `a, b` -- "this color, at that opacity", which is what
 *   the semantic tables have always called it;
 * - an empty value is an em dash, the same placeholder the Brand table uses for the one token
 *   whose value is the project's own color.
 *
 * Everything else keeps its CSS structure and only loses the `var()` wrappers: composite border
 * effects stay recognizable as the five primitives they are made of, and a `calc()` stays a
 * `calc()`. Rewriting those into prose would mean guessing at which of the parts matters, and a
 * generated table is the wrong place to guess.
 */
export function formatTokenValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return NO_VALUE;
  if (SOLE_REFERENCE.test(trimmed)) return bare(trimmed.slice(4, -1).trim());
  const atOpacity = COLOR_AT_OPACITY.exec(trimmed);
  if (!!atOpacity) return `${bare(atOpacity[1])}, ${bare(atOpacity[2])}`;
  return trimmed.replace(VAR_REFERENCE, (_match, name: string) => bare(name));
}

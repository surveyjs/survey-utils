import { ThemeToken } from "./theme";
import { formatTokenValue } from "./value";

/**
 * A table placeholder in the topic: `<div id="...">` ... `</div>`.
 *
 * The id is not decoration and not an anchor -- it is the query. `id="-component-action-"`
 * means "every token with `-component-action-` in its name", so the topic's author decides
 * what a section covers by editing the id, in the file the table lives in, without touching
 * this generator. Several queries are separated by `|`, which is how a section that covers a
 * family of related components (every kind of panel, every kind of checkable control) names
 * them all.
 */
export interface TokenTable {
  /** The id, verbatim -- what goes back into the rewritten `<div>`. */
  id: string;
  /** The id split on `|`, whitespace-trimmed: the patterns a token matches against. */
  patterns: string[];
  /** The tokens this table lists, in theme declaration order. */
  tokens: ThemeToken[];
}

export interface TokenTablesResult {
  /** The topic with every placeholder's body replaced by its table. */
  text: string;
  /** Every placeholder found, in document order. */
  tables: TokenTable[];
  /**
   * Component tokens no placeholder claimed. Reported rather than dropped: a token the theme
   * declares and the topic never lists is either a section nobody wrote yet or a component
   * renamed upstream, and both are invisible in a diff of tables that all still generate.
   */
  unmatched: ThemeToken[];
}

/** `<div id="...">`, with the offsets of the body it wraps. */
const DIV_OPEN = /<div id="([^"]*)">/g;
const DIV_CLOSE = "</div>";

/** The segment that marks a token as belonging to one component rather than the system. */
const COMPONENT_SEGMENT = "-component-";

/**
 * Does a token belong in a table whose id names this pattern?
 *
 * A pattern is an infix -- `-component-action-` sits in the middle of
 * `--sjs2-color-component-action-brand-primary-default-bg` -- and the trailing dash is what
 * keeps `-component-label-` from swallowing `-component-labeled-item-` tokens.
 *
 * It also matches a name that *ends* where the pattern does, because a handful of tokens are
 * named for a component and nothing else: `--sjs2-radius-component-action` is the corner radius
 * of every action, and there is no further segment for the infix to sit before. Without this it
 * would fall out of the Buttons & Actions table and out of every other one -- as would the whole
 * `--sjs2-radius-component-*` family, and the only two tokens the Notifications and Swatches
 * sections have to show.
 */
function matches(name: string, pattern: string): boolean {
  if (name.indexOf(pattern) >= 0) return true;
  return pattern.charAt(pattern.length - 1) === "-" && name.endsWith(pattern.slice(0, -1));
}

/** The patterns an id names: `"-a- | -b-"` -> `["-a-", "-b-"]`. */
export function idPatterns(id: string): string[] {
  return id.split("|").map((pattern) => pattern.trim()).filter((pattern) => !!pattern);
}

/** A cell's content, with the one character that would end the cell early escaped. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

/** The Markdown table for one placeholder. An empty table still gets a header, see below. */
function renderTable(tokens: ThemeToken[]): string {
  const rows = tokens.map(
    (token) => `| \`${token.name}\` | ${cell(formatTokenValue(token.value))} |`
  );
  return ["| Variable | Value |", "| -------- | ----- |"].concat(rows).join("\n");
}

/**
 * The topic with every `<div id="...">` body replaced by the table its id asks for.
 *
 * The rewrite is the update mechanism: the placeholders survive it unchanged, so the command is
 * idempotent and re-running it after the theme changes is the whole of "keep the tables in sync".
 * A token added upstream appears in the table its name already puts it in, a removed one leaves,
 * and a changed value changes in one cell -- the diff is the token change and nothing else,
 * which is only true because the rows keep the theme's own order rather than being sorted into
 * an order that would reshuffle on every insert.
 */
export function updateTokenTables(markdown: string, tokens: ThemeToken[]): TokenTablesResult {
  const tables: TokenTable[] = [];
  const claimed: { [name: string]: true } = {};
  const parts: string[] = [];
  let cursor = 0;
  let open: RegExpExecArray | null;

  DIV_OPEN.lastIndex = 0;
  while ((open = DIV_OPEN.exec(markdown)) !== null) {
    const bodyStart = open.index + open[0].length;
    const bodyEnd = markdown.indexOf(DIV_CLOSE, bodyStart);
    if (bodyEnd < 0) {
      throw new Error(
        `Unclosed <div id="${open[1]}">: a table placeholder has to be closed by ${DIV_CLOSE}.`
      );
    }
    const patterns = idPatterns(open[1]);
    const matched = tokens.filter((token) => patterns.some((pattern) => matches(token.name, pattern)));
    matched.forEach((token) => { claimed[token.name] = true; });
    tables.push({ id: open[1], patterns, tokens: matched });

    parts.push(markdown.substring(cursor, bodyStart));
    parts.push("\n\n" + renderTable(matched) + "\n\n");
    cursor = bodyEnd;
    DIV_OPEN.lastIndex = bodyEnd;
  }
  parts.push(markdown.substring(cursor));

  const unmatched = tokens.filter(
    (token) => token.name.indexOf(COMPONENT_SEGMENT) >= 0 && !claimed[token.name]
  );
  return { text: parts.join(""), tables, unmatched };
}

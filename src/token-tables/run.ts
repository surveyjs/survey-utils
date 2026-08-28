import * as fs from "fs";
import * as path from "path";
import { resolvePath } from "../paths";
import { baseThemeFile, readThemeTokens, ThemeToken } from "./theme";
import { updateTokenTables } from "./tables";

export class TokenTablesUsageError extends Error { }

interface TokenTablesArgs {
  /** The topics to rewrite. At least one: the command writes nothing on its own. */
  files: string[];
  /** --theme: another base-theme.ts. Absent: survey-library's. */
  theme?: string;
  /** --path: the survey-library checkout the default theme is found in. */
  path?: string;
  /** --check: rewrite in memory and report, without touching the files. */
  check: boolean;
}

function parseArgs(args: string[]): TokenTablesArgs {
  const res: TokenTablesArgs = { files: [], check: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = (): string => {
      const next = args[++i];
      if (next === undefined || next.indexOf("--") === 0) {
        throw new TokenTablesUsageError(arg + " needs a value");
      }
      return next;
    };
    if (arg === "--theme") res.theme = value();
    else if (arg === "--path") res.path = value();
    else if (arg === "--check") res.check = true;
    else if (arg.indexOf("--") === 0) throw new TokenTablesUsageError("Unknown option: " + arg);
    else res.files.push(arg);
  }
  if (res.files.length === 0) {
    throw new TokenTablesUsageError(
      "No file to update: token-tables rewrites the table placeholders inside a Markdown topic, "
      + "so name the topic.\n\n"
      + "  survey-utils token-tables ../surveyjs-site-data/Docs/complete-design-token-list.md"
    );
  }
  return res;
}

/** The counts a run prints per topic, so a diff that looks wrong can be checked against them. */
function reportTables(file: string, result: ReturnType<typeof updateTokenTables>): void {
  const total = result.tables.reduce((sum, table) => sum + table.tokens.length, 0);
  console.log(`${file}: ${result.tables.length} table(s), ${total} token(s)`);
  result.tables.forEach((table) => {
    console.log(`  ${String(table.tokens.length).padStart(4)}  ${table.id}`);
  });
  // An id that matches nothing is a typo or a component renamed upstream. It generates a table
  // with a header and no rows, which reads on the page as "this component has no tokens" -- a
  // claim the run has no way to know is true, so it says out loud that it made it.
  result.tables.filter((table) => table.tokens.length === 0).forEach((table) => {
    console.warn(`warning: no token matches id="${table.id}" -- the table is empty.`);
  });
  if (result.unmatched.length > 0) {
    console.warn(
      `warning: ${result.unmatched.length} component token(s) match no table in ${path.basename(file)} `
      + "and are documented nowhere:"
    );
    result.unmatched.forEach((token) => console.warn("  " + token.name));
  }
}

/**
 * `survey-utils token-tables <file...>`: fill the token tables of a Markdown topic from the
 * default theme.
 *
 * The topic owns the sections and their ids; the theme owns the tokens and their values. This
 * command is only the join between them, which is why it can be re-run after any theme change
 * and why `--check` is enough for CI: a topic whose tables no longer match the theme fails the
 * check with the tokens that moved named in the diff.
 */
export function runTokenTables(args: string[]): number {
  const parsed = parseArgs(args);
  const themeFile = baseThemeFile(parsed.theme, parsed.path);
  const tokens: ThemeToken[] = readThemeTokens(themeFile);
  console.log(`${themeFile}: ${tokens.length} token(s)`);

  const files = parsed.files.map((file) => resolvePath(file));
  const missing = files.filter((file) => !fs.existsSync(file));
  if (missing.length > 0) {
    missing.forEach((file) => console.error("File not found: " + file));
    return 2;
  }

  let changed = 0;
  files.forEach((file) => {
    const before = fs.readFileSync(file, "utf8");
    const result = updateTokenTables(before, tokens);
    reportTables(file, result);
    if (result.tables.length === 0) {
      console.warn(
        `warning: ${file} holds no <div id="..."> table placeholder -- nothing to fill.`
      );
      return;
    }
    if (result.text === before) return;
    changed++;
    if (parsed.check) console.error("differs: " + file);
    else fs.writeFileSync(file, result.text);
  });

  if (parsed.check) {
    console.log(`${files.length} file(s) checked, ${changed} differ from the theme.`);
    return changed > 0 ? 1 : 0;
  }
  console.log(`${changed} file(s) written.`);
  return 0;
}

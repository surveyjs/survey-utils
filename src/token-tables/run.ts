import * as fs from "fs";
import * as path from "path";
import { tokenTopicPaths } from "../site-paths";
import { baseThemeFile, readThemeTokens, ThemeToken } from "./theme";
import { updateTokenTables } from "./tables";

export interface TokenTablesOptions {
  /** The survey-library checkout the theme is read from. Absent: the sibling checkout. */
  path?: string;
  /** The content repo root the topics are joined onto. Absolute. */
  out: string;
  /** Fill in memory and report, without touching the files. */
  check?: boolean;
}

/**
 * The topics a run fills: paths.json's own, joined onto the content repo root.
 *
 * Which topic holds the token tables is a fact of the content repo's layout, not a choice --
 * a caller that has the repo root in hand has already said everything -- so a publish survives
 * the topic being renamed or split upstream without an edit anywhere but paths.json.
 */
export function topicFiles(out: string): string[] {
  return tokenTopicPaths().map((topic) => path.resolve(out, topic));
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
 * Fill the design-token tables of the site's topics from survey-core's default theme.
 *
 * The topic owns the sections and their ids; the theme owns the tokens and their values; this is
 * only the join between them, which is why re-running it is the whole of "sync the tables".
 *
 * It runs as part of `generate-doc library-site` rather than as a command of its own, because it
 * is the same publish as the rest of the Form Library's site artifacts: the API reference, the
 * schema and the guide come from a survey-core build, and the token list comes from the theme in
 * that same build. Two commands could be run against two different checkouts, or one could be
 * forgotten; one cannot.
 *
 * A missing topic is not fatal. The topics are declared here, the site repo is checked out by
 * whoever runs the publish, and a branch that has not got the topic yet is a normal state of an
 * upstream repo -- not a reason to fail a documentation build that has otherwise succeeded.
 */
export function fillTokenTables(options: TokenTablesOptions): number {
  const themeFile = baseThemeFile(options.path);
  const tokens: ThemeToken[] = readThemeTokens(themeFile);
  console.log(`${themeFile}: ${tokens.length} token(s)`);

  const files = topicFiles(options.out);
  const missing = files.filter((file) => !fs.existsSync(file));
  missing.forEach((file) => console.warn(`warning: no topic at ${file} -- nothing to fill.`));
  const present = files.filter((file) => fs.existsSync(file));

  let changed = 0;
  present.forEach((file) => {
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
    if (options.check) console.error("differs: " + file);
    else fs.writeFileSync(file, result.text);
  });

  if (options.check) {
    console.log(`${present.length} topic(s) checked, ${changed} differ from the theme.`);
    return changed > 0 ? 1 : 0;
  }
  console.log(`${changed} topic(s) written.`);
  return 0;
}

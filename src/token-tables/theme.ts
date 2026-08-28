import * as fs from "fs";
import * as path from "path";
import * as JSON5 from "json5";
import { PathError, productRoot } from "../paths";
import { PATHS_FILE, themePath } from "../site-paths";

/**
 * One CSS custom property the default theme declares, kept in declaration order.
 *
 * Order is part of the data, not an accident of parsing: the theme groups a component's
 * tokens the way a reader wants to meet them -- every size of an action's padding together,
 * then its colors, then its border effects -- and the generated tables inherit that grouping
 * for free by never sorting.
 */
export interface ThemeToken {
  /** The full custom property name, e.g. `--sjs2-color-component-action-brand-primary-default-bg`. */
  name: string;
  /** The declared value, verbatim: `var(--sjs2-color-bg-brand-primary)`, `transparent`, ... */
  value: string;
}

/**
 * The default theme, relative to the survey-library repo root -- `product.theme` in paths.json.
 *
 * Which file inside the repo it is, is not a caller's to name: base-theme.ts is the whole source
 * of truth for `--sjs2-*`, generated from the design system upstream, and every other theme in
 * survey-core only overrides parts of it, so the complete list of tokens and their default values
 * is there and nowhere else. Keeping the path in paths.json means a move upstream is followed by
 * a release of this repo rather than by an edit to every script that runs the command.
 */
export const BASE_THEME_PATH = themePath();

/**
 * The theme file a run reads: survey-library's base-theme.ts, found under `--path`, or next to
 * survey-utils like every other command's repo.
 */
export function baseThemeFile(root?: string): string {
  const file = path.join(productRoot("survey-library", root), BASE_THEME_PATH);
  if (fs.existsSync(file)) return file;
  throw new PathError(
    `Theme file not found: ${file}\n`
    + "Check survey-library out next to survey-utils, or name its root with --path <dir>.\n"
    + `The path inside the repo is 'product.theme' in ${PATHS_FILE}.`
  );
}

/**
 * The tokens base-theme.ts declares.
 *
 * The file is `export default { ... }` around a plain object literal, so it is read as data
 * rather than imported: importing it would need survey-core compiled, and this command has no
 * other reason to want a build. JSON5 handles what plain JSON would not -- the trailing
 * comment, the unquoted keys a future edit might introduce.
 */
export function readThemeTokens(file: string): ThemeToken[] {
  const source = fs.readFileSync(file, "utf8");
  const literal = source.replace(/^[\s\S]*?export\s+default/, "").replace(/;\s*$/, "");
  let theme: any;
  try {
    theme = JSON5.parse(literal);
  } catch (error) {
    throw new PathError(
      `${file} is not the object literal this command reads: ${String((<Error>error).message)}\n`
      + "It expects `export default { ..., \"cssVariables\": { ... } }` -- the shape base-theme.ts "
      + "is generated in."
    );
  }
  const cssVariables = !!theme && theme.cssVariables;
  if (!cssVariables || typeof cssVariables !== "object") {
    throw new PathError(`${file} declares no cssVariables object.`);
  }
  return Object.keys(cssVariables).map((name) => ({ name, value: String(cssVariables[name]) }));
}

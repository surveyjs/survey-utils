import {
  checkProduct, formatDeadStrings, formatErrors, formatSummary, products, resolveProductName,
} from "./loc-lint";
import { ProductRootError } from "./paths";

/**
 * Reports localization strings that no product source reaches any more.
 *
 *   survey-utils check-strings creator
 *   survey-utils check-strings creator --list-dead
 *   survey-utils check-strings library --path ../../LibV3/survey-library
 *   node ./dist/checkUnusedStrings.js creator          (the same check, run directly)
 *
 * Product aliases are accepted, so `dashboard` still selects `analytics`.
 *
 * Without --path, the product's repo is looked up next to survey-utils -- the layout
 * of a local SurveyJS checkout. --path names the repo root instead (the folder that
 * holds its package.json), so a checkout anywhere on disk can be checked. It applies
 * to one product, so it needs the product to be named.
 *
 * Exit code 1 means the build should fail: a *new* unused string appeared, the
 * allowlist rotted, or a dynamic namespace lost its resolver. Strings already
 * recorded as dead in the allowlist are reported but do not fail the build --
 * they are a cleanup backlog, not a regression.
 */
export function runCheckUnusedStrings(args: string[]): number {
  let listDead = false;
  let path: string | undefined = undefined;
  const requested: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--list-dead") {
      listDead = true;
    } else if (arg === "--path") {
      path = args[++i];
      if (path === undefined || path.startsWith("--")) {
        console.error("--path needs a directory: the root of the product's checkout.");
        return 2;
      }
    } else if (arg.startsWith("--")) {
      console.error(`Unknown option: ${arg}`);
      return 2;
    } else {
      requested.push(arg);
    }
  }

  const unknown = requested.filter((name) => !resolveProductName(name));
  if (unknown.length > 0) {
    console.error(`Unknown product(s): ${unknown.join(", ")}. Known: ${Object.keys(products).join(", ")}`);
    return 2;
  }

  // An alias and its product name in one run must not check the product twice.
  const names = requested.length > 0
    ? Array.from(new Set(requested.map((name) => resolveProductName(name) as string)))
    : Object.keys(products);

  // One --path is one repo, so it cannot answer for a run over several products.
  if (!!path && names.length !== 1) {
    console.error(
      "--path names one product's checkout, so name that product too: "
      + `check-strings <${Object.keys(products).join("|")}> --path <dir>`
    );
    return 2;
  }

  let failed = false;
  let missingRoot = false;
  names.forEach((name) => {
    let product;
    try {
      product = products[name](path);
    } catch (error) {
      // The checkout is not where we looked. The message says where; a stack adds nothing.
      if (!(error instanceof ProductRootError)) throw error;
      console.error(`${name}: ${error.message}`);
      missingRoot = true;
      return;
    }
    const result = checkProduct(product);

    console.log(formatSummary(product, result));
    if (listDead) console.log(`\n${formatDeadStrings(product, result)}\n`);

    const errors = formatErrors(product, result);
    if (errors) {
      failed = true;
      console.error(`\n=== ${name}: FAILED ===\n${errors}\n`);
    }
  });

  return failed || missingRoot ? 1 : 0;
}

if (require.main === module) {
  process.exit(runCheckUnusedStrings(process.argv.slice(2)));
}

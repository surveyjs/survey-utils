import {
  checkProduct, formatDeadStrings, formatErrors, formatSummary, products, resolveProductName,
} from "./loc-lint";

/**
 * Reports localization strings that no product source reaches any more.
 *
 *   survey-utils check-strings creator
 *   survey-utils check-strings creator --list-dead
 *   node ./dist/checkUnusedStrings.js creator          (the same check, run directly)
 *
 * Product aliases are accepted, so `dashboard` still selects `analytics`.
 *
 * Exit code 1 means the build should fail: a *new* unused string appeared, the
 * allowlist rotted, or a dynamic namespace lost its resolver. Strings already
 * recorded as dead in the allowlist are reported but do not fail the build --
 * they are a cleanup backlog, not a regression.
 */
export function runCheckUnusedStrings(args: string[]): number {
  const listDead = args.indexOf("--list-dead") > -1;
  const requested = args.filter((arg) => !arg.startsWith("--"));

  const unknown = requested.filter((name) => !resolveProductName(name));
  if (unknown.length > 0) {
    console.error(`Unknown product(s): ${unknown.join(", ")}. Known: ${Object.keys(products).join(", ")}`);
    return 2;
  }

  // An alias and its product name in one run must not check the product twice.
  const names = requested.length > 0
    ? Array.from(new Set(requested.map((name) => resolveProductName(name) as string)))
    : Object.keys(products);

  let failed = false;
  names.forEach((name) => {
    const product = products[name]();
    const result = checkProduct(product);

    console.log(formatSummary(product, result));
    if (listDead) console.log(`\n${formatDeadStrings(product, result)}\n`);

    const errors = formatErrors(product, result);
    if (errors) {
      failed = true;
      console.error(`\n=== ${name}: FAILED ===\n${errors}\n`);
    }
  });

  return failed ? 1 : 0;
}

if (require.main === module) {
  process.exit(runCheckUnusedStrings(process.argv.slice(2)));
}

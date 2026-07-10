import { checkProduct, formatDeadStrings, formatErrors, formatSummary, products } from "./loc-lint";

/**
 * Reports localization strings that no product source reaches any more.
 *
 *   node ./dist/checkUnusedStrings.js creator
 *   node ./dist/checkUnusedStrings.js creator --list-dead
 *
 * Exit code 1 means the build should fail: a *new* unused string appeared, the
 * allowlist rotted, or a dynamic namespace lost its resolver. Strings already
 * recorded as dead in the allowlist are reported but do not fail the build --
 * they are a cleanup backlog, not a regression.
 */
function main(): void {
  const args = process.argv.slice(2);
  const listDead = args.indexOf("--list-dead") > -1;
  const requested = args.filter((arg) => !arg.startsWith("--"));
  const names = requested.length > 0 ? requested : Object.keys(products);

  const unknown = names.filter((name) => !products[name]);
  if (unknown.length > 0) {
    console.error(`Unknown product(s): ${unknown.join(", ")}. Known: ${Object.keys(products).join(", ")}`);
    process.exit(2);
  }

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

  process.exit(failed ? 1 : 0);
}

main();

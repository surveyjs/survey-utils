import {
  checkProduct, formatDeadStrings, formatErrors, formatSummary, products, resolveProductName,
} from "./loc-lint";

/**
 * Reports localization strings that no product source reaches any more.
 *
 *   survey-utils check-strings creator
 *   survey-utils check-strings creator --list-dead
 *   survey-utils check-strings library --repo ../..    (an explicit repo checkout)
 *   node ./dist/checkUnusedStrings.js creator          (the same check, run directly)
 *
 * Product aliases are accepted, so `dashboard` still selects `analytics`.
 * Without `--repo` the product repo is expected next to survey-utils.
 *
 * Exit code 1 means the build should fail: a *new* unused string appeared, the
 * allowlist rotted, or a dynamic namespace lost its resolver. Strings already
 * recorded as dead in the allowlist are reported but do not fail the build --
 * they are a cleanup backlog, not a regression.
 */
export function runCheckUnusedStrings(args: string[]): number {
  let listDead = false;
  let repoRoot: string | undefined = undefined;
  const requested: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--list-dead") {
      listDead = true;
    } else if (arg === "--repo") {
      const next = args[++i];
      if (next === undefined || next.startsWith("--")) {
        console.error("--repo needs a value: the product's repo checkout, e.g. --repo ../..");
        return 2;
      }
      repoRoot = next;
    } else if (!arg.startsWith("--")) {
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

  if (!!repoRoot && names.length !== 1) {
    console.error("--repo points into one product's checkout; name exactly one product to use it.");
    return 2;
  }

  let failed = false;
  names.forEach((name) => {
    const product = products[name](repoRoot);
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

import * as fs from "fs";
import { analyze } from "./analyze";
import { listFiles } from "./files";
import { collectLocaleKeys } from "./inventory";
import { collectStringLiterals } from "./literals";
import { AnalyzeResult, LocKey, LocLintProduct } from "./types";

/** Allowlist reason prefixes. See the README. */
export const BASELINE_PREFIX = "baseline:";
export const DYNAMIC_PREFIX = "dynamic:";

export function checkProduct(product: LocLintProduct): AnalyzeResult {
  const keys = collectLocaleKeys(
    fs.readFileSync(product.referenceLocaleFile, "utf8"),
    product.referenceLocaleExport,
    product.referenceLocaleFile
  );
  const files = listFiles(product.sourceRoots, {
    extensions: product.sourceExtensions,
    skipDirs: product.skipDirs,
  });
  const literals = collectStringLiterals(files, (file) => fs.readFileSync(file, "utf8"));
  return analyze(keys, literals, product);
}

/**
 * Allowlisted keys whose reason marks them dead rather than dynamic: strings
 * that are already unused and are only waiting to be deleted. These are the
 * answer to "which translations can I remove?" -- they do not fail the build.
 */
export function deadStrings(product: LocLintProduct, result: AnalyzeResult): Array<LocKey> {
  return result.allowlisted.filter((key) => product.allowlist[key.path].startsWith(BASELINE_PREFIX));
}

/** Allowlisted keys reached through a lookup no static check can follow. */
export function dynamicStrings(product: LocLintProduct, result: AnalyzeResult): Array<LocKey> {
  return result.allowlisted.filter((key) => product.allowlist[key.path].startsWith(DYNAMIC_PREFIX));
}

/** Blocking problems only. Empty string means the build should pass. */
export function formatErrors(product: LocLintProduct, result: AnalyzeResult): string {
  const sections: Array<string> = [];

  if (result.unused.length > 0) {
    sections.push(
      `${result.unused.length} NEW localization string(s) are not used anywhere.\n` +
      `Delete them from every locale file next to\n  ${product.referenceLocaleFile}\n` +
      `or, if they are reached dynamically, add them to\n  ${product.allowlistFile}\n` +
      `with a "${DYNAMIC_PREFIX}" reason naming the call site:\n` +
      formatKeys(result.unused)
    );
  }

  if (result.obsoleteAllowlist.length > 0) {
    sections.push(
      `${result.obsoleteAllowlist.length} allowlist entr(y|ies) in\n  ${product.allowlistFile}\n` +
      `are no longer needed (the key was deleted, or it became reachable again). Remove them:\n` +
      result.obsoleteAllowlist.map((key) => `  ${key}`).join("\n")
    );
  }

  if (result.unresolvedDynamicNamespaces.length > 0) {
    sections.push(
      `These namespaces are built dynamically in source but have no resolver, so their\n` +
      `keys can never be proven used. Add a resolver in the product config:\n` +
      result.unresolvedDynamicNamespaces.map((ns) => `  ${ns}.*`).join("\n")
    );
  }

  return sections.join("\n\n");
}

/**
 * The standing state of the product, printed whether or not the build fails.
 * Never say "OK -- everything is used" while dead strings sit in the baseline.
 */
export function formatSummary(product: LocLintProduct, result: AnalyzeResult): string {
  const dead = deadStrings(product, result);
  const dynamic = dynamicStrings(product, result);
  const lines = [
    `${product.name}: ${result.unused.length} new unused string(s), ` +
    `${dead.length} known dead, ${dynamic.length} dynamic exemption(s).`,
  ];
  if (dead.length > 0) {
    lines.push(
      `  ${dead.length} string(s) are already unused and waiting to be deleted ` +
      `(reason "${BASELINE_PREFIX}" in ${product.allowlistFile}).`
    );
    lines.push("  Run with --list-dead to print them.");
  }
  return lines.join("\n");
}

/** The cleanup backlog, grouped by namespace so it can be worked through. */
export function formatDeadStrings(product: LocLintProduct, result: AnalyzeResult): string {
  const dead = deadStrings(product, result);
  if (dead.length === 0) return `${product.name}: no dead strings. Nothing to clean up.`;

  const byNamespace = new Map<string, Array<LocKey>>();
  dead.forEach((key) => {
    const namespace = key.path.split(".")[0];
    if (!byNamespace.has(namespace)) byNamespace.set(namespace, []);
    (byNamespace.get(namespace) as Array<LocKey>).push(key);
  });

  const sections = Array.from(byNamespace.keys()).sort().map((namespace) => {
    const keys = byNamespace.get(namespace) as Array<LocKey>;
    return `${namespace}.*  (${keys.length})\n${formatKeys(keys)}`;
  });

  return (
    `${dead.length} dead localization string(s) in ${product.referenceLocaleFile}.\n` +
    `Delete each from every locale file in that folder, then drop its entry from\n` +
    `${product.allowlistFile}\n\n` +
    sections.join("\n\n")
  );
}

function formatKeys(keys: Array<LocKey>): string {
  return keys.map((key) => `  ${key.path}  (english.ts:${key.line})`).join("\n");
}

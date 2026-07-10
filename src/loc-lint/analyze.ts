import { collectDynamicNamespaces } from "./literals";
import { AnalyzeResult, Evidence, LocKey, LocLintConfig } from "./types";

/**
 * Matches a key against every evidence provider in turn. A key is used if any
 * provider vouches for it; only a key nobody vouches for is reported.
 */
export function getEvidence(key: string, literals: Set<string>, config: LocLintConfig): Evidence {
  if (literals.has(key)) return "literal";
  const segments = key.split(".");
  const resolver = config.resolvers[segments[0]];
  if (!!resolver && resolver(key, segments, { literals: literals })) return "resolver";
  if (Object.prototype.hasOwnProperty.call(config.allowlist, key)) return "allowlist";
  return null;
}

export function analyze(keys: Array<LocKey>, literals: Set<string>, config: LocLintConfig): AnalyzeResult {
  const unused: Array<LocKey> = [];
  const allowlisted: Array<LocKey> = [];
  const stillNeeded = new Set<string>();

  keys.forEach((key) => {
    const evidence = getEvidence(key.path, literals, config);
    if (evidence === null) {
      unused.push(key);
    } else if (evidence === "allowlist") {
      allowlisted.push(key);
      stillNeeded.add(key.path);
    }
  });

  const obsoleteAllowlist = Object.keys(config.allowlist)
    .filter((key) => !stillNeeded.has(key))
    .sort();

  const known = new Set(keys.map((key) => key.path.split(".")[0]));
  const unresolvedDynamicNamespaces = Array.from(collectDynamicNamespaces(literals))
    .filter((ns) => known.has(ns) && !config.resolvers[ns])
    .sort();

  return { unused, allowlisted, obsoleteAllowlist, unresolvedDynamicNamespaces };
}

/**
 * Product-agnostic types for the localization linter.
 *
 * The linter answers one question: which keys in a product's reference locale
 * file are no longer reachable from its source? Nothing in `loc-lint/` outside
 * `products/` knows about SurveyJS.
 */

/** A single translatable leaf in the reference locale file. */
export interface LocKey {
  /** Dotted path, e.g. `pe.enterNewValue`. */
  path: string;
  /** 1-based line in the locale file, so reports are clickable. */
  line: number;
}

export interface ResolverContext {
  /** Every string literal in the product source, for resolvers that need it. */
  literals: Set<string>;
}

/**
 * Decides whether a key is reachable through a dynamic lookup that no static
 * scan can see, e.g. `getString("qt." + questionType)`. Receives the full
 * dotted path and its segments (segments[0] is the namespace).
 */
export type KeyResolver = (path: string, segments: Array<string>, context: ResolverContext) => boolean;

/** Why a key is considered used. `null` means it is not. */
export type Evidence = "literal" | "resolver" | "allowlist" | null;

export interface LocLintConfig {
  /**
   * Resolvers keyed by namespace (the first path segment). A namespace without
   * a resolver relies on literal matching alone.
   */
  resolvers: Record<string, KeyResolver>;
  /** Dead-or-dynamic keys accepted on purpose, mapped to the reason why. */
  allowlist: Record<string, string>;
}

/** Everything the runner needs to check one product. */
export interface LocLintProduct extends LocLintConfig {
  /** Shown in reports, and the name passed on the command line. */
  name: string;
  /** Absolute path of the locale file that defines every key. */
  referenceLocaleFile: string;
  /** Name of the exported object literal inside that file. */
  referenceLocaleExport: string;
  /** Absolute paths of every directory whose source may consume a string. */
  sourceRoots: Array<string>;
  /** File extensions scanned for string literals. */
  sourceExtensions: Array<string>;
  /** Directory names skipped anywhere under `sourceRoots`. */
  skipDirs: Array<string>;
  /** Absolute path of the allowlist JSON, so the runner can name it in errors. */
  allowlistFile: string;
}

export interface AnalyzeResult {
  /** Keys with no evidence at all. Non-empty means CI should fail. */
  unused: Array<LocKey>;
  /**
   * Keys that exist only because the allowlist vouches for them. The reason
   * text decides what each one means -- a live dynamic lookup, or a dead string
   * nobody has deleted yet -- so the caller, not the core, interprets them.
   */
  allowlisted: Array<LocKey>;
  /**
   * Allowlist entries that no longer earn their place: the key was deleted, or
   * it became reachable again. Keeps the baseline from rotting.
   */
  obsoleteAllowlist: Array<string>;
  /**
   * Namespaces built dynamically in source (a `"ns."` literal exists) that have
   * no resolver. Their keys can never be proven used, so a resolver is owed.
   */
  unresolvedDynamicNamespaces: Array<string>;
}

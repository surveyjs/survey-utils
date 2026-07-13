export * from "./types";
export * from "./inventory";
export * from "./literals";
export * from "./analyze";
export * from "./files";
export * from "./run";
export * from "./paths";
export * from "./dom";

import { LocLintProduct } from "./types";
import { createCreatorProduct } from "./products/creator";
import { createLibraryProduct } from "./products/library";
import { createAnalyticsProduct } from "./products/analytics";

/**
 * Products this linter knows how to check. Each entry is a factory because
 * building the registries requires loading (and sometimes instantiating) the
 * product's bundle -- too expensive to do for a product nobody asked for.
 *
 * To add survey-pdf, drop a module into `products/` that exports a
 * `LocLintProduct` and register it here.
 */
export const products: Record<string, () => LocLintProduct> = {
  library: createLibraryProduct,
  creator: createCreatorProduct,
  analytics: createAnalyticsProduct,
};

/**
 * Accepted spellings that are not the product's own name. `dashboard` is what
 * survey-analytics was called here first; scripts and CI jobs still pass it.
 */
export const productAliases: Record<string, string> = {
  dashboard: "analytics",
};

/**
 * The registry name behind whatever the caller typed, or undefined if nothing
 * answers to it.
 */
export function resolveProductName(name: string): string | undefined {
  const canonical = productAliases[name] || name;
  return products[canonical] ? canonical : undefined;
}

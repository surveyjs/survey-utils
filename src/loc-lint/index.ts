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

/**
 * Products this linter knows how to check. Each entry is a factory because
 * building the registries requires loading (and sometimes instantiating) the
 * product's bundle -- too expensive to do for a product nobody asked for.
 *
 * To add survey-library, survey-pdf or survey-analytics, drop a module into
 * `products/` that exports a `LocLintProduct` and register it here.
 */
export const products: Record<string, () => LocLintProduct> = {
  library: createLibraryProduct,
  creator: createCreatorProduct,
};

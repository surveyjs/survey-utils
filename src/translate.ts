import { existsSync } from "fs";
import { join } from "path";
import { ProductRootError, productRoot } from "./paths";
import { setTranslationKey } from "./localization-utils";
import { translateFiles } from "./index";

/**
 * Translates the localization files of a SurveyJS product.
 *
 *   survey-utils translate library
 *   survey-utils translate creator --key <azure translator subscription key>
 *   survey-utils translate library --path ../../LibV3/survey-library
 *
 * The key may also come from TRANSLATION_API_KEY (environment or .env); --key wins.
 *
 * `--path` is the root of the product's repo -- the same thing it means in every other
 * command -- and the product's localization folder is joined onto it. Without --path
 * the repo is looked up next to this package, the layout of a local SurveyJS checkout.
 * A product that calls the bin from its own package.json has no such siblings, so it
 * passes --path.
 */

/** Where each product keeps its locale files, relative to the root of its repo. */
const productPaths: { [name: string]: { repo: string; localization: string } } = {
  library: {
    repo: "survey-library",
    localization: "packages/survey-core/src/localization",
  },
  creator: {
    repo: "survey-creator",
    localization: "packages/survey-creator-core/src/localization",
  },
  "creator-presets": {
    repo: "survey-creator",
    localization: "packages/survey-creator-core/src/ui-preset-editor/localization",
  },
  analytics: {
    repo: "survey-analytics",
    localization: "src/analytics-localization",
  },
};

export const translateProducts = Object.keys(productPaths);

export class TranslateUsageError extends Error { }

interface TranslateArgs {
  product: string;
  path?: string;
  key?: string;
}

function parseArgs(args: string[]): TranslateArgs {
  const res: Partial<TranslateArgs> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = (): string => {
      const next = args[++i];
      if (next === undefined || next.indexOf("--") === 0) throw new TranslateUsageError(arg + " needs a value");
      return next;
    };
    if (arg === "--key") {
      res.key = value();
    } else if (arg === "--path") {
      res.path = value();
    } else if (arg.indexOf("--") === 0) {
      throw new TranslateUsageError("Unknown option: " + arg);
    } else if (res.product) {
      throw new TranslateUsageError("Only one product at a time, got: " + res.product + " and " + arg);
    } else {
      res.product = arg;
    }
  }
  // --path is a repo root, not a locale folder, so it cannot name the product by itself.
  if (!res.product) {
    throw new TranslateUsageError("No product. Known products: " + translateProducts.join(", "));
  }
  if (!productPaths[res.product]) {
    throw new TranslateUsageError("Unknown product: " + res.product + ". Known: " + translateProducts.join(", "));
  }
  return <TranslateArgs>res;
}

export function runTranslate(args: string[]): number {
  const parsed = parseArgs(args);
  if (!!parsed.key) setTranslationKey(parsed.key);

  const product = productPaths[parsed.product];
  let path: string;
  try {
    path = join(productRoot(product.repo, parsed.path), product.localization);
  } catch (error) {
    // The checkout is not where we looked. The message says where; a stack adds nothing.
    if (!(error instanceof ProductRootError)) throw error;
    console.error(error.message);
    return 1;
  }
  if (!existsSync(path)) {
    console.error(`Localization folder not found: ${path}\n`
      + `--path must name the root of the ${product.repo} checkout, which holds `
      + `${product.localization}.`);
    return 1;
  }
  translateFiles(path);
  return 0;
}

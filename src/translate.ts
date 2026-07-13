import { existsSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { setTranslationKey } from "./localization-utils";
import { translateFiles } from "./index";

/**
 * Translates the localization files of a SurveyJS product.
 *
 *   survey-utils translate library
 *   survey-utils translate creator --key <azure translator subscription key>
 *   survey-utils translate --path ./src/localization --key <key>
 *
 * The key may also come from TRANSLATION_API_KEY (environment or .env); --key wins.
 *
 * Without --path, the localization folder is looked up next to this package -- the
 * layout of a local SurveyJS checkout, where survey-utils sits beside survey-library,
 * survey-creator and survey-analytics. A product installed from npm has no such
 * siblings, so it passes --path instead.
 */

/** Localization folder of each known product, relative to the SurveyJS checkout root. */
const productPaths: { [name: string]: string } = {
  library: "survey-library/packages/survey-core/src/localization",
  creator: "survey-creator/packages/survey-creator-core/src/localization",
  "creator-presets": "survey-creator/packages/survey-creator-core/src/ui-preset-editor/localization",
  analytics: "survey-analytics/src/analytics-localization",
};

export const translateProducts = Object.keys(productPaths);

export class TranslateUsageError extends Error { }

interface TranslateArgs {
  product?: string;
  path?: string;
  key?: string;
}

function parseArgs(args: string[]): TranslateArgs {
  const res: TranslateArgs = {};
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
  if (!res.product && !res.path) {
    throw new TranslateUsageError("No product. Known products: " + translateProducts.join(", ")
      + ". Or name a localization folder with --path <dir>.");
  }
  if (!!res.product && !productPaths[res.product]) {
    throw new TranslateUsageError("Unknown product: " + res.product + ". Known: " + translateProducts.join(", "));
  }
  return res;
}

function getLocalizationPath(args: TranslateArgs): string {
  if (!!args.path) {
    return isAbsolute(args.path) ? args.path : resolve(process.cwd(), args.path);
  }
  // dist/ -> the package -> the checkout root the sibling products live in.
  return join(__dirname, "..", "..", productPaths[args.product as string]);
}

export function runTranslate(args: string[]): number {
  const parsed = parseArgs(args);
  if (!!parsed.key) setTranslationKey(parsed.key);

  const path = getLocalizationPath(parsed);
  if (!existsSync(path)) {
    console.error("Localization folder not found: " + path
      + (!!parsed.path ? "" : "\nPass --path <dir> when the product is not checked out next to survey-utils."));
    return 1;
  }
  translateFiles(path);
  return 0;
}

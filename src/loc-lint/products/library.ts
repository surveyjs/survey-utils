import * as path from "path";
import { installDom } from "../dom";
import { allowlistPath, productRoot, readAllowlist, requireBundle } from "../paths";
import { KeyResolver, LocLintProduct } from "../types";

const PRODUCT = "library";
const buildHint = "cd packages/survey-core && npm run build   (in the survey-library repo)";

/**
 * Every localization key reachable through survey-core's localizable-string
 * mechanism. A `@property({ localizable: { defaultStr: true } })` declaration
 * looks its default text up by the property NAME (a bare identifier, invisible
 * to the literal scan); `{ defaultStr: "key" }` uses a quoted key (already a
 * literal). Both surface here as a LocalizableString's `localizationName`.
 *
 * Harvested from live instances because the strings are created lazily, on
 * first access of the `loc<Name>` getter, and many localizable properties are
 * `@property` decorators that never reach the Serializer's property list.
 */
function collectLocalizationNames(bundlePath: string): Set<string> {
  installDom();
  const core = requireBundle(bundlePath, buildHint);
  const { Serializer, ElementFactory, SurveyModel } = core;
  const names = new Set<string>();

  const harvest = (obj: any): void => {
    if (!obj) return;
    // Force every `loc<Name>` accessor so its LocalizableString gets created.
    for (let proto = obj; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      Object.getOwnPropertyNames(proto).forEach((member) => {
        if (!/^loc[A-Z]/.test(member)) return;
        const descriptor = Object.getOwnPropertyDescriptor(proto, member);
        if (!descriptor || typeof descriptor.get !== "function") return;
        try {
          const locStr = obj[member];
          if (!!locStr && !!locStr.localizationName) names.add(locStr.localizationName);
        } catch {
          /* accessor may throw without a fuller object graph; skip it */
        }
      });
    }
    const strings = obj["localizableStrings"];
    if (!!strings) {
      Object.keys(strings).forEach((key) => {
        const name = strings[key] && strings[key].localizationName;
        if (!!name) names.add(name);
      });
    }
  };

  harvest(new SurveyModel({}));
  // Container/child classes that carry their own localizable strings.
  ["page", "panel", "paneldynamic", "matrixdropdowncolumn", "itemvalue", "multipletextitem"].forEach((type) => {
    try { harvest(Serializer.createClass(type)); } catch { /* not registered in this build */ }
  });
  ElementFactory.Instance.getAllTypes().forEach((type: string) => {
    try { harvest(ElementFactory.Instance.createElement(type === "default" ? "text" : type, "q")); } catch { /* skip */ }
  });

  return names;
}

export function createLibraryProduct(repoRoot?: string): LocLintProduct {
  const pkg = (name: string, ...rest: Array<string>) =>
    path.join(productRoot("survey-library", repoRoot), "packages", name, ...rest);
  const localizationNames = collectLocalizationNames(pkg("survey-core", "build", "survey.core.js"));

  // Flat keys: the whole key is one segment, so a single catch-all resolver
  // handles the entire table.
  const anyKey: KeyResolver = (key) => localizationNames.has(key);

  return {
    name: PRODUCT,
    referenceLocaleFile: pkg("survey-core", "src", "localization", "english.ts"),
    referenceLocaleExport: "englishStrings",
    // survey-core plus every renderer that may consume its strings. survey-js-ui
    // is a thin repackage whose only source is `entries/`.
    sourceRoots: [
      pkg("survey-core", "src"),
      pkg("survey-react-ui", "src"),
      pkg("survey-vue3-ui", "src"),
      pkg("survey-angular-ui", "src"),
      pkg("survey-js-ui", "entries"),
    ],
    sourceExtensions: [".ts", ".tsx", ".vue", ".html"],
    skipDirs: ["localization", "node_modules", "build", "tests"],
    resolvers: { "*": anyKey },
    allowlist: readAllowlist(PRODUCT),
    allowlistFile: allowlistPath(PRODUCT),
  };
}

import * as path from "path";
import { installDom } from "../dom";
import { readAllowlist, allowlistPath, requireBundle, siblingRepo } from "../paths";
import { KeyResolver, LocLintProduct, ResolverContext } from "../types";

const PRODUCT = "creator";
const creatorCore = siblingRepo("survey-creator", "packages", "survey-creator-core");

const bundlePath = path.join(creatorCore, "build", "survey-creator-core.js");
const surveyCorePath = path.join(creatorCore, "node_modules", "survey-core");
const buildHint = "cd packages/survey-creator-core && npm run build   (in the survey-creator repo)";

/**
 * Catch-all property-grid tab; see `otherTabName` in
 * survey-creator-core/src/question-editor/properties.ts.
 */
const OTHER_TAB_NAME = "others";

/**
 * Runtime registries, read from the built bundle rather than re-parsed from
 * source, so a property added in survey-core immediately counts as a use of the
 * matching `pe.*` / `pehelp.*` / `p.*` string.
 */
function buildRegistries() {
  // The creator model touches `window` while constructing; install a DOM first.
  installDom();
  const creator = requireBundle(bundlePath, buildHint);
  // Same module instance the bundle resolved, so it sees the creator's own classes.
  const core = requireBundle(surveyCorePath, buildHint);
  const { Serializer, ElementFactory } = core;

  const propertyNames = new Set<string>();
  const propertyCategories = new Set<string>();
  const propertyValues = new Set<string>(["true", "false"]);
  const classNames = new Set<string>();

  Serializer.getAllClasses().forEach((className: string) => {
    classNames.add(className);
    Serializer.getProperties(className).forEach((property: any) => {
      propertyNames.add(property.name);
      getStaticChoices(property).forEach((value) => propertyValues.add(value));
    });
  });

  // Property-grid tab captions (`pe.tabs.<name>`) are named by the grid
  // definitions -- the designer's, the theme tab's and the creator theme's --
  // not by any `category` on the serializer property.
  [
    creator.defaultPropertyGridDefinition,
    creator.themeModelPropertyGridDefinition,
    creator.creatorThemeModelPropertyGridDefinition,
  ].forEach((gridDefinition: any) => {
    Object.keys(gridDefinition.classes).forEach((className) => {
      const definition = gridDefinition.classes[className];
      (definition.tabs || []).forEach((tab: any) => propertyCategories.add(tab.name));
      (definition.properties || []).forEach((property: any) => {
        if (typeof property !== "string" && !!property.tab) propertyCategories.add(property.tab);
      });
    });
  });

  const model = new creator.SurveyCreatorModel({
    showTranslationTab: true,
    showLogicTab: true,
    showThemeTab: true,
    showJSONEditorTab: true,
  });

  const tabNames = new Set<string>(model.tabs.map((tab: any) => tab.id));
  const logicTypeNames = new Set<string>(
    new creator.SurveyLogic(model.survey, model).logicTypes.map((logicType: any) => logicType.name)
  );

  const questionTypes = new Set<string>(ElementFactory.Instance.getAllTypes());
  questionTypes.add("default");
  model.toolbox.items.forEach((item: any) => questionTypes.add(item.id));

  const toolboxCategories = new Set<string>(Object.keys(creator.QuestionToolbox.defaultCategories));
  // The bucket every uncategorized toolbox item falls into.
  toolboxCategories.add("general");
  model.toolbox.categories.forEach((category: any) => toolboxCategories.add(category.name));

  model.dispose();

  return {
    propertyNames,
    propertyCategories,
    propertyValues,
    classNames,
    tabNames,
    logicTypeNames,
    questionTypes,
    toolboxCategories,
    // `and` / `or` join conditions in the expression editor; they are not in
    // `settings.operators` but reach `getString("op." + operator)` all the same.
    operators: new Set<string>(Object.keys(creator.settings.operators).concat(["and", "or"])),
    themeColors: collectPaletteColors(creator),
    creatorThemeNames: new Set<string>(creator.defaultCreatorThemesOrder),
    themeNames: new Set<string>(creator.defaultThemesOrder),
  };
}

type Registries = ReturnType<typeof buildRegistries>;

/**
 * Choice values a property can take. Choices supplied by a callback depend on a
 * live object, so they are skipped -- their `pv.*` strings fall to the allowlist.
 */
function getStaticChoices(property: any): Array<string> {
  if (!property.hasChoices) return [];
  let choices: Array<any> | undefined = undefined;
  try {
    choices = property.getChoices(null);
  } catch {
    return [];
  }
  if (!Array.isArray(choices)) return [];
  return choices
    .map((choice: any) => (!!choice && typeof choice === "object" ? choice.value : choice))
    .filter((value: any) => typeof value === "string");
}

/** Color names offered by the theme tab, across every palette. */
function collectPaletteColors(creator: any): Set<string> {
  const colors = new Set<string>();
  [creator.PredefinedColors, creator.PredefinedBackgroundColors].forEach((palettes: any) => {
    Object.keys(palettes).forEach((palette) => {
      Object.keys(palettes[palette]).forEach((color) => colors.add(color));
    });
  });
  return colors;
}

/**
 * `pe.title`, `pe.addNew@choices`, `pe.tabs.general`, `pe.text.name`.
 * `allowSuffixes` covers the two `pe`-only fallbacks in editorLocalization.ts:
 * `loc.pe[propName + "_placeholder"]` and `loc.pe[propType + "Help"]`.
 */
function isPropertyPath(registries: Registries, segments: Array<string>, context: ResolverContext, allowSuffixes: boolean): boolean {
  const namespace = segments[0];
  const rest = segments.slice(1);
  if (rest.length === 1) {
    const name = rest[0];
    if (registries.propertyNames.has(name)) return true;
    // `"pe.addNew@" + prop.name` -- matrices.ts. The base must exist literally.
    const at = name.indexOf("@");
    if (at > -1) {
      return context.literals.has(`${namespace}.${name.slice(0, at)}`) && registries.propertyNames.has(name.slice(at + 1));
    }
    if (!allowSuffixes) return false;
    if (name.endsWith("_placeholder")) return registries.propertyNames.has(name.slice(0, -"_placeholder".length));
    return name.endsWith("Help");
  }
  // Property-grid tab captions: `pe.tabs.<category>`, optionally per class. A
  // panel is named either after a category declared in a grid definition, or
  // after the complex property it was generated from (`validators`, `visibleIf`).
  if (rest[0] === "tabs") {
    return registries.propertyCategories.has(rest[1]) ||
      registries.propertyNames.has(rest[1]) ||
      rest[1] === OTHER_TAB_NAME;
  }
  // Per-class overrides: `pe.text.name`, `pe.matrixdropdowncolumn@default.name`.
  const className = rest[0].split("@")[0];
  return registries.classNames.has(className) && registries.propertyNames.has(rest[1]);
}

function buildResolvers(registries: Registries): Record<string, KeyResolver> {
  return {
    // `getLocString("qt." + item.id)` -- toolbox.ts
    qt: (_path, segments) => registries.questionTypes.has(segments[1]),

    // `locTitle.localizationName = "toolboxCategories." + name` -- toolbox.ts
    toolboxCategories: (_path, segments) => registries.toolboxCategories.has(segments[1]),

    // `"tabs." + tabName` -- tabbed-menu.ts
    tabs: (_path, segments) => registries.tabNames.has(segments[1]),

    // `getStringByPath(["pe", propName])` -- editorLocalization.ts
    pe: (_path, segments, context) => isPropertyPath(registries, segments, context, true),
    pehelp: (_path, segments, context) => isPropertyPath(registries, segments, context, false),
    peplaceholder: (_path, segments, context) => isPropertyPath(registries, segments, context, false),

    // `getStringByPath(["p", strName])`, values are either a string or {name, title}.
    p: (_path, segments) => {
      if (!registries.propertyNames.has(segments[1])) return false;
      return segments.length === 2 || (segments.length === 3 && ["name", "title"].indexOf(segments[2]) > -1);
    },

    // `getStringByPath(["pv", propName, value])` and the flat `pv.<value>` fallback.
    pv: (_path, segments) => {
      if (segments.length === 2) return registries.propertyValues.has(segments[1]);
      return registries.propertyNames.has(segments[1]) && registries.propertyValues.has(segments[2]);
    },

    // `getString("op." + name)` -- condition-survey.ts, expressionToDisplayText.ts
    op: (_path, segments) => registries.operators.has(segments[1]),

    // `getValueInternal(name, "validators" | "triggers")` -- editorLocalization.ts
    validators: (_path, segments) => registries.classNames.has(segments[1]),
    triggers: (_path, segments) => registries.classNames.has(segments[1]),

    // `getLogicString(name)` -> `"ed.lg." + name`, where name is a logic type
    // plus a suffix, or a literal such as "trigger_setvalueEmptyText".
    ed: (_path, segments, context) => {
      if (segments[1] !== "lg" || segments.length < 3) return false;
      const name = segments.slice(2).join(".");
      if (context.literals.has(name)) return true;
      return ["Name", "Description", "Text"].some(
        (suffix) => name.endsWith(suffix) && registries.logicTypeNames.has(name.slice(0, -suffix.length))
      );
    },

    // `getLocString("theme.names." + theme)`, `getLocString("theme.colors." + colorName)`
    theme: (_path, segments) => {
      if (segments[1] === "colors") return registries.themeColors.has(segments[2]);
      if (segments[1] === "names") return registries.themeNames.has(segments[2]);
      return false;
    },

    // `getLocString("creatortheme.names." + theme)` -- creator-theme-model.ts
    creatortheme: (_path, segments) =>
      segments[1] === "names" && registries.creatorThemeNames.has(segments[2]),
  };
}

/** Built lazily: constructing the creator model is expensive and needs a DOM. */
export function createCreatorProduct(): LocLintProduct {
  const registries = buildRegistries();
  const renderer = (name: string) => siblingRepo("survey-creator", "packages", name, "src");
  return {
    name: PRODUCT,
    referenceLocaleFile: path.join(creatorCore, "src", "localization", "english.ts"),
    referenceLocaleExport: "enStrings",
    // Every package that may consume a creator string. A key referenced only
    // from tests or from the locale files themselves is dead, so those are out.
    sourceRoots: [
      path.join(creatorCore, "src"),
      renderer("survey-creator-react"),
      renderer("survey-creator-vue"),
      renderer("survey-creator-angular"),
      renderer("survey-creator-js"),
    ],
    sourceExtensions: [".ts", ".tsx", ".vue", ".html"],
    skipDirs: ["localization", "node_modules", "build"],
    resolvers: buildResolvers(registries),
    allowlist: readAllowlist(PRODUCT),
    allowlistFile: allowlistPath(PRODUCT),
  };
}

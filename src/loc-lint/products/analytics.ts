import * as path from "path";
import { allowlistPath, readAllowlist, siblingRepo } from "../paths";
import { KeyResolver, LocLintProduct } from "../types";

const PRODUCT = "dashboard";
const analyticsSrc = siblingRepo("survey-analytics", "src");

/**
 * survey-analytics (the Dashboard) builds several keys dynamically from a small
 * set of enums. Unlike creator/library there is no clean registry to query at
 * runtime -- the chart types live behind Plotly, which will not import under
 * Node -- so the resolver is static:
 *
 *   getString("visualizer_" + visualizer.type)   // alternativeVizualizersWrapper.ts
 *   getString("chartType_" + chartType)          // selectBase.ts, number.ts
 *   getString(`${type}DownloadCaption`)          // tables/tabulator.ts
 *   getString("intervalMode_" + intervalMode)    // histogram.ts
 *   getString("topNValueText" + value)           // selectBase.ts
 *
 * A visualizer's `type`, a chart `type`, and a download `type` are each assigned
 * as a string literal in source, so the suffix must appear in the literal set.
 * Interval modes and top-N values are closed numeric/enum lists that do NOT all
 * appear as reusable literals, so they are matched against the source-of-truth
 * arrays copied below.
 */

// HistogramModel.intervalModes -- src/histogram.ts. Excludes the internal
// sentinels "default" (no grouping) and "custom" (hasCustomIntervals), which
// are never rendered through getString("intervalMode_" + ...).
const INTERVAL_MODES = new Set(["auto", "decades", "years", "quarters", "months", "days"]);

// SelectBase.topNValuesDefaults -- src/selectBase.ts.
const TOP_N_VALUES = new Set(["-1", "5", "10", "20"]);

const VISUALIZER_PREFIX = "visualizer_";
const CHART_TYPE_PREFIX = "chartType_";
const INTERVAL_MODE_PREFIX = "intervalMode_";
const TOP_N_PREFIX = "topNValueText";
const DOWNLOAD_SUFFIX = "DownloadCaption";

/** Flat keys: the whole key is one segment, dispatched here by prefix/suffix. */
const anyKey: KeyResolver = (key, _segments, context) => {
  // The dynamic part is a visualizer/chart/download type, always a source literal.
  if (key.startsWith(VISUALIZER_PREFIX)) return context.literals.has(key.slice(VISUALIZER_PREFIX.length));
  if (key.startsWith(CHART_TYPE_PREFIX)) return context.literals.has(key.slice(CHART_TYPE_PREFIX.length));
  if (key.endsWith(DOWNLOAD_SUFFIX)) return context.literals.has(key.slice(0, -DOWNLOAD_SUFFIX.length));
  // Closed enums.
  if (key.startsWith(INTERVAL_MODE_PREFIX)) return INTERVAL_MODES.has(key.slice(INTERVAL_MODE_PREFIX.length));
  if (key.startsWith(TOP_N_PREFIX)) return TOP_N_VALUES.has(key.slice(TOP_N_PREFIX.length));
  return false;
};

export function createDashboardProduct(): LocLintProduct {
  return {
    name: PRODUCT,
    referenceLocaleFile: path.join(analyticsSrc, "analytics-localization", "english.ts"),
    referenceLocaleExport: "englishStrings",
    // survey-analytics is a single package; its strings are consumed only here.
    sourceRoots: [analyticsSrc],
    sourceExtensions: [".ts", ".tsx", ".vue", ".html"],
    skipDirs: ["analytics-localization", "node_modules", "build"],
    resolvers: { "*": anyKey },
    allowlist: readAllowlist(PRODUCT),
    allowlistFile: allowlistPath(PRODUCT),
  };
}

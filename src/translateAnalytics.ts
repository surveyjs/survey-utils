// Kept for run_translate_analytics.cmd. `survey-utils translate analytics` is the same run.
import { runTranslate } from "./translate";

process.exitCode = runTranslate(["analytics", ...process.argv.slice(2)]);

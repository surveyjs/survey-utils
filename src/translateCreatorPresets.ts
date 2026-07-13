// Kept for run_translate_creator_presets.cmd. `survey-utils translate creator-presets` is the same run.
import { runTranslate } from "./translate";

process.exitCode = runTranslate(["creator-presets", ...process.argv.slice(2)]);

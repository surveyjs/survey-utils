// Kept for run_translate_creator.cmd. `survey-utils translate creator` is the same run.
import { runTranslate } from "./translate";

process.exitCode = runTranslate(["creator", ...process.argv.slice(2)]);

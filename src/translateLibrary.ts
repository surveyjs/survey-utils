// Kept for run_translate_library.cmd. `survey-utils translate library` is the same run.
import { runTranslate } from "./translate";

process.exitCode = runTranslate(["library", ...process.argv.slice(2)]);

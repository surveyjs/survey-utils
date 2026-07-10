import * as fs from "fs";
import * as path from "path";

export interface ListFilesOptions {
  /** File extensions to keep, with the leading dot. */
  extensions: Array<string>;
  /** Directory names skipped anywhere in the tree. */
  skipDirs?: Array<string>;
}

/** Recursive directory walk. Missing roots are skipped, not fatal: some renderers are optional. */
export function listFiles(roots: Array<string>, options: ListFilesOptions): Array<string> {
  const skipDirs = new Set(options.skipDirs || []);
  const result: Array<string> = [];

  const walk = (dir: string): void => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(full);
      } else if (options.extensions.indexOf(path.extname(entry.name)) > -1) {
        result.push(full);
      }
    });
  };

  roots.filter((root) => fs.existsSync(root)).forEach(walk);
  return result.sort();
}

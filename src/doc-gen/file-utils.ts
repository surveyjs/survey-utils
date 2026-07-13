import * as fs from "fs";
import * as path from "path";
import { FileMap } from "./types";

export function printError(text: string): void {
  console.log(text);
}

export function checkFiles(fileNames: string[], errorText: string): boolean {
  if (!Array.isArray(fileNames)) {
    printError("file list is empty");
    return false;
  }
  for (let i = 0; i < fileNames.length; i++) {
    const absFileName = getAbsoluteFileName(fileNames[i]);
    if (!fs.existsSync(absFileName)) {
      printError(errorText + ": " + absFileName);
      return false;
    }
  }
  return true;
}
/** Entry files and output directories resolve against the working directory: consumers run the CLI from their own package. */
export function getAbsoluteFileName(name: string): string {
  return path.isAbsolute(name) ? name : path.join(process.cwd(), name);
}
/** Resolves a directory against the working directory without touching the disk. */
export function resolveDir(dir: string): string {
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}
/** Resolves a directory against the working directory and creates it when missing. */
export function ensureDir(dir: string): string {
  const absDir = resolveDir(dir);
  if (!fs.existsSync(absDir)) {
    fs.mkdirSync(absDir, { recursive: true });
  }
  return absDir;
}
/** Writes every entry of a FileMap, creating the directories it needs. */
export function writeFiles(files: FileMap): string[] {
  const written: string[] = [];
  Object.keys(files).forEach((filePath) => {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, files[filePath]);
    written.push(filePath);
  });
  return written;
}
/** File paths whose on-disk content differs from the generated one (missing counts as different). */
export function diffFiles(files: FileMap): string[] {
  return Object.keys(files).filter((filePath) => {
    if (!fs.existsSync(filePath)) return true;
    return fs.readFileSync(filePath, "utf8") !== files[filePath];
  });
}

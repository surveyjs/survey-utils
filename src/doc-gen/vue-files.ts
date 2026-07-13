import * as fs from "fs";
import * as path from "path";
import { getAbsoluteFileName } from "./file-utils";

/**
 * Extracts the `<script lang="ts">` block of every .vue file the entries import
 * into a sibling .ts file, so the TypeScript program can see it. The generated
 * files are collected in `generatedFiles` and removed by deleteVueTSFiles().
 */
export function generateVueTSFiles(generatedFiles: string[], fileNames: string[]): void {
  for (let i = 0; i < fileNames.length; i++) {
    const fn = fileNames[i];
    let text: string = fs.readFileSync(getAbsoluteFileName(fn), "utf8");
    const dir = path.dirname(fn);
    generateVueTSFile(generatedFiles, text, dir);
    const matchArray = text.match(/(?<=export \* from ")(.*)(?=";)/gm);
    if (!Array.isArray(matchArray)) continue;
    for (let j = 0; j < matchArray.length; j++) {
      const fnChild = path.join(dir, matchArray[j] + ".ts");
      const absFnChild = getAbsoluteFileName(fnChild);
      if (!fs.existsSync(absFnChild)) return;
      text = fs.readFileSync(absFnChild, "utf8");
      generateVueTSFile(generatedFiles, text, dir);
    }
  }
}
function generateVueTSFile(generatedFiles: string[], text: string, dir: string): void {
  const matchArray = text.match(/(?<=")(.*)(?=.vue";)/gm);
  if (!Array.isArray(matchArray)) return;
  for (let i = 0; i < matchArray.length; i++) {
    const fileName = path.join(dir, matchArray[i] + ".vue");
    if (!fs.existsSync(fileName)) continue;
    let absFileName = getAbsoluteFileName(fileName);
    const vueText: string = fs.readFileSync(absFileName, "utf8");
    const startStr = "<script lang=\"ts\">";
    const endStr = "</script>";
    const startIndex = vueText.indexOf(startStr) + startStr.length;
    const endIndex = vueText.lastIndexOf(endStr);
    if (endIndex > startIndex && startIndex > 0) {
      const vue_tsText = vueText.substring(startIndex, endIndex);
      absFileName += ".ts";
      generatedFiles.push(absFileName);
      fs.writeFileSync(absFileName, vue_tsText);
    }
  }
}
export function deleteVueTSFiles(generatedFiles: string[]): void {
  for (let i = 0; i < generatedFiles.length; i++) {
    fs.unlinkSync(generatedFiles[i]);
  }
}
export function isNonEnglishLocalizationFile(fileName: string): boolean {
  const dir = path.dirname(fileName);
  const name = path.basename(fileName);
  if (name === "english") return false;
  const loc = "localization";
  return dir.lastIndexOf(loc) > dir.length - loc.length - 3;
}

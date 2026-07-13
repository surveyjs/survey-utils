import  { readdirSync as utils } from "fs";
import { ICommentInfo, LocalizationUtils } from "./localization-utils";
import { dirname, join } from "path";

// The API-doc generator, absorbed from surveyjs-doc-generator. Re-exported with
// its original names so a consumer can swap the dependency without rewriting its
// doc_generator wrapper; `survey-utils generate-doc` is the preferred route.
export {
  setJsonObj, generateDocumentation, generateMDFiles, buildModel, buildMDFiles,
  buildDocModelJSON, buildJSONDefinitionAST, buildJSONDefinitionRuntime, loadSerializer,
  DocEntry, DocEntryType, DocModel, DocOptions, MDGenerationOptions
} from "./doc-gen";
export { runCheckUnusedStrings } from "./checkUnusedStrings";

export function translateFile(fileName: string): void {
    new LocalizationUtils().translateFile(fileName, getEnglishJson(fileName), getEnglishTopComments(fileName));
}
export function translateFiles(path: string): void {
  const englishJson = getEnglishJson(path);
  const englishComments = getEnglishTopComments(path);
  utils(path).forEach(file => {
    if (file.endsWith(".ts") && file !== "nl-BE.ts" && file !== "tajik.ts") {
        new LocalizationUtils().translateFile(join(path, file), englishJson, englishComments);
    }
  });
}
export function updateEnglishFile(fileName: string): void {
    new LocalizationUtils().removeEnglishUnneededComments(fileName);
}
function getEnglishJson(fileName: string): any {
    fileName = getEnglishFileName(fileName);
    const text = new LocalizationUtils().readFile(fileName);
    return new LocalizationUtils().getJson(text);
}
function getEnglishTopComments(fileName: string): Array<ICommentInfo> {
    fileName = getEnglishFileName(fileName);
    const text = new LocalizationUtils().readFile(fileName);
    return new LocalizationUtils().readJsonComments(text);
}
function getEnglishFileName(fileName: string): string {
    const dir = fileName.endsWith(".ts") ? dirname(fileName) : fileName;
    return join(dir, "english.ts");
}


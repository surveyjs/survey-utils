import * as ts from "typescript";
import { DocEntry } from "./types";

/** Shared mutable state for a single doc-model build. */
export interface GenerationContext {
  checker: ts.TypeChecker;
  outputClasses: DocEntry[];
  outputPMEs: DocEntry[];
  pmesHash: { [fullName: string]: DocEntry };
  classesHash: { [className: string]: DocEntry };
  curClass: DocEntry | null;
  curJsonName: string | null;
  generateJSONDefinitionClasses: { [className: string]: boolean };
  outputDefinition: any;
  vueGeneratedFiles: string[];
}

import * as path from "path";
import {
  buildModel, buildMDFiles, generateDocumentation, setJsonObj,
  DocOptions, MDGenerationOptions
} from "../../src/doc-gen";
import * as fileUtils from "../../src/doc-gen/file-utils";

export interface DocsResult {
  classes: any[];
  pmes: any[];
  findClass(name: string): any;
  findMember(className: string, memberName: string): any;
  findPME(className: string, name: string): any;
  filterPMEs(className: string, name?: string): any[];
}

/**
 * Builds the doc model from tests/doc-gen/fixtures/<fixtureName>.entry.ts.
 *
 * The model is round-tripped through JSON, because that is what the emitters and
 * the classes.json/pmes.json outputs see: fields left `undefined` disappear.
 *
 * Fixtures are referenced through a one-line `export * from "./<name>";` entry
 * file because the model build visits entry files twice (once in the
 * all-source-files loop and once in the explicit entries loop), which would
 * duplicate every class declared directly inside an entry file.
 */
export function runDocGenerator(fixtureName: string, jsonObj: any = null): DocsResult {
  try {
    setJsonObj(jsonObj);
    const model = buildModel([entryFile(fixtureName)], {});
    if (!model) throw new Error("the fixture entry file was not found: " + fixtureName);
    const classes = JSON.parse(JSON.stringify(model.classes));
    const pmes = JSON.parse(JSON.stringify(model.pmes));
    return {
      classes: classes,
      pmes: pmes,
      findClass: (name: string) => classes.find((c: any) => c.name === name),
      findMember: (className: string, memberName: string) => {
        const cls = classes.find((c: any) => c.name === className);
        if (!cls || !Array.isArray(cls.members)) return undefined;
        return cls.members.find((m: any) => m.name === memberName);
      },
      findPME: (className: string, name: string) =>
        pmes.find((p: any) => p.className === className && p.name === name),
      filterPMEs: (className: string, name?: string) =>
        pmes.filter((p: any) => p.className === className && (!name || p.name === name))
    };
  } finally {
    setJsonObj(null);
  }
}

export function entryFile(fixtureName: string): string {
  return "tests/doc-gen/fixtures/" + fixtureName + ".entry.ts";
}

/** The generated markdown keyed by file name (e.g. "simplemodel.md"). */
export function runMDGenerator(
  classes: any[], pmes: any[], options: MDGenerationOptions = {}
): { [fileName: string]: string } {
  return byBaseName(buildMDFiles(classes, pmes, options));
}

/** Full paths of the files written by the last runFullGenerator call. */
export const lastWrittenPaths: string[] = [];

/**
 * Runs the whole generateDocumentation pipeline on a fixture and returns every
 * file it wrote, keyed by base name. The write step is stubbed, so nothing reaches
 * the disk and the default output directories can still be asserted; the full paths
 * are available in lastWrittenPaths.
 */
export function runFullGenerator(
  fixtureName: string, docOptions: DocOptions = {}
): { [fileName: string]: string } {
  let written: { [absPath: string]: string } = {};
  lastWrittenPaths.length = 0;
  const writeSpy = jest.spyOn(fileUtils, "writeFiles").mockImplementation((files) => {
    written = files;
    lastWrittenPaths.push(...Object.keys(files));
    return Object.keys(files);
  });
  try {
    generateDocumentation([entryFile(fixtureName)], {}, docOptions);
  } finally {
    writeSpy.mockRestore();
  }
  return byBaseName(written);
}

function byBaseName(files: { [absPath: string]: string }): { [fileName: string]: string } {
  const res: { [fileName: string]: string } = {};
  Object.keys(files).forEach((filePath) => { res[path.basename(filePath)] = files[filePath]; });
  return res;
}

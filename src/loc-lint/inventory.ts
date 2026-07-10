import * as ts from "typescript";
import { LocKey } from "./types";

/**
 * Flattens the object literal exported by a locale file into dotted leaf paths.
 *
 * Parsed rather than evaluated: locale files are `export var enStrings = {...}`
 * followed by unrelated statements, and we want line numbers for the report.
 */
export function collectLocaleKeys(sourceText: string, exportName?: string, fileName = "locale.ts"): Array<LocKey> {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const root = findObjectLiteral(sourceFile, exportName);
  if (!root) {
    throw new Error(`Cannot find an exported object literal${exportName ? ` named "${exportName}"` : ""} in ${fileName}`);
  }
  const keys: Array<LocKey> = [];
  visit(root, []);
  return keys;

  function visit(node: ts.ObjectLiteralExpression, prefix: Array<string>): void {
    node.properties.forEach((prop) => {
      if (!ts.isPropertyAssignment(prop)) return;
      const name = getPropertyName(prop.name);
      if (name === undefined) return;
      const path = prefix.concat([name]);
      if (ts.isObjectLiteralExpression(prop.initializer)) {
        visit(prop.initializer, path);
      } else {
        const line = sourceFile.getLineAndCharacterOfPosition(prop.getStart(sourceFile)).line + 1;
        keys.push({ path: path.join("."), line: line });
      }
    });
  }
}

function findObjectLiteral(sourceFile: ts.SourceFile, exportName?: string): ts.ObjectLiteralExpression | undefined {
  let result: ts.ObjectLiteralExpression | undefined = undefined;
  sourceFile.statements.forEach((statement) => {
    if (!!result || !ts.isVariableStatement(statement)) return;
    statement.declarationList.declarations.forEach((decl) => {
      if (!!result) return;
      if (!!exportName && (!ts.isIdentifier(decl.name) || decl.name.text !== exportName)) return;
      if (!!decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
        result = decl.initializer;
      }
    });
  });
  return result;
}

function getPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

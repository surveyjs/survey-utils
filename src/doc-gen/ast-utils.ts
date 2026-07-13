import * as ts from "typescript";
import { DocEntry } from "./types";

export function hasMembers(entry: DocEntry, name: string): boolean {
  if (!entry || !Array.isArray(entry.members)) return false;
  for (let i = 0; i < entry.members.length; i++) {
    if (entry.members[i].name === name) return true;
  }
  return false;
}
export function getJsonTypeName(node: ts.FunctionDeclaration): string | null {
  let body = node.getFullText();
  if (body) {
    let pos = body.indexOf('return "');
    if (pos > 0) {
      body = body.substr(pos + 'return "'.length);
      pos = body.indexOf('"');
      return body.substr(0, pos);
    }
  }
  return null;
}
export function isSurveyEventType(type: string | undefined): boolean {
  return !!type && (type.indexOf("Event") === 0 || type.indexOf("CreatorEvent") === 0);
}
export function getPMEType(nodeKind: ts.SyntaxKind): string {
  if (nodeKind === ts.SyntaxKind.MethodDeclaration || nodeKind === ts.SyntaxKind.MethodSignature) return "method";
  if (nodeKind === ts.SyntaxKind.FunctionDeclaration) return "function";
  return "property";
}
/**
 * True if this is visible outside this file, false otherwise.
 *
 * `ts.NodeFlags` has no `Export` member -- the original read `node.flags &
 * ts.NodeFlags["Export"]`, i.e. a mask of `undefined`, which is always 0 -- so
 * a node is "exported" here purely by sitting at the top level of a source file.
 */
export function isNodeExported(node: ts.Node): boolean {
  return !!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile;
}
export function isPMENodeExported(node: ts.Node, symbol: ts.Symbol): boolean {
  const modifier = ts.getCombinedModifierFlags(<ts.Declaration>node);
  if ((modifier & ts.ModifierFlags.Public) !== 0) return true;
  if (node.kind === ts.SyntaxKind.PropertyDeclaration) return true;
  if (isSymbolHasComments(symbol)) return true;
  const parent = node.parent;
  return !!parent && parent.kind === ts.SyntaxKind.InterfaceDeclaration;
}
/** True if there is a comment before declaration */
export function isSymbolHasComments(symbol: ts.Symbol): boolean {
  const com = symbol.getDocumentationComment(undefined);
  return !!com && com.length > 0;
}
export function isOptionsInterface(name: string): boolean {
  return name.indexOf("Options") > -1 || name.indexOf("Event") > -1;
}

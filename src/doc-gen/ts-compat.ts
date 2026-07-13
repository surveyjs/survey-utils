import * as ts from "typescript";

/**
 * The `ts.*` APIs whose shape changed between TypeScript 4.2 (which the
 * generator was written against) and 5.x. Both changes below fail *silently* --
 * no crash, just a doc model that quietly loses members or fills fields with
 * objects -- so they are isolated here rather than inlined at the call sites.
 */

/**
 * TypeScript 5.0 removed `node.decorators`; reading it now yields `undefined`
 * for every node, which would drop every `@property()`-declared member from the
 * model without any error.
 */
export function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  if (!ts.canHaveDecorators(node)) return [];
  return ts.getDecorators(node) || [];
}

/**
 * TypeScript 4.3 changed `JSDocTagInfo.text` from `string` to
 * `SymbolDisplayPart[]`. Assigning it straight into a DocEntry field would put
 * an array of parts where the JSON expects a string.
 *
 * Returns `undefined` -- not `""` -- for a tag without text (`@hidden`), so that
 * the field stays absent from the JSON exactly as it did under 4.2.
 */
export function jsDocTagText(tag: ts.JSDocTagInfo): string | undefined {
  if (!tag.text || tag.text.length === 0) return undefined;
  return ts.displayPartsToString(tag.text);
}

/**
 * `JSDocTag.comment` on a raw AST node is `string | NodeArray<JSDocComment>`
 * since TypeScript 4.4; it is an array whenever the comment contains a `{@link}`.
 */
export function jsDocCommentText(comment: string | ts.NodeArray<ts.JSDocComment> | undefined): string | undefined {
  if (comment === undefined) return undefined;
  if (typeof comment === "string") return comment;
  return comment.map((part) => part.text).join("");
}

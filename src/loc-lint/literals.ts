import * as ts from "typescript";

/**
 * Every string literal that appears in the product source, as written.
 *
 * TypeScript sources go through the parser rather than a regex so that keys
 * mentioned only in a commented-out line -- `// getString("qt." + type)` -- do
 * not count as usage. Templates and markup fall back to a regex, which is
 * enough because locale keys are plain ASCII with no escapes.
 */
export function collectStringLiterals(files: Array<string>, readFile: (path: string) => string): Set<string> {
  const literals = new Set<string>();
  files.forEach((file) => {
    const text = readFile(file);
    if (/\.tsx?$/.test(file)) {
      collectFromTypeScript(text, file, literals);
    } else {
      collectFromMarkup(text, literals);
    }
  });
  return literals;
}

function collectFromTypeScript(text: string, fileName: string, literals: Set<string>): void {
  const scriptKind = /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.add(node.text);
    } else if (ts.isTemplateExpression(node)) {
      // `ed.lg.${name}` -- the head carries the prefix we care about.
      literals.add(node.head.text);
      node.templateSpans.forEach((span) => literals.add(span.literal.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function collectFromMarkup(text: string, literals: Set<string>): void {
  // Fresh regex per file: a shared /g/ literal would carry `lastIndex` across calls.
  const literalRe = /["'`]([^"'`\r\n]{1,200})["'`]/g;
  const stripped = text.replace(/<!--[\s\S]*?-->/g, "");
  let match: RegExpExecArray | null;
  while ((match = literalRe.exec(stripped)) !== null) {
    literals.add(match[1]);
  }
}

/**
 * Literals that end in a dot -- `"ed.lg."`, `"qt."` -- betray a key assembled
 * at runtime. The namespace they open cannot be checked by literal matching, so
 * it needs a resolver.
 */
export function collectDynamicNamespaces(literals: Set<string>): Set<string> {
  const namespaces = new Set<string>();
  literals.forEach((literal) => {
    if (!literal.endsWith(".") || literal.length < 2) return;
    if (!/^[A-Za-z][A-Za-z0-9_.-]*\.$/.test(literal)) return;
    namespaces.add(literal.slice(0, -1).split(".")[0]);
  });
  return namespaces;
}

import * as fs from "fs";
import * as ts from "typescript";
import { SurveyBundle } from "./serializer-module";

/**
 * The expression operators.
 *
 * The names live in two static object literals on `OperandMaker` -- a class survey-core does
 * not export, and should not have to: it is internal, and making it public to feed a
 * documentation generator would put a permanent API commitment on the library for the
 * convenience of a build tool. The names are values in a source file rather than API
 * members, so they are read from the source, which survey-utils is already parsing for the
 * JSDoc.
 *
 * The source only supplies the *candidates*. Which of them is an operator an author may
 * actually write, and how it is spelled, is settled by `ConditionsParser` -- which survey-core
 * does export -- so the internal helpers (`arithmeticOp`, `containsCore`) drop out on their
 * own, and `greater` is reported as `>` because that is what the library renders it as.
 */

export interface OperatorFact {
  /** The operator as an author writes it, e.g. ">=". */
  name: string;
  /** Every accepted spelling, the canonical one first: ["==", "=", "equal"]. */
  forms: string[];
  isBinary: boolean;
}

export interface OperatorNames {
  binary: string[];
  unary: string[];
}

/** Symbol spellings put to the grammar. A lexical alphabet, not a table of meanings: what
 *  each symbol means is read back from the parser, and one it rejects never reaches the guide. */
const OPERATOR_SYMBOLS = [
  "+", "-", "*", "/", "%", "^", ">", "<", ">=", "<=", "==", "=", "!=", "<>"
];

/**
 * The operator names declared on `OperandMaker`, read off the AST of the file that declares
 * it. Returns empty lists when the sources are not available -- survey-creator generates docs
 * without survey-core's source tree, and an absent operator section is better than a wrong one.
 */
export function readOperatorNames(sourceFiles: string[], warnings: string[]): OperatorNames {
  const file = findOperandMakerFile(sourceFiles);
  if (!file) {
    warnings.push(
      "expressions.ts was not among the compiled sources: the operator list is omitted. "
      + "The guide reads the operator names from survey-core's source, not from its exports."
    );
    return { binary: [], unary: [] };
  }
  const res: OperatorNames = { binary: [], unary: [] };
  let source: ts.SourceFile;
  try {
    source = ts.createSourceFile(
      file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true
    );
  } catch (error) {
    warnings.push("could not read " + file + ": " + String(error));
    return res;
  }
  ts.forEachChild(source, (node: ts.Node) => {
    if (!ts.isClassDeclaration(node) || !node.name || node.name.text !== "OperandMaker") return;
    node.members.forEach((member) => {
      if (!ts.isPropertyDeclaration(member) || !member.name || !member.initializer) return;
      const name = member.name.getText(source);
      if (name !== "binaryFunctions" && name !== "unaryFunctions") return;
      if (!ts.isObjectLiteralExpression(member.initializer)) return;
      const keys = member.initializer.properties
        .map((prop) => (prop.name ? keyText(prop.name, source) : ""))
        .filter((key) => !!key);
      if (name === "binaryFunctions") res.binary = keys; else res.unary = keys;
    });
  });
  if (res.binary.length === 0 && res.unary.length === 0) {
    warnings.push("no operator tables found on OperandMaker in " + file);
  }
  return res;
}

/** The file that declares OperandMaker, as the compiler saw it -- not a path assembled here. */
function findOperandMakerFile(sourceFiles: string[]): string {
  const candidates = sourceFiles.filter((file) => /expressions\.ts$/.test(file.replace(/\\/g, "/")));
  for (let i = 0; i < candidates.length; i++) {
    try {
      if (fs.readFileSync(candidates[i], "utf8").indexOf("class OperandMaker") > -1) {
        return candidates[i];
      }
    } catch (error) {
      // A source the compiler listed but we cannot read is not the one we want.
    }
  }
  return "";
}

function keyText(name: ts.PropertyName, source: ts.SourceFile): string {
  const text = name.getText(source);
  // A key may be quoted in the literal; the operator is the string, not its quotes.
  return text.replace(/^["']|["']$/g, "");
}

/**
 * Turns the candidate names into the operators the guide states, using only survey-core's
 * public API to decide: a spelling the grammar rejects is not an operator, and
 * `Operand.toString()` renders the canonical form, which is what collapses `greater`/`>` and
 * `equal`/`=`/`==` onto one entry.
 */
export function extractOperators(
  names: OperatorNames, bundle: SurveyBundle, warnings: string[]
): OperatorFact[] {
  const Parser = bundle.ConditionsParser;
  if (!Parser) {
    warnings.push("the bundle has no ConditionsParser: the operator list is omitted.");
    return [];
  }
  const byToken: { [token: string]: OperatorFact } = {};
  const probe = (spelling: string, isBinary: boolean): void => {
    const token = canonicalOperator(Parser, spelling, isBinary);
    if (!token) return;
    if (!byToken[token]) byToken[token] = { name: token, forms: [], isBinary: isBinary };
    const forms = byToken[token].forms;
    if (forms.indexOf(spelling) < 0) {
      // The canonical spelling leads; the aliases follow it.
      if (spelling === token) forms.unshift(spelling); else forms.push(spelling);
    }
  };
  names.binary.forEach((name) => probe(name, true));
  OPERATOR_SYMBOLS.forEach((symbol) => probe(symbol, true));
  names.unary.forEach((name) => probe(name, false));
  return Object.keys(byToken).sort().map((token) => byToken[token]);
}

/**
 * The operator as the library itself writes it: `{a} greater 1` parses and comes back from
 * toString() as `({a} > 1)`, so the spellings of one operator collapse onto one token without
 * this code having to know that `greater` means `>`. An empty result means the grammar did not
 * accept the spelling, which is how the internal helpers are excluded.
 */
function canonicalOperator(Parser: any, spelling: string, isBinary: boolean): string {
  let text = "";
  try {
    const operand = new Parser().parseExpression("{a} " + spelling + (isBinary ? " 1" : ""));
    if (!operand) return "";
    text = String(operand.toString());
  } catch (error) {
    return "";
  }
  if (text.charAt(0) === "(" && text.charAt(text.length - 1) === ")") {
    text = text.substring(1, text.length - 1);
  }
  // The probe fixes the operands, so what is left between them is the operator.
  if (text.indexOf("{a}") !== 0) return "";
  text = text.substring(3).trim();
  if (isBinary) {
    if (text.lastIndexOf("1") !== text.length - 1) return "";
    text = text.substring(0, text.length - 1).trim();
  }
  return text;
}

/**
 * Candidate names no spelling reached: the arithmetic operators, which are written as symbols
 * (`plus` is `+`), and the internal helpers (`arithmeticOp`, `containsCore`), which are not
 * operators at all.
 *
 * Nothing reads this at generation time -- the tests do. An operator survey-core adds with a
 * *new symbol* and no word form is the one case that could silently miss the guide, so pinning
 * this list makes such an addition fail a test instead of quietly dropping out.
 */
export function wordlessOperators(names: OperatorNames, bundle: SurveyBundle): string[] {
  const Parser = bundle.ConditionsParser;
  if (!Parser) return [];
  return names.binary.map((name) => ({ name: name, binary: true }))
    .concat(names.unary.map((name) => ({ name: name, binary: false })))
    .filter((op) => !canonicalOperator(Parser, op.name, op.binary))
    .map((op) => op.name)
    .sort();
}

import ts from "typescript";

// Every literal rather than the `className` attributes: a `.ts` recipe spells its class list as a
// plain literal, which a reader watching JSX never looks at.

/**
 * Every whitespace-separated run inside a string or template literal of one module.
 *
 * Literals rather than the raw text, so a comment naming a class a sweep watches for cannot fail
 * that sweep.
 */
export function classTokensIn(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tokens: string[] = [];

  const push = (literal: string): void => {
    for (const token of literal.split(/\s+/)) if (token !== "") tokens.push(token);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) push(node.text);
    else if (ts.isTemplateExpression(node)) {
      push(node.head.text);
      for (const span of node.templateSpans) push(span.literal.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return tokens;
}

import ts from "typescript";

/**
 * Source text with every comment blanked, line breaks kept. A reader matching raw source finds an
 * attribute a JSDoc only names, and `openingTag` reads a `<` inside an opening tag's comment as a
 * lost brace count.
 */
export function blankComments(source: string, fileName = "component.tsx"): string {
  // Parsed rather than scanned: only the parser knows whether a `/` opens a regular expression or a
  // `}` closes a template's `${}`, and a `//` in either is code. JSX unless `fileName` names a module.
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false);
  // Offsets are UTF-16 code units, as `split("")` indexes them; `join` rejoins the lone surrogates.
  const out = source.split("");

  // A comment is trivia, which sits between one token's end and the next token's start: those before
  // the first line break TypeScript calls trailing, the rest leading.
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(file);
    if (children.length > 0) return children.forEach(visit);
    const trivia = [...(ts.getTrailingCommentRanges(source, node.pos) ?? []), ...(ts.getLeadingCommentRanges(source, node.pos) ?? [])];
    for (const { pos, end } of trivia) {
      for (let at = pos; at < end; at++) if (out[at] !== "\n") out[at] = " ";
    }
  };
  visit(file);

  return out.join("");
}

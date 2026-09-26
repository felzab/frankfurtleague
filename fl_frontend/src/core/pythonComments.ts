/**
 * Python source with every `#` comment cut, for a reader of its double-quoted literals.
 *
 * A cut inside a literal leaves an odd number of quotes on the line, which throws rather than passing
 * the stub on.
 */
export function withoutPythonComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const kept = line.replace(/#.*$/, "");
      const cutInsideALiteral = kept !== line && (kept.match(/"/g) ?? []).length % 2 !== 0;
      if (cutInsideALiteral) throw new Error(`a "#" inside a string literal was read as a comment: ${line.trim()}`);
      return kept;
    })
    .join("\n");
}

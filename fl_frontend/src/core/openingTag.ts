/**
 * One JSX opening tag, from `<Name` to the `>` that closes it. Braces are counted, so a `>` inside an
 * attribute expression — an arrow, a comparison, a nested element — does not end the tag early.
 */
export function openingTag(source: string, from: number): string {
  let depth = 0;

  for (let at = from; at < source.length; at++) {
    const here = source[at];
    if (here === "{") depth += 1;
    else if (here === "}") depth -= 1;
    // Nothing rather than a span running past the tag: a tag holds no `<` outside a brace, so one
    // here means the count is lost, and a span carrying two controls pairs one's mark with the
    // other's name.
    else if (here === "<" && at > from && depth === 0) return "";
    else if (here === ">" && depth === 0) return source.slice(from, at + 1);
  }

  return "";
}

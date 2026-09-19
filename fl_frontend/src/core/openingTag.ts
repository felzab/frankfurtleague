/**
 * Past a type argument written on the tag's own name, which is the one `<` an opening tag holds
 * outside a brace. `from` back where it never closes, so the walk below answers nothing rather than
 * guessing.
 */
function afterTypeArguments(source: string, from: number): number {
  if (source[from] !== "<" || !/[A-Za-z]/.test(source[from + 1] ?? "")) return from;

  // Walked character by character rather than matched against a slice, which copies the rest of the
  // file once per tag.
  let at = from + 1;
  while (/[\w.]/.test(source[at] ?? "")) at += 1;
  if (source[at] !== "<") return from;

  let depth = 0;
  for (; at < source.length; at++) {
    if (source[at] === "<") depth += 1;
    // Never the `>` of an arrow: a function type inside the argument closes nothing.
    else if (source[at] === ">" && source[at - 1] !== "=") {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
  }

  return from;
}

/**
 * One JSX opening tag, from `<Name` to the `>` that closes it. Braces are counted, so a `>` inside an
 * attribute expression — an arrow, a comparison, a nested element — does not end the tag early.
 */
export function openingTag(source: string, from: number): string {
  let depth = 0;

  for (let at = afterTypeArguments(source, from); at < source.length; at++) {
    const here = source[at];
    if (here === "{") depth += 1;
    else if (here === "}") depth -= 1;
    // Nothing rather than a span running past the tag: past the name's own type argument a `<`
    // outside a brace means the count is lost, and a span carrying two controls pairs one's mark
    // with the other's name.
    else if (here === "<" && at > from && depth === 0) return "";
    else if (here === ">" && depth === 0) return source.slice(from, at + 1);
  }

  return "";
}

/**
 * Source text with every comment blanked, line breaks kept. A reader matching raw source finds an
 * attribute a JSDoc only names, and `openingTag` reads a `<` inside an opening tag's comment as a
 * lost brace count.
 */
export function blankComments(source: string): string {
  const out = [...source];
  const blank = (from: number, to: number): void => {
    for (let at = from; at < to; at++) if (out[at] !== "\n") out[at] = " ";
  };

  for (let at = 0; at < source.length; at++) {
    const here = source.slice(at, at + 2);

    if (here === "//" || here === "/*") {
      const ends = here === "//" ? source.indexOf("\n", at) : source.indexOf("*/", at + 2);
      const to = ends === -1 ? source.length : here === "//" ? ends : ends + 2;
      blank(at, to);
      at = to - 1;
      continue;
    }

    // Skipped whole rather than scanned: a `//` inside a URL or a class list would otherwise blank
    // the rest of its line. Comments are consumed above first, so an apostrophe inside one is safe.
    const quote = source[at];
    if (quote === '"' || quote === "'" || quote === "`") {
      for (at += 1; at < source.length; at++) {
        if (source[at] === "\\") {
          at += 1;
          continue;
        }
        if (source[at] === quote) break;
      }
    }
  }

  return out.join("");
}

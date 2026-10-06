/**
 * A message's markup as its reader reads it, so a mail test checks one fact in both branches. In `core`
 * rather than `shared/testing`: the mail tests sit in `core`, which imports no `shared`.
 */
export function readable(html: string): string {
  let stripped = html;

  // To a fixpoint, as `fl_frontend/src/shared/testing/renderTest.ts :: textOf` strips; the style
  // element with its contents, or its rules stand as sentences.
  for (let previous = ""; stripped !== previous;) {
    previous = stripped;
    stripped = stripped.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ");
  }

  return (
    stripped
      // Below the strip and never inside it: `&lt;script&gt;` decodes to a tag a mail test asserts a
      // reader is served, and a strip running after would eat it.
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&amp;", "&")
      .replace(/\s+/g, " ")
      // The space the strip itself put before the punctuation following an inline link.
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim()
  );
}

/** The text branch on the same terms, so a comparison between the two is not a comparison of line wrapping. */
export const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

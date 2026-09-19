import { textOf } from "./renderTest.ts";

function withoutElements(html: string, opening: RegExp): string {
  let out = html;

  for (let match = opening.exec(out); match !== null; match = opening.exec(out)) {
    const tag = match[1] ?? "";
    const start = match.index;
    let depth = 0;
    let end = match[0].endsWith("/>") ? start + match[0].length : -1;

    // Balanced on the element's own tag name, so a nested element of that name does not end it early.
    const tags = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "g");
    tags.lastIndex = start;
    for (let tagMatch = end === -1 ? tags.exec(out) : null; tagMatch !== null; tagMatch = tags.exec(out)) {
      if (tagMatch[2] === "/") continue;
      depth += tagMatch[1] === "/" ? -1 : 1;
      if (depth === 0) {
        end = tagMatch.index + tagMatch[0].length;
        break;
      }
    }

    if (end === -1) throw new Error(`an element opened at ${String(start)} never closes`);
    out = out.slice(0, start) + out.slice(end);
    opening.lastIndex = 0;
  }

  return out;
}

/** What a screen reader reads out: the text of the markup with every `aria-hidden` subtree taken out. */
export const spokenText = (html: string, separator = ""): string =>
  textOf(withoutElements(html, /<(\w+)\b[^>]*\saria-hidden="true"[^>]*>/), separator);

/** What a sighted reader sees: the text with every `sr-only` subtree taken out. */
export const shownText = (html: string, separator = ""): string =>
  textOf(withoutElements(html, /<(\w+)\b[^>]*\sclass="(?:[^"]*\s)?sr-only(?:\s[^"]*)?"[^>]*>/), separator);

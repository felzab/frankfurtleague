import { createElement } from "react";

import { renderToStaticMarkup } from "react-dom/server";

import type { ComponentType, ReactNode } from "react";

/** A component's markup as the server sends it, for a case reading what a page carries rather than how it reacts. */
export function renderMarkup<P extends object>(Component: ComponentType<P>, props: P): string {
  return renderToStaticMarkup(createElement(Component, props));
}

/**
 * For what props cannot express — a component under the provider it reads, or one asserted beside a
 * sibling whose ordering is the claim.
 */
export function renderTree(tree: ReactNode): string {
  return renderToStaticMarkup(tree);
}

/**
 * The words inside markup, each tag replaced by `separator`. The empty default joins what stood either
 * side of a tag; a caller reading across an element boundary passes a space, or two words become one.
 */
export function textOf(html: string, separator = ""): string {
  let text = html;

  // To a FIXPOINT rather than in one pass — the shape CodeQL's
  // incomplete-multi-character-sanitization names: a pattern leaving a tag standing hands the caller
  // markup to read as text, and this one is free to change.
  for (let previous = ""; text !== previous;) {
    previous = text;
    text = text.replace(/<[^>]*>/g, separator);
  }

  return text;
}

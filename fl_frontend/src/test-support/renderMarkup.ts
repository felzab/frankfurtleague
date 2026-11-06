import { createElement } from "react";

import { renderToStaticMarkup } from "react-dom/server";

import type { ComponentType } from "react";

/** A component's markup as the server sends it, for a case reading what a page carries rather than how it reacts. */
export function renderMarkup<P extends object>(Component: ComponentType<P>, props: P): string {
  return renderToStaticMarkup(createElement(Component, props));
}

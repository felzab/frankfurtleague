// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { THEME_COLOR } from "@/core/themeColor";

import { ThemeColor } from "./ThemeColor";

const page = (
  <ThemeProvider>
    <ThemeColor />
  </ThemeProvider>
);

/** Every theme-colour meta in the document, as the system scheme it answers and its colour. */
const barColours = () =>
  [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) => [meta.getAttribute("media"), meta.getAttribute("content")]);

describe("the browser bar's colour", () => {
  afterEach(() => localStorage.clear());

  it("follows the system's scheme where the visitor chose none", () => {
    render(page);

    expect(barColours()).toStrictEqual([
      ["(prefers-color-scheme: light)", THEME_COLOR.light],
      ["(prefers-color-scheme: dark)", THEME_COLOR.dark],
    ]);
  });

  it("gives the chosen theme's colour to both schemes once the server's metas have hydrated", async () => {
    // The server cannot read the choice, which next-themes keeps in the browser's storage.
    const server = document.createElement("div");
    server.innerHTML = renderToString(page);
    document.body.append(server);
    localStorage.setItem("theme", "light");

    const root = await act(() => hydrateRoot(server, page));

    // Two metas, not the server's two beside two of the client's: the first in the document is the one applied.
    expect(barColours()).toStrictEqual([
      ["(prefers-color-scheme: light)", THEME_COLOR.light],
      ["(prefers-color-scheme: dark)", THEME_COLOR.light],
    ]);
    act(() => root.unmount());
    server.remove();
  });
});

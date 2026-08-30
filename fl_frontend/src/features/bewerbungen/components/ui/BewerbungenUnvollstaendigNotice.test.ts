import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createElement as h } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import type { ComponentType } from "react";
import type { BewerbungenUnvollstaendig } from "./BewerbungenUnvollstaendigNotice.tsx";

/**
 * `node --test` strips types but compiles no JSX, and resolves neither `next/link`'s subpath nor the
 * extensionless imports its dependencies ship. Local, so no other test pays for a transpile.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/link") return nextResolve("next/link.js", context);
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      // A published ESM package importing `./x` with no extension, which Node alone will not resolve.
      if (!specifier.startsWith(".") || specifier.includes(".js")) throw error;
      return nextResolve(`${specifier}.js`, context);
    }
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    const source = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;

    return { format: "module", shortCircuit: true, source: source };
  },
});

const { BewerbungenUnvollstaendigNotice } = await import("./BewerbungenUnvollstaendigNotice.tsx");
const { Callout } = await import("@/shared/components/ui/Callout.tsx");

const markup = (props: BewerbungenUnvollstaendig): string => renderToStaticMarkup(h(BewerbungenUnvollstaendigNotice, props));

const NEUESTE: BewerbungenUnvollstaendig = { richtung: "desc", umkehrHref: "?q=schule&order=asc" };
const AELTESTE: BewerbungenUnvollstaendig = { richtung: "asc", umkehrHref: "?q=schule&order=desc" };

/** The class list of the outermost element, which is where `Callout` puts its severity. */
const rootClass = (html: string): string => /^<div class="([^"]*)"/.exec(html)?.[1] ?? "";

/** The one anchor, as its href and the text a screen reader announces for it. */
function anchor(html: string): { href: string; name: string; attrs: string } {
  const found = /<a ([^>]*)>(.*?)<\/a>/s.exec(html);
  assert.notEqual(found, null, "the notice rendered no link at all");
  const attrs = found?.[1] ?? "";

  return { href: /href="([^"]*)"/.exec(attrs)?.[1]?.replaceAll("&amp;", "&") ?? "", name: (found?.[2] ?? "").trim(), attrs: attrs };
}

describe("the notice a truncated queue carries", () => {
  /* Against `Callout`'s own two severities rather than a class string: a literal would keep passing
     if the recipe were retokenised, and would say nothing about which severity was picked. */
  it("renders at warning, not at danger or info", () => {
    const severity = (name: "warning" | "danger" | "info") =>
      rootClass(renderToStaticMarkup(h(Callout as ComponentType<never>, { severity: name, title: "t" } as never)));

    assert.equal(rootClass(markup(NEUESTE)), severity("warning"));
    assert.notEqual(severity("warning"), severity("danger"), "the two severities are indistinguishable, so this proves nothing");
    assert.notEqual(rootClass(markup(NEUESTE)), severity("info"));
  });

  /* A dismissible notice would leave a partial queue looking whole, and the operator who closed it
     with no way back. Asserted on the markup, `Callout` rendering its close control as a button. */
  it("offers nothing to close it with", () => {
    for (const props of [NEUESTE, AELTESTE]) {
      assert.doesNotMatch(markup(props), /<button/, "the notice can be dismissed");
      assert.doesNotMatch(markup(props), /aria-hidden="true"[^>]*>\s*$/, "the notice hides itself from assistive technology");
    }
  });

  it("reverses the read through a real link that says what it does", () => {
    const neueste = anchor(markup(NEUESTE));
    assert.equal(neueste.href, "?q=schule&order=asc", "the link drops the search text or the order");
    assert.equal(neueste.name, "die ältesten zuerst laden");

    const aelteste = anchor(markup(AELTESTE));
    assert.equal(aelteste.href, "?q=schule&order=desc");
    assert.equal(aelteste.name, "die neuesten zuerst laden");

    // An `aria-label` here would replace the visible words with something a speaking user cannot read back.
    for (const { attrs } of [neueste, aelteste]) assert.doesNotMatch(attrs, /aria-label/);
  });

  /* One block, so the sentence is announced as a sentence. Split across paragraphs or spans with
     their own roles, the link would be read out detached from the loss it repairs. */
  it("announces the whole explanation as one block", () => {
    for (const props of [NEUESTE, AELTESTE]) {
      const html = markup(props);
      const absaetze = html.match(/<p[ >]/g) ?? [];

      assert.equal(absaetze.length, 1, "the explanation is split across blocks");
      assert.match(html, /<p[^>]*>[^<]*<a [^>]*>[^<]*<\/a>[^<]*<\/p>/, "the link is not inline in the explanation");
      assert.doesNotMatch(html, /<p[^>]*>(?:(?!<\/p>).)*?role="/s, "an element inside the sentence claims a role of its own");
    }
  });

  /* The reversed view is just as truncated, and it is the only view whose own incompleteness the
     operator cannot infer from having clicked something. */
  it("says it is still incomplete from both ends of the queue", () => {
    for (const props of [NEUESTE, AELTESTE]) {
      assert.match(markup(props), /Auch diese Ansicht bleibt unvollständig\./);
      assert.match(markup(props), /Dubletten werden nur unter den geladenen Zeilen erkannt\./);
    }

    assert.match(markup(NEUESTE), /Geladen sind die neuesten Bewerbungen/);
    assert.match(markup(AELTESTE), /Geladen sind die ältesten Bewerbungen/);
  });
});

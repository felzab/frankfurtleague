import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { ReactNode } from "react";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AdminCreateSaisonModal } = await import("@/features/saisons/components/modals/AdminCreateSaisonModal.tsx");
const { AdminCreateSchiedsrichterModal } = await import("@/features/schiedsrichter/components/modals/AdminCreateSchiedsrichterModal.tsx");
const { AdminCreateSperreModal } = await import("@/features/sperrliste/components/modals/AdminCreateSperreModal.tsx");
const { AdminCreateSpielerModal } = await import("@/features/spieler/components/modals/AdminCreateSpielerModal.tsx");
const { AdminCreateSpielortModal } = await import("@/features/spielorte/components/modals/AdminCreateSpielortModal.tsx");
const { AdminCreateTeamModal } = await import("@/features/teams/components/modals/AdminCreateTeamModal.tsx");

const markup = (modal: ReactNode): string => renderTree(underNext(modal));

/** Each trigger's rendered markup and the name it owes, keyed by the component's own module name. */
const TRIGGERS: Record<string, { name: string; html: string }> = {
  AdminCreateSaisonModal: { name: "Neue Saison anlegen", html: markup(h(AdminCreateSaisonModal)) },
  AdminCreateSchiedsrichterModal: { name: "Neuen Schiedsrichter anlegen", html: markup(h(AdminCreateSchiedsrichterModal)) },
  AdminCreateSperreModal: { name: "Adresse sperren", html: markup(h(AdminCreateSperreModal)) },
  AdminCreateSpielerModal: {
    name: "Neuen Spieler anlegen",
    html: markup(h(AdminCreateSpielerModal, { saisonOptions: [], defaultSaisonId: null })),
  },
  AdminCreateSpielortModal: { name: "Neuen Spielort anlegen", html: markup(h(AdminCreateSpielortModal)) },
  AdminCreateTeamModal: { name: "Neues Team anlegen", html: markup(h(AdminCreateTeamModal, { saisonOptions: [], defaultSaisonId: null })) },
};

/** Every CRUD header's create trigger, found by its file name rather than by the markup this file asserts. */
function createModals(): string[] {
  const features = path.resolve(import.meta.dirname, "..");

  return readdirSync(features)
    .map((slice) => path.join(features, slice, "components", "modals"))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => readdirSync(dir).filter((file) => /^AdminCreate\w+Modal\.tsx$/.test(file)))
    .map((file) => file.replace(/\.tsx$/, ""))
    .sort();
}

const trigger = (html: string): string => /<button\b[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";

describe("a CRUD header's create trigger", () => {
  /* First: a sixth create modal would otherwise go unasserted, its trigger free to lose its name. */
  it("is asserted for every create modal the slices hold", () => {
    assert.deepEqual(Object.keys(TRIGGERS).sort(), createModals());
  });

  /* The glyph beside the label is `aria-hidden`, so the words below are the button's whole accessible
     name (WCAG 4.1.2), and a trigger reading „Neu“ names nothing a reader can act on. */
  it("is named by the words the slice owes it", () => {
    for (const [modal, { name, html }] of Object.entries(TRIGGERS)) {
      const button = trigger(html);

      assert.notEqual(button, "", `${modal} renders no button`);
      assert.equal(textOf(button).trim(), name, `${modal}'s button names something else`);
    }
  });
});

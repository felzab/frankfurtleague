import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it, mock } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ts from "typescript";
import { z } from "zod";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { ActionResult } from "@/shared/types/types.ts";

/** Every write held unanswered: each case below asserts that none was sent at all. */
const { calls } = doubleActions({ modules: [/\/src\/features\/\w+\/actions\.ts$/], answer: () => new Promise(() => undefined) });

/* `next/error` is CommonJS whose exports Node's static reader cannot see, so the sign-in card's ESM import
   of `catchError` fails at link. The shim hands on the real function rather than a stand-in. */
const NEXT_ERROR_INTEROP = `import { createRequire } from "node:module";
export const { catchError } = createRequire(${JSON.stringify(import.meta.filename)})("next/error");`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Narrowed to the card: the shim's own `require` has to reach the real module.
    if (specifier === "next/error" && (context.parentURL ?? "").endsWith("/SignInForm.tsx"))
      return { url: `data:text/javascript,${encodeURIComponent(NEXT_ERROR_INTEROP)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

doubleToasts();

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { FieldError } = await import("@heroui/react/field-error");
const { Input } = await import("@heroui/react/input");
const { Label } = await import("@heroui/react/label");
const { TextField } = await import("@/shared/components/ui/TextField.tsx");
const { EntityForm } = await import("@/shared/components/ui/EntityForm.tsx");

type Draft = { name: string };

/** Whether the create form's one field is shown refused, by the mark react-aria sets on its input. */
const marked = (container: HTMLElement): boolean => container.querySelector('input[name="name"]')?.getAttribute("aria-invalid") === "true";

describe("the create form's field errors", () => {
  /* The payload step trims, and the schema refuses a space: a draft judged in place of the payload
     keeps a padded name refused that the write would take, so the mark never clears. */
  it("blocks an empty draft, and clears the mark once the payload it would send is taken", async () => {
    const user = userEvent.setup();
    const onSubmit = mock.fn(async (_payload: Draft): Promise<ActionResult> => ({ success: true, message: "Angelegt" }));
    const { container } = render(
      underNext(
        h(EntityForm<Draft, Draft>, {
          initialDraft: { name: "" },
          renderFields: (draft, setDraft) =>
            h(
              TextField,
              { name: "name", value: draft.name, onChange: (next: string) => setDraft({ name: next }) },
              h(Label, null, "Name"),
              h(Input),
              h(FieldError),
            ),
          schema: z.object({ name: z.string().regex(/^\S+$/, { error: "Ohne Leerzeichen." }) }),
          toPayload: (draft) => ({ name: draft.name.trim() }),
          onSubmit,
          successMessage: "Angelegt",
          onClose: () => undefined,
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    assert.equal(onSubmit.mock.callCount(), 0, "the empty draft was sent");
    assert.ok(marked(container), "the blocked press marked nothing");

    await user.type(screen.getByRole("textbox", { name: "Name" }), "  Lena  ");
    assert.ok(!marked(container), "the mark stands over a name the payload step would send");
  });
});

/** Each request the page sends, recorded and answered as a success, for the forms writing through `fetch`. */
async function fetchesDuring(press: () => Promise<void>): Promise<string[]> {
  const sent: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    sent.push(String(input));
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } }));
  }) as typeof fetch;
  try {
    await press();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  } finally {
    globalThis.fetch = original;
  }

  return sent;
}

/** A seat's person as the application stored them, confirmed or still waiting on their link. */
const kontakt = (vorname: string, email: string) => ({
  vorname,
  nachname: "Meier",
  email,
  telefon: "069 1234567",
  geburtsdatum: null,
  einwilligung: {
    umfang: "kontaktdaten" as const,
    erfasst_von: "administrativ" as const,
    text_version: "2026-09-bestaetigungsseite",
    datum: "2026-09-01",
    bestaetigt_am: null,
  },
});

/* `aria` sets `noValidate` and drops every `required`, so the browser stops nothing: a form whose press
   skips the shared block posts whatever it holds and learns the rules from the server. Each form below is
   pressed nowhere else. */
describe("a public or single-purpose form's press over a draft its schema refuses", () => {
  it("the sign-in card sends no link for an empty address", async () => {
    const user = userEvent.setup();
    const { SignInForm } = await import("@/features/auth/components/forms/SignInForm.tsx");
    render(h(SignInForm));
    calls.length = 0;

    await user.click(screen.getByRole("button", { name: "Link senden" }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    assert.deepEqual(
      calls.map((call) => call.action),
      [],
      "the empty address was sent",
    );
  });

  it("the contact's confirmation panel sends no confirmation without a birth date", async () => {
    const user = userEvent.setup();
    const { BestaetigungFormPanel } = await import("@/features/bewerbungen/components/views/BestaetigungFormPanel.tsx");
    render(
      h(BestaetigungFormPanel, {
        token: "kein-echtes-token",
        vorname: "Mira",
        schule: "Lessing-Kolleg",
        saison: "2026",
        rolle: "Ansprechperson",
        mindestalter: 18,
        onAbschluss: () => undefined,
      }),
    );

    const sent = await fetchesDuring(() => user.click(screen.getByRole("button", { name: "Eintrag bestätigen" })));

    assert.deepEqual(sent, [], "the confirmation was sent without the birth date it requires");
  });

  it("the registration form sends no registration for an empty draft", async () => {
    const user = userEvent.setup();
    const { RegistrierungFormPanel } = await import("@/features/registrierungen/components/views/RegistrierungFormPanel.tsx");
    render(
      h(RegistrierungFormPanel, {
        token: "kein-echtes-token",
        ansicht: {
          acknowledged: 1,
          team: "Lessing-Kolleg",
          schule: "Lessing-Kolleg Oberstufengymnasium",
          saison_id: "2026",
          saison_status: "future",
          laeuft: true,
          erlaubte_stufen: ["Q1", "Q2"],
          kader_frei: true,
          team_eingetragen: true,
          nachnominierung: false,
        },
        onLinkTot: () => undefined,
      }),
    );

    const sent = await fetchesDuring(() => user.click(screen.getByRole("button", { name: /Registrierung abschicken/ })));

    assert.deepEqual(sent, [], "the empty registration was sent");
  });

  it("the triage's reseat sends no person whose address the schema refuses", async () => {
    const user = userEvent.setup();
    const { bestaetigungsStand } = await import("@/features/bewerbungen/bestaetigungStand.ts");
    const { BewerbungBestaetigungStrip } = await import("@/features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx");
    const offen = { verschickt_am: "2026-09-01", erinnert_am: null, abgelehnt_am: null, zustellung: null };
    // Clara stepped out of the Trainer seat, which leaves it to be seated again.
    const staende =
      bestaetigungsStand({
        kontakte: {
          ansprechperson: kontakt("Anna", "anna@schule.example"),
          stellvertretung: kontakt("Bernd", "bernd@schule.example"),
          trainer: null,
          trainer_ist_zugleich: null,
        },
        bestaetigungen: { ansprechperson: offen, stellvertretung: offen, trainer: { ...offen, abgelehnt_am: "2026-09-03" } },
        status: "eingereicht",
      }) ?? assert.fail("the fixture carries no confirmation block");
    render(underNext(h(BewerbungBestaetigungStrip, { bewerbungId: "68d0f2a4c1e2b3a4d5e6f708", staende, frist: "2099-12-31", isOpen: true })));
    calls.length = 0;

    await user.click(screen.getByRole("button", { name: "Trainer neu besetzen" }));
    await user.type(screen.getByRole("textbox", { name: "Vorname" }), "Doreen");
    await user.type(screen.getByRole("textbox", { name: "Nachname" }), "Ostwald");
    await user.type(screen.getByRole("textbox", { name: "Telefon" }), "069 7654321");
    await user.type(screen.getByRole("textbox", { name: "E-Mail" }), "doreen@{Enter}");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    assert.deepEqual(
      calls.map((call) => call.action),
      [],
      "a person with an address the schema refuses was seated",
    );
  });
});

const SRC = path.resolve(import.meta.dirname, "..", "..");

/** Every module rendering the shared `Form`, read off its syntax tree. */
const FORM_MODULES = filesUnder(SRC, (name) => name.endsWith(".tsx") && !isTestFile(name), 200)
  .filter((file) => {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let renders = false;
    const visit = (node: ts.Node): void => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "Form") renders = true;
      ts.forEachChild(node, visit);
    };
    visit(source);

    return renders;
  })
  .map((file) => path.relative(SRC, file).split(path.sep).join("/"));

/** A page-owned editor, whose press over a refused draft `fl_frontend/src/features/admin/editorWiring.test.ts` makes. */
const isEditor = (file: string): boolean => readFileSync(path.join(SRC, file), "utf8").includes("<ConfirmSaveModal");

/**
 * Every form outside the page-owned editors. The ones not pressed above are pressed over a refused
 * draft in their own suites; the triage strip's correction is, its reseat is pressed here.
 */
const OTHER_FORMS = [
  "features/auth/components/forms/SignInForm.tsx",
  "features/bewerbungen/components/forms/BewerbungForm/BewerbungForm.tsx",
  "features/bewerbungen/components/views/BestaetigungFormPanel.tsx",
  "features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx",
  "features/registrierungen/components/views/RegistrierungFormPanel.tsx",
  "features/registrierungen/components/views/SpielerBestaetigungView.tsx",
  "features/schiedsrichter/components/views/SchiedsrichterBestaetigungView.tsx",
  "shared/components/ui/EntityForm.tsx",
];

describe("the forms these cases reach", () => {
  /* A form added beside these renders the shared `Form` and is judged nowhere, its press posting
     whatever it holds, until it is named here and pressed. */
  it("are every module rendering the shared form", () => {
    const editors = FORM_MODULES.filter(isEditor);
    assert.ok(editors.length > 0, "no form is read as a page-owned editor, so the split below sorts nothing");
    assert.deepEqual(FORM_MODULES.filter((file) => !isEditor(file)).sort(), [...OTHER_FORMS].sort());
  });
});

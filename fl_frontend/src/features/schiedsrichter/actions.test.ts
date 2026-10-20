import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { act, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import {
  doubleActionRequest,
  doubleActions,
  doubleToasts,
  loggedErrorCodes,
  loggedErrorTraces,
  loggedLines,
} from "@/shared/testing/actionDoubles.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { answer, answerReadsWith, EDGE_TRACE_ID, EMPTIEST_ANSWER, pageBody } from "@/shared/testing/pageHarness.ts";
import { answerShown, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";

import { mapNameRefusal as mapSpielortNameRefusal } from "../spielorte/refusals.ts";
import { mapEinladenRefusal, mapGesperrteAdresseRefusal, mapNameRefusal, mapReactivateRefusal, mapRetireRefusal } from "./refusals.ts";

import type { ReactNode } from "react";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { answerWith, answered } = doubleActions({
  modules: ["/src/features/schiedsrichter/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

// An administrator's session: every admin-tier read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
doubleActionRequest();

const { mapSchiedsrichterAnsichtRefusal, mapSchiedsrichterBestaetigungRefusal } = await import("./queries.ts");

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminSchiedsrichterEditView } = await import("./components/views/AdminSchiedsrichterEditView.tsx");
const { default: AdminSchiedsrichterEditPage } = await import("@/app/bereich/admin/schiedsrichter/[schiedsrichter_id]/page.tsx");

const CREATE_OPERATION = "POST /schiedsrichter";
const SAVE_OPERATION = "PATCH /schiedsrichter/{schiedsrichter_id}";
const EINLADEN_OPERATION = "POST /schiedsrichter/{schiedsrichter_id}/bestaetigung/einladen";
const REACTIVATE_OPERATION = "POST /schiedsrichter/{schiedsrichter_id}/reactivate";
const RETIRE_OPERATION = "DELETE /schiedsrichter/{schiedsrichter_id}";
const BESTAETIGUNG_OPERATION = "POST /schiedsrichter/bestaetigung";
const ANSICHT_OPERATION = "POST /schiedsrichter/bestaetigung/ansicht";

/** The create's and the save's own answer: the name's mapper first, then the ban's, as both actions ask them. */
const saveAnswer = (error: unknown) => mapNameRefusal(error) ?? mapGesperrteAdresseRefusal(error);

describe("the referee's writes against the codes their endpoints publish", () => {
  /* Coming back mints for an unanswered referee, so the reactivation meets the ban list as every mint
     does; left unmapped it reaches the admin as the shared fallback, which names no rule. */
  it("words every refusal the reactivation publishes", () => {
    assert.deepEqual(publishedRefusals(REACTIVATE_OPERATION), ["REQ-SCHIEDSRICHTER-007"]);
    for (const code of publishedRefusals(REACTIVATE_OPERATION)) {
      assert.notEqual(
        answerShown(REACTIVATE_OPERATION, code, mapReactivateRefusal),
        null,
        `${code} reaches the admin as an unhandled conflict`,
      );
    }
  });

  /* Both writes mint where an address was given, so both meet the ban list, and one mapper words it
     for the box that holds the value the list refused. */
  it("maps every refusal the create and the save publish", () => {
    assert.deepEqual(
      publishedRefusals(CREATE_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      ["REQ-SCHIEDSRICHTER-007"],
    );
    // No `REQ-SCHIEDSRICHTER-001`: a retired referee's new address is stored and mails nothing.
    assert.deepEqual(
      publishedRefusals(SAVE_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      ["REQ-SCHIEDSRICHTER-007"],
    );
    for (const [operation, published] of [
      [CREATE_OPERATION, publishedRefusals(CREATE_OPERATION)],
      [SAVE_OPERATION, publishedRefusals(SAVE_OPERATION)],
    ] as const) {
      assert.ok(published.includes(DUPLICATE_KEY), `${operation} no longer publishes the duplicate name its mapper places`);
      for (const code of published) {
        assert.notEqual(answerShown(operation, code, saveAnswer), null, `${code} reaches the admin as an unhandled conflict on ${operation}`);
      }
    }
  });

  it("lands the ban on the box that holds the refused address", () => {
    assert.deepEqual(Object.keys(saveAnswer(refusedOn(CREATE_OPERATION, "REQ-SCHIEDSRICHTER-007"))?.fieldErrors ?? {}), ["kontakt.email"]);
  });

  /* Every refusal the re-send publishes, worded at the panel: nothing there is a form, so each is a
     sentence rather than a field error. */
  it("words every refusal the re-send publishes", () => {
    assert.deepEqual(publishedRefusals(EINLADEN_OPERATION), [
      "REQ-SCHIEDSRICHTER-001",
      "REQ-SCHIEDSRICHTER-004",
      "REQ-SCHIEDSRICHTER-006",
      "REQ-SCHIEDSRICHTER-007",
    ]);
    for (const code of publishedRefusals(EINLADEN_OPERATION)) {
      assert.notEqual(answerShown(EINLADEN_OPERATION, code, mapEinladenRefusal), null, `${code} reaches the admin as an unhandled conflict`);
    }
  });

  /* The public page's own two endpoints. Their German is the visitor's, so it is worded where the
     page reads them rather than in an admin action's mapper. */
  it("words every refusal the referee's own link publishes", async () => {
    for (const code of publishedRefusals(BESTAETIGUNG_OPERATION)) {
      const own = await mapSchiedsrichterBestaetigungRefusal(refusedOn(BESTAETIGUNG_OPERATION, code), () =>
        Promise.resolve({ zustand: "gueltig" as const, ansicht: { mindestalter: 16, medien_mindestalter: 18 } }),
      );
      assert.notEqual(
        own ?? answerShown(BESTAETIGUNG_OPERATION, code, () => null),
        null,
        `${code} reaches the visitor as an unhandled conflict`,
      );
    }
    for (const code of publishedRefusals(ANSICHT_OPERATION)) {
      assert.notEqual(
        mapSchiedsrichterAnsichtRefusal(refusedOn(ANSICHT_OPERATION, code)),
        null,
        `${code} reaches the visitor as an unhandled conflict`,
      );
    }
  });

  it("leaves the retirement's own refusal on the retirement", () => {
    assert.deepEqual(publishedRefusals(RETIRE_OPERATION), ["REQ-RETIRE-004"]);
    for (const code of publishedRefusals(RETIRE_OPERATION)) {
      assert.notEqual(answerShown(RETIRE_OPERATION, code, mapRetireRefusal), null, `${code} reaches the admin as an unhandled conflict`);
    }
  });
});

describe("the referee name a unique index already holds", () => {
  /* `uniq_schiedsrichter_name` is this collection's only unique index, so the 409 it raises is always
     the name. Unmapped, `fl_frontend/src/shared/utils/actionError.ts` answers it with a sentence about
     an entry, which names no box and no way out. */
  it("lands the duplicate on the name box rather than in a banner", () => {
    // The field message carries no second sentence: the box under it is the way out (`docs/frontend/spec.md` §1.12).
    assert.deepEqual(mapNameRefusal(refusedOn(CREATE_OPERATION, DUPLICATE_KEY)), { fieldErrors: { name: "Diesen Namen gibt es schon." } });
  });

  /* One sentence for both slices: a reader meets the same box on four forms, and a rewording of one
     copy would tell two of them something the other two do not say. */
  it("words a venue's duplicate name the same way", () => {
    assert.deepEqual(
      mapNameRefusal(refusedOn(CREATE_OPERATION, DUPLICATE_KEY)),
      mapSpielortNameRefusal(refusedOn("POST /spielorte", DUPLICATE_KEY)),
    );
  });
});

const { router } = recordingRouter();

const underRecordingNext = (tree: ReactNode): ReactNode => underNext(tree, { router });

const RECORD = {
  id: "68c1f0a2b3c4d5e6f7a8b9c0",
  name: "Anna Beispiel",
  schule: "Musterschule",
  kontakt: { email: "anna@example.de", telefon: "069 1234567" },
  default_payment: 25,
  geburtsdatum: null,
  einwilligung: null,
  bestaetigung: null,
  adresswechsel: null,
  abgelaufen: { bestaetigung: false, adresswechsel: false },
};

/** The record the editor page's read answers with, as the backend holds it at that moment. */
let stored: Record<string, unknown> = { ...RECORD, inactive_since: null };
/** The registry's read failing, where a case asks it to: with a failure, or with words off their schema. */
let registerFehlt: boolean | "vertragsbruch" = false;
/** The read's judgement of each link's deadline, served beside the record. */
let lapse = { bestaetigung_abgelaufen: false, adresswechsel_abgelaufen: false };
answerReadsWith((endpoint, schema, params) => {
  if (registerFehlt === true && endpoint.startsWith("/einwilligung/fassungen/")) throw new Error("backend unreachable");
  if (registerFehlt === "vertragsbruch" && endpoint.startsWith("/einwilligung/fassungen/")) return { acknowledged: 1 };
  return endpoint === `/schiedsrichter/${RECORD.id}`
    ? answer(schema, endpoint, { schiedsrichter: stored, ...lapse })
    : EMPTIEST_ANSWER(endpoint, schema, params);
});

/** What the save answers where the address of an outstanding referee moved and the link went out. */
const VERSAND_SATZ = "Der Best\u00e4tigungslink ging an anna@example.de.";

afterEach(() => {
  toasts.length = 0;
});

/** The editor the page mounts for a referee nobody erased. */
const renderEditor = () =>
  render(underRecordingNext(h(AdminSchiedsrichterEditView, { istFassungBekannt: true, schiedsrichter: RECORD, inactiveSince: null })));

/** A draft that differs from the stored record, typed as an administrator types one. */
async function typeADraft(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByRole("textbox", { name: "Name" }), " B.");
}

describe("what the save tells the administrator about the message it sent", () => {
  /* The save mails a link where an outstanding referee's address moved, and the editor's toast is
     the one surface that can say so: the page it returns to shows no send. */
  it("carries the send's own sentence into the undo offer", async () => {
    answerWith(() =>
      Promise.resolve({
        success: true,
        updated_document: null,
        message: "Schiedsrichter bearbeitet",
        versandSatz: VERSAND_SATZ,
        versand: "gesendet",
      }),
    );

    const user = userEvent.setup();
    renderEditor();
    // The save bar is closed on a clean draft, so the press needs a change to commit — and one the
    // rail raises no blocking banner over, which would open the confirmation dialog instead.
    await user.type(screen.getByRole("textbox", { name: /Schule/ }), "n");
    await user.click(screen.getAllByRole("button", { name: "Speichern" })[0]!);
    // The write runs inside a transition, so the press returns before the offer is raised.
    await act(answered);
    await waitFor(() => {
      assert.ok(toasts.length > 0, "the save raised no toast at all");
    });

    assert.deepEqual(
      toasts.map((raised) => [raised.variant, raised.title, raised.description]),
      [["success", "\u00c4nderung gespeichert", VERSAND_SATZ]],
    );
  });

  /* A link that did not go out is collateral rather than a clean save: the referee has no working link, and
     nobody else is told. */
  for (const versand of ["fehlgeschlagen", "gesperrt", "zurueckgehalten"] as const) {
    it(`grades a save whose link is ${versand} a warning`, async () => {
      answerWith(() =>
        Promise.resolve({
          success: true,
          updated_document: null,
          message: "Schiedsrichter bearbeitet",
          versandSatz: VERSAND_SATZ,
          versand: versand,
        }),
      );

      const user = userEvent.setup();
      const { unmount } = renderEditor();
      const before = toasts.length;
      // The save bar is closed on a clean draft, so the press needs a change to commit — and one the
      // rail raises no blocking banner over, which would open the confirmation dialog instead.
      await user.type(screen.getByRole("textbox", { name: /Schule/ }), "n");
      await user.click(screen.getAllByRole("button", { name: "Speichern" })[0]!);
      // The write runs inside a transition, so the press returns before the offer is raised.
      await act(answered);
      await waitFor(() => {
        assert.ok(toasts.length > before, "the save raised no toast at all");
      });

      assert.deepEqual(
        toasts.slice(before).map((raised) => [raised.variant, raised.title]),
        [["warning", "Mit Folgen gespeichert"]],
      );
      unmount();
    });
  }

  it("falls back to the editor's own sentence where the save mailed nothing", async () => {
    answerWith(() => Promise.resolve({ success: true, updated_document: null, message: "Schiedsrichter bearbeitet" }));

    const user = userEvent.setup();
    renderEditor();
    // The save bar is closed on a clean draft, so the press needs a change to commit — and one the
    // rail raises no blocking banner over, which would open the confirmation dialog instead.
    await user.type(screen.getByRole("textbox", { name: /Schule/ }), "n");
    await user.click(screen.getAllByRole("button", { name: "Speichern" })[0]!);
    // The write runs inside a transition, so the press returns before the offer is raised.
    await act(answered);
    await waitFor(() => {
      assert.ok(toasts.length > 0, "the save raised no toast at all");
    });

    assert.deepEqual(
      toasts.map((raised) => [raised.variant, raised.description]),
      [["success", "Die Schiedsrichterdaten wurden aktualisiert."]],
    );
  });
});

describe("the referee's editor page", () => {
  /* The registry tells a known label from an unknown one, which the consent panel says beside it; its
     failure leaves that unchecked rather than taking the editor down. */
  it("hands the editor an unchecked label, and renders, where the registry read failed", async () => {
    const props = { params: Promise.resolve({ schiedsrichter_id: RECORD.id }), searchParams: Promise.resolve({}) };
    stored = {
      ...RECORD,
      inactive_since: null,
      einwilligung: {
        umfang: "intern",
        erteilt_von: "volljaehrig",
        datum: "2026-09-22",
        bestaetigt_am: "2026-09-22",
        text_version: "2026-09-schiedsrichterseite",
        medien: false,
        nachweis: { umfang: null, medien: null },
      },
    };
    registerFehlt = true;

    try {
      const body = await pageBody(AdminSchiedsrichterEditPage, props);
      assert.equal(
        (body.props as { istFassungBekannt: unknown }).istFassungBekannt,
        null,
        "a failed registry read reached the editor as a verdict",
      );
      // Untyped, as a cached read's throw arrives: only this line tells it from a bug.
      assert.deepEqual(loggedErrorCodes(), ["FE-RSC-001"], "the failure went unlogged");
      assert.deepEqual(loggedErrorTraces(), [EDGE_TRACE_ID], "the line names no request");
    } finally {
      registerFehlt = false;
      stored = { ...RECORD, inactive_since: null };
    }
  });

  /* The editor is the operator's tool for repairing the record, so a broken contract leaves it
     standing too; logged under the error boundary's own code, so the broken deploy is still seen. */
  it("hands the editor an unchecked label where the registry broke its contract, and logs it", async () => {
    const props = { params: Promise.resolve({ schiedsrichter_id: RECORD.id }), searchParams: Promise.resolve({}) };
    stored = {
      ...RECORD,
      inactive_since: null,
      einwilligung: {
        umfang: "intern",
        erteilt_von: "volljaehrig",
        datum: "2026-09-22",
        bestaetigt_am: "2026-09-22",
        text_version: "2026-09-schiedsrichterseite",
        medien: false,
        nachweis: { umfang: null, medien: null },
      },
    };
    registerFehlt = "vertragsbruch";

    try {
      const body = await pageBody(AdminSchiedsrichterEditPage, props);
      assert.equal((body.props as { istFassungBekannt: unknown }).istFassungBekannt, null, "a contract break took the editor down");
      assert.deepEqual(
        loggedLines
          .filter(({ level }) => level === "error")
          .map(({ message, meta }) => [message, (meta as { error_code?: string }).error_code]),
        [["Contract break absorbed by an admin readout", "FE-RSC-001"]],
        "the contract break went unlogged",
      );
    } finally {
      registerFehlt = false;
      stored = { ...RECORD, inactive_since: null };
    }
  });

  /* A rename is the surviving write on this page, and the draft mirrors the stored record: without
     the key the saved values never reach the boxes and the form reads as dirty against them. */
  it("keys the editor on the stored record, so a save remounts it", async () => {
    const user = userEvent.setup();
    const props = { params: Promise.resolve({ schiedsrichter_id: RECORD.id }), searchParams: Promise.resolve({}) };
    stored = { ...RECORD, inactive_since: null };
    const { rerender } = render(underRecordingNext(await pageBody(AdminSchiedsrichterEditPage, props)));
    await typeADraft(user);

    // The refresh after a save re-reads the row as the backend stored it, which is not what was typed.
    stored = { ...stored, name: "Anna Beispiel-Berg" };
    rerender(underRecordingNext(await pageBody(AdminSchiedsrichterEditPage, props)));

    assert.equal(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Name" }).value,
      "Anna Beispiel-Berg",
      "the box keeps the draft over the record the save stored",
    );
  });
});

/* The page hands each panel the read's flag for that panel's own link: two booleans of one type,
   which a swap anywhere between the read and the panel moves with nothing failing to compile. */
describe("which link the editor's page marks as lapsed", () => {
  const props = { params: Promise.resolve({ schiedsrichter_id: RECORD.id }), searchParams: Promise.resolve({}) };
  // One deadline for both links, so only the served flag can tell the two panels apart.
  const frist = "2026-10-05";
  const bestaetigung = { verschickt_am: "2026-09-21", erinnert_am: null, frist, zustellung: null };
  const BESTAETIGT = {
    umfang: "intern",
    erteilt_von: "volljaehrig",
    datum: "2026-09-22",
    bestaetigt_am: "2026-09-22",
    text_version: "2026-09-schiedsrichterseite",
    medien: false,
    nachweis: { umfang: null, medien: null },
  };

  /** The text of the panel headed `title`, as the page renders it over the read answered with `served`. */
  async function shownIn(record: Record<string, unknown>, served: typeof lapse, title: string): Promise<string> {
    stored = { ...RECORD, inactive_since: null, ...record };
    lapse = served;
    try {
      const { unmount } = render(underRecordingNext(await pageBody(AdminSchiedsrichterEditPage, props)));
      const text = screen.getByRole("heading", { level: 2, name: title }).closest("section")?.textContent ?? "";
      unmount();
      return text;
    } finally {
      stored = { ...RECORD, inactive_since: null };
      lapse = { bestaetigung_abgelaufen: false, adresswechsel_abgelaufen: false };
    }
  }

  it("marks the consent link's panel where only that link has lapsed", async () => {
    const shown = await shownIn({ bestaetigung }, { bestaetigung_abgelaufen: true, adresswechsel_abgelaufen: false }, "Bestätigung");

    assert.match(shown, /abgelaufen/, "the consent link's panel says nothing of the lapse the read served for it");
  });

  // A confirmed referee: the only one an address change waits on, and one whose consent link no lapse costs.
  it("marks the address change's panel, and not the consent link's, where only the change has lapsed", async () => {
    const record = {
      einwilligung: BESTAETIGT,
      bestaetigung,
      adresswechsel: {
        email: "anna@neu.example",
        weg: "konto" as const,
        verschickt_am: "2026-10-01",
        gueltig_bis: "2020-01-01T11:00:00Z",
        freigegeben_am: null,
        grund: null,
        bestaetigt_am: null,
        wirksam_ab: null,
        zustellung: null,
      },
    };
    const served = { bestaetigung_abgelaufen: false, adresswechsel_abgelaufen: true };

    assert.match(await shownIn(record, served, "Neue E-Mail-Adresse"), /abgelaufen/, "the change's panel misses the lapse served for it");
    assert.doesNotMatch(await shownIn(record, served, "Bestätigung"), /abgelaufen/, "the consent link's panel took the change's lapse");
  });
});

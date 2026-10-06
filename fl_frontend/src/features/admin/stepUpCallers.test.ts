import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ts from "typescript";

import { publishedLaufendeFassung } from "@/core/einwilligungDocument.ts";
import { registerDoubles } from "@/core/exportingModule.ts";
import { filesUnder, isTestFile, serverActionModules } from "@/core/treeWalk.ts";
import { doubleEveryAction, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { declaredStatus } from "@/shared/testing/declaredStatus.ts";
import { laufendeNeubesetzung } from "@/shared/testing/einwilligungAnswers.ts";
import { nextRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { CONDITIONALLY_STEPPED_UP, STEP_UP_CALLERS, STEP_UP_WRITES } from "@/shared/testing/stepUpWrites.ts";

import type { StepUpPress } from "@/shared/testing/stepUpWrites.ts";
import type { ReactNode } from "react";

const SRC = path.resolve(import.meta.dirname, "..", "..");

/* The create form, replaced at the module boundary: what a create declares to it is all this sweep
   asks of the create, `fl_frontend/src/shared/components/ui/EntityForm.test.ts` driving the real one. */
const declaredToTheCreateForm: boolean[] = [];
const RECORDING_FORM = {
  EntityForm: (props: { stepUp?: boolean | "enrolment" }): null => {
    // Either window: which one a create is held to is the action's, and the form reads it whole.
    declaredToTheCreateForm.push(props.stepUp !== undefined && props.stepUp !== false);
    return null;
  },
};
registerDoubles({
  modules: {
    "shared/components/ui/EntityForm.tsx": RECORDING_FORM,
  },
});

const { calls, answerWith, answered } = doubleEveryAction();
doubleToasts();

type User = ReturnType<typeof userEvent.setup>;

/** A page past the step-up window, its prompt answering yes and counting each run. */
const prompts: string[] = [];
const staleVia = (StepUpContext: React.Context<unknown>, tree: ReactNode): ReactNode =>
  h(
    StepUpContext.Provider,
    {
      value: {
        isStale: () => true,
        confirm: () => {
          prompts.push(`prompt before ${String(calls.length)} writes`);
          return Promise.resolve(true);
        },
      },
    },
    tree,
  );

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { StepUpContext } = (await import("@/shared/components/ui/stepUp.ts")) as unknown as { StepUpContext: React.Context<unknown> };
const { bestaetigungsStand } = await import("@/features/bewerbungen/bestaetigungStand.ts");
const { BewerbungBestaetigungStrip } = await import("@/features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx");
const { FormBestaetigungSection } =
  await import("@/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormBestaetigungSection.tsx");
const { FormAdresswechselSection } =
  await import("@/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormAdresswechselSection.tsx");
const { AdminSchiedsrichterEditForm } =
  await import("@/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm.tsx");
const { AdminSchiedsrichterTable } = await import("@/features/schiedsrichter/components/collections/AdminSchiedsrichterTable.tsx");
const { AdminSchiedsrichterEditView } = await import("@/features/schiedsrichter/components/views/AdminSchiedsrichterEditView.tsx");
const { EinladungLinkHolder } = await import("@/features/einladungen/components/EinladungLinkHolder.tsx");
const { FormEinladungSection } = await import("@/features/teams/components/forms/AdminTeamEditForm/FormEinladungSection.tsx");
const { FormSaisonSection } = await import("@/features/teams/components/forms/AdminTeamEditForm/FormSaisonSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");
const { AdminKontakteEditForm } = await import("@/features/kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx");
const { FormKontaktEinladen } = await import("@/features/kontakte/components/forms/AdminKontakteEditForm/FormKontaktEinladen.tsx");

/** Every step-up write a module imports from any slice's actions module, read off its syntax tree. */
function importedStepUpWrites(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const resolved = specifier.startsWith("@/") ? path.join(SRC, specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
    const slice = /[\\/]features[\\/](\w+)[\\/]actions$/.exec(resolved)?.[1];
    const bindings = statement.importClause?.namedBindings;
    if (slice === undefined || bindings === undefined || !ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      const name = (element.propertyName ?? element.name).text;
      if (STEP_UP_WRITES[name] === slice) found.push(name);
    }
  }

  return found;
}

const ACTION_MODULES: ReadonlySet<string> = new Set(serverActionModules(20));

/** Every module importing a step-up write, and the writes it imports: a server action module is the write, never its caller. */
const CALLERS = filesUnder(SRC, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 200)
  .filter((file) => !ACTION_MODULES.has(file))
  .map((file) => [path.relative(SRC, file).split(path.sep).join("/"), importedStepUpWrites(file).sort()] as const)
  .filter(([, writes]) => writes.length > 0);

describe("every caller of a step-up write", () => {
  /* Two routes to one set, the imports and the registry: a caller added beside these is driven by
     nothing, and a one-press one is refused by the server past the window with no prompt on offer. */
  it("is registered with how its press asks", () => {
    assert.deepEqual(
      Object.fromEntries(CALLERS),
      Object.fromEntries(Object.entries(STEP_UP_CALLERS).map(([module, writes]) => [module, Object.keys(writes).sort()])),
    );
  });

  it("asks nothing only where the write is the call's and this caller never sends that call", () => {
    for (const [module, writes] of Object.entries(STEP_UP_CALLERS)) {
      for (const [action, press] of Object.entries(writes)) {
        if (press === "never") assert.ok(CONDITIONALLY_STEPPED_UP.has(action), `${module} never asks before ${action}, which always steps up`);
      }
    }
  });
});

/** One press of a caller, from its render to the press that sends the write. */
type Drive = { render: () => ReactNode; reach?: (user: User) => Promise<void>; press: string; asks: boolean; answer?: () => Promise<unknown> };

const REFEREE_ID = "6890a1b2c3d4e5f607800001";
const BESTAETIGT = {
  umfang: "kader_oeffentlich" as const,
  erteilt_von: "volljaehrig" as const,
  datum: "2026-09-22",
  bestaetigt_am: "2026-09-22",
  text_version: "2026-09-schiedsrichterseite",
  medien: false,
  nachweis: { umfang: null, medien: null },
};
const retiredReferee = (answered: boolean) => ({
  id: REFEREE_ID,
  name: "Anna Körner",
  schule: null,
  default_payment: 20,
  kontakt: { telefon: null, email: "anna.koerner@schule.de" },
  inactive_since: "2026-01-10",
  geburtsdatum: answered ? "1990-01-01" : null,
  einwilligung: answered ? BESTAETIGT : null,
  bestaetigung: null,
  adresswechsel: null,
});

const seat = (vorname: string, email: string, bestaetigtAm: string | null = null) => ({
  vorname,
  nachname: "Meier",
  email,
  telefon: "069 1234567",
  geburtsdatum: bestaetigtAm === null ? null : "1988-04-02",
  einwilligung: {
    umfang: "kontaktdaten" as const,
    erfasst_von: bestaetigtAm === null ? ("administrativ" as const) : ("person" as const),
    text_version: "2026-09-bestaetigungsseite",
    datum: "2026-09-01",
    bestaetigt_am: bestaetigtAm,
    medien: false,
    eingetragen_von: null,
    nachweis: { umfang: null, medien: null },
  },
});
const OFFEN = { verschickt_am: "2026-09-01", erinnert_am: null, abgelehnt_am: null, zustellung: null };
const strip = (trainerStieAus: boolean) =>
  underNext(
    h(BewerbungBestaetigungStrip, {
      neubesetzung: laufendeNeubesetzung(),
      bewerbungId: "68d0f2a4c1e2b3a4d5e6f708",
      staende:
        bestaetigungsStand({
          kontakte: {
            ansprechperson: seat("Anna", "anna@schule.example", "2026-09-02"),
            stellvertretung: seat("Bernd", "bernd@schule.example"),
            trainer: trainerStieAus ? null : seat("Clara", "clara@schule.example"),
            trainer_ist_zugleich: null,
          },
          bestaetigungen: {
            ansprechperson: OFFEN,
            stellvertretung: OFFEN,
            trainer: trainerStieAus ? { ...OFFEN, abgelehnt_am: "2026-09-03" } : OFFEN,
          },
          status: "eingereicht",
        }) ?? assert.fail("the strip's fixture carries no confirmation block"),
      frist: "2099-12-31",
      isOpen: true,
      isDirty: false,
      onGetipptChange: () => undefined,
    }),
    { router: nextRouter() },
  );

const refereeEditor = (answered: boolean) =>
  underNext(
    h(AdminSchiedsrichterEditForm, {
      istFassungBekannt: true,
      schiedsrichter: { ...retiredReferee(answered), inactive_since: undefined },
      isRetired: false,
      pageHeader: { title: "Anna Körner" },
    } as never),
    { router: nextRouter(), search: "saison_id=2526" },
  );

/** A confirmed referee's new address waiting on its mailbox, the panel's two controls each minting or voiding its link. */
const adresswechselPanel = () =>
  underNext(
    h(FormAdresswechselSection, {
      schiedsrichterId: REFEREE_ID,
      adresswechsel: { email: "anna@neu.example", verschickt_am: "2026-09-01", frist: "2099-12-31", zustellung: null },
      isDirty: false,
    }),
    { router: nextRouter() },
  );

const moveAddress = async (user: User) => {
  const box = screen.getByRole<HTMLInputElement>("textbox", { name: "E-Mail" });
  await user.clear(box);
  await user.type(box, "anna@neu.example");
};

const TEAM_ID = "a".repeat(24);
const SWAP = { teams: [], playedKnockoutSpiele: 0 };

/** One unconfirmed Ansprechperson and two empty seats, so the editor draws one address box and one re-send. */
const kontakteEditor = () =>
  underNext(
    h(AdminKontakteEditForm, {
      laufendesLabel: publishedLaufendeFassung("bewerbung").text_version,
      teamId: TEAM_ID,
      saison: {
        saisonId: "2627",
        saisonStatus: "future",
        membership: {
          gruppe: "A",
          austritt: null,
          trikot_farbe: null,
          kontakte: { ansprechperson: seat("Anna", "anna@schule.example"), stellvertretung: null, trainer: null, trainer_ist_zugleich: null },
          kontakte_stand: "9f2c",
        },
      },
      pageHeader: { title: "SG Alpha" },
    }),
    { router: nextRouter(), search: "saison_id=2627" },
  );

/** Typed over what the box held and left, as the editor judges a typed field. */
const retype = (label: string, value: string) => async (user: User) => {
  const box = screen.getByRole<HTMLInputElement>("textbox", { name: label });
  await user.clear(box);
  await user.paste(value);
  await act(async () => box.blur());
};

/** Every one-press caller of the registry, and a case of the conditional ones on a call that asks nothing. */
const DRIVES: Record<string, Drive[]> = {
  "features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx :: einwilligungErneutSendenAction": [
    { render: () => strip(false), press: "Link erneut senden: Trainer", asks: true },
  ],
  "features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx :: kontaktEmailKorrigierenAction": [
    {
      render: () => strip(false),
      reach: async (user) => {
        await user.click(screen.getByRole("button", { name: "Adresse korrigieren: Clara Meier" }));
        const box = screen.getByRole<HTMLInputElement>("textbox", { name: "Neue E-Mail-Adresse" });
        await user.clear(box);
        await user.type(box, "clara@neu.example");
      },
      press: "Korrigieren und Link senden",
      asks: true,
    },
  ],
  "features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx :: besetzeKontaktSitzAction": [
    {
      render: () => strip(true),
      reach: async (user) => {
        await user.click(screen.getByRole("button", { name: "Neu besetzen: Trainer" }));
        await user.type(screen.getByRole("textbox", { name: "Vorname" }), "Doreen");
        await user.type(screen.getByRole("textbox", { name: "Nachname" }), "Ostwald");
        await user.type(screen.getByRole("textbox", { name: "Telefon" }), "069 7654321");
        await user.type(screen.getByRole("textbox", { name: "E-Mail" }), "doreen@schule.example");
      },
      press: "Neu besetzen und Link senden",
      asks: true,
    },
  ],
  "features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormBestaetigungSection.tsx :: einladeSchiedsrichterAction": [
    {
      render: () =>
        underNext(
          h(FormBestaetigungSection, {
            istFassungBekannt: true,
            schiedsrichterId: REFEREE_ID,
            hatAdresse: true,
            isRetired: false,
            bestaetigung: null,
            einwilligung: null,
            geburtsdatum: null,
            isDirty: false,
          }),
          { router: nextRouter() },
        ),
      press: "Bestätigungslink senden",
      asks: true,
    },
  ],
  "features/schiedsrichter/components/collections/AdminSchiedsrichterTable.tsx :: reactivateSchiedsrichterAction": [
    ...[true, false].map((unanswered) => ({
      render: () =>
        underNext(
          h(AdminSchiedsrichterTable, {
            filteredSchiedsrichter: [retiredReferee(!unanswered)],
            emptiness: "none",
            setDeletingSchiedsrichter: () => undefined,
          } as never),
          { search: "saison_id=2026" },
        ),
      press: "Reaktivieren: Schiedsrichter Anna Körner",
      asks: unanswered,
    })),
  ],
  "features/schiedsrichter/components/views/AdminSchiedsrichterEditView.tsx :: reactivateSchiedsrichterAction": [
    ...[true, false].map((unanswered) => ({
      render: () =>
        underNext(
          h(AdminSchiedsrichterEditView, {
            istFassungBekannt: true,
            schiedsrichter: { ...retiredReferee(!unanswered), inactive_since: undefined },
            inactiveSince: "2026-01-10",
          } as never),
          { search: "saison_id=2526" },
        ),
      press: "Reaktivieren",
      asks: unanswered,
    })),
  ],
  // A save seating somebody new mints them a link; one correcting a telephone mints nothing and asks nothing.
  "features/kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx :: patchSaisonTeamKontakteAction": [
    { render: kontakteEditor, reach: retype("E-Mail", "anna@neu.example"), press: "Speichern", asks: true },
    { render: kontakteEditor, reach: retype("Telefon", "069 7654321"), press: "Speichern", asks: false },
  ],
  "features/kontakte/components/forms/AdminKontakteEditForm/FormKontaktEinladen.tsx :: einladeKontaktAction": [
    {
      render: () =>
        underNext(
          h(FormKontaktEinladen, { teamId: TEAM_ID, saisonId: "2627", rolle: "ansprechperson", label: "Ansprechperson", isDirty: false }),
          {
            router: nextRouter(),
          },
        ),
      press: "Bestätigungslink senden: Ansprechperson",
      asks: true,
    },
  ],
  "features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm.tsx :: patchSchiedsrichterAction": [
    // A moved address mints on either side of the referee's answer: a consent link before it, an address link after.
    { render: () => refereeEditor(false), reach: moveAddress, press: "Speichern", asks: true },
    { render: () => refereeEditor(true), reach: moveAddress, press: "Speichern", asks: true },
    { render: () => refereeEditor(true), reach: retype("Telefon", "069 7654321"), press: "Speichern", asks: false },
  ],
  "features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormAdresswechselSection.tsx :: einladeAdresswechselAction": [
    { render: () => adresswechselPanel(), press: "Link erneut senden: Neue E-Mail-Adresse", asks: true },
  ],
  "features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormAdresswechselSection.tsx :: verwirfAdresswechselAction": [
    { render: () => adresswechselPanel(), press: "Änderung verwerfen", asks: true },
  ],
  "features/teams/components/forms/AdminTeamEditForm/FormEinladungSection.tsx :: mailEinladungAction": [
    {
      render: () =>
        underNext(
          h(EinladungLinkHolder, {
            scope: `${TEAM_ID}:2627`,
            children: h(FormEinladungSection, {
              teamId: TEAM_ID,
              saisonId: "2627",
              isMember: true,
              isFinishedSaison: false,
              einladung: null,
              laeuft: true,
            }),
          }),
        ),
      // The link a mint hands back, which is the only link the mail can carry.
      answer: () =>
        Promise.resolve({ success: true, einladung_id: "b".repeat(24), token: "t", link: "https://example.org/r/t", message: "Angelegt." }),
      reach: async (user) => {
        await user.click(screen.getByRole("button", { name: "Registrierungslink anlegen" }));
        await act(answered);
        await screen.findByRole("button", { name: "Link per E-Mail senden" });
      },
      press: "Link per E-Mail senden",
      asks: true,
    },
  ],
  "features/teams/components/forms/AdminTeamEditForm/FormSaisonSection.tsx :: postSaisonTeamAction": [
    {
      render: () =>
        underNext(
          h(DraftStatusProvider, {
            status: declaredStatus(["gruppe", "trikot_farbe"]),
            children: h(FormSaisonSection, {
              saison: { saisonId: "2027", saisonStatus: "future" },
              gruppeLock: { locked: false },
              banners: [],
              gruppeOffer: [{ gruppe: "A", occupied: 1, capacity: 4 }],
              isMember: false,
              isRetired: false,
              gruppe: "A",
              onGruppeChange: () => undefined,
              onValidateSelection: () => undefined,
              trikotFarbe: null,
              onTrikotFarbeChange: () => undefined,
              onValidateTrikotSelection: () => undefined,
              swap: SWAP,
              teamId: TEAM_ID,
              isDirty: false,
            } as never),
          }),
        ),
      press: "In Saison 2027 aufnehmen",
      asks: true,
    },
  ],
};

beforeEach(() => {
  prompts.length = 0;
});

describe("a one-press caller of a step-up write past the window", () => {
  it("is driven for every one-press write the registry holds", () => {
    const onePress = Object.entries(STEP_UP_CALLERS).flatMap(([module, writes]) =>
      Object.entries(writes)
        .filter(([, press]) => press === "one-press")
        .map(([action]) => `${module} :: ${action}`),
    );

    assert.deepEqual(Object.keys(DRIVES).sort(), onePress.sort());
  });

  for (const [pair, drives] of Object.entries(DRIVES)) {
    const action = pair.split(" :: ")[1] ?? "";
    for (const drive of drives) {
      it(`${pair}, ${drive.asks ? "asks for the passkey before it sends" : "on a call the server does not hold, asks nothing"}`, async () => {
        const user = userEvent.setup({ delay: null });
        if (drive.answer !== undefined) answerWith(drive.answer);
        const { unmount } = render(staleVia(StepUpContext, drive.render()));
        await drive.reach?.(user);
        const sent = calls.length;
        prompts.length = 0;

        await user.click(screen.getAllByRole("button", { name: drive.press })[0] ?? assert.fail(`nothing to press for ${pair}`));
        await waitFor(() =>
          assert.ok(
            calls.slice(sent).some((call) => call.action === action),
            `${pair}: the press sent no ${action}`,
          ),
        );
        // Its answer lands inside this case, or in the case after it.
        await act(answered);
        unmount();

        assert.deepEqual(
          prompts,
          drive.asks ? [`prompt before ${String(sent)} writes`] : [],
          `${pair}: the prompt did not run exactly as the write asks`,
        );
      });
    }
  }
});

const { STEP_UP_RUNNING } = await import("@/shared/components/ui/stepUp.ts");

/** Whether the next prompt stays open until `release` answers it: until then each answers yes at once, as a reach needs. */
const held: { holding: boolean; release?: (confirmed: boolean) => void } = { holding: false };
const heldVia = (tree: ReactNode): ReactNode =>
  h(
    StepUpContext.Provider,
    {
      value: {
        isStale: () => true,
        confirm: () => (held.holding ? new Promise<boolean>((resolve) => (held.release = resolve)) : Promise.resolve(true)),
      },
    },
    tree,
  );

describe("a one-press caller of a step-up write, while its prompt is open", () => {
  beforeEach(() => {
    held.holding = false;
    held.release = undefined;
  });

  for (const [pair, drives] of Object.entries(DRIVES)) {
    const action = pair.split(" :: ")[1] ?? "";
    for (const drive of drives.filter((each) => each.asks)) {
      /* Nothing is sent while the passkey prompt is open, so the pressed control reads the step-up's
         words rather than the write's own running words. */
      it(`${pair}, reads as confirming rather than sending`, async () => {
        const user = userEvent.setup({ delay: null });
        if (drive.answer !== undefined) answerWith(drive.answer);
        const { unmount } = render(heldVia(drive.render()));
        await drive.reach?.(user);
        const sent = calls.length;
        held.holding = true;

        const pressed = screen.getAllByRole("button", { name: drive.press })[0] ?? assert.fail(`nothing to press for ${pair}`);
        const wordless = pressed.textContent === "";
        await user.click(pressed);
        await waitFor(() => assert.ok(held.release !== undefined, `${pair}: the press opened no prompt`));
        // An icon control has no words to change, so it answers a second press by its pending state instead.
        if (wordless)
          assert.equal(pressed.getAttribute("data-pending"), "true", `${pair}: the icon control takes a second press while the prompt is open`);
        else assert.equal(pressed.textContent, STEP_UP_RUNNING, `${pair}: the control does not read as confirming while the prompt is open`);
        assert.ok(!calls.slice(sent).some((call) => call.action === action), `${pair}: the write went out while the prompt was open`);

        held.release?.(true);
        await waitFor(() =>
          assert.ok(
            calls.slice(sent).some((call) => call.action === action),
            `${pair}: the press sent no ${action}`,
          ),
        );
        await act(answered);
        unmount();
      });
    }
  }
});

describe("a create sending a step-up write", () => {
  it("declares it to the create form, which asks before it sends", async () => {
    const creates = Object.entries(STEP_UP_CALLERS).flatMap(([module, writes]) =>
      Object.values(writes).some((press: StepUpPress) => press === "create") ? [module] : [],
    );
    assert.ok(creates.length > 0, "the registry names no create, so nothing below is judged");

    for (const create of creates) {
      const exports = (await import(pathToFileURL(path.join(SRC, create)).href)) as Record<
        string,
        (props: { onClose: () => void }) => ReactNode
      >;
      const Create = Object.values(exports)[0] ?? assert.fail(`${create} exports no create`);
      declaredToTheCreateForm.length = 0;
      const { unmount } = render(underNext(h(Create, { onClose: () => undefined })));
      unmount();
      assert.deepEqual(declaredToTheCreateForm.slice(0, 1), [true], `${create} does not declare its step-up to the create form`);
    }
  });
});

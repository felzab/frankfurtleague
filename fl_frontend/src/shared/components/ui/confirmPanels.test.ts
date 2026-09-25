import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { doubleEveryAction, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { declaredStatus } from "@/shared/testing/declaredStatus.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { ReactNode } from "react";

const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

/* Every row a panel renders is wrapped in a marked box, so a second row counts whether or not its
   press is the armed one: an unarmed row renders nothing else a reader could count. */
const ROW_URL = pathToFileURL(path.join(import.meta.dirname, "ConfirmActionRow.tsx")).href;
const REACT_URL = pathToFileURL(createRequire(import.meta.filename).resolve("react")).href;
const COUNTED_ROW = `data:text/javascript,${encodeURIComponent(
  `import { createElement } from ${JSON.stringify(REACT_URL)};
   import { ConfirmActionRow as Row } from ${JSON.stringify(ROW_URL)};
   export function ConfirmActionRow(props) { return createElement("div", { "data-confirm-row": "" }, createElement(Row, props)); }`,
)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/shared/components/ui/ConfirmActionRow") return { url: COUNTED_ROW, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { answerWith } = doubleEveryAction();
doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const load = async <T>(module: string, name: string): Promise<T> => ((await import(`@/${module}`)) as Record<string, T>)[name] as T;
type Component = (props: never) => ReactNode;
const component = (module: string, name: string) => load<Component>(module, name);
const el = (C: Component, props: object): ReactNode => h(C as (props: object) => ReactNode, props);

const { EinladungLinkHolder } = await import("@/features/einladungen/components/EinladungLinkHolder.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

type User = ReturnType<typeof userEvent.setup>;

/** One operation a panel offers: the panel before it, the picks it needs, the read it arms on, and the press that arms it. */
type Arming = { render: () => ReactNode; reach?: (user: User) => Promise<void>; answer?: () => Promise<unknown>; resting: string };

const pick = async (user: User, box: RegExp, option: RegExp) => {
  await user.click(screen.getByRole("button", { name: box }));
  await user.click(screen.getByRole("option", { name: option }));
};

const swapTeam = (id: string, name: string, gruppe: "A" | "B") => ({
  id,
  name,
  gruppe,
  gespielteGruppenSpiele: 0,
  gruppenSpieleProSpieltag: {},
  koSpieleProSpieltag: {},
});
const SWAP = { teams: [swapTeam("t1", "SG Alpha", "A"), swapTeam("t2", "TSV Beta", "B")], playedKnockoutSpiele: 0 };

const RULES = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_group: 2,
  number_of_groups: 2,
  teams_per_group: 4,
  max_kadergroesse: 18,
  tiebreak_order: "tordifferenz",
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  erlaubte_stufen: ["E1", "Q1"],
};
const UNDRAWN = {
  saisonId: "2026-27",
  saisonStatus: "future",
  rules: RULES,
  startDate: "2026-08-01",
  endDate: "2027-06-30",
  spielplan: null,
  spieltageCount: 0,
  schedule: [
    { phase: "gruppenphase", matchdays: 3, matches_per_matchday: 4 },
    { phase: "halbfinale", matchdays: 1, matches_per_matchday: 2 },
    { phase: "finale", matchdays: 1, matches_per_matchday: 1 },
  ],
  gruppenOccupancy: { A: 4, B: 4 },
  bestand: { spiele: 0, erfasst: 0, angesetzt: 0 },
  hasDrawnSpiele: false,
  onBeforeWrite: () => true,
};
const DRAWN = {
  ...UNDRAWN,
  spielplan: { generiert_am: "2026-07-01", spieltage: 5, spiele: 15 },
  spieltageCount: 5,
  bestand: { spiele: 15, erfasst: 0, angesetzt: 4 },
  hasDrawnSpiele: true,
};

const TEAM_ID = "a".repeat(24);
const LIVE_EINLADUNG = {
  id: "b".repeat(24),
  saison_id: "2627",
  team_id: TEAM_ID,
  erstellt_am: "2026-09-01",
  erstellt_von: "vorstand@beispiel.de",
  widerrufen_am: null,
  versand: { zustellung: null },
};

const M = {
  ablehnen: "features/bewerbungen/components/forms/AdminBewerbungAblehnenSection.tsx",
  annehmen: "features/bewerbungen/components/forms/AdminBewerbungAnnehmenSection.tsx",
  bestaetigung: "features/bewerbungen/components/views/BestaetigungFormPanel.tsx",
  kontakteLoeschen: "features/kontakte/components/forms/AdminKontakteEditForm/FormKontakteLoeschenSection.tsx",
  kontaktErasure: "features/kontakte/components/forms/AdminKontakteEditForm/FormKontaktErasure.tsx",
  passkey: "features/passkeys/components/modals/PasskeyEintragRow.tsx",
  einladungVersand: "features/saisons/components/forms/AdminSaisonEditForm/FormEinladungVersandSection.tsx",
  gruppenSwap: "features/saisons/components/forms/AdminSaisonEditForm/FormGruppenSwapSection.tsx",
  rollover: "features/saisons/components/forms/AdminSaisonEditForm/FormRolloverSection.tsx",
  spielplan: "features/saisons/components/forms/AdminSaisonEditForm/FormSpielplanSection.tsx",
  teamErsatz: "features/saisons/components/forms/AdminSaisonEditForm/FormTeamErsatzSection.tsx",
  anonymisieren: "features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormAnonymisierenSection.tsx",
  sperre: "features/sperrliste/components/forms/AdminSperreAufhebenPanel.tsx",
  spielerLoeschen: "features/spieler/components/forms/AdminSpielerEditForm/FormLoeschenSection.tsx",
  einladung: "features/teams/components/forms/AdminTeamEditForm/FormEinladungSection.tsx",
  saison: "features/teams/components/forms/AdminTeamEditForm/FormSaisonSection.tsx",
};

const C = {
  ablehnen: await component(M.ablehnen, "AdminBewerbungAblehnenSection"),
  annehmen: await component(M.annehmen, "AdminBewerbungAnnehmenSection"),
  bestaetigung: await component(M.bestaetigung, "BestaetigungFormPanel"),
  kontakteLoeschen: await component(M.kontakteLoeschen, "FormKontakteLoeschenSection"),
  kontaktErasure: await component(M.kontaktErasure, "FormKontaktErasure"),
  passkey: await component(M.passkey, "PasskeyEintragRow"),
  einladungVersand: await component(M.einladungVersand, "FormEinladungVersandSection"),
  gruppenSwap: await component(M.gruppenSwap, "FormGruppenSwapSection"),
  rollover: await component(M.rollover, "FormRolloverSection"),
  spielplan: await component(M.spielplan, "FormSpielplanSection"),
  teamErsatz: await component(M.teamErsatz, "FormTeamErsatzSection"),
  anonymisieren: await component(M.anonymisieren, "FormAnonymisierenSection"),
  sperre: await component(M.sperre, "AdminSperreAufhebenPanel"),
  spielerLoeschen: await component(M.spielerLoeschen, "FormLoeschenSection"),
  einladung: await component(M.einladung, "FormEinladungSection"),
  saison: await component(M.saison, "FormSaisonSection"),
};

const einladungPanel = () =>
  underNext(
    h(EinladungLinkHolder, {
      scope: `${TEAM_ID}:2627`,
      children: el(C.einladung, {
        teamId: TEAM_ID,
        saisonId: "2627",
        isMember: true,
        isFinishedSaison: false,
        einladung: LIVE_EINLADUNG,
        laeuft: true,
      }),
    }),
  );

/** Every panel rendering the shared row or reveal, with each operation it offers. */
const PANELS: Record<string, Arming[]> = {
  [M.ablehnen]: [
    {
      render: () => underNext(el(C.ablehnen, { bewerbungId: "68d0f2a4c1e2b3a4d5e6f708", teamName: "SG Alpha", saisonId: "2027" })),
      reach: (user) => user.type(screen.getByRole("textbox", { name: "Grund für die Absage" }), "Kein Platz."),
      resting: "Bewerbung ablehnen",
    },
  ],
  [M.annehmen]: [
    {
      render: () =>
        underNext(
          el(C.annehmen, {
            bewerbungId: "68d0f2a4c1e2b3a4d5e6f708",
            teamName: "SG Alpha",
            createsTeam: false,
            saisonId: "2027",
            saisonStatus: "future",
            gruppeOffer: [{ gruppe: "A", occupied: 1, capacity: 4 }],
            hindernis: null,
          }),
        ),
      reach: async (user) => {
        await user.selectOptions(document.querySelector('select[name="gruppe"]') ?? assert.fail("the acceptance offers no group"), "A");
      },
      resting: "Bewerbung annehmen",
    },
  ],
  [M.bestaetigung]: [
    {
      render: () =>
        el(C.bestaetigung, {
          token: "kein-echtes-token",
          vorname: "Mira",
          schule: "Lessing-Kolleg",
          saison: "2026",
          rolle: "Ansprechperson",
          mindestalter: 16,
          onAbschluss: () => undefined,
        }),
      resting: "Ich möchte nicht eingetragen sein",
    },
  ],
  [M.kontakteLoeschen]: [
    {
      render: () => underNext(el(C.kontakteLoeschen, { teamId: "t1", saisonId: "2526", hasStored: true, stand: "9f2c", isDirty: false })),
      resting: "Kontakte löschen",
    },
  ],
  [M.kontaktErasure]: [
    {
      render: () => underNext(el(C.kontaktErasure, { email: "ada@example.org", fullName: "Ada Byron", isDirty: false })),
      resting: "Kontaktperson löschen",
    },
  ],
  [M.passkey]: [
    {
      render: () =>
        h(
          "ul",
          null,
          el(C.passkey, {
            eintrag: { id: "p1", createdAt: "2026-09-01T10:00:00.000Z", label: "YubiKey 5" },
            reason: null,
            onRemove: () => Promise.resolve(),
          }),
        ),
      resting: "Löschen",
    },
  ],
  [M.einladungVersand]: [
    {
      render: () => underNext(el(C.einladungVersand, { saisonId: "2627", isFinishedSaison: false })),
      answer: () =>
        Promise.resolve({
          success: true,
          zeilen: [
            {
              team_id: "a".repeat(24),
              team_name: "Ernst-Reuter-Schule",
              empfaenger: [{ rolle: "ansprechperson", vorname: "Erika", email: "erika@beispiel.de" }],
              uebersprungen: null,
              ersetzt_link: false,
            },
          ],
        }),
      resting: "Links an alle Teams senden",
    },
  ],
  [M.gruppenSwap]: [
    {
      render: () => underNext(el(C.gruppenSwap, { saisonId: "2027", swap: SWAP, isFinishedSaison: false })),
      reach: async (user) => {
        await pick(user, /^Team/, /^SG Alpha/);
        await pick(user, /^Tauscht Gruppen mit/, /^TSV Beta/);
      },
      resting: "Gruppen tauschen",
    },
  ],
  [M.rollover]: [
    {
      render: () =>
        underNext(
          el(C.rollover, {
            saisonId: "2026",
            saisonStatus: "future",
            rollover: { outgoingSaisonId: null, offeneSpiele: [], hasUndatierteSpieltage: false },
            hasDrawnSpiele: true,
            onBeforeActivate: () => true,
            banners: [],
          }),
        ),
      resting: "Auf Saison 2026 umstellen",
    },
  ],
  [M.spielplan]: [
    { render: () => underNext(el(C.spielplan, UNDRAWN)), resting: "Spielplan anlegen" },
    {
      render: () => underNext(el(C.spielplan, DRAWN)),
      reach: (user) => user.click(screen.getByRole("radio", { name: "Zurücknehmen" })),
      resting: "Spielplan zurücknehmen",
    },
  ],
  [M.teamErsatz]: [
    {
      render: () =>
        underNext(
          el(C.teamErsatz, {
            saisonId: "2026-27",
            ersatz: {
              rows: [{ teamId: "t1", name: "SG Alpha", gruppe: "A", spiele: 4, gespielteSpiele: 0, hasAustritt: false, isVerwaist: false }],
              candidates: [{ id: "c1", name: "TSV Beta", isStillgelegt: false, isInSaison: false }],
            },
            isFinishedSaison: false,
          }),
        ),
      reach: async (user) => {
        await pick(user, /^Ausscheidendes Team/, /^SG Alpha/);
        await pick(user, /^Nachrückendes Team/, /^TSV Beta/);
      },
      resting: "Team ersetzen",
    },
  ],
  [M.anonymisieren]: [
    {
      render: () =>
        underNext(
          el(C.anonymisieren, {
            schiedsrichterId: "68c1f0a2b3c4d5e6f7a8b9c0",
            name: "Anna Beispiel",
            schule: "Musterschule",
            kontakt: { email: "anna@example.de", telefon: "069 1234567" },
            onBeforeAnonymise: () => true,
          }),
        ),
      resting: "Daten löschen",
    },
  ],
  [M.sperre]: [
    {
      render: () => underNext(el(C.sperre, { sperreId: "6890a1b2c3d4e5f607190001", gesperrtAm: "12.03.2026" })),
      resting: "Sperre vom 12.03.2026 aufheben",
    },
  ],
  [M.spielerLoeschen]: [
    {
      render: () =>
        underNext(
          el(C.spielerLoeschen, { spielerId: "68c1f0a2b3c4d5e6f7a8b9c0", fullName: "Lena Meier", isRetired: true, membershipCount: 2 }),
          {
            search: "saison_id=2026",
          },
        ),
      resting: "Spieler endgültig löschen",
    },
  ],
  [M.einladung]: [
    { render: einladungPanel, reach: (user) => user.click(screen.getByRole("radio", { name: "Ersetzen" })), resting: "Neuen Link anlegen" },
    { render: einladungPanel, reach: (user) => user.click(screen.getByRole("radio", { name: "Zurückziehen" })), resting: "Link zurückziehen" },
  ],
  [M.saison]: [
    {
      render: () =>
        underNext(
          h(DraftStatusProvider, {
            status: declaredStatus(["gruppe", "trikot_farbe"]),
            children: el(C.saison, {
              saison: { saisonId: "2027", saisonStatus: "active" },
              gruppeLock: { locked: true },
              banners: [],
              gruppeOffer: [
                { gruppe: "A", occupied: 1, capacity: 4 },
                { gruppe: "B", occupied: 1, capacity: 4 },
              ],
              isMember: true,
              isRetired: false,
              gruppe: "A",
              onGruppeChange: () => undefined,
              onValidateSelection: () => undefined,
              trikotFarbe: null,
              onTrikotFarbeChange: () => undefined,
              onValidateTrikotSelection: () => undefined,
              swap: SWAP,
              teamId: "t1",
            }),
          }),
        ),
      reach: (user) => pick(user, /Tauschen mit/, /^TSV Beta/),
      resting: "Gruppen tauschen",
    },
  ],
};

/** Every module rendering the shared row or reveal, read off its syntax tree. */
const RENDERING_MODULES = filesUnder(SRC, (name) => name.endsWith(".tsx") && !isTestFile(name), 200)
  .filter((file) => {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let renders = false;
    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (tag === "ConfirmActionRow" || tag === "ConfirmReveal") renders = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    return renders;
  })
  .map((file) => path.relative(SRC, file).split(path.sep).join("/"));

describe("the panels these cases arm", () => {
  /* A panel added beside these is armed nowhere, and a second reveal in it stands until somebody sees
     two alerts on one page. */
  it("are every module rendering the shared row or reveal", () => {
    assert.deepEqual([...RENDERING_MODULES].sort(), Object.keys(PANELS).sort());
  });
});

/* `docs/frontend/spec.md :: I66`: a second reveal would arm one operation while the row below confirmed
   the other. Armed, since a reveal renders only then. */
describe("one reveal and one action row per panel, whatever it offers", () => {
  for (const [module, armings] of Object.entries(PANELS)) {
    for (const arming of armings) {
      it(`${module}, armed on „${arming.resting}“`, async () => {
        const user = userEvent.setup();
        if (arming.answer !== undefined) answerWith(arming.answer);
        const { unmount } = render(arming.render());
        await arming.reach?.(user);
        await user.click(screen.getByRole("button", { name: arming.resting }));
        // Found rather than got: a panel that arms once a read it started has answered is armed after the click returns.
        await screen.findByRole("button", { name: "Abbrechen" });

        const reveals = screen.getAllByRole("alert").length;
        const rows = document.querySelectorAll("[data-confirm-row]").length;
        unmount();

        assert.equal(reveals, 1, "the armed panel shows a reveal count other than one");
        assert.equal(rows, 1, "the panel renders a row count other than one");
      });
    }
  }
});

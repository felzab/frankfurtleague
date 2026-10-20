import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { ZUSTELLUNG_CHIP } from "@/features/bewerbungen/zustellung.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { nextRouter, recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { FLAdresswechselVerwaltungOffen } from "@/features/adresswechsel/schemas.ts";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { answerWith, answered, calls } = doubleActions({
  modules: ["/src/features/adresswechsel/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdresswechselWartet, ADRESSWECHSEL_ERNEUT, ADRESSWECHSEL_VERWERFEN } = await import("./AdresswechselWartet.tsx");

const ADRESSWECHSEL_ID = "68c1f0a2b3c4d5e6f7a8b9e0";

/** A change with a reason, its new mailbox asked: the state that offers both controls. */
const OFFEN: FLAdresswechselVerwaltungOffen = {
  id: ADRESSWECHSEL_ID,
  email: "lena@neu.example",
  weg: "wartezeit",
  grund: "Postfach von der Schule gelöscht",
  wartet_auf: "neue_adresse",
  verschickt_am: "2026-10-01",
  gueltig_bis: "2099-12-31T11:30:00Z",
  freigegeben_am: null,
  bestaetigt_am: null,
  wirksam_ab: null,
  zustellung: null,
  abgelaufen: false,
  genehmigung: null,
};

function panel(offen: FLAdresswechselVerwaltungOffen, router = nextRouter()) {
  const geschrieben = { count: 0 };
  const tree = underNext(h(AdresswechselWartet, { offen, onGeschrieben: () => void (geschrieben.count += 1) }), {
    router,
    search: "saison_id=2026",
  });
  return { tree, geschrieben };
}

const words = (offen: FLAdresswechselVerwaltungOffen): string =>
  textOf(renderTree(panel(offen).tree), " ")
    .replace(/\s+/g, " ")
    .trim();

beforeEach(() => {
  toasts.length = 0;
});

describe("what the tool shows of the change waiting at an address", () => {
  it("names the new address, its way and reason, the day its link went and its deadline to the minute, with both controls", () => {
    const shown = words(OFFEN);

    assert.match(shown, /Neue Adresse wartet auf Bestätigung/);
    assert.match(shown, /lena@neu\.example/);
    assert.match(shown, /Ohne die bisherige Adresse/);
    assert.match(shown, /Postfach von der Schule gelöscht/);
    assert.match(shown, /01\.10\.2026/);
    // 12:30 in Berlin in December: an instant stated in UTC would read 11:30.
    assert.match(shown, /31\.12\.2099 um 12:30 Uhr/);
    assert.ok(shown.includes(ADRESSWECHSEL_ERNEUT) && shown.includes(ADRESSWECHSEL_VERWERFEN), "a control is missing");
  });

  /* The pass ends a lapsed change within the hour, so until then a past instant alone would read as a deadline still running. */
  it("says a lapsed link is lapsed, once and beside its instant, by the read's judgement alone", () => {
    const lapsed = words({ ...OFFEN, gueltig_bis: "2020-01-01T11:00:00Z", abgelaufen: true });

    assert.equal(lapsed.split("abgelaufen").length - 1, 1, "the lapse is said other than once");
    assert.match(lapsed, /01\.01\.2020 um 12:00 Uhr abgelaufen/);
    assert.doesNotMatch(words({ ...OFFEN, gueltig_bis: "2020-01-01T11:00:00Z", abgelaufen: false }), /abgelaufen/);
  });

  /* Before the approval the request went to the address on file, so its facts are that request's, never a link's. */
  it("shows a change waiting on the address on file's approval by that request's day and deadline, with the discard alone", () => {
    const shown = words({ ...OFFEN, weg: "freigabe", grund: null, wartet_auf: "freigabe", gueltig_bis: "2099-12-31T11:30:00Z" });

    assert.match(shown, /Neue Adresse wartet auf Freigabe durch die bisherige/);
    assert.match(shown, /Anfrage gesendet am 01\.10\.2026/);
    assert.match(shown, /Freigabe bis 31\.12\.2099 um 12:30 Uhr/);
    assert.ok(!shown.includes(ADRESSWECHSEL_ERNEUT), "a change with no link to send offers a re-send");
    assert.ok(shown.includes(ADRESSWECHSEL_VERWERFEN), "the discard is missing");
  });

  it("shows a confirmed change by the instant it takes effect, with the discard alone", () => {
    const shown = words({
      ...OFFEN,
      wartet_auf: "wartezeit",
      gueltig_bis: null,
      bestaetigt_am: "2026-10-20T11:30:00Z",
      wirksam_ab: "2026-10-27T11:30:00Z",
    });

    assert.match(shown, /Neue Adresse gilt ab 27\.10\.2026 um 12:30 Uhr/);
    assert.ok(!shown.includes(ADRESSWECHSEL_ERNEUT), "a spent link is offered again");
    assert.ok(shown.includes(ADRESSWECHSEL_VERWERFEN), "the discard is missing");
  });

  /* The approval is pressed on the grant's row, so the tool reads it and links there rather than offering a second press. */
  it("shows an approval still open as its deadline and the way to the administrators page, offering no approval itself", () => {
    const { tree } = panel({
      ...OFFEN,
      wartet_auf: "genehmigung",
      gueltig_bis: null,
      bestaetigt_am: "2026-10-20T11:30:00Z",
      genehmigung: { verwaltung: "administration", bis: "2026-10-27T11:30:00Z", genehmigt_am: null, genehmigt_von: null },
    });
    const { unmount } = render(tree);

    assert.match(document.body.textContent ?? "", /Neue Adresse wartet auf Genehmigung durch die Verwaltung/);
    assert.match(document.body.textContent ?? "", /Offen bis 27\.10\.2026 um 12:30 Uhr/);
    assert.equal(
      screen.getByRole("link", { name: "Zu den Administratoren" }).getAttribute("href"),
      "/bereich/admin/administratoren?saison_id=2026",
    );
    assert.equal(screen.queryAllByRole("button", { name: /genehmig/i }).length, 0, "the tool offers the approval it only reads");
    unmount();
  });

  it("names who approved and when, once approved", () => {
    const shown = words({
      ...OFFEN,
      wartet_auf: "wartezeit",
      gueltig_bis: null,
      bestaetigt_am: "2026-10-20T11:30:00Z",
      wirksam_ab: "2026-10-27T11:30:00Z",
      genehmigung: {
        verwaltung: "owner",
        bis: "2026-10-27T11:30:00Z",
        genehmigt_am: "2026-10-21T09:00:00Z",
        genehmigt_von: "anna@liga.example",
      },
    });

    assert.match(shown, /Erteilt am 21\.10\.2026 um 11:00 Uhr von anna@liga\.example/);
  });

  it("wears the delivery register's own chip where the link's message was refused", () => {
    const shown = words({ ...OFFEN, zustellung: { nachricht_id: "m1", stand: "unzustellbar", grund: null, am: "2026-10-01T10:00:00Z" } });

    assert.ok(shown.includes(ZUSTELLUNG_CHIP.unzustellbar?.label ?? "-"), "the refused delivery is not named");
  });
});

describe("the waiting change's two controls", () => {
  /* By the change's id, never the address: a tab older than a newer change meets this one's end rather than acting on its successor. */
  for (const [control, action] of [
    [ADRESSWECHSEL_ERNEUT, "einladeAdresswechselAction"],
    [ADRESSWECHSEL_VERWERFEN, "verwirfAdresswechselAction"],
  ] as const) {
    it(`sends ${action} for the change shown alone, and has the tool read again`, async () => {
      answerWith(() => Promise.resolve({ success: true, message: "Gesendet.", versand: "gesendet", hinweis: null, adresseBelegt: false }));
      const { tree, geschrieben } = panel(OFFEN);
      const { unmount } = render(tree);
      const before = calls.length;

      await userEvent.setup().click(screen.getByRole("button", { name: control }));
      await act(answered);

      assert.deepEqual(
        calls.slice(before).map((call) => [call.action, call.payload]),
        [[action, { id: ADRESSWECHSEL_ID }]],
      );
      assert.equal(geschrieben.count, 1, "the tool kept showing the change as it stood before the press");
      unmount();
    });
  }

  /* Graded as the start's press grades it, the earlier link being dead either way (`docs/frontend/spec.md :: I679`). */
  for (const [versand, variant, title] of [
    ["gesendet", "success", "Link gesendet"],
    ["fehlgeschlagen", "warning", "Link nicht verschickt"],
    ["gesperrt", "warning", "Link zurückgehalten"],
    ["zurueckgehalten", "warning", "Link zurückgehalten"],
  ] as const) {
    it(`grades a re-send whose link is ${versand} a ${variant} titled „${title}“`, async () => {
      answerWith(() =>
        Promise.resolve({ success: true, message: "Der vorherige Link gilt nicht mehr.", versand, hinweis: null, adresseBelegt: false }),
      );
      const { tree } = panel(OFFEN);
      const { unmount } = render(tree);

      await userEvent.setup().click(screen.getByRole("button", { name: ADRESSWECHSEL_ERNEUT }));
      await act(answered);

      await waitFor(() =>
        assert.deepEqual(
          toasts.map((shown) => [shown.variant, shown.title]),
          [[variant, title]],
        ),
      );
      unmount();
    });
  }

  it("titles a discard „Änderung verworfen“ with the action's own words", async () => {
    answerWith(() => Promise.resolve({ success: true, message: "Die Änderung ist verworfen. Die bisherige Adresse bleibt." }));
    const { tree } = panel(OFFEN);
    const { unmount } = render(tree);

    await userEvent.setup().click(screen.getByRole("button", { name: ADRESSWECHSEL_VERWERFEN }));
    await act(answered);

    await waitFor(() =>
      assert.deepEqual(
        toasts.map((shown) => [shown.variant, shown.title, shown.description]),
        [["success", "Änderung verworfen", "Die Änderung ist verworfen. Die bisherige Adresse bleibt."]],
      ),
    );
    unmount();
  });
});

describe("a press of the waiting change's controls nobody can tell landed", () => {
  /* A send saves nothing, so its title names the link, and sending again is safe; a second discard of a
     change already gone is refused, so the address, shown again, decides. */
  const arms: Record<string, { control: string; title: string; repair: string }> = {
    send: {
      control: ADRESSWECHSEL_ERNEUT,
      title: "Unklar, ob der Link verschickt wurde",
      repair: "Prüfe die Verbindung, lade die Seite neu und sende den Link erneut. Ein neuer Link ersetzt einen, der schon rausging.",
    },
    discard: {
      control: ADRESSWECHSEL_VERWERFEN,
      title: "Unklar, ob es gespeichert wurde",
      repair: "Prüfe die Verbindung und zeige die Adresse erneut an. Wartet die neue Adresse dann noch, verwirf die Änderung erneut.",
    },
  };
  for (const [arm, { control, title, repair }] of Object.entries(arms)) {
    it(`titles the ${arm} by what is unknown of it and names its own next step`, async () => {
      answerWith(() => Promise.reject(new TypeError("Failed to fetch")));
      const { router } = recordingRouter();
      const { tree, geschrieben } = panel(OFFEN, router);
      const { unmount } = render(tree);

      await userEvent.setup().click(screen.getByRole("button", { name: control }));
      await act(answered);

      await waitFor(() =>
        assert.deepEqual(
          toasts.map((shown) => [shown.title, shown.description, shown.options?.outcome]),
          [[title, repair, "unknown"]],
        ),
      );
      assert.equal(geschrieben.count, 0, "a press nobody can tell landed was read as landed");
      unmount();
    });
  }
});

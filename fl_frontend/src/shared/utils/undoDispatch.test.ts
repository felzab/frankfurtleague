import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { setImmediate as settled } from "node:timers/promises";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";

import type { RaisedToast } from "@/shared/testing/actionDoubles.ts";

/* Replaced at the module boundary: the cases below press the offer's own `onPress` and read which
   toasts followed it, and the real module hands both to HeroUI's queue rather than back to its caller. */
const { raised } = doubleToasts();

const FEATURES = path.resolve(import.meta.dirname, "..", "..", "features");

/**
 * Every page-owned editor that offers an undo, each dispatching through `offerUndo` to its own
 * route. A `fetch` of an editor's own would regrow the per-editor copy the shared dispatch removed.
 */
const EDITORS: Record<string, string> = {
  kontakte: "kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx",
  saisons: "saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm.tsx",
  schiedsrichter: "schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm.tsx",
  spiele: "spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm.tsx",
  spieler: "spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm.tsx",
  spielorte: "spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm.tsx",
  spieltage: "spieltage/components/forms/AdminSpieltagEditForm/AdminSpieltagEditForm.tsx",
  teams: "teams/components/forms/AdminTeamEditForm/AdminTeamEditForm.tsx",
};

// Imported here rather than at the top: a static import resolves before the hook above is registered.
const { offerUndo } = await import("./undoDispatch.ts");

/** The ruling's words for an undo nobody can tell landed. */
const RUECKNAHME_UNKLAR = "Ob die Änderung zurückgenommen wurde, ist unklar. Lade die Seite neu und prüfe sie.";

type Pressed = {
  replacedWith: string[];
  /** How many toasts the press had raised by each departure, the offer's own not counted. */
  toastsBeforeLeaving: number[];
  refreshed: number;
  toasts: RaisedToast[];
};

/** Offers an undo, presses it against one answer from the route or a request that never arrived, and reports what the press did. */
async function pressAgainst(answer: Response | Error): Promise<Pressed> {
  const replacedWith: string[] = [];
  const toastsBeforeLeaving: number[] = [];
  let refreshed = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  };

  try {
    offerUndo({
      endpoint: "/api/admin/spielorte/undo",
      body: {},
      fallback: "Die Spielortdaten wurden aktualisiert.",
      router: {
        refresh: () => refreshed++,
        replace: (href) => {
          replacedWith.push(href);
          toastsBeforeLeaving.push(raised.length - 1);
        },
      },
    });
    raised[0]?.options?.actionProps?.onPress?.();
    await settled();

    return { replacedWith, toastsBeforeLeaving, refreshed, toasts: raised.slice(1) };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("what the shared undo dispatch says when it never landed", () => {
  beforeEach(() => {
    raised.length = 0;
  });

  /* A dispatch whose answer never came may have restored the change on its way, so „nicht
     zurückgenommen“ would send the admin to undo by hand what may already be undone. */
  it("says nobody can tell whether a dispatch that never answered took the change back", async () => {
    const pressed = await pressAgainst(new TypeError("Failed to fetch"));

    assert.deepEqual(
      pressed.toasts.filter((toast) => toast.variant === "danger").map((toast) => [toast.title, toast.description]),
      [["Rücknahme unklar", RUECKNAHME_UNKLAR]],
    );
    assert.deepEqual(pressed.replacedWith, [], "a dispatch that never answered leaves the page");
  });
});

describe("where the shared undo dispatch sends a caller the route turned away", () => {
  beforeEach(() => {
    raised.length = 0;
  });

  /* Said before leaving: a new sign-in lands on `/admin` rather than back on this change, so a
     departure alone leaves the change the admin meant to take back standing unnoticed. */
  it("says the change still stands, then leaves for `/signin` on the route's 401", async () => {
    const pressed = await pressAgainst(
      Response.json({ success: false, error: "Deine Sitzung hat keine Administratorrechte." }, { status: 401 }),
    );
    const gescheitert = pressed.toasts.at(-1);

    assert.deepEqual(pressed.replacedWith, ["/signin"]);
    assert.equal(gescheitert?.variant, "danger", "the lapsed session leaves the page without reporting the undo that did not happen");
    assert.equal(gescheitert?.title, "Änderung nicht zurückgenommen");
    assert.equal(gescheitert?.options?.description, "Die Änderung steht weiterhin. Melde Dich neu an.");
    assert.deepEqual(pressed.toastsBeforeLeaving, [2], "the page is left before the outcome is reported");
  });

  /* `fl_frontend/src/proxy.ts`'s other destination: signing in again is no way back for an address the
     allowlist does not hold, so the sentence names the cause and no repair. */
  it("says the change still stands, then leaves for `/` on the route's own 403", async () => {
    const pressed = await pressAgainst(
      Response.json({ success: false, error: "Deine Sitzung hat keine Administratorrechte." }, { status: 403 }),
    );
    const gescheitert = pressed.toasts.at(-1);

    assert.deepEqual(pressed.replacedWith, ["/"]);
    assert.equal(gescheitert?.variant, "danger");
    assert.equal(gescheitert?.title, "Änderung nicht zurückgenommen");
    assert.equal(gescheitert?.options?.description, "Die Änderung steht weiterhin. Deine Sitzung hat keine Administratorrechte.");
    assert.deepEqual(pressed.toastsBeforeLeaving, [2], "the page is left before the outcome is reported");
  });

  /* The cases proving the two above are the route's doing: an edge's 403 carries no envelope and is
     the transport, and a refusal the route answered 200 is the replay's, and neither leaves the page. */
  it("stays for any other answer, blaming the transport on an edge's 403 and the replay on a refusal", async () => {
    const challenged = await pressAgainst(new Response("<html></html>", { status: 403 }));
    assert.deepEqual(challenged.replacedWith, []);
    assert.equal(challenged.toasts.at(-1)?.variant, "danger");

    raised.length = 0;
    const refused = await pressAgainst(Response.json({ success: false, error: "Die Änderung steht weiterhin." }));
    assert.deepEqual(refused.replacedWith, []);
    assert.equal(refused.refreshed, 1);
  });

  /* A restore whose commit answer was lost may stand, and the route's sentence for it speaks of a save
     rather than of the change being taken back. */
  it("says nobody can tell whether a replay of unknown outcome took the change back", async () => {
    const error = "Ob die Änderung gespeichert wurde, ist unklar. Lade die Seite neu und prüfe, ob sie da ist.";
    const pressed = await pressAgainst(Response.json({ success: false, error, outcome: "unknown" }));

    assert.deepEqual(
      pressed.toasts.filter((toast) => toast.variant === "danger").map((toast) => [toast.title, toast.description]),
      [["Rücknahme unklar", RUECKNAHME_UNKLAR]],
    );
    assert.equal(pressed.refreshed, 1, "a restore that may have landed left the screen as it was");
  });

  it("keeps a refused replay under the negated title, with the route's sentence", async () => {
    const pressed = await pressAgainst(Response.json({ success: false, error: "Der Spielort wurde inzwischen gelöscht." }));

    assert.deepEqual(
      pressed.toasts.filter((toast) => toast.variant === "danger").map((toast) => [toast.title, toast.description]),
      [["Änderung nicht zurückgenommen", "Der Spielort wurde inzwischen gelöscht."]],
    );
  });
});

describe("where each editor's undo dispatches", () => {
  it("rides the shared dispatch to its own route, with no fetch of its own", () => {
    for (const [slice, file] of Object.entries(EDITORS)) {
      const source = readFileSync(path.resolve(FEATURES, file), "utf8");

      assert.ok(source.includes(`endpoint: "/api/admin/${slice}/undo"`), `${slice}: the undo no longer dispatches to the slice's own route`);
      assert.ok(!source.includes("fetch("), `${slice}: the editor spells a dispatch of its own beside the shared one`);
    }
  });
});

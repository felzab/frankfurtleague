import "@/shared/testing/dom.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { toast } from "@heroui/react/toast";

import { appToast } from "./appToast.ts";

const danger = mock.method(toast, "danger", () => "0");

afterEach(() => danger.mock.resetCalls());

const raisedTitles = (): unknown[] => danger.mock.calls.map((call) => call.arguments[0]);
const raisedDescriptions = (): unknown[] => danger.mock.calls.map((call) => (call.arguments[1] as { description?: string }).description);

describe("appToast.failure", () => {
  it("raises the site's title over the failure's own sentence", () => {
    appToast.failure("Änderung nicht gespeichert", { error: "Der Eintrag wurde nicht gefunden. Lade die Seite neu." });

    assert.deepEqual(raisedTitles(), ["Änderung nicht gespeichert"]);
    assert.deepEqual(raisedDescriptions(), ["Der Eintrag wurde nicht gefunden. Lade die Seite neu."]);
  });

  /* The site's title says the change did not happen, which is the one false sentence where the
     server could not tell: the neutral title stands in, the detail unchanged. */
  it("raises the neutral title where the outcome is unknown", () => {
    const error = "Ob die Änderung gespeichert wurde, ist unklar. Lade die Seite neu und prüfe, ob sie da ist.";
    appToast.failure("Änderung nicht gespeichert", { error, outcome: "unknown" });

    assert.deepEqual(raisedTitles(), ["Unklar, ob es gespeichert wurde"]);
    assert.deepEqual(raisedDescriptions(), [error]);
  });

  /* A send saves nothing, so „gespeichert“ misstates what is unknown there: the site's own title for
     an unknown outcome stands in, and never over an outcome that is known. */
  it("raises the site's own unknown title where it names one, and only where the outcome is unknown", () => {
    const error = "Prüfe die Verbindung und sende den Link erneut. Ein neuer Link ersetzt einen, der schon rausging.";
    appToast.failure("Link nicht gesendet", { error, outcome: "unknown" }, "Unklar, ob der Link verschickt wurde");
    appToast.failure("Link nicht gesendet", { error: "Der Link wurde nicht gesendet." }, "Unklar, ob der Link verschickt wurde");

    assert.deepEqual(raisedTitles(), ["Unklar, ob der Link verschickt wurde", "Link nicht gesendet"]);
  });

  /* A press whose first write stands and whose second was refused saved something, so the site's
     „nicht gespeichert“ is false there too: the partly-saved title stands in. */
  it("raises the partly-saved title where part of the press landed", () => {
    const error = "Das Team wurde angelegt, konnte aber nicht in die Saison aufgenommen werden.";
    appToast.failure("Änderung nicht gespeichert", { error, outcome: "partial" });

    assert.deepEqual(raisedTitles(), ["Nur teilweise gespeichert"]);
    assert.deepEqual(raisedDescriptions(), [error]);
  });

  /* A toast marks nothing, so „Überprüfe Deine Eingaben.“ would point at marks nobody can see on
     every control that raises one over a refused payload. */
  it("speaks a refused payload's sentence for a map no control shows", () => {
    appToast.failure("Gruppen nicht getauscht", {
      error: "Überprüfe Deine Eingaben.",
      unplacedError: "Einzelne Angaben wurden nicht übernommen. Lade die Seite neu.",
    });

    assert.deepEqual(raisedDescriptions(), ["Einzelne Angaben wurden nicht übernommen. Lade die Seite neu."]);
  });
});

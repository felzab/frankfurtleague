"use client";

import { useTransition } from "react";

import ArrowRightFromSquare from "@gravity-ui/icons/ArrowRightFromSquare";

import { Button } from "@heroui/react/button";

import { labelBadge } from "@/shared/components/ui/badges";
import { formButton } from "@/shared/components/ui/formButtons";
import { benannt } from "@/shared/utils/benannt";
import { focusRow, focusSlot } from "@/shared/utils/focusAfterWrite";

import type { Anmeldung } from "../../types";

// `timeZone` for the reason `fl_frontend/src/features/passkeys/components/ui/PasskeyKarteView.tsx :: DATUM` gives.
const ZEITPUNKT = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "long", timeStyle: "short" });

const zeit = (iso: string): string => ZEITPUNKT.format(new Date(iso));

// The day alone: the library refreshes a session's activity stamp once an hour, so a minute printed
// here could be up to an hour behind (`fl_frontend/src/core/auth.ts :: SESSION_UPDATE_AGE_SECONDS`).
const TAG = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "long" });

const UHRZEIT = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", timeStyle: "short" });

/**
 * The sign-out's name for a screen reader, which meets one per row: the factor, the passkey's own name
 * and the sign-in's time, the only facts a row holds, no device being stored (WCAG 2.4.6).
 */
function abmeldenName(anmeldung: Anmeldung): string {
  const angemeldet = new Date(anmeldung.angemeldetAm);
  const faktor = anmeldung.faktor.art === "passkey" ? `Passkey „${anmeldung.faktor.name}“` : "Code";
  return benannt("Abmelden", `Anmeldung per ${faktor} vom ${TAG.format(angemeldet)}, ${UHRZEIT.format(angemeldet)}`);
}

/** One live sign-in: when it began and was last active, when it ends at the latest, and what made it. */
export function AnmeldungZeile({ anmeldung, onEnd }: { anmeldung: Anmeldung; onEnd: (id: string) => Promise<void> }) {
  const [isPending, startEnding] = useTransition();

  return (
    <li
      className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
      {...focusRow(anmeldung.id)}>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="fluid-sm font-bold break-words text-foreground">
          {anmeldung.faktor.art === "passkey" ? `Mit Passkey · ${anmeldung.faktor.name}` : "Mit Code per E-Mail"}
        </span>
        {anmeldung.diesesGeraet && <span className={`${labelBadge("brand")} self-start`}>Dieses Gerät</span>}
        <span className="muted-hint">Angemeldet am {zeit(anmeldung.angemeldetAm)}</span>
        <span className="muted-hint">Zuletzt aktiv am {TAG.format(new Date(anmeldung.zuletztAktivAm))}</span>
        <span className="muted-hint">Endet spätestens am {zeit(anmeldung.endetSpaetestensAm)}</span>
      </div>

      {/* None on this device's row: the bar's own control ends it and clears the cookie with it. */}
      {!anmeldung.diesesGeraet && (
        <Button
          type="button"
          variant="secondary"
          isPending={isPending}
          aria-label={isPending ? undefined : abmeldenName(anmeldung)}
          // Once this row has gone the next row's sign-out takes the focus, passing over this device's, which holds none.
          {...focusSlot("abmelden")}
          onPress={() => startEnding(() => onEnd(anmeldung.id))}
          className={formButton({ intent: "cancel" })}>
          <ArrowRightFromSquare
            aria-hidden="true"
            className="size-4.5 shrink-0"
          />
          {isPending ? "Meldet ab..." : "Abmelden"}
        </Button>
      )}
    </li>
  );
}

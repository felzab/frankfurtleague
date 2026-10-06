import Link from "next/link";

import { KONTAKT_EMAIL } from "@/core/brand";
import { KONTO_HREF } from "@/core/kontoHref";
import { Callout } from "@/shared/components/ui/Callout";
import { card } from "@/shared/components/ui/card";
import { NAME_WRAP_CLASSES } from "@/shared/components/ui/nameWrap";

import { zeilenOf } from "../../utils";

import type { FunktionZiel } from "../../utils";

/**
 * A person holding no Funktion holds a session only because the sign-in gate found a record of theirs,
 * so `konto` offers the account page rather than an empty landing, even where that record has gone since.
 */
export type FunktionenZustand = { zustand: "konto"; unbestaetigt: boolean } | { zustand: "auswahl"; ziele: readonly FunktionZiel[] };

/** One place the landing offers, drawn alike whichever kind of place it is. */
function ZielKarte({ href, titel, detail }: { href: string; titel: string; detail: string }) {
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        className={`${card({ interactive: true })} flex items-center justify-between gap-4 p-5`}>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={`fluid-base font-bold text-foreground ${NAME_WRAP_CLASSES}`}>{titel}</span>
          <span className="muted-hint">{detail}</span>
        </div>
        <span
          aria-hidden="true"
          className="fluid-sm font-bold text-brand">
          →
        </span>
      </Link>
    </li>
  );
}

export function FunktionenView(props: FunktionenZustand) {
  return (
    <div className="w-full p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-page flex-col gap-6">
        {/* Names neither the record nor its team: on a mailbox somebody else typed by mistake, either
            would tell a stranger which club entered them. */}
        {props.zustand === "konto" && props.unbestaetigt && (
          <Callout
            severity="info"
            title="Noch nicht bestätigt">
            {`Du bist angemeldet, aber Deine Eintragung ist noch nicht bestätigt. Bestätige sie über den Link aus unserer E-Mail. Hast Du keinen bekommen, schreib uns an ${KONTAKT_EMAIL}.`}
          </Callout>
        )}

        {props.zustand === "konto" && (
          <ul className="flex flex-col gap-4">
            <ZielKarte
              href={KONTO_HREF}
              titel="Konto"
              detail="Was Du bei uns bestätigt hast, und Deine Anmeldung"
            />
          </ul>
        )}

        {props.zustand === "auswahl" && (
          <ul className="flex flex-col gap-4">
            {props.ziele.map((ziel) => (
              <ZielKarte
                key={ziel.href}
                href={ziel.href}
                {...zeilenOf(ziel)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

import Link from "next/link";

import { KONTAKT_EMAIL } from "@/core/brand";
import { card } from "@/shared/components/ui/card";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { NAME_WRAP_CLASSES } from "@/shared/components/ui/nameWrap";

import { zeilenOf } from "../../utils";

import type { FunktionZiel } from "../../utils";

/**
 * What the landing shows once it has not sent the person straight on. `unbestaetigt` is a state of
 * its own rather than a flavour of `leer`: records matched, and the person's own link is what is missing.
 */
export type FunktionenZustand = { zustand: "leer" } | { zustand: "unbestaetigt" } | { zustand: "auswahl"; ziele: readonly FunktionZiel[] };

export function FunktionenView(props: FunktionenZustand) {
  return (
    <div className="w-full p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-page flex-col gap-6">
        {props.zustand === "leer" && (
          <EmptyState
            title="Du bist angemeldet, aber derzeit nirgends eingetragen."
            hint={`Fehlt ein Eintrag, schreib uns an ${KONTAKT_EMAIL}.`}
          />
        )}

        {/* Names neither the record nor its team: on a mailbox somebody else typed by mistake, either
            would tell a stranger which club entered them. */}
        {props.zustand === "unbestaetigt" && (
          <EmptyState
            title="Noch nicht bestätigt"
            hint={`Du bist angemeldet, aber Deine Eintragung ist noch nicht bestätigt. Bestätige sie über den Link aus unserer E-Mail. Hast Du keinen bekommen, schreib uns an ${KONTAKT_EMAIL}.`}
          />
        )}

        {props.zustand === "auswahl" && (
          <ul className="flex flex-col gap-4">
            {props.ziele.map((ziel) => {
              const { titel, detail } = zeilenOf(ziel);

              return (
                <li key={ziel.href}>
                  <Link
                    href={ziel.href}
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
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

"use client";

import { memo } from "react";

import Clock from "@gravity-ui/icons/Clock";

import { adresswechselZeitpunkt } from "@/core/adresswechsel";
import { OFFENE_ANTRAEGE } from "@/core/seitenNamen";
import { VonOderGesperrt } from "@/features/berechtigungen/components/ui/VonOderGesperrt";
import { ANTRAG_WAS, BEANTRAGT_LABEL, GESTELLT_AM_LABEL, GESTELLT_VON_LABEL, OFFEN_BIS_LABEL } from "@/features/berechtigungen/constants";
import { IDENTITY_HEAD_CLASSES, IDENTITY_NAME_CLASSES, IDENTITY_ROW_CLASSES, IDENTITY_STACK_CLASSES } from "@/shared/components/ui/adminTable";
import { card } from "@/shared/components/ui/card";
import { FOCUS_HEADING, focusRow, focusSection } from "@/shared/utils/focusAfterWrite";

import { AdminBerechtigungAntragAblehnenPanel } from "../forms/AdminBerechtigungAntragAblehnenPanel";
import { AdminBerechtigungAntragGenehmigenPanel } from "../forms/AdminBerechtigungAntragGenehmigenPanel";

import type { FLBerechtigungAntragZeile } from "@/features/berechtigungen/schemas";
import type { ReactNode } from "react";

/** The eyebrow naming the fact at the fact, as the grants' own cards carry it. */
const FACT_LABEL_CLASSES = "fluid-xxs font-extrabold tracking-widest text-foreground-muted uppercase";

function Fakt({ label, children, numeric = false }: { label: string; children: ReactNode; numeric?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={FACT_LABEL_CLASSES}>{label}</span>
      <p className={`fluid-sm font-medium break-words text-foreground ${numeric ? "font-numeric tabular-nums" : ""}`}>{children}</p>
    </div>
  );
}

/** **Above the grants and outside their search**: a request is a decision owed, never a row to find. */
export const AdminBerechtigungAntraegeList = memo(function AdminBerechtigungAntraegeList({
  antraege,
}: {
  antraege: readonly FLBerechtigungAntragZeile[];
}) {
  // No empty section on every visit: once the last is decided, the page's own heading takes the focus.
  if (antraege.length === 0) return null;

  return (
    <section
      {...focusSection("antraege")}
      className="flex w-full flex-col gap-3">
      {/* `h2`, never `h1`: the shell's top bar owns the page's one heading. */}
      <h2
        className="fluid-xl font-extrabold tracking-tight text-foreground"
        {...FOCUS_HEADING}>
        {OFFENE_ANTRAEGE}
      </h2>
      <ul className="flex w-full flex-col gap-3">
        {antraege.map((antrag) => {
          const gestelltAm = adresswechselZeitpunkt(antrag.angefragt_am);
          // What each control's name tells the row apart by: the address, or the request's moment where it is withheld.
          const zeile = antrag.adresse ?? `Antrag vom ${gestelltAm}`;
          return (
            <li
              key={antrag.id}
              {...focusRow(antrag.id)}
              className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
              <div className={IDENTITY_ROW_CLASSES}>
                <Clock
                  aria-hidden="true"
                  className="size-4.5 shrink-0 text-foreground-muted"
                />
                <div className={IDENTITY_STACK_CLASSES}>
                  <div className={IDENTITY_HEAD_CLASSES}>
                    {/* A barred address is withheld on every route, so the row names the state instead. */}
                    <span className={IDENTITY_NAME_CLASSES}>
                      <VonOderGesperrt
                        von={antrag.adresse}
                        gesperrt={antrag.gesperrt}
                      />
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid w-full grid-cols-1 gap-3 border-t border-border/50 pt-3 sm:grid-cols-2">
                <Fakt label={BEANTRAGT_LABEL}>{ANTRAG_WAS[antrag.verwaltung]}</Fakt>
                <Fakt
                  label={OFFEN_BIS_LABEL}
                  numeric>
                  {adresswechselZeitpunkt(antrag.bis)}
                </Fakt>
                <Fakt label={GESTELLT_VON_LABEL}>
                  <VonOderGesperrt
                    von={antrag.gestartet_von}
                    gesperrt={antrag.gestartet_von_gesperrt}
                  />
                </Fakt>
                <Fakt
                  label={GESTELLT_AM_LABEL}
                  numeric>
                  {gestelltAm}
                </Fakt>
              </div>

              {/* Both on every request, each closed with its reason where this reader may not press it, as a grant's revoke is. */}
              <div className="-mx-1 flex flex-col gap-3 border-t border-border/50 pt-2">
                <AdminBerechtigungAntragGenehmigenPanel
                  antrag={antrag}
                  zeile={zeile}
                />
                <AdminBerechtigungAntragAblehnenPanel
                  antrag={antrag}
                  zeile={zeile}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
});

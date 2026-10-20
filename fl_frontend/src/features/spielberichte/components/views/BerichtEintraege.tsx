import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";

import { KARTEN_FARBE_LABELS, KARTEN_GRUND_LABELS, TORSCHUETZE_UNBEKANNT_LABEL } from "../../constants";
import { spielerLabel } from "../../utils";

import type { FLSpielberichtAnsicht, FLSpielberichtBericht, FLSpielberichtSeite } from "../../schemas";

/**
 * A stored report's scorers, cards and remarks, read-only, for the administrator's panel and the referee's view after
 * the season alike: both name a person and a side the same way.
 */
export function BerichtEintraege({
  lesen,
  bericht,
  bemerkungenTitel,
}: {
  lesen: FLSpielberichtAnsicht;
  bericht: FLSpielberichtBericht;
  /** Who the remarks are for, in the reader's words. */
  bemerkungenTitel: string;
}) {
  const { spiel } = lesen;

  // A side fielding another club since is named by its place, never by the club now on it, which the entry is not about.
  const team = (seite: FLSpielberichtSeite) =>
    lesen.seiten_geaendert.includes(seite)
      ? `früheres ${seite === "team1" ? "Team 1" : "Team 2"}`
      : ((seite === "team1" ? spiel.team1?.name : spiel.team2?.name) ?? "");
  const person = (spielerId: string | null): string => {
    if (spielerId === null) return TORSCHUETZE_UNBEKANNT_LABEL;
    const genannt = [...lesen.kader.team1, ...lesen.kader.team2, ...lesen.genannt].find((spieler) => spieler.spieler_id === spielerId);
    return genannt === undefined ? spielerId : spielerLabel(genannt);
  };

  return (
    <>
      {bericht.torschuetzen.length > 0 && (
        <ul
          aria-label="Torschützen"
          className="flex w-full flex-col gap-2">
          {bericht.torschuetzen.map((tor, index) => (
            <li
              // Entries carry no id of their own; their place in the stored list is stable while this read stands.
              key={index}
              className={`${card()} flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3`}>
              <span className="font-numeric fluid-sm font-semibold tabular-nums">{`${tor.minute}.`}</span>
              <span className="min-w-0 flex-1 fluid-sm">{person(tor.spieler_id)}</span>
              <span className="muted-meta">{team(tor.seite)}</span>
              {tor.eigentor && <span className={labelBadge("warning")}>Eigentor</span>}
            </li>
          ))}
        </ul>
      )}

      {bericht.karten.length > 0 && (
        <ul
          aria-label="Karten"
          className="flex w-full flex-col gap-2">
          {bericht.karten.map((karte, index) => (
            <li
              key={index}
              className={`${card()} flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3`}>
              <span className="font-numeric fluid-sm font-semibold tabular-nums">{`${karte.minute}.`}</span>
              <span className="min-w-0 flex-1 fluid-sm">{person(karte.spieler_id)}</span>
              <span className="muted-meta">{team(karte.seite)}</span>
              <span className={labelBadge(karte.farbe === "gelb" ? "warning" : "danger")}>{KARTEN_FARBE_LABELS[karte.farbe]}</span>
              {karte.grund !== null && <span className="muted-meta">{`Grund: ${KARTEN_GRUND_LABELS[karte.grund]}`}</span>}
            </li>
          ))}
        </ul>
      )}

      {bericht.bemerkungen !== null && (
        <div className="flex w-full flex-col gap-y-1">
          <p className="fluid-xs font-bold text-foreground">{bemerkungenTitel}</p>
          <p className="fluid-sm whitespace-pre-line text-foreground">{bericht.bemerkungen}</p>
        </div>
      )}
    </>
  );
}

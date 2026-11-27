"use client";

import { useState } from "react";

import { KONTAKT_EMAIL, KONTAKT_MAILTO } from "@/core/brand";
import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";
import { byShirtNumber, kaderName, rolleMarkOf } from "@/features/spieler/constants";
import { rowState } from "@/features/spieler/rowChip";
import { ListTable } from "@/kit/ListTable";

import { KaderRowDialog } from "./KaderRowDialog";

import type { BoxRules } from "@/core/boxRules";
import type { FLKaderResponse, FLKaderRow } from "@/core/generated/client/types";
import type { TableHead, TableRow } from "@/kit/Table";
import type { Route } from "next";

/**
 * The squad in shirt-number order, rows wearing none last, each group in the read's own order: a live row opens its
 * dialog, its role's mark after the name, and an ausgetragen one stands muted with its chip and opens nothing, since
 * only the league brings it back.
 */
function rowsOf(kader: readonly FLKaderRow[], open: (row: FLKaderRow) => void): TableRow[] {
  return kader.toSorted(byShirtNumber).map((row) => {
    const isLive = row.inactive_since === null;
    const mark = rolleMarkOf(row.rolle);
    return {
      id: row.spieler_id,
      name: { record: kaderName(row) },
      // A role an ausgetragen row held is no longer the squad's: the write frees it for another live row.
      ...(isLive && mark !== undefined ? { mark } : {}),
      chip: rowState(row),
      muted: !isLive,
      ...(isLive ? { onOpen: () => open(row) } : {}),
      cells: {
        nummer: row.nummer === null ? COPY.shared.noValue : { record: row.nummer },
        position: row.position === null ? COPY.shared.noValue : { record: row.position },
        stufe: row.stufe === null ? COPY.shared.noValue : { record: row.stufe },
      },
    };
  });
}

/**
 * The squad with nobody in it yet, saying where its players come from, as the Registrierungen' empty list does: every
 * player enters through the team's registration link, which the league sends.
 */
const EMPTY = {
  kind: "none",
  plural: COPY.shared.kader,
  one: true,
  searchPlural: COPY.shared.spieler,
  glyph: "teams",
  line: AREA_COPY.team.registrierung.linkFromLeague({ href: KONTAKT_MAILTO as Route, label: { record: KONTAKT_EMAIL } }),
} as const;

/**
 * The team's Kader as the list template's table, searched by the template's field, and the dialog its live rows open.
 * One dialog for every row, mounted closed while the squad holds a live row, so a press opens it by its state as a held
 * dialog asks; it keeps the row last pressed, which it shows while it closes.
 */
export function KaderTable({
  head,
  read,
  team,
  saison,
  rules,
}: {
  head: TableHead;
  read: FLKaderResponse;
  team: string;
  saison: string;
  /** What the row's save asks of its boxes, read on the server. */
  rules: BoxRules;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [isOpen, setOpen] = useState(false);
  const live = read.kader.filter((row) => row.inactive_since === null);
  // The row last pressed as the read now holds it, else any live row, which the closed dialog holds unseen.
  const row = read.kader.find((candidate) => candidate.spieler_id === chosen) ?? live[0];
  const open = (pressed: FLKaderRow) => {
    setChosen(pressed.spieler_id);
    setOpen(true);
  };

  return (
    <>
      <ListTable
        table={{
          ...head,
          label: COPY.page.teamKader,
          rows: rowsOf(read.kader, open),
          empty: EMPTY,
        }}
      />
      {row !== undefined && (
        <KaderRowDialog
          row={row}
          team={team}
          saison={saison}
          allowedStufen={read.allowed_stufen}
          takenRollen={live.flatMap((other) => (other.spieler_id === row.spieler_id || other.rolle === null ? [] : [other.rolle]))}
          rules={rules}
          open={{ isOpen, onOpenChange: setOpen }}
        />
      )}
    </>
  );
}

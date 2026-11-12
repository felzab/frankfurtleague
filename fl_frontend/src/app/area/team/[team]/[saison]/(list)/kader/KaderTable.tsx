"use client";

import { useState } from "react";

import { ListTable } from "@/kit/ListTable";

import { COPY } from "@/core/copy";
import { byShirtNumber, kaderName, roleMarkOf } from "@/features/spieler/constants";
import { rowChip } from "@/features/spieler/rowChip";

import { KaderRowDialog } from "./KaderRowDialog";

import type { FLKaderResponse, FLKaderRow } from "@/core/generated/client/types";
import type { TableHead, TableRow } from "@/kit/Table";

/**
 * The squad in shirt-number order, rows wearing none last, each group in the read's own order: a live row opens its
 * dialog, its role's mark after the name, and an ausgetragen one stands muted with its chip and opens nothing, since
 * only the league brings it back.
 */
function rowsOf(kader: readonly FLKaderRow[], open: (row: FLKaderRow) => void): TableRow[] {
  return kader.toSorted(byShirtNumber).map((row) => {
    const isLive = row.inactive_since === null;
    const chip = rowChip(row);
    const mark = roleMarkOf(row.rolle);
    const facts = [
      row.position === null ? null : { record: row.position },
      row.stufe === null ? null : COPY.admin.saison.stufe[row.stufe],
    ].filter((fact) => fact !== null);
    return {
      id: row.spieler_id,
      name: { record: kaderName(row) },
      // A role an ausgetragen row held is no longer the squad's: the write frees it for another live row.
      ...(isLive && mark !== undefined ? { mark } : {}),
      ...(chip === undefined ? {} : { chip }),
      ...(facts.length === 0 ? {} : { phoneLine: COPY.shared.line(facts) }),
      muted: !isLive,
      ...(isLive ? { onOpen: () => open(row) } : {}),
      cells: {
        nummer: row.nummer === null ? COPY.shared.noValue : { record: row.nummer },
        position: row.position === null ? COPY.shared.noValue : { record: row.position },
        stufe: row.stufe === null ? COPY.shared.noValue : COPY.admin.saison.stufe[row.stufe],
      },
    };
  });
}

/**
 * The team's Kader as the list template's table, searched by the template's field, and the dialog its live rows open.
 * One dialog for every row, mounted closed while the squad holds a live row, so a press opens it by its state as a held
 * dialog asks; it keeps the row last pressed, which it shows while it closes.
 */
export function KaderTable({ head, read, team, saison }: { head: TableHead; read: FLKaderResponse; team: string; saison: string }) {
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
          empty: { kind: "none", plural: COPY.shared.kader, one: true, searchPlural: COPY.shared.spieler, glyph: "teams" },
        }}
      />
      {row !== undefined && (
        <KaderRowDialog
          row={row}
          team={team}
          saison={saison}
          allowedStufen={read.allowed_stufen}
          takenRollen={live.flatMap((other) => (other.spieler_id === row.spieler_id || other.rolle === null ? [] : [other.rolle]))}
          open={{ isOpen, onOpenChange: setOpen }}
        />
      )}
    </>
  );
}

"use client";

import { useState } from "react";

import { ListTable } from "@/kit/ListTable";

import { COPY, textOf } from "@/core/copy";
import { kaderName } from "@/features/spieler/constants";
import { rowChip } from "@/features/spieler/rowChip";

import { KaderRowDialog } from "./KaderRowDialog";

import type { FLKaderResponse, FLKaderRow } from "@/core/generated/client/types";
import type { TableHead, TableRow } from "@/kit/Table";

const WORDS = COPY.admin.spieler;

/** A shirt number's place in the list: its figure, a row wearing none after every row that wears one. */
const shirtOrder = (row: FLKaderRow) => (row.nummer === null ? Number.POSITIVE_INFINITY : Number(row.nummer));

/**
 * The squad in shirt-number order, rows wearing none last, each group in the read's own order: a live row opens its
 * dialog, its role's mark after the name, and an ausgetragen one stands muted with its chip and opens nothing, since
 * only the league brings it back.
 */
function rowsOf(kader: readonly FLKaderRow[], open: (row: FLKaderRow) => void): TableRow[] {
  return kader
    .toSorted((one, other) => shirtOrder(one) - shirtOrder(other))
    .map((row) => {
      const isLive = row.inactive_since === null;
      const chip = rowChip(row);
      const facts = [row.position, row.stufe === null ? null : textOf(COPY.admin.saison.stufe[row.stufe])].filter((fact) => fact !== null);
      return {
        id: row.spieler_id,
        name: { record: kaderName(row) },
        // A role an ausgetragen row held is no longer the squad's: the write frees it for another live row.
        ...(isLive && row.rolle !== null ? { mark: { letters: COPY.shared.rolleMark[row.rolle], label: WORDS.rolleOption[row.rolle] } } : {}),
        ...(chip === undefined ? {} : { chip }),
        ...(facts.length === 0 ? {} : { phoneLine: { record: facts.join(" · ") } }),
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
 * dialog asks (`fl_frontend/src/kit/useOpenUntilHidden.ts`); it keeps the row last pressed, which it shows while it
 * closes.
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

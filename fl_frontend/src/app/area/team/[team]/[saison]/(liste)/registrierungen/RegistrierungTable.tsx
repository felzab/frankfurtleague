"use client";

import { useState } from "react";

import { ListTable } from "@/kit/ListTable";

import { COPY } from "@/core/copy";

import { RegistrierungDialog } from "./RegistrierungDialog";

import type { Words } from "@/core/copy";
import type { TableHead, TableProps, TableRow } from "@/kit/Table";
import type { RegistrierungEntry } from "./RegistrierungDialog";

/** A pending registration's row as the server draws it, the press opening its dialog added here. */
export type RegistrierungRow = Pick<TableRow, "id" | "name" | "chip" | "cells"> & { line?: Words; entry: RegistrierungEntry };

/**
 * The team's pending registrations as the list template's table, searched by the template's field, each row opening
 * the one dialog, as the Kader's rows open theirs: mounted closed while a row stands, so a press opens it by its state
 * as a held dialog asks; it keeps the row last pressed, which it shows while it closes.
 */
export function RegistrierungTable({ head, rows, empty }: { head: TableHead; rows: readonly RegistrierungRow[]; empty: TableProps["empty"] }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [isOpen, setOpen] = useState(false);
  // The row last pressed as the read now holds it, else the first, which the closed dialog holds unseen.
  const shown = rows.find((row) => row.id === chosen) ?? rows[0];

  return (
    <>
      <ListTable
        table={{
          ...head,
          label: COPY.page.registrierungen,
          rows: rows.map(({ entry, ...row }) => ({
            ...row,
            onOpen: () => {
              setChosen(entry.decided.registrierung_id);
              setOpen(true);
            },
          })),
          empty,
        }}
      />
      {shown !== undefined && (
        <RegistrierungDialog
          entry={shown.entry}
          open={{ isOpen, onOpenChange: setOpen }}
        />
      )}
    </>
  );
}

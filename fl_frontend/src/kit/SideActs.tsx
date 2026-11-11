"use client";

import { createContext, use } from "react";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { askingLook } from "./buttonStyles";
import { actsFold } from "./cardStyles";
import { Menu } from "./Menu";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

/** The stacking width of the list a row's acts stand in, or `null` where the list folds no acts. */
type Fold = "list" | "crowded" | null;

const ActsFold = createContext<Fold>(null);

/**
 * What a list hands its rows' acts: whether its rows' side acts fold, and at which of the list's stacking widths. A
 * client part, since the list is drawn on the server, where no context is given.
 */
export function ActsFoldScope({ at, children }: { at: Fold; children: ReactNode }) {
  return <ActsFold value={at}>{children}</ActsFold>;
}

/** One side act of a row: its words, its button's and its menu entry's alike, and what its press does. */
export type SideAct = {
  label: Copy;
  /** An act that destroys: its button in the outlined danger look every destroying act's trigger takes. */
  tone?: "danger";
  /** The act is under way: its button busy, and the „⋯“ that holds it. */
  isBusy?: boolean;
  /**
   * Runs the act, or opens its question. A press on the menu's entry calls it as a press on the button does, in the
   * press's own event, so an act behind the passkey touch asks it from that press.
   */
  onPress: () => void;
};

/**
 * A row's side acts, the ones beside what the row is for, such as a running change's fresh link and its ending: in a
 * list that folds them (`Table`'s `folds`) they are labelled buttons at the row's end where the list is a table, and
 * one „⋯“ at the row's end where its rows are stacked, which opens the kit's menu on the same acts in the same order,
 * a destroying one after the others. Every row of such a list folds, one holding a single act too, so a list's rows
 * stand alike. A row's decision, such as „Zusagen“ and „Ablehnen“, is no side act and is never folded.
 *
 * `children` are the questions the acts open, each on the open state its act's press sets: a question opened from the
 * menu hands the focus back to the „⋯“ as it closes, as the menu itself does.
 */
export function SideActs({ acts, children }: { acts: ReadonlyArray<SideAct>; children?: ReactNode }) {
  const at = use(ActsFold);
  const buttons = acts.map((act) => (
    <Button
      key={act.label}
      variant={askingLook(act.tone ?? "primary")}
      label={act.label}
      isBusy={act.isBusy}
      onPress={act.onPress}
    />
  ));
  if (at === null)
    return (
      <>
        {buttons}
        {children}
      </>
    );
  const s = actsFold({ at });
  return (
    <>
      <span className={s.buttons()}>{buttons}</span>
      <span className={s.menu()}>
        <Menu
          label={COPY.template.more}
          placement="below"
          trigger={
            <Button
              icon="more"
              label={COPY.template.more}
              isBusy={acts.some((act) => act.isBusy === true)}
            />
          }
          groups={[acts.map((act) => ({ kind: "action", label: act.label, onAction: act.onPress }))]}
        />
      </span>
      {children}
    </>
  );
}

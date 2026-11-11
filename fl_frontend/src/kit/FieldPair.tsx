import { fieldFrame, fieldLabel, fieldRoot, fieldUnit, messageLine } from "./fieldStyles";
import { placeholderBar, PlaceholderLine, PlaceholderSentence } from "./Skeleton";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

/**
 * What a field holds, which sets its width on the kit's scale (`fieldStyles.ts :: fieldFrame`): a short value by its
 * count and its unit, or a field's kind, a value whose length varies at the standard width by default.
 */
type PlaceholderShape =
  { holds: 2 | 5; unit?: Copy; kind?: never } | { kind?: "field" | "paragraph" | "date" | "time"; holds?: never; unit?: never };

/** The frame's size and face for each kind, a short one's `ch` counted in the numeric face as its field's is. */
const KIND_CLASSES = {
  field: fieldFrame.variants.width.standard,
  paragraph: fieldFrame.variants.width.full,
  date: `${fieldFrame.variants.width.short} ${fieldFrame.variants.holds[10]} ${fieldFrame.variants.figures.true}`,
  time: `${fieldFrame.variants.width.short} ${fieldFrame.variants.holds[5]} ${fieldFrame.variants.figures.true}`,
} as const;

/**
 * A field while the record filling it is read: its label's line, its frame at the size of what it holds, and, where
 * the field carries a description, the description's words set unseen, so a box of placeholders stands as tall as its
 * fields will. Its label's bar adds nothing to the width the field is laid out at, so a short field stands as wide as
 * its value. `figures` says a five-character field holds digits, whose `ch` is the numeric face's, as a two-character
 * one's and a unit's always are. A short field's `unit` is set unseen inside the bar, which is then as wide as the field
 * with its unit.
 */
export function FieldPlaceholder({
  figures = false,
  description,
  ...at
}: PlaceholderShape & {
  figures?: boolean;
  description?: Copy;
}) {
  const unit = fieldUnit({ holds: at.holds });
  const numeric = figures || at.holds === 2;
  const short = at.holds !== undefined || at.kind === "date" || at.kind === "time";
  const size =
    at.holds === undefined
      ? KIND_CLASSES[at.kind ?? "field"]
      : `${fieldFrame.variants.width.short} ${fieldFrame.variants.holds[at.holds]} ${numeric ? fieldFrame.variants.figures.true : ""}`;
  return (
    <div className={fieldRoot()}>
      <PlaceholderLine
        textClass={fieldLabel({ class: "self-stretch" })}
        widthClass="w-full max-w-24"
      />
      {/* The frame's own text size and face, which a short width's `ch` is counted in. */}
      {at.unit === undefined ? (
        <span
          data-kit-short={short || undefined}
          className={placeholderBar(`rounded-lg text-sm pointer-coarse:text-base ${size}`)}
        />
      ) : (
        <span
          data-kit-short
          className={placeholderBar(
            `rounded-lg text-sm pointer-coarse:text-base ${fieldFrame.variants.width.short} ${fieldFrame.variants.inset.full} ${unit.frame()}`,
          )}>
          <span className={unit.value()} />
          <span className={unit.unit({ class: "invisible" })}>{at.unit}</span>
        </span>
      )}
      {description !== undefined && (
        <PlaceholderSentence
          textClass={messageLine()}
          words={description}
        />
      )}
    </div>
  );
}

/** A day and its time while they are read, as `FieldPair` sets the two halves of one value. */
export function FieldPairPlaceholder() {
  return (
    <FieldPair>
      <FieldPlaceholder kind="date" />
      <FieldPlaceholder kind="time" />
    </FieldPair>
  );
}

/**
 * Two fields forming one value, sharing one row at every screen width: a day with its time, a street with its number,
 * a postcode with its town. A side holding a short field keeps its width (its frame says so, `data-kit-short`) and a
 * side holding a standard one takes the room it leaves, so a street and its number together end where the standard
 * fields over and under them end, and a day and its time stand at their own two widths. A short side's message wraps
 * at its field's width, as every field's does. Two fields holding two values stand one under the other, as every field
 * does, and values of one kind, or a span's two ends, stand as `FieldRows`.
 */
export function FieldPair({ children }: { children: [ReactNode, ReactNode] }) {
  const [first, second] = children;
  const SIDE_CLASSES = "min-w-0 flex-1 has-[[data-kit-short]]:flex-none";
  return (
    <div className="flex w-full max-w-field items-start gap-x-3">
      <div className={SIDE_CLASSES}>{first}</div>
      <div className={SIDE_CLASSES}>{second}</div>
    </div>
  );
}

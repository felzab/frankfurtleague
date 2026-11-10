import { fieldFrame, fieldLabel, fieldRoot, fieldUnit, messageLine } from "./fieldStyles";
import { placeholderBar, PlaceholderLine, PlaceholderSentence } from "./Skeleton";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

/**
 * Where a short side's message line may run past its field, on desktop, where a short field such as a house number
 * is narrower than „Pflichtfeld“: the line wraps at the field's width otherwise, its words adding nothing to the width
 * a field is laid out at (`fieldStyles.ts :: messageLine`). A short first side's line runs on under the second side
 * while the second side's own line stands empty, so two messages never overlap. A side at the row's end wraps, and so
 * does each side on a phone, at its share of the row.
 */
const reach = tv({
  variants: {
    side: {
      first:
        "lg:[&_[data-kit-message]]:whitespace-nowrap lg:group-has-[[data-pair-side=second]_[data-kit-message]:not(:empty)]/pair:[&_[data-kit-message]]:whitespace-normal",
      none: "",
    },
  },
});

/** A field's width on the kit's scale (`fieldStyles.ts :: fieldFrame`), a short one with its count and its unit. */
type PlaceholderWidth = { width: "short"; holds: 2 | 5; unit?: Copy } | { width: "standard" | "full"; holds?: never; unit?: never };

/**
 * A field while the record filling it is read: its label's line, its frame at its width's size, and, where the field
 * carries a description, the description's words set unseen, so a box of placeholders stands as tall as its fields
 * will. Its label's bar adds nothing to the width the field is laid out at, so a short field stands as wide as its
 * value. `figures` says a five-character field holds digits, whose `ch` is the numeric face's, as a two-character
 * one's and a unit's always are. A short field's `unit` is set unseen inside the bar, which is then as wide as the
 * field with its unit.
 */
export function FieldPlaceholder({
  figures = false,
  description,
  ...at
}: PlaceholderWidth & {
  figures?: boolean;
  description?: Copy;
}) {
  const unit = fieldUnit({ holds: at.holds });
  const numeric = figures || at.holds === 2;
  return (
    <div className={fieldRoot()}>
      <PlaceholderLine
        textClass={fieldLabel({ class: "self-stretch" })}
        widthClass="w-full max-w-24"
      />
      {/* The frame's own text size and face, which a short width's `ch` is counted in. */}
      {at.unit === undefined ? (
        <span
          className={placeholderBar(
            `rounded-lg text-sm pointer-coarse:text-base ${fieldFrame.variants.width[at.width]} ${at.holds === undefined ? "" : fieldFrame.variants.holds[at.holds]} ${numeric ? fieldFrame.variants.figures.true : ""}`,
          )}
        />
      ) : (
        <span
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
      <FieldPlaceholder width="standard" />
      <FieldPlaceholder width="standard" />
    </FieldPair>
  );
}

/**
 * Two fields forming one value, sharing one row at every screen width: a day with its time, a street with its number,
 * a postcode with its town. Together they are as wide as one standard field, so the pair ends where the fields over
 * and under it end. `short` names a side holding a short field, which keeps its width while the other side takes the
 * room it leaves; without it the two share the row in equal halves. The address writes the number after its street
 * but the postcode before its town, which is why `short` names a side. Two fields holding two values stand one under
 * the other, as every field does, and values of one kind, or a span's two ends, stand as `FieldRows`.
 */
export function FieldPair({ short, children }: { short?: "first" | "second"; children: [ReactNode, ReactNode] }) {
  const [first, second] = children;
  const KEEPS_CLASSES = "shrink-0";
  const GROWS_CLASSES = "min-w-0 flex-1";
  return (
    <div className="group/pair flex w-full max-w-field items-start gap-x-3">
      <div className={reach({ side: short === "first" ? "first" : "none", class: short === "first" ? KEEPS_CLASSES : GROWS_CLASSES })}>
        {first}
      </div>
      <div
        data-pair-side="second"
        className={short === "second" ? KEEPS_CLASSES : GROWS_CLASSES}>
        {second}
      </div>
    </div>
  );
}

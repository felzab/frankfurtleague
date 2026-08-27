import { tv } from "tailwind-variants";

/**
 * **Driven by the open state, never `:hover` alone.** A modal popover marks everything outside it `inert`, and an
 * inert subtree is hit-tested as `pointer-events: none`, so the glyph stops matching `:hover` the moment its own
 * panel opens.
 */
const hintTriggerStyle = tv({
  /* An inline glyph rather than a flex sibling: a text run's visual mass sits above its line box's centre, so centring
     in a row cannot look right. `align-middle` aligns any icon size with no tuned constant. */
  /* `cursor-auto` and not merely the absence of one: `.popover__trigger` declares `pointer`. While the panel is open
     the glyph is `inert` and the cursor comes from `<body>`, so `auto` is the only value that cannot change. */
  base: "inline-flex shrink-0 cursor-auto align-middle transition-colors",
  variants: {
    /** A caller's own trigger brings its colour, so the open state reads as a fill; the bare glyph has none to keep. */
    kind: {
      glyph: "ms-1.5 [--hint-icon-size:1em]",
      custom: "-m-0.5 items-center justify-center rounded-md p-0.5",
    },
    /* Both arms are spelled, so the glyph never carries `text-brand` beside `text-foreground-muted`: the two are the
       same specificity, and which one paints would fall to Tailwind's emission order. */
    isOpen: { true: "", false: "" },
  },
  compoundVariants: [
    { kind: "glyph", isOpen: true, class: "text-brand" },
    { kind: "glyph", isOpen: false, class: "text-foreground-muted hover:text-brand" },
    { kind: "custom", isOpen: true, class: "bg-hover" },
    { kind: "custom", isOpen: false, class: "hover:bg-hover" },
  ],
});

/** A wrapper for `formButtons.ts :: ctaButton`'s reason (COR-2): a bare `tv` types `isOpen` optional, and omitting it emits neither compound. */
export function hintTrigger(options: { kind: "glyph" | "custom"; isOpen: boolean }): string {
  return hintTriggerStyle(options);
}

/**
 * One season's pages and the `@modal` slot, where a match opens over the Spielplan as a pop-up. The frame is
 * the layout's above, so it outlives a season switch, which remounts what this segment holds.
 */
export default function SaisonLayout({ children, modal }: LayoutProps<"/saisons/[saison]">) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}

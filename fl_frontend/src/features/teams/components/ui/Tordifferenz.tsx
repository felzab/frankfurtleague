/**
 * Three arms, not two: a level difference is neither a surplus nor a deficit. The figure's one
 * spelling, so the Saisontabelle and a club's own page cannot render one difference two ways.
 */
export function Tordifferenz({ geschossen, kassiert }: { geschossen: number; kassiert: number }) {
  const differenz = geschossen - kassiert;
  if (differenz === 0) return <span className="text-foreground">0</span>;

  // `-strong`, not the plain accents: a figure is text, and answers to 4.5:1 on a card's ground.
  return differenz > 0 ? <span className="text-success-strong">+{differenz}</span> : <span className="text-danger-strong">{differenz}</span>;
}

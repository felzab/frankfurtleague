import { Classic } from "./frame";

/**
 * The classic public frame around the pages it holds: the landing, About, Kontakt, the sponsors page and the sign-in;
 * and the `@modal` slot, where a match row on the landing opens its match as the season pages' pop-up.
 */
export default function ClassicLayout({ children, modal }: LayoutProps<"/">) {
  return (
    <Classic>
      {children}
      {modal}
    </Classic>
  );
}

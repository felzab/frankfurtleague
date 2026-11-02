import { Classic } from "./frame";

/** The classic public frame around the pages it holds: the landing, About, Kontakt, the sponsors page and the sign-in. */
export default function ClassicLayout({ children }: { children: React.ReactNode }) {
  return <Classic>{children}</Classic>;
}

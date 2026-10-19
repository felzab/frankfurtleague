import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { FunktionSwitcher } from "@/shared/components/layout/sidemenu/FunktionSwitcher";

import { requireSubjectSession } from "../../resolvers";
import { funktionOrteOf } from "../../utils";

/**
 * The person and team shells' switcher, streamed into the frame in a boundary of its own: which places
 * the person's Funktionen lead to is the session's to say.
 */
export async function PersonLaneFunktionSwitcher({ ohneOrt, mitBereich }: { ohneOrt: string; mitBereich: boolean }) {
  // Its own, whatever is mounted above: the builder stage reaches no sign-in store (`docs/frontend/spec.md :: I448`).
  await connection();
  // The guard's own read, memoised per render (`fl_frontend/src/core/subject.ts :: getSubjectSession`).
  const { funktionen } = funktionenOf(await requireSubjectSession());

  return (
    <FunktionSwitcher
      orte={funktionOrteOf(funktionen)}
      ohneOrt={ohneOrt}
      mitBereich={mitBereich}
    />
  );
}

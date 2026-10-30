import { rolesOf } from "@/core/funktionen";
import { getSubjectSession } from "@/core/subject";
import { FunktionSwitcher } from "@/shared/components/layout/sidemenu/FunktionSwitcher";

import { funktionOrteOf } from "../../utils";

/**
 * The person and team shells' switcher, streamed into the frame in a boundary of its own: which places
 * the person's Funktionen lead to is the session's to say.
 */
export async function PersonLaneFunktionSwitcher({ ohneOrt, mitBereich }: { ohneOrt: string; mitBereich: boolean }) {
  // The hold's own read, memoised per render; nothing for a refused session, the page turning it away.
  const subject = await getSubjectSession();
  if (subject === null) return null;
  const { roles: funktionen } = rolesOf(subject);

  return (
    <FunktionSwitcher
      orte={funktionOrteOf(funktionen)}
      ohneOrt={ohneOrt}
      mitBereich={mitBereich}
    />
  );
}

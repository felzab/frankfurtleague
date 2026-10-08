import { GESPERRTE_ADRESSE, vonOderGesperrt } from "@/features/berechtigungen/constants";
import { Leer } from "@/shared/components/ui/Angabe";

/** An actor a read may withhold, rendered: the withheld address is a state in a name's place, so it takes the empty grade. */
export function VonOderGesperrt({ von, gesperrt }: { von: string | null; gesperrt: boolean }) {
  const text = vonOderGesperrt(von, gesperrt);

  return text === GESPERRTE_ADRESSE ? <Leer>{text}</Leer> : text;
}

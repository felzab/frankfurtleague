import { vonOderGesperrt } from "@/features/berechtigungen/constants";
import { Leer } from "@/shared/components/ui/Angabe";

/** An actor a read may withhold, rendered: a state in a name's place, barred or erased, takes the empty grade. */
export function VonOderGesperrt({ von, gesperrt }: { von: string | null; gesperrt: boolean }) {
  const text = vonOderGesperrt(von, gesperrt);

  return text === von ? text : <Leer>{text}</Leer>;
}

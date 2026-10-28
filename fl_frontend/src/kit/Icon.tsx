import Calendar from "lucide-react/icons/calendar";
import Check from "lucide-react/icons/check";
import ChevronDown from "lucide-react/icons/chevron-down";
import ChevronLeft from "lucide-react/icons/chevron-left";
import ChevronRight from "lucide-react/icons/chevron-right";
import LoaderCircle from "lucide-react/icons/loader-circle";
import Search from "lucide-react/icons/search";
import X from "lucide-react/icons/x";

/**
 * Every glyph the site draws, by what it means rather than by its drawing, so a glyph changes here and
 * nowhere else. Each is imported from its own module, so a test loading the kit loads eight icons, not
 * the whole set.
 */
const GLYPHS = {
  aufklappen: ChevronDown,
  haken: Check,
  kalender: Calendar,
  laedt: LoaderCircle,
  schliessen: X,
  suche: Search,
  vor: ChevronRight,
  zurueck: ChevronLeft,
};

export type IconName = keyof typeof GLYPHS;

/**
 * A glyph at one of the two sizes: 18 px in the rail, 16 px everywhere else. Always hidden from
 * assistive technology, since the control carrying it is named by its label.
 */
export function Icon({ glyph, size, spinning = false }: { glyph: IconName; size: 16 | 18; spinning?: boolean }) {
  const Glyph = GLYPHS[glyph];
  // Spins under reduced motion too: a busy state that stops reads as stuck.
  return (
    <Glyph
      aria-hidden
      size={size}
      className={spinning ? "shrink-0 animate-spin" : "shrink-0"}
    />
  );
}

import Ban from "lucide-react/icons/ban";
import Calendar from "lucide-react/icons/calendar";
import CalendarDays from "lucide-react/icons/calendar-days";
import CalendarRange from "lucide-react/icons/calendar-range";
import Check from "lucide-react/icons/check";
import ChevronDown from "lucide-react/icons/chevron-down";
import ChevronLeft from "lucide-react/icons/chevron-left";
import ChevronRight from "lucide-react/icons/chevron-right";
import CircleCheck from "lucide-react/icons/circle-check";
import CircleX from "lucide-react/icons/circle-x";
import Ellipsis from "lucide-react/icons/ellipsis";
import FileText from "lucide-react/icons/file-text";
import Info from "lucide-react/icons/info";
import LayoutDashboard from "lucide-react/icons/layout-dashboard";
import ListFilter from "lucide-react/icons/list-filter";
import LoaderCircle from "lucide-react/icons/loader-circle";
import Mail from "lucide-react/icons/mail";
import MapPin from "lucide-react/icons/map-pin";
import Menu from "lucide-react/icons/menu";
import ScrollText from "lucide-react/icons/scroll-text";
import Search from "lucide-react/icons/search";
import Shield from "lucide-react/icons/shield";
import Trash from "lucide-react/icons/trash-2";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import User from "lucide-react/icons/user";
import UserPlus from "lucide-react/icons/user-plus";
import Users from "lucide-react/icons/users";
import Whistle from "lucide-react/icons/whistle";
import X from "lucide-react/icons/x";
import { tv } from "tailwind-variants/lite";

/**
 * Every glyph the site draws, by what it means rather than by its drawing, so a glyph changes here and
 * nowhere else: one name per meaning, and no drawing under two names, so a reader learns each mark once.
 * Each is imported from its own module, so a test loading the kit loads these icons, not the whole set.
 * The second group names the pages of a frame's menu, one glyph per page, so no two entries of a rail or
 * a phone bar share a mark.
 */
const GLYPHS = {
  aufklappen: ChevronDown,
  // An outcome is a mark in a ring: the bare check is an item chosen, the bare cross a close or a clear.
  erledigt: CircleCheck,
  fehler: CircleX,
  filter: ListFilter,
  haken: Check,
  info: Info,
  kalender: Calendar,
  laedt: LoaderCircle,
  mehr: Ellipsis,
  menue: Menu,
  schliessen: X,
  suche: Search,
  vor: ChevronRight,
  warnung: TriangleAlert,
  zurueck: ChevronLeft,

  uebersicht: LayoutDashboard,
  saisons: CalendarRange,
  // A season's matches, in the public frame and the administration's alike. A calendar with its days
  // marked reads as dated fixtures, and leaves the bare calendar to `kalender`, picking a date.
  spielplan: CalendarDays,
  spielorte: MapPin,
  schiedsrichter: Whistle,
  bewerbungen: FileText,
  teams: Users,
  spieler: User,
  registrierungen: UserPlus,
  administratoren: Shield,
  sperrliste: Ban,
  loeschungen: Trash,
  adressaenderungen: Mail,
  protokoll: ScrollText,
};

export type IconName = keyof typeof GLYPHS;

/**
 * Each size in rem, so a glyph grows with the reader's font size as the text beside it does; Lucide's own
 * `size` would write fixed pixels. The names are the pixels at the default 16-px root.
 */
const glyph = tv({
  base: "shrink-0",
  variants: {
    size: {
      12: "size-3",
      16: "size-4",
      18: "size-4.5",
    },
    spinning: {
      // Spins under reduced motion too: a busy state that stops reads as stuck.
      true: "animate-spin",
    },
  },
});

/**
 * Lucide draws on a 24-unit grid at a 2-unit stroke; the 12-px glyph, the tick inside a checkbox, takes a
 * 3-unit stroke so it keeps its weight at half the size.
 */
const STROKE = { 12: 3, 16: 2, 18: 2 } as const;

/**
 * A glyph at one of the three sizes: 18 px in the rail, 12 px as a checkbox's tick, 16 px everywhere else.
 * Always hidden from assistive technology, since the control carrying it is named by its label.
 */
export function Icon({ glyph: name, size, spinning = false }: { glyph: IconName; size: 12 | 16 | 18; spinning?: boolean }) {
  const Glyph = GLYPHS[name];
  return (
    <Glyph
      aria-hidden
      strokeWidth={STROKE[size]}
      className={glyph({ size, spinning })}
    />
  );
}

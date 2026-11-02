import Ban from "lucide-react/icons/ban";
import Calendar from "lucide-react/icons/calendar";
import CalendarDays from "lucide-react/icons/calendar-days";
import CalendarRange from "lucide-react/icons/calendar-range";
import CalendarSync from "lucide-react/icons/calendar-sync";
import Check from "lucide-react/icons/check";
import ChevronDown from "lucide-react/icons/chevron-down";
import ChevronLeft from "lucide-react/icons/chevron-left";
import ChevronRight from "lucide-react/icons/chevron-right";
import CircleCheck from "lucide-react/icons/circle-check";
import CircleX from "lucide-react/icons/circle-x";
import Clock from "lucide-react/icons/clock";
import Ellipsis from "lucide-react/icons/ellipsis";
import FileText from "lucide-react/icons/file-text";
import Goal from "lucide-react/icons/goal";
import GraduationCap from "lucide-react/icons/graduation-cap";
import HandCoins from "lucide-react/icons/hand-coins";
import Info from "lucide-react/icons/info";
import LayoutDashboard from "lucide-react/icons/layout-dashboard";
import ListFilter from "lucide-react/icons/list-filter";
import LoaderCircle from "lucide-react/icons/loader-circle";
import LogIn from "lucide-react/icons/log-in";
import Mail from "lucide-react/icons/mail";
import MapPin from "lucide-react/icons/map-pin";
import Menu from "lucide-react/icons/menu";
import Monitor from "lucide-react/icons/monitor";
import Moon from "lucide-react/icons/moon";
import PanelLeft from "lucide-react/icons/panel-left";
import Plus from "lucide-react/icons/plus";
import ScrollText from "lucide-react/icons/scroll-text";
import Search from "lucide-react/icons/search";
import Shield from "lucide-react/icons/shield";
import Sun from "lucide-react/icons/sun";
import Trash from "lucide-react/icons/trash-2";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import User from "lucide-react/icons/user";
import UserPlus from "lucide-react/icons/user-plus";
import Users from "lucide-react/icons/users";
import Whistle from "lucide-react/icons/whistle";
import X from "lucide-react/icons/x";

import { tv } from "./tv";

/** What a glyph is handed: Lucide's drawings take all three, a network's mark its box's class alone. */
type GlyphProps = { className?: string; strokeWidth?: number; "aria-hidden"?: boolean };

/**
 * Instagram's and Threads' marks, which Lucide does not draw: each file under `public/icons/footer/` as a
 * mask over the text colour, so the mark takes the theme's colour as a Lucide glyph does.
 */
const network = tv({
  base: "inline-block bg-current mask-contain mask-center mask-no-repeat",
  variants: {
    mark: {
      instagram: "mask-[url('/icons/footer/instagram/instagram_logo_black.svg')]",
      threads: "mask-[url('/icons/footer/threads/threads_logo_black.svg')]",
    },
  },
});

const Instagram = ({ className }: GlyphProps) => (
  <span
    aria-hidden
    className={network({ mark: "instagram", className })}
  />
);

const Threads = ({ className }: GlyphProps) => (
  <span
    aria-hidden
    className={network({ mark: "threads", className })}
  />
);

/**
 * Every glyph the site draws, by what it means rather than by its drawing, so a glyph changes here and
 * nowhere else: one name per meaning, and no drawing under two names, so a reader learns each mark once.
 * Each is imported from its own module, so a test loading the kit loads these icons, not the whole set.
 * The second group names what each page of a frame's menu holds, one glyph per page, so no two entries of a
 * rail or a phone bar share a mark; the same glyph marks that thing wherever else it stands, as a venue's pin
 * leads the pop-up's „Ort“ and a referee's whistle its „Schiedsrichter“.
 */
const GLYPHS = {
  // A record created where its list shows, before the act's label.
  create: Plus,
  // „Anmelden“ at the collapsed rail's foot: an arrow into a door frame.
  signin: LogIn,
  expand: ChevronDown,
  // The theme row's three: the moon for the dark theme, the sun for the light, the screen for the system's.
  dark: Moon,
  // An outcome is a mark in a ring: the bare check is an item chosen, the bare cross a close or a clear.
  done: CircleCheck,
  error: CircleX,
  filter: ListFilter,
  check: Check,
  light: Sun,
  info: Info,
  calendar: Calendar,
  loading: LoaderCircle,
  more: Ellipsis,
  menu: Menu,
  // The season button collapsed to its glyph: a calendar with the cycling arrows, switching between seasons,
  // apart from the plain range of `saisons`, the page listing them.
  saison: CalendarSync,
  close: X,
  // The strip's toggle folding the rail: one glyph in both states, as shadcn/ui's sidebar trigger draws
  // it; the tooltip and `aria-expanded` say which way the next press goes.
  sidebar: PanelLeft,
  search: Search,
  system: Monitor,
  // A time of day, the pop-up's „Uhrzeit“; the date beside it is `calendar`, and the dated fixtures `spielplan`.
  uhrzeit: Clock,
  forward: ChevronRight,
  warning: TriangleAlert,
  back: ChevronLeft,

  overview: LayoutDashboard,
  saisons: CalendarRange,
  // A season's matches, in the public frame and the administration's alike. A calendar with its days
  // marked reads as dated fixtures, and leaves the bare calendar to `calendar`, picking a date.
  spielplan: CalendarDays,
  spielorte: MapPin,
  schiedsrichter: Whistle,
  bewerbungen: FileText,
  teams: Users,
  spieler: User,
  registrierungen: UserPlus,
  administrators: Shield,
  sperrliste: Ban,
  erasures: Trash,
  // An e-mail address: the administration's address changes, and the league's own on the question door and Kontakt.
  email: Mail,
  log: ScrollText,

  // The landing's: its three pillars, who plays (the Abi year), how it is played and what the takings pay
  // for; and the two networks the league posts on.
  pupils: GraduationCap,
  play: Goal,
  proceeds: HandCoins,
  instagram: Instagram,
  threads: Threads,
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

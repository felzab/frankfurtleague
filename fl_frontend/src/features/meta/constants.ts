import type { KontaktChannel, QaQuestion, TeamMember } from "./types";

// Content in code and not data: no database backing and no admin surface, so a change here is a
// deploy. The pages it feeds change once or twice a year.
const TEAM_MEMBERS: TeamMember[] = [
  { id: 1, name: "David", role: "Vorstand", desc: "Ligaleitung & Orga", tag: "vorstand" },
  { id: 2, name: "Maria-Lucia", role: "Vorstand", desc: "Ligaleitung & Orga", tag: "vorstand" },
  { id: 3, name: "Matin", role: "Organisation", desc: "Orga & Verwaltung", tag: "orga" },
  { id: 4, name: "Mana", role: "Organisation", desc: "Orga & Verwaltung", tag: "orga" },
  { id: 5, name: "Nick", role: "Organisation", desc: "Orga & Verwaltung", tag: "orga" },
  { id: 6, name: "Vincent", role: "Organisation", desc: "Orga & Verwaltung", tag: "orga" },
  { id: 7, name: "Felix", role: "Development", desc: "Website & Infrastruktur", tag: "web" },
  { id: 8, name: "Nikolas", role: "Design", desc: "Design & Kommunikation", tag: "web" },
  { id: 9, name: "Cornelia", role: "Design", desc: "Layout & Design", tag: "web" },
  { id: 10, name: "Jonathan", role: "Kommunikation", desc: "Kommunikation & Orga", tag: "web" },
];

/** Section heading per tag. Keyed by the union, so a new tag is a compile error here. */
export const TAG_TITLES: Record<TeamMember["tag"], string> = {
  vorstand: "Vorstand",
  orga: "Organisation",
  web: "Web, Design & Kommunikation",
};

/**
 * Seeded with every key rather than accumulating into `{}`, so each bucket is a real array and a new
 * tag fails to compile here until it has both a bucket and a title.
 */
export const GROUPED_MEMBERS = TEAM_MEMBERS.reduce(
  (acc, member) => {
    acc[member.tag].push(member);
    return acc;
  },
  { vorstand: [], orga: [], web: [] } as Record<TeamMember["tag"], TeamMember[]>,
);

export const KONTAKT_CHANNELS: KontaktChannel[] = [
  {
    id: "email",
    name: "E-Mail",
    // Its own address rather than `KONTAKT_EMAIL`, and shown and linked as the same one: this channel
    // is the inbox the league actually reads, and a value a press does not honour sends a visitor
    // somewhere nobody is.
    value: "frankfurt.league@gmail.com",
    action: "mailto:frankfurt.league@gmail.com",
  },
  {
    id: "instagram",
    name: "Instagram",
    value: "@frankfurt.league",
    action: "https://instagram.com/frankfurt.league",
  },
  { id: "threads", name: "Threads", value: "@frankfurt.league", action: "https://www.threads.com/@frankfurt.league" },
  {
    id: "whatsapp",
    name: "WhatsApp",
    value: "Noch nicht verfügbar",
    action: "https://wa.me",
  },
];

export const QA_QUESTIONS: QaQuestion[] = [
  {
    id: "finanzierung",
    q: "Wie funktioniert die Finanzierung der Abibälle?",
    a: "Die beiden Teams eines Spiels verdienen an Tickets und an ihren Verkäufen vor Ort. Der Erlös wird nach dem Spiel geteilt, in der Regel je zur Hälfte.",
  },
  {
    id: "organisation",
    q: "Wer organisiert die Liga?",
    a: "Ehrenamtliche Schülerinnen, Schüler und Helfer. Wer dazugehört, steht auf der Team-Seite.",
  },
  {
    id: "regeln",
    q: "Nach welchen Regeln wird gespielt?",
    a: "11 gegen 11, zwei Hälften à 45 Minuten. Die Schiedsrichter kommen, soweit möglich, von außerhalb.",
  },
  {
    id: "teilnahme",
    q: "Wer darf in den Teams mitspielen?",
    a: "Nur Schülerinnen und Schüler des Abijahrgangs, für den das Team antritt.",
  },
  {
    id: "bewerbung",
    q: "Wie kann unsere Schule der Liga beitreten?",
    a: "Neue Schulen bewerben sich in der Saisonpause, mit einem vollständigen Kader und mindestens einer Vertretung der Schule. Schreib uns über die Kontakt-Seite.",
  },
  {
    id: "wetter",
    q: "Was passiert bei schlechtem Wetter?",
    a: "Wir spielen bei jedem Wetter. Bei offizieller Unwetterwarnung oder Platzsperre wird das Spiel abgesagt und neu angesetzt.",
  },
  {
    id: "preise",
    q: "Was bekommt der Gewinner?",
    a: "Das meiste Geld, dazu Ruhm und Ehre als bester Abijahrgang des Jahres.",
  },
  {
    id: "lehrer",
    q: "Dürfen auch Lehrer mitspielen?",
    a: "Nein, die Frankfurt-League ist eine reine Schülerliga. Als Fans an der Seitenlinie sind Lehrer willkommen.",
  },
  {
    id: "schiedsrichter-platzgebühr",
    q: "Wie werden die Schiedsrichter und die Platzgebühr bezahlt?",
    a: "Die beiden Teams legen die Kosten vor und holen sie sich aus den Einnahmen des Spiels zurück.",
  },
  {
    id: "flinta",
    q: "Können auch Mädchen- oder gemischte Teams antreten?",
    a: "Absolut, die Liga ist offen für alle.",
  },
  {
    id: "orte",
    q: "Wo finden die Spiele statt?",
    a: "Wir haben keinen zentralen Spielort. Wo und wann ein Spiel stattfindet, steht im Spielplan.",
  },
  {
    id: "eintritt",
    q: "Kostet der Eintritt etwas?",
    a: "Ja, je nach Spiel und Kaufzeitpunkt 2 bis 5 €. Im Vorverkauf sind Tickets meist günstiger.",
  },
  {
    id: "verletzungen",
    q: "Wie seid ihr bei Verletzungen abgesichert?",
    a: "Bei den meisten Spielen sind Sanitäter vor Ort, ebenfalls Schüler. Im Notfall rufen wir sofort den Krankenwagen.",
  },
  {
    id: "tabelle",
    q: "Wie setzt sich die Tabelle zusammen?",
    a: "Nach Punkten aus den Spielen der Gruppenphase.",
  },
  {
    id: "finale",
    q: "Gibt es ein großes Finale?",
    a: "Nach der Gruppenphase folgt die KO-Runde bis zum Finale. Diese Spiele sind größer aufgezogen als die Gruppenspiele.",
  },
];

import type { KontaktChannel, TeamMember } from "./types";

export const TEAM_MEMBERS: TeamMember[] = [
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

export const KONTAKT_CHANNELS: KontaktChannel[] = [
  {
    id: "email",
    name: "E-Mail",
    value: "frankfurt.league@gmail.com",
    action: "mailto:kontakt@frankfurt-league.de",
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
    value: "N/A",
    action: "https://wa.me",
  },
];

export const QA_QUESTIONS = [
  {
    id: "finanzierung",
    q: "Wie genau funktioniert die Finanzierung der Abibälle?",
    a: "Die Teams, die bei einem bestimmten Spiel gegeneinander spielen verdienen durch Tickets und Verkäufe vor Ort (Kuchen, Getränke etc) Geld, welches dann nach dem Spiel zwischen den Teams verteilt wird. Dies ist normalerweise eine 50%/50% Verteilung. Je weiter ein Team in der Frankfurt-League kommt, desto mehr Möglichkeiten gibt es, Geld für den Abiball zu verdienen.",
  },
  {
    id: "organisation",
    q: "Wer organisiert den Ligabetrieb?",
    a: "Die Frankfurt-League wird von einem Team ehrenamtlicher Schüler und Helfer bei den jeweiligen Spielen betrieben. Erfahre mehr hierüber auf unserer Team-Seite!",
  },
  {
    id: "regeln",
    q: "Nach welchen Regeln wird gespielt?",
    a: "Es wird reguläres 11-gegen-11 Fußball gespielt und jedes Spiel besteht aus zwei Hälften à 45min. Es werden, soweit möglich, neutrale und externe Schiedsrichter eingesetzt. Wichtig ist, dass der Kader jedes Teams nur aus Spielern ihres eigenen Abijahrgangs bestehen muss.",
  },
  {
    id: "teilnahme",
    q: "Wer darf in den Teams mitspielen?",
    a: "Spielberechtigt sind ausschließlich aktive Schülerinnen und Schüler der jeweiligen Schule, welche den jewiligen Abijahrgang besuchen.",
  },
  {
    id: "bewerbung",
    q: "Wie kann unsere Schule der Liga beitreten?",
    a: "Neue Schulen bewerben sich in der Saisonpause. Dafür braucht ihr einen vollständigen Kader und einen oder mehrere Vertreter der Schule. Kontaktiert uns einfach über einen der auf unserer Kontakt-Seite stehenden Wege.",
  },
  {
    id: "wetter",
    q: "Was passiert bei schlechtem Wetter?",
    a: "Wir spielen bei jedem Wetter. Bei offizieller Unwetterwarnung oder Platzsperre wird das Spiel durch das Orga-Team abgesagt und neu angesetzt.",
  },
  {
    id: "preise",
    q: "Was bekommt der Gewinner?",
    a: "Vor allem natürlich das meiste Geld, aber auch Ruhm und Ehre als bester Abijahrgang des jewiligen Jahres.",
  },
  {
    id: "lehrer",
    q: "Dürfen auch Lehrer mitspielen?",
    a: "Nein. Die Frankfurt-League ist ein reines Schüler-Turnier. Lehrer sind als treue Fans an der Seitenlinie willkommen.",
  },
  {
    id: "schiedsrichter-platzgebühr",
    q: "Wie werden die Schiedsrichter und die Platzgebühr bezahlt?",
    a: "Alle Kosten müssen im Voraus von den spielenden Teams bezahlt werden und können im Nachhinein aus den Einnahmen des jewiligen Spiels finanziert werden.",
  },
  {
    id: "flinta",
    q: "Können auch Mädchen- oder gemischte Teams antreten?",
    a: "Absolut! Die Liga ist offen für alle. Wir freuen uns über jeden Spieler und jede Spielerin auf dem Platz.",
  },
  {
    id: "orte",
    q: "Wo finden die Spiele statt?",
    a: "Wir haben keinen Zentralen Spielort. Der Ort und die Uhrzeit, an dem ein bestimmtes Spiel stattdfindet wird immer auf unserer Website bekannt gegeben und kann in der Saisonübersicht eingesehen werden.",
  },
  {
    id: "eintritt",
    q: "Kostet der Eintritt etwas?",
    a: "Ja, da Geld für die Abikassen gesammelt wird, kostet der Eintritt je nach Spiel und Kaufzeitpunkt 2-5€. In den meisten Fällen lohnt es sich, Tickets im Voraus zu kaufen!",
  },
  {
    id: "verletzungen",
    q: "Wie seid ihr bei Verletzungen abgesichert?",
    a: "Bei den meisten Spielen sind Sanitäter (Schüler) anwesend und im Notfall wird natürlich sofort der Krankenwagen gerufen.",
  },
  {
    id: "tabelle",
    q: "Wie setzt sich die Tabelle zusammen?",
    a: "Es gibt regulär 3 Punkte für einen Sieg, 1 Punkt für ein Unentschieden und 0 Punkte für eine Niederlage. Bei gleichem Punktestand wird die Tordifferenz berücksichtigt. ",
  },
  {
    id: "finale",
    q: "Gibt es ein großes Finale?",
    a: "Nach der Gruppenphase folgen die Playoffs, welche vom Viertelfinale bis zum Finale gehen. Diese Spiele sind oft etwas breiter organisiert, als Gruppenspiele.",
  },
];

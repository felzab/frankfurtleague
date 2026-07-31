import Image from "next/image";
import Link from "next/link";

import { ArrowsExpand, Envelope } from "@gravity-ui/icons";

import { Card } from "@heroui/react";

import { KONTAKT_CHANNELS } from "../../constants";

export default function KontaktView() {
  const getIcon = (id: string) => {
    switch (id) {
      case "email":
        return (
          <Envelope
            aria-hidden="true"
            width={32}
            height={32}
          />
        );
      case "instagram":
        return (
          <Image
            src="/icons/footer/instagram/instagram.svg"
            alt=""
            width={32}
            height={32}
            title="Instagram by Pixel Icons"
          />
        );
      case "threads":
        return (
          // bg-field-fg, not bg-foreground as in the Footer: this icon sits on the green field card,
          // where the foreground is always white. The light-theme variant used to render the BLACK
          // logo here, on emerald.
          // inline-block for the same reason as the Footer's copy — this one is a flex item today,
          // which blockifies it, but that is the parent's business and not something to depend on.
          <span
            aria-hidden="true"
            className="bg-field-fg inline-block size-8 mask-[url('/icons/footer/threads/threads_logo_black.svg')] mask-contain mask-center mask-no-repeat"
          />
        );
      case "whatsapp":
        return (
          <Image
            src="/icons/footer/whatsapp/whatsapp.svg"
            alt=""
            width={32}
            height={32}
            title="Whatsapp by Icon Mafia"
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="max-w-meta flex w-full flex-col items-center gap-y-4 text-left sm:gap-y-8">
      {/** Headline */}
      <div className="flex flex-col items-center px-2 text-center">
        <h1 className="text-fluid-2xl sm:text-fluid-2xl lg:text-fluid-3xl text-field-fg font-black tracking-tight uppercase drop-shadow-md">
          Frankfurt-League Kontakt
        </h1>
        <p className="text-fluid-sm sm:text-fluid-sm text-field-fg/80 mt-2 font-medium">Wir haben immer ein offenes Ohr für Dein Anliegen.</p>
      </div>

      <div className="soccer-field-separator w-full" />

      {/** Section 1: Offenheit */}
      <section className="flex w-full flex-col gap-y-3 sm:gap-y-4">
        <div className="text-field-fg flex flex-row items-center gap-x-3">
          <ArrowsExpand className="size-5 drop-shadow sm:size-6 lg:size-7" />
          <h2 className="text-fluid-base sm:text-fluid-lg font-extrabold tracking-wide uppercase">Wir sind für alles offen</h2>
        </div>

        <div className="soccer-field-card-bg soccer-field-card-border rounded-2xl border p-5 shadow-xl sm:p-6 lg:p-8">
          <p className="text-fluid-xs sm:text-fluid-sm text-field-fg/95 leading-relaxed font-medium text-pretty">
            Fragen, Verbesserungsvorschläge oder Anregungen zur Liga? Kontaktiere uns gern über einen der folgenden Wege. Wir melden uns
            schnellstmöglich bei Dir!
          </p>
        </div>
      </section>

      <div className="soccer-field-separator w-full" />

      {/** Section 2: Channels Grid */}
      <section
        role="list"
        className="grid w-full grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
        {KONTAKT_CHANNELS.map((channel, i) => (
          <Card
            role="listitem"
            key={i}
            className="soccer-field-card-bg soccer-field-card-border flex flex-col justify-between rounded-2xl border p-5 shadow-xl sm:p-6">
            <div>
              <Card.Header className="flex flex-row items-center gap-x-3.5 p-0 sm:gap-x-4">
                <div className="bg-field-fg/10 flex size-11 shrink-0 items-center justify-center rounded-xl p-2 shadow-inner sm:size-12">
                  {getIcon(channel.id)}
                </div>
                <div className="text-fluid-sm sm:text-fluid-base text-field-fg font-extrabold tracking-wider uppercase">{channel.name}</div>
              </Card.Header>

              <div className="soccer-field-separator my-3 sm:my-4" />

              <Card.Content className="p-0">
                <span className="text-fluid-sm text-field-fg/90 font-mono font-bold tracking-tight break-all">{channel.value}</span>
              </Card.Content>
            </div>

            <Card.Footer className="p-0 pt-5 sm:pt-6">
              <Link
                href={channel.action}
                target="_blank"
                rel="noopener noreferrer"
                className="text-fluid-xs border-field-fg/30 bg-field-fg/10 text-field-fg hover:border-field-fg hover:bg-field-fg/25 flex w-full items-center justify-center rounded-xl border py-3 font-bold uppercase backdrop-blur-sm transition-all duration-200 active:scale-95">
                Jetzt kontaktieren
              </Link>
            </Card.Footer>
          </Card>
        ))}
      </section>
    </div>
  );
}

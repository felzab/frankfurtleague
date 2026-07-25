import Image from "next/image";
import Link from "next/link";

import { ArrowsExpand, Envelope } from "@gravity-ui/icons";

import { Card } from "@heroui/react";

import { KONTAKT_CHANNELS } from "../../constants";

export default function KontaktView() {
  const getIcon = (id: string) => {
    switch (id) {
      case "email":
        return <Envelope className="size-7 sm:size-8 lg:size-9" />;
      case "instagram":
        return (
          <Image
            src="/icons/footer/instagram/instagram.svg"
            alt="Instagram logo link"
            width={32}
            height={32}
            className="size-8 sm:size-9"
            title="Instagram by Pixel Icons"
          />
        );
      case "threads":
        return (
          <>
            <Image
              src={"/icons/footer/threads/threads_logo_black.svg"}
              alt="Threads logo link"
              width={32}
              height={32}
              title="Threads logo link"
              className="block size-8 sm:size-9 dark:hidden"
            />
            <Image
              src={"/icons/footer/threads/threads_logo_white.svg"}
              alt="Threads logo link"
              width={32}
              height={32}
              title="Threads logo link"
              className="hidden size-8 sm:size-9 dark:block"
            />
          </>
        );
      case "whatsapp":
        return (
          <Image
            src="/icons/footer/whatsapp/whatsapp.svg"
            alt="Whatsapp logo link"
            width={32}
            height={32}
            className="size-8 sm:size-9"
            title="Whatsapp by Icon Mafia"
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex w-full max-w-[1200px] flex-col items-center gap-y-4 text-left sm:gap-y-8">
      {/** Headline */}
      <div className="flex flex-col items-center px-2 text-center">
        <h2 className="text-fluid-2xl sm:text-fluid-2xl lg:text-fluid-3xl font-black tracking-tight text-white uppercase drop-shadow-md">
          Frankfurt-League Kontakt
        </h2>
        <p className="text-fluid-sm sm:text-fluid-sm mt-2 font-medium text-white/80">Wir haben immer ein offenes Ohr für dein Anliegen.</p>
      </div>

      <div className="soccer-field-separator w-full" />

      {/** Section 1: Offenheit */}
      <section className="flex w-full flex-col gap-y-3 sm:gap-y-4">
        <div className="flex flex-row items-center gap-x-3 text-white">
          <ArrowsExpand className="size-5 drop-shadow sm:size-6 lg:size-7" />
          <h3 className="text-fluid-base sm:text-fluid-lg font-extrabold tracking-wide uppercase">Wir sind für alles offen</h3>
        </div>

        <div className="soccer-field-card-bg soccer-field-card-border rounded-2xl border p-5 shadow-xl sm:p-6 lg:p-8">
          <p className="text-fluid-xs sm:text-fluid-sm leading-relaxed font-medium text-pretty text-white/95">
            Fragen, Verbesserungsvorschläge oder Anregungen zur Liga? Kontaktiere uns gern über einen der folgenden Wege. Wir melden uns
            schnellstmöglich bei dir!
          </p>
        </div>
      </section>

      <div className="soccer-field-separator w-full" />

      {/** Section 2: Channels Grid */}
      <section className="grid w-full grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
        {KONTAKT_CHANNELS.map((channel, i) => (
          <Card
            key={i}
            className="soccer-field-card-bg soccer-field-card-border flex flex-col justify-between rounded-2xl border p-5 shadow-xl backdrop-blur-md sm:p-6">
            <div>
              <Card.Header className="flex flex-row items-center gap-x-3.5 p-0 sm:gap-x-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/10 p-2 shadow-inner sm:size-12">
                  {getIcon(channel.id)}
                </div>
                <div className="text-fluid-sm sm:text-fluid-base font-extrabold tracking-wider text-white uppercase">{channel.name}</div>
              </Card.Header>

              <div className="soccer-field-separator my-3 sm:my-4" />

              <Card.Content className="p-0">
                <span className="text-fluid-sm font-mono font-bold tracking-tight break-all text-white/90">{channel.value}</span>
              </Card.Content>
            </div>

            <Card.Footer className="p-0 pt-5 sm:pt-6">
              <Link
                href={channel.action}
                target="_blank"
                rel="noopener noreferrer"
                className="text-fluid-xs flex w-full items-center justify-center rounded-xl border border-white/30 bg-white/10 py-3 font-bold text-white uppercase backdrop-blur-sm transition-all duration-200 hover:border-white hover:bg-white/25 active:scale-95">
                Jetzt kontaktieren
              </Link>
            </Card.Footer>
          </Card>
        ))}
      </section>
    </div>
  );
}

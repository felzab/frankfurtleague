import Image from "next/image";
import Link from "next/link";

import { ArrowsExpand, Envelope } from "@gravity-ui/icons";

import { Card, Separator } from "@heroui/react";

import { KONTAKT_CHANNELS } from "../../constants";

export default function KontaktView() {
  const getIcon = (id: string) => {
    switch (id) {
      case "email":
        return <Envelope className="h-[38px] w-[38px]" />;
      case "instagram":
        return (
          <Image
            src="/icons/footer/instagram/instagram.svg"
            alt="Instagram logo link"
            width={38}
            height={38}
            title="Instagram by Pixel Icons"
          />
        );
      case "threads":
        return (
          <>
            <Image
              src={"/icons/footer/threads/threads_logo_black.svg"}
              alt="Threads logo link"
              width={38}
              height={38}
              title="Threads (X) logo link"
              className="block h-[38px] w-[38px] dark:hidden"
            />
            <Image
              src={"/icons/footer/threads/threads_logo_white.svg"}
              alt="Threads logo link"
              width={38}
              height={38}
              title="Threads (X) logo link"
              className="hidden h-[38px] w-[38px] dark:block"
            />
          </>
        );
      case "whatsapp":
        return (
          <Image
            src="/icons/footer/whatsapp/whatsapp.svg"
            alt="Whatsapp logo link"
            width={38}
            height={38}
            title="Whatsapp by Icon Mafia"
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="relative flex flex-col items-center gap-y-10 py-30 text-left lg:py-44">
      <h2 className="text-fluid-xl xl:text-fluid-3xl font-extrabold tracking-tighter uppercase">Frankfurt-League Kontakt</h2>

      <Separator className="soccer-field-separator" />

      {/** Section 1: Offenheit */}
      <section className="items-left flex w-[90%] flex-col gap-y-4 lg:w-[80%]">
        {/** Sub-heading */}
        <div className="flex flex-row items-center gap-x-2 lg:gap-x-4">
          <ArrowsExpand className="h-[22px] w-[22px] lg:h-[30px] lg:w-[30px]" />
          <h3 className="text-fluid-lg font-extrabold tracking-wide uppercase">Wir sind für alles offen</h3>
        </div>

        <p className="text-fluid-md soccer-field-card-bg w-full rounded-2xl px-6 py-4 font-medium text-pretty shadow-xl lg:p-6">
          Fragen, Verbesserungsvorschläge oder Anregungen zur Liga? Kontaktiere uns gern über einen der folgenden Wege.
        </p>
      </section>

      <Separator className="soccer-field-separator" />

      {/** Section 2: Channels */}
      <section className="grid w-[90%] grid-cols-1 gap-6 p-4 md:grid-cols-2 lg:w-[80%] lg:grid-cols-3">
        {KONTAKT_CHANNELS.map((channel, i) => (
          <Card
            key={i}
            className="soccer-field-card-bg soccer-field-card-border min-w-[280px] border p-6 backdrop-blur md:min-w-[300px] lg:min-w-[320px] 2xl:min-w-[380px]">
            <Card.Header className="justify-left flex flex-row items-center gap-x-4 px-2">
              <div>{getIcon(channel.id)}</div>
              <div className="text-fluid-base font-extrabold tracking-wider uppercase">{channel.name}</div>
            </Card.Header>
            <Separator className="h-[2px] bg-emerald-400/20" />
            <Card.Content className="text-fluid-xxs flex w-fit items-center p-2 font-bold text-emerald-600 dark:text-emerald-300">
              {channel.value}
            </Card.Content>
            <Card.Footer>
              <Link
                href={channel.action}
                target="_blank"
                className="soccer-field-card-bg w-full rounded-2xl p-2 text-center">
                Jetzt kontaktieren
              </Link>
            </Card.Footer>
          </Card>
        ))}
      </section>
    </div>
  );
}

import { Card, Separator } from "@heroui/react";
import Link from "next/link";
import { Envelope, ArrowsExpand } from "@gravity-ui/icons";
import Image from "next/image";
import ThreadsLogo from "@/shared/components/layout/footer/ThreadsLogo";
import { KONTAKT_CHANNELS } from "../constants";

export default function Kontakt() {
  const getIcon = (id: string) => {
    switch (id) {
      case "email":
        return <Envelope className="w-[38px] h-[38px]" />;
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
        return <ThreadsLogo />;
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
    <div className="relative flex flex-col items-center gap-y-10 py-30 lg:py-44 text-left">
      <h2 className="text-fluid-xl xl:text-fluid-3xl tracking-tighter font-extrabold uppercase">Frankfurt-League Kontakt</h2>

      <Separator className="soccer-field-separator" />

      {/** Section 1: Offenheit */}
      <section className="flex flex-col items-left gap-y-4 w-[90%] lg:w-[80%] ">
        {/** Sub-heading */}
        <div className="flex flex-row items-center gap-x-2 lg:gap-x-4">
          <ArrowsExpand className="w-[22px] h-[22px] lg:w-[30px] lg:h-[30px]" />
          <h3 className="text-fluid-lg tracking-wide font-extrabold uppercase">Wir sind für alles offen</h3>
        </div>

        <p className="w-full px-6 py-4 lg:p-6 rounded-2xl text-fluid-md text-balance font-medium soccer-field-card-bg shadow-xl">
          Fragen, Verbesserungsvorschläge oder Anregungen zur Liga? Kontaktiere uns gern über einen der folgenden Wege.
        </p>
      </section>

      <Separator className="soccer-field-separator" />

      {/** Section 2: Channels */}
      <section className="w-[90%] lg:w-[80%] grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-4">
        {KONTAKT_CHANNELS.map((channel, i) => (
          <Card
            key={i}
            className="min-w-[280px] md:min-w-[300px] lg:min-w-[320px] 2xl:min-w-[380px] p-6 soccer-field-card-bg backdrop-blur border soccer-field-card-border">
            <Card.Header className="flex flex-row items-center justify-left px-2 gap-x-4">
              <div>{getIcon(channel.id)}</div>
              <div className="font-extrabold text-fluid-base uppercase tracking-wider">{channel.name}</div>
            </Card.Header>
            <Separator className="h-[2px] bg-emerald-400/20" />
            <Card.Content className="flex items-center w-fit p-2 text-fluid-xxs font-bold text-emerald-600 dark:text-emerald-300">
              {channel.value}
            </Card.Content>
            <Card.Footer>
              <Link
                href={channel.action}
                target="_blank"
                className="w-full p-2 text-center soccer-field-card-bg rounded-2xl">
                Jetzt kontaktieren
              </Link>
            </Card.Footer>
          </Card>
        ))}
      </section>
    </div>
  );
}

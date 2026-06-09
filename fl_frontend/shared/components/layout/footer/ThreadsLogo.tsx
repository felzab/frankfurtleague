"use client";

import useMounted from "@/shared/hooks/useMounted";
import { useTheme } from "next-themes";
import Image from "next/image";

export default function ThreadsLogo() {
  const { theme } = useTheme();
  const mounted = useMounted();

  if (!mounted) {
    return <></>;
  }
  return (
    <Image
      src={theme === "light" ? "/icons/footer/threads/threads_logo_black.svg" : "/icons/footer/threads/threads_logo_white.svg"}
      alt="Threads logo link"
      width={38}
      height={38}
      title="Threads (X) logo link"
      className="w-[38px] h-[38px]"
    />
  );
}

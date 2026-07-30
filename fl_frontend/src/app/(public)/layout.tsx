import { Suspense } from "react";

import ServerIsLive from "@/features/system/components/ServerIsLive";
import Footer from "@/shared/components/layout/footer/Footer";
import TopNav from "@/shared/components/layout/topnav/TopNav";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="bg-surface border-border z-10 h-[55px] w-full border-b">
        {/* Sized to the header, not the page: this boundary wraps TopNav, not children. */}
        <Suspense fallback={<div className="bg-muted/40 h-full w-full animate-pulse" />}>
          <TopNav />
        </Suspense>
      </header>

      <main className="flex w-full flex-1 flex-col items-center justify-start">{children}</main>

      <footer className="bg-surface border-border z-10 h-auto w-full shrink-0 border-t lg:h-[220px]">
        <Footer serverStatusSlot={<ServerIsLive />} />
      </footer>
    </>
  );
}

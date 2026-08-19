import { ServerIsLive } from "@/features/system/components/ui/ServerIsLive";
import { Footer } from "@/shared/components/layout/footer/Footer";
import { TopNav } from "@/shared/components/layout/topnav/TopNav";
import { SkipToContentLink } from "@/shared/components/ui/SkipToContentLink";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SkipToContentLink />

      {/* `box-content` is load-bearing: the height becomes --navbar-height plus the border, which
          the <nav> inside also uses. Under border-box the nav overflows it by the border. */}
      <header className="bg-surface border-border z-10 box-content h-(--navbar-height) w-full border-b">
        <TopNav />
      </header>

      <main
        id="main-content"
        className="flex w-full flex-1 flex-col items-center justify-start">
        {children}
      </main>

      <footer className="bg-surface border-border z-10 h-auto w-full shrink-0 border-t lg:h-[220px]">
        <Footer serverStatusSlot={<ServerIsLive />} />
      </footer>
    </>
  );
}

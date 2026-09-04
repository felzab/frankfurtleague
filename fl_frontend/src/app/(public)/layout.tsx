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

      {/* The floor keeps the footer off the first screen, where `flex-1` alone would park it at the
          bottom of one. Less the border `box-content` puts outside the token, which the floor
          would otherwise overshoot the screen by. */}
      <main
        id="main-content"
        className="flex min-h-[calc(100dvh-var(--navbar-height)-1px)] w-full flex-1 flex-col items-center justify-start">
        {children}
      </main>

      {/* A floor, never a height: a fixed one is left behind by a column gaining a link, and the
          fill stops where the separator and the copyright row are still being drawn. */}
      <footer className="bg-surface border-border z-10 flex w-full shrink-0 flex-col border-t lg:min-h-[220px]">
        <Footer serverStatusSlot={<ServerIsLive />} />
      </footer>
    </>
  );
}

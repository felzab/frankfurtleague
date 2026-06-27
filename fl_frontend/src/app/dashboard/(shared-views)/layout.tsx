export default async function TeamsWithSpielerPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-tertiary-light dark:bg-tertiary-dark text-text-black dark:text-text-white scrollbar-hide mt-2 flex h-full min-h-dvh w-[95%] max-w-[1550px] flex-col gap-y-2 overflow-y-scroll rounded-2xl p-2 lg:p-5">
      {children}
    </div>
  );
}

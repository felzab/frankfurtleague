export default async function TeamsWithSpielerPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-dvh h-full w-[95%] max-w-[1550px] gap-y-2 p-2 lg:p-5 rounded-2xl mt-2 bg-tertiary-light dark:bg-tertiary-dark text-text-black dark:text-text-white overflow-y-scroll scrollbar-hide">
      {children}
    </div>
  );
}

export default function PageLoader() {
  return (
    <div className="h-[200dvh] flex flex-col items-center justify-start pt-20 text-center ">
      <div className="w-25 h-25 border-8 border-dotted rounded-full animate-spin border-quaternary-light dark:border-quaternary-dark"></div>
      <h2 className="text-text-black dark:text-text-white mt-4">Laden...</h2>
    </div>
  );
}

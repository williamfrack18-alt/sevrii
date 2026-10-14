import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";

// The same simple frame as the login page: logo, language, centered column.
export default function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="theme-dark flex flex-col min-h-dvh">
      <header className="h-[78px] px-6 sm:px-10 flex items-center justify-between">
        <BrandMark />
        <LangToggle />
      </header>
      <main className="flex-1 flex items-center justify-center px-6 pb-20">
        <div className="w-full max-w-[420px] flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h1 className="font-serif text-[38px] leading-[1.08]">{title}</h1>
            {subtitle && <p className="text-muted text-[16px]">{subtitle}</p>}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

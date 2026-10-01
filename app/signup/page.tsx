import Link from "next/link";
import SignupForm from "./SignupForm";
import BrandMark from "@/components/BrandMark";

export default function SignupPage() {
  return (
    <div className="theme-dark flex">
      <div
        className="hidden md:flex w-[44%] p-14 flex-col justify-between"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 20% 80%, rgba(61,220,132,.22), transparent 70%), linear-gradient(160deg,#0f4d34 0%,#0a3322 45%,#061c13 100%)",
        }}
      >
        <BrandMark />
        <div className="flex flex-col gap-6">
          <h1 className="font-serif text-[48px] leading-[1.06]">
            Turn what you&rsquo;re good at into a real business
          </h1>
          <p className="text-[17px] leading-relaxed max-w-sm" style={{ color: "rgba(255,255,255,.75)" }}>
            Sevrii helps you define your service, build your page, and land your first customers with AI.
          </p>
        </div>
        <div className="text-[13px]" style={{ color: "rgba(255,255,255,.55)" }}>
          © Sevrii 2026
        </div>
      </div>
      <div className="flex-1 flex flex-col">
        <header className="h-[78px] px-6 sm:px-10 flex items-center md:hidden">
          <BrandMark />
        </header>
        <main className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-[420px] flex flex-col gap-8">
            <div className="flex flex-col gap-3">
              <span className="text-[14px] font-medium" style={{ color: "#3ddc84" }}>
                Create your account
              </span>
              <h2 className="font-serif text-[40px] leading-[1.08]">Let&rsquo;s get started</h2>
              <p className="text-muted text-[16px]">
                You&rsquo;re creating your account as a service provider on Sevrii.
              </p>
            </div>
            <SignupForm />
            <p className="text-[14px] text-muted">
              Already have an account?{" "}
              <Link href="/login" className="text-ink font-semibold underline">
                Log in
              </Link>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

import Link from "next/link";
import SignupForm from "./SignupForm";

export default function SignupPage() {
  return (
    <div className="min-h-screen flex bg-cream">
      <div className="hidden md:flex w-[40%] bg-ink text-white p-14 flex-col justify-between">
        <Link href="/" className="font-serif text-2xl font-semibold">
          Sevri
        </Link>
        <div className="flex flex-col gap-6">
          <h1 className="font-serif text-4xl font-semibold leading-tight">
            Turn what you&rsquo;re good at into a real business
          </h1>
          <p className="text-white/85 max-w-sm">
            Sevri helps you define your service, build your page, and land your first customers
            with AI.
          </p>
        </div>
        <div className="text-white/60 text-[13px]">© Sevri 2026</div>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[420px] flex flex-col gap-7">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold uppercase tracking-wide text-ink">
              Create your account
            </span>
            <h2 className="font-serif text-3xl font-semibold">Let&rsquo;s get started</h2>
            <p className="text-muted text-[15px]">
              You&rsquo;re creating your account as a service provider on Sevri.
            </p>
          </div>
          <SignupForm />
          <p className="text-center text-[14px] text-muted">
            Already have an account?{" "}
            <Link href="/login" className="text-ink font-semibold underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

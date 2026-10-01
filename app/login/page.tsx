import Link from "next/link";
import LoginForm from "./LoginForm";
import BrandMark from "@/components/BrandMark";

export default function LoginPage() {
  return (
    <div className="theme-dark flex flex-col">
      <header className="h-[78px] px-6 sm:px-10 flex items-center">
        <BrandMark />
      </header>
      <main className="flex-1 flex items-center justify-center px-6 pb-20">
        <div className="w-full max-w-[420px] flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h1 className="font-serif text-[40px] leading-[1.08]">Welcome back</h1>
            <p className="text-muted text-[16px]">Log in to your Sevrii account.</p>
          </div>
          <LoginForm />
          <p className="text-[14px] text-muted">
            New to Sevrii?{" "}
            <Link href="/signup" className="text-ink font-semibold underline">
              Create an account
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

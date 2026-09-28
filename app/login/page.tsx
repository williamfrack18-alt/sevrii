import Link from "next/link";
import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cream p-8">
      <div className="w-full max-w-[420px] flex flex-col gap-7">
        <Link href="/" className="font-serif text-2xl font-semibold self-center">
          Sevri
        </Link>
        <div className="flex flex-col gap-2 text-center">
          <h2 className="font-serif text-3xl font-semibold">Welcome back</h2>
          <p className="text-muted text-[15px]">Log in to your Sevri account.</p>
        </div>
        <LoginForm />
        <p className="text-center text-[14px] text-muted">
          New to Sevri?{" "}
          <Link href="/signup" className="text-ink font-semibold underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}

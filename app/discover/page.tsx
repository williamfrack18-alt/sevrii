import { redirect } from "next/navigation";

// The fixed-question onboarding was replaced by the Brain: everything starts at /start.
export default async function Page({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  redirect((await searchParams)?.new === "1" ? "/start?new=1" : "/start");
}

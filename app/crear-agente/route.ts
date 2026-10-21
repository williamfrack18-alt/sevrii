import { getCurrentUser } from "@/lib/session";
import { startWith } from "@/lib/startPath";

export const dynamic = "force-dynamic";

// "Crear mi agente" on sevrii.com and on /agentes: sign-up (or log-in) and then
// the three paths with "Crear un agente" already picked.
export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  return startWith("agent", user);
}

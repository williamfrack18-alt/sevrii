import "server-only";
import { NextResponse } from "next/server";
import { siteUrl } from "./billing";

export const START_PATHS = ["existing", "new", "agent"] as const;
export type StartPath = (typeof START_PATHS)[number];
export const isStartPath = (v: unknown): v is StartPath => (START_PATHS as readonly unknown[]).includes(v);

// The buttons on sevrii.com that already say what the person wants ("Crear mi
// tienda", "Crear mi agente"): remember it through sign-up or log-in, so the
// first screen inside Sevrii (the three paths) opens with it picked.
export function startWith(path: StartPath | null, user: { business?: unknown } | null) {
  const q = path ? `path=${path}` : "";
  const to = !user ? "/signup" : user.business ? `/start?new=1${q ? `&${q}` : ""}` : `/start${q ? `?${q}` : ""}`;
  const res = NextResponse.redirect(`${siteUrl()}${to}`, 303);
  if (path) res.cookies.set("sevrii_path", path, { path: "/", maxAge: 60 * 60, sameSite: "lax", httpOnly: true, secure: true });
  return res;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBusinessBySlug, getUserById } from "@/lib/db";
import { limitsFor } from "@/lib/billing";
import { getCurrentUser } from "@/lib/session";
import ChatWidget from "../ChatWidget";
import { chatAgentFor } from "../agentChat";
import "../store.css";

// The agent's room: when someone tries or buys the agent they come in here, a
// full-screen chat with the agent's name and brand where the whole service
// happens (it does the task, shows the case file, asks for their OK).
export const maxDuration = 300;

async function load(slug: string) {
  const b = await getBusinessBySlug(slug);
  if (!b) return null;
  const owner = await getUserById(b.userId);
  const live = b.published && Boolean(owner && limitsFor(owner).canPublish);
  const viewer = live ? null : await getCurrentUser().catch(() => null);
  if (!live && viewer?.id !== b.userId) return null;
  return { b, live };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const found = await load(slug);
  if (!found) return { title: "Sevrii", robots: { index: false } };
  const name = found.b.serviceAgent.name || found.b.name;
  return { title: `${name} · ${found.b.site.lang === "en" ? "AI agent" : "Agente de IA"}`, robots: { index: false } };
}

export default async function AgentRoom({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const found = await load(slug);
  if (!found) notFound();
  const { b, live } = found;
  const agent = chatAgentFor(b);
  if (!agent) notFound();
  const site = b.site;
  const lang = site.lang === "en" ? "en" : "es";
  const rawC = (await searchParams).c;
  const campaign = typeof rawC === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(rawC) ? rawC : "";
  return (
    // Always Sevrii's black, white and green here (not the project's accent color).
    <div className="mt ag ag-room" lang={site.lang}>
      {!live && <div className="draft-bar">{lang === "es" ? "Borrador: solo tú puedes ver esta página." : "Draft: only you can see this page."}</div>}
      <div className="ag-room-top">
        <a href={`/site/${b.slug}`}>← {b.name}</a>
        <span>{lang === "es" ? "Agente de IA · Sevrii" : "AI agent · Sevrii"}</span>
      </div>
      <main className="ag-room-main">
        <div className="ag-room-chat" id="chat">
          <ChatWidget room slug={b.slug} businessName={b.name} logoUrl={site.logoUrl} ownerName={site.ownerName} ownerPhoto={site.ownerPhotoUrl} lang={lang} campaign={campaign || undefined} agent={agent} />
        </div>
      </main>
    </div>
  );
}

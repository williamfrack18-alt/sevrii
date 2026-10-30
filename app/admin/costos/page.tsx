import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { isStaffAdmin } from "@/lib/billing";
import { aiFeatureReport, type AiFeatureRow } from "@/lib/db";

// What each Sevrii function really costs in AI (measured per call since the
// per-function meter exists), and what a plan costs at its limits. Only for
// Sevrii's admins. Numbers in USD; tokens as the API reports them.
export const metadata = { title: "Sevrii · Costos de IA", robots: { index: false } };
export const dynamic = "force-dynamic";

const NAMES: Record<string, string> = {
  brain_chat: "Mensaje en el Cerebro",
  brain_research: "Investigación del Cerebro (hasta la propuesta)",
  brain_ideas: "Ronda de ideas del Cerebro",
  store_chat: "Mensaje en Store / Agente",
  marketing_chat: "Mensaje en Marketing",
  marketing_agent: "Agente de Marketing (anuncios, publicaciones, revisiones)",
  video: "Video creado",
  visitor_chat: "Mensaje de un cliente en la página",
  service_agent: "Mensaje a un agente de IA del dueño",
  publish: "Publicar una página",
  other: "Otros",
};

// Provisional limits under review (they are NOT the ones in lib/plans.ts).
const DRAFT_CAPS = [
  { plan: "Gratis", price: 0, research: 2, messages: 150, videos: 0 },
  { plan: "Starter", price: 29, research: 10, messages: 500, videos: 4 },
  { plan: "Pro", price: 79, research: 50, messages: 2000, videos: 15 },
];

type Line = { feature: string; units: number; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; searches: number; usd: number; models: string[] };

function summarize(rows: AiFeatureRow[]): Line[] {
  const by = new Map<string, Line>();
  for (const r of rows) {
    const l = by.get(r.feature) ?? { feature: r.feature, units: 0, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0, usd: 0, models: [] };
    l.units += r.units;
    l.calls += r.calls;
    l.input += r.input;
    l.output += r.output;
    l.cacheRead += r.cacheRead;
    l.cacheWrite += r.cacheWrite;
    l.searches += r.searches;
    l.usd += r.micros / 1_000_000;
    if (r.model) l.models.push(r.model);
    by.set(r.feature, l);
  }
  return [...by.values()].sort((a, b) => b.usd - a.usd);
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

export default async function CostsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user || !isStaffAdmin(user)) notFound();
  const days = Math.min(90, Math.max(1, Number((await searchParams).dias) || 30));
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const lines = summarize(await aiFeatureReport(since));
  const per = (f: string) => {
    const l = lines.find((x) => x.feature === f);
    return l && l.units > 0 ? l.usd / l.units : null;
  };
  const msg = Math.max(per("brain_chat") ?? 0, per("store_chat") ?? 0, per("marketing_chat") ?? 0);
  const research = per("brain_research");
  const video = per("video");
  const total = lines.reduce((s, l) => s + l.usd, 0);

  return (
    <main className="max-w-[980px] mx-auto px-4 md:px-8 py-10 text-[#0A0A0A]">
      <h1 className="text-[28px] font-semibold">Costos de IA por función</h1>
      <p className="mt-2 text-[14px] text-[#52525B]">
        Últimos {days} días (desde {since}, UTC). Medido en cada llamada a la IA desde que existe este medidor. Total: {usd(total)}. Cambia el rango con ?dias=7, 30 o 90.
      </p>

      <table className="mt-6 w-full text-[13.5px] border-collapse">
        <thead>
          <tr className="text-left border-b border-[#E4E4E7]">
            <th className="py-2 pr-3">Función</th>
            <th className="py-2 pr-3 text-right">Unidades</th>
            <th className="py-2 pr-3 text-right">Llamadas</th>
            <th className="py-2 pr-3 text-right">Tokens entrada / salida por unidad</th>
            <th className="py-2 pr-3 text-right">Búsquedas</th>
            <th className="py-2 pr-3 text-right">Total</th>
            <th className="py-2 text-right">Por unidad</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.feature} className="border-b border-[#F4F4F5] align-top">
              <td className="py-2 pr-3">
                {NAMES[l.feature] ?? l.feature}
                <div className="text-[11.5px] text-[#71717A]">{l.models.join(", ")}</div>
              </td>
              <td className="py-2 pr-3 text-right">{l.units}</td>
              <td className="py-2 pr-3 text-right">{l.calls}</td>
              <td className="py-2 pr-3 text-right">
                {l.units ? `${k((l.input + l.cacheRead + l.cacheWrite) / l.units)} / ${k(l.output / l.units)}` : "—"}
              </td>
              <td className="py-2 pr-3 text-right">{l.searches}</td>
              <td className="py-2 pr-3 text-right">{usd(l.usd)}</td>
              <td className="py-2 text-right font-medium">{l.units ? usd(l.usd / l.units) : "—"}</td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={7} className="py-6 text-[#71717A]">Todavía no hay datos medidos en este rango.</td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="mt-10 text-[20px] font-semibold">Cuenta por plan, con los topes provisionales</h2>
      <p className="mt-1 text-[13.5px] text-[#52525B]">
        Peor caso: un usuario que usa TODO su tope en el mes. Mensaje = el más caro de Cerebro, Store y Marketing ({msg ? usd(msg) : "sin datos"}). Investigación = {research !== null ? usd(research) : "sin datos"}. Video = {video !== null ? usd(video) : "sin datos"} (solo la IA; sin el navegador en la nube ni la herramienta de video). Pagos al 5% no entran aquí.
      </p>
      <table className="mt-4 w-full text-[13.5px] border-collapse">
        <thead>
          <tr className="text-left border-b border-[#E4E4E7]">
            <th className="py-2 pr-3">Plan</th>
            <th className="py-2 pr-3 text-right">Precio</th>
            <th className="py-2 pr-3 text-right">IA al tope</th>
            <th className="py-2 text-right">Margen</th>
          </tr>
        </thead>
        <tbody>
          {DRAFT_CAPS.map((c) => {
            const cost = c.research * (research ?? 0) + c.messages * msg + c.videos * (video ?? 0);
            return (
              <tr key={c.plan} className="border-b border-[#F4F4F5]">
                <td className="py-2 pr-3">
                  {c.plan} <span className="text-[#71717A]">({c.research} investigaciones, {c.messages} mensajes, {c.videos} videos)</span>
                </td>
                <td className="py-2 pr-3 text-right">${c.price}</td>
                <td className="py-2 pr-3 text-right">{usd(cost)}</td>
                <td className="py-2 text-right font-medium" style={{ color: c.price - cost >= 0 ? "#047857" : "#B91C1C" }}>{usd(c.price - cost)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}

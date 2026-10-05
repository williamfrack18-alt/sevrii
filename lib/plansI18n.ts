import type { PlanId } from "./plans";

type Cell = boolean | string;
type Row = { label: string; values: Record<PlanId, Cell> };
type Group = { title: string; rows: Row[] };

const es = {
  nav: "Planes",
  title: "Escoge tu plan",
  sub: "Empiezas gratis. Cuando quieras dar el siguiente paso, escoges el plan que lo incluye. Cada plan trae todo lo del anterior.",
  monthly: "Mensual",
  yearly: "Anual",
  yearlySave: "ahorra 17 %",
  perMonth: "/mes",
  billedYearly: (total: number) => `$${total} al año`,
  free: "Gratis",
  current: "Tu plan actual",
  choose: (name: string) => `Elegir ${name}`,
  manage: "Administrar suscripción",
  soon: "Próximamente",
  notify: "Avísame cuando esté listo",
  notified: "Te avisaremos",
  notReady: "Los pagos se están configurando. Vuelve en un rato.",
  failed: "No pudimos abrir el pago. Inténtalo de nuevo.",
  already: "Ya tienes un plan activo.",
  admin: "Cuenta de administrador: todo desbloqueado para pruebas.",
  success: "¡Gracias! Tu plan se activa en unos segundos. Si no lo ves, recarga la página.",
  cancel: "No se hizo ningún cobro. Puedes elegir tu plan cuando quieras.",
  needProjects: (n: number) => `Tu plan permite ${n === 1 ? "1 proyecto" : `${n} proyectos`}. Para crear más, necesitas un plan mayor.`,
  needPublish: "Para publicar tu página necesitas el plan Starter.",
  pastDue: "No pudimos cobrar tu último pago. Actualiza tu tarjeta para no perder tu plan.",
  renews: (d: string) => `Se renueva el ${d}`,
  ends: (d: string) => `Termina el ${d}`,
  adsNote: "La plata de los anuncios la pagas directo a Meta o Google; nunca pasa por Sevrii.",
  capitalNote: "Capital: la oferta de financiamiento la hace Stripe según lo que cobras, en cualquier plan.",
  plans: {
    free: { name: "Gratis", tagline: "Para probar", summary: "Conoce tu estrategia y ve tu página lista, sin pagar." },
    starter: { name: "Starter", tagline: "Para empezar a vender", summary: "Sevrii te prepara todo: publicas tu página y lanzas tus campañas con la guía." },
    pro: { name: "Pro", tagline: "Para crecer", summary: "Sevrii lo hace por ti: el agente lanza y cuida tus anuncios, y cobras con Stripe." },
    team: { name: "Equipo", tagline: "Para negocios con equipo", summary: "Varios servicios y varias personas trabajando en Sevrii." },
  } as Record<PlanId, { name: string; tagline: string; summary: string }>,
  highlights: {
    free: ["Cerebro completo: entrevista, investigación de tu zona y propuesta", "Tu página de venta armada, en borrador", "1 proyecto"],
    starter: ["Todo lo de Gratis", "Tu página publicada en sevrii.com", "Estrategia y campañas listas, con guía para lanzarlas tú", "Conteo de visitas, llamadas y mensajes", "1 proyecto"],
    pro: ["Todo lo de Starter", "El agente publica tus campañas en Meta y Google, con tu aprobación", "Revisión semanal y resumen de resultados", "Cobra a tus clientes con Stripe (Payments)", "Hasta 3 proyectos"],
    team: ["Todo lo de Pro", "Hasta 10 proyectos", "Varios usuarios", "Reportes de todos tus proyectos", "Soporte prioritario"],
  } as Record<PlanId, string[]>,
  compareTitle: "Compara los planes",
  groups: [
    {
      title: "Cerebro",
      rows: [
        { label: "Entrevista, investigación de tu zona y propuesta", values: { free: true, starter: true, pro: true, team: true } },
        { label: "Investigaciones completas por día", values: { free: "2", starter: "3", pro: "6", team: "12" } },
      ],
    },
    {
      title: "Store",
      rows: [
        { label: "Página de venta armada por la IA", values: { free: "Borrador", starter: true, pro: true, team: true } },
        { label: "Publicar tu página", values: { free: false, starter: true, pro: true, team: true } },
        { label: "Conteo de visitas, llamadas y mensajes", values: { free: false, starter: true, pro: true, team: true } },
      ],
    },
    {
      title: "Marketing",
      rows: [
        { label: "Estrategia y campañas listas, con guía", values: { free: false, starter: true, pro: true, team: true } },
        { label: "El agente publica las campañas por ti", values: { free: false, starter: false, pro: true, team: true } },
        { label: "Revisión semanal y resumen", values: { free: false, starter: false, pro: true, team: true } },
      ],
    },
    {
      title: "Payments",
      rows: [{ label: "Cobrar a tus clientes con Stripe", values: { free: false, starter: false, pro: true, team: true } }],
    },
    {
      title: "Cuenta",
      rows: [
        { label: "Proyectos (servicios que vendes)", values: { free: "1", starter: "1", pro: "3", team: "10" } },
        { label: "Usuarios", values: { free: "1", starter: "1", pro: "1", team: "Varios" } },
        { label: "Mensajes a la IA por día", values: { free: "60", starter: "200", pro: "400", team: "800" } },
        { label: "Soporte", values: { free: "Correo", starter: "Correo", pro: "Prioritario", team: "Prioritario" } },
      ],
    },
  ] as Group[],
  lock: {
    plan: "Plan",
    upgrade: "Mejorar plan",
    seePlans: "Ver planes",
    publishChip: "Publicar: plan Starter",
    marketingTitle: "Marketing está en el plan Starter",
    marketingSub: "Con Starter, el cerebro de marketing arma tu estrategia y te deja las campañas listas con guía para lanzarlas. Con Pro (próximamente), el agente las publica y las cuida por ti.",
    autoPro: "Publicar automático: plan Pro (próximamente)",
    paymentsPro: "Payments viene incluido en el plan Pro (próximamente).",
    projectsLocked: (n: number) => `Tu plan permite ${n === 1 ? "1 proyecto" : `${n} proyectos`}`,
    projectsLockedSub: "Para vender otro servicio, mejora tu plan.",
  },
};

const en: typeof es = {
  nav: "Plans",
  title: "Choose your plan",
  sub: "You start free. When you want the next step, pick the plan that includes it. Each plan has everything in the one before.",
  monthly: "Monthly",
  yearly: "Yearly",
  yearlySave: "save 17%",
  perMonth: "/mo",
  billedYearly: (total: number) => `$${total} per year`,
  free: "Free",
  current: "Your current plan",
  choose: (name: string) => `Choose ${name}`,
  manage: "Manage subscription",
  soon: "Coming soon",
  notify: "Tell me when it's ready",
  notified: "We'll let you know",
  notReady: "Payments are being set up. Come back in a bit.",
  failed: "We couldn't open checkout. Please try again.",
  already: "You already have an active plan.",
  admin: "Admin account: everything unlocked for testing.",
  success: "Thank you! Your plan turns on in a few seconds. If you don't see it, reload the page.",
  cancel: "You weren't charged. You can choose your plan any time.",
  needProjects: (n: number) => `Your plan allows ${n === 1 ? "1 project" : `${n} projects`}. To create more, you need a bigger plan.`,
  needPublish: "To publish your page you need the Starter plan.",
  pastDue: "We couldn't charge your last payment. Update your card to keep your plan.",
  renews: (d: string) => `Renews on ${d}`,
  ends: (d: string) => `Ends on ${d}`,
  adsNote: "Ad money is paid directly to Meta or Google; it never goes through Sevrii.",
  capitalNote: "Capital: the financing offer comes from Stripe based on what you charge, on any plan.",
  plans: {
    free: { name: "Free", tagline: "To try it", summary: "Get your strategy and see your page ready, without paying." },
    starter: { name: "Starter", tagline: "To start selling", summary: "Sevrii prepares everything: you publish your page and launch your campaigns with the guide." },
    pro: { name: "Pro", tagline: "To grow", summary: "Sevrii does it for you: the agent launches and manages your ads, and you charge with Stripe." },
    team: { name: "Team", tagline: "For businesses with a team", summary: "Several services and several people working in Sevrii." },
  },
  highlights: {
    free: ["Full Brain: interview, local research and proposal", "Your sales page built, as a draft", "1 project"],
    starter: ["Everything in Free", "Your page published on sevrii.com", "Strategy and ready campaigns, with a guide to launch them", "Visits, calls and messages count", "1 project"],
    pro: ["Everything in Starter", "The agent publishes your campaigns on Meta and Google, with your approval", "Weekly review and results summary", "Charge your customers with Stripe (Payments)", "Up to 3 projects"],
    team: ["Everything in Pro", "Up to 10 projects", "Multiple users", "Reports across projects", "Priority support"],
  },
  compareTitle: "Compare plans",
  groups: [
    {
      title: "Brain",
      rows: [
        { label: "Interview, local research and proposal", values: { free: true, starter: true, pro: true, team: true } },
        { label: "Full research runs per day", values: { free: "2", starter: "3", pro: "6", team: "12" } },
      ],
    },
    {
      title: "Store",
      rows: [
        { label: "Sales page built by AI", values: { free: "Draft", starter: true, pro: true, team: true } },
        { label: "Publish your page", values: { free: false, starter: true, pro: true, team: true } },
        { label: "Visits, calls and messages count", values: { free: false, starter: true, pro: true, team: true } },
      ],
    },
    {
      title: "Marketing",
      rows: [
        { label: "Strategy and ready campaigns, with a guide", values: { free: false, starter: true, pro: true, team: true } },
        { label: "The agent publishes campaigns for you", values: { free: false, starter: false, pro: true, team: true } },
        { label: "Weekly review and summary", values: { free: false, starter: false, pro: true, team: true } },
      ],
    },
    {
      title: "Payments",
      rows: [{ label: "Charge your customers with Stripe", values: { free: false, starter: false, pro: true, team: true } }],
    },
    {
      title: "Account",
      rows: [
        { label: "Projects (services you sell)", values: { free: "1", starter: "1", pro: "3", team: "10" } },
        { label: "Users", values: { free: "1", starter: "1", pro: "1", team: "Multiple" } },
        { label: "AI messages per day", values: { free: "60", starter: "200", pro: "400", team: "800" } },
        { label: "Support", values: { free: "Email", starter: "Email", pro: "Priority", team: "Priority" } },
      ],
    },
  ],
  lock: {
    plan: "Plan",
    upgrade: "Upgrade plan",
    seePlans: "See plans",
    publishChip: "Publish: Starter plan",
    marketingTitle: "Marketing is in the Starter plan",
    marketingSub: "With Starter, the marketing brain builds your strategy and leaves your campaigns ready with a guide to launch them. With Pro (coming soon), the agent publishes and manages them for you.",
    autoPro: "Auto-publish: Pro plan (coming soon)",
    paymentsPro: "Payments is included in the Pro plan (coming soon).",
    projectsLocked: (n: number) => `Your plan allows ${n === 1 ? "1 project" : `${n} projects`}`,
    projectsLockedSub: "To sell another service, upgrade your plan.",
  },
};

export const PLANS_TEXT = { es, en };

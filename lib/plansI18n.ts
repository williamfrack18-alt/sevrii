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
  billedYearly: (total: number) => `$${total.toLocaleString("en-US")} al año`,
  free: "Gratis",
  current: "Tu plan actual",
  choose: (name: string) => `Elegir ${name}`,
  higherPlan: "Ya tienes un plan superior",
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
  capitalNote: "Capital (próximamente, desde el plan Starter): la oferta de crédito la hará un socio financiero según lo que cobras con Sevrii.",
  plans: {
    free: { name: "Gratis", tagline: "Para probar", summary: "Conoce tu estrategia y ve tu página lista, sin pagar." },
    starter: { name: "Starter", tagline: "Para empezar a vender", summary: "Publicas tu página, cobras con links de pago y otras personas pueden vender tu servicio por una comisión." },
    pro: { name: "Pro", tagline: "Para crecer", summary: "Sevrii hace tu marketing: estrategia, campañas y el agente que lanza y cuida tus anuncios." },
    team: { name: "Equipo", tagline: "Para negocios con equipo", summary: "Varios servicios y varias personas trabajando en Sevrii." },
  } as Record<PlanId, { name: string; tagline: string; summary: string }>,
  highlights: {
    free: ["Cerebro completo: entrevista, investigación de tu zona y propuesta", "Tu página de venta armada, en borrador", "1 proyecto"],
    starter: ["Todo lo de Gratis", "Tu página publicada en sevrii.com", "Payments: cobra a tus clientes con links de pago", "Afiliados: otras personas venden tu servicio y tú les pagas una comisión", "Capital: crédito para tu negocio (próximamente)", "Conteo de visitas, llamadas y mensajes", "1 proyecto"],
    pro: ["Todo lo de Starter", "Marketing: tu estrategia y tus campañas listas", "Agente de marketing: lanza tus campañas en Facebook e Instagram con tu aprobación", "Revisa tus anuncios cada día, pausa lo que gasta sin traer clientes y te prepara publicaciones gratis", "Hasta 3 proyectos"],
    team: ["Todo lo de Pro", "Hasta 10 proyectos", "Varios usuarios", "Reportes de todos tus proyectos", "Soporte prioritario"],
  } as Record<PlanId, string[]>,
  compareTitle: "Compara los planes",
  groups: [
    {
      title: "Cerebro",
      rows: [
        { label: "Entrevista, investigación de tu zona y propuesta", values: { free: true, starter: true, pro: true, team: true } },
        { label: "Investigaciones de mercado por mes", values: { free: "2", starter: "10", pro: "25", team: "60" } },
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
        { label: "Estrategia y campañas listas, con guía", values: { free: false, starter: false, pro: true, team: true } },
        { label: "El agente publica las campañas por ti", values: { free: false, starter: false, pro: true, team: true } },
        { label: "Revisión diaria de tus anuncios", values: { free: false, starter: false, pro: true, team: true } },
      ],
    },
    {
      title: "Payments",
      rows: [
        { label: "Cobrar a tus clientes con links de pago", values: { free: false, starter: true, pro: true, team: true } },
        { label: "Comisión por pago (incluye Stripe)", values: { free: false, starter: "5%", pro: "5%", team: "5%" } },
      ],
    },
    {
      title: "Afiliados",
      rows: [
        { label: "Otras personas venden tu servicio y les pagas una comisión", values: { free: false, starter: true, pro: true, team: true } },
      ],
    },
    {
      title: "Capital",
      rows: [
        { label: "Crédito para tu negocio según lo que cobras", values: { free: false, starter: "Próximamente", pro: "Próximamente", team: "Próximamente" } },
      ],
    },
    {
      title: "Cuenta",
      rows: [
        { label: "Proyectos (servicios que vendes)", values: { free: "1", starter: "1", pro: "3", team: "10" } },
        { label: "Usuarios", values: { free: "1", starter: "1", pro: "1", team: "Varios" } },
        { label: "Mensajes a la IA por mes", values: { free: "150", starter: "800", pro: "2.000", team: "5.000" } },
        { label: "Soporte", values: { free: "Correo", starter: "Correo", pro: "Prioritario", team: "Prioritario" } },
      ],
    },
  ] as Group[],
  lock: {
    plan: "Plan",
    upgrade: "Mejorar plan",
    seePlans: "Ver planes",
    publishChip: "Publicar: plan Starter",
    marketingTitle: "Marketing está en el plan Pro (próximamente)",
    marketingSub: "Con Pro, Sevrii arma tu estrategia de marketing, te deja las campañas listas y el agente las publica y las cuida por ti. Está por salir: en Planes puedes pedir que te avisemos.",
    autoPro: "Publicar automático: plan Pro (próximamente)",
    paymentsPro: "Payments viene desde el plan Starter: 5% por pago, todo incluido.",
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
  billedYearly: (total: number) => `$${total.toLocaleString("en-US")} per year`,
  free: "Free",
  current: "Your current plan",
  choose: (name: string) => `Choose ${name}`,
  higherPlan: "You already have a higher plan",
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
  capitalNote: "Capital (coming soon, from the Starter plan): the credit offer will come from a financial partner based on what you charge with Sevrii.",
  plans: {
    free: { name: "Free", tagline: "To try it", summary: "Get your strategy and see your page ready, without paying." },
    starter: { name: "Starter", tagline: "To start selling", summary: "You publish your page, charge with payment links, and other people can sell your service for a commission." },
    pro: { name: "Pro", tagline: "To grow", summary: "Sevrii does your marketing: strategy, campaigns and the agent that launches and manages your ads." },
    team: { name: "Team", tagline: "For businesses with a team", summary: "Several services and several people working in Sevrii." },
  },
  highlights: {
    free: ["Full Brain: interview, local research and proposal", "Your sales page built, as a draft", "1 project"],
    starter: ["Everything in Free", "Your page published on sevrii.com", "Payments: charge your clients with payment links", "Affiliates: other people sell your service and you pay them a commission", "Capital: credit for your business (coming soon)", "Visits, calls and messages count", "1 project"],
    pro: ["Everything in Starter", "Marketing: your strategy and campaigns ready", "Marketing agent: launches your campaigns on Facebook and Instagram with your approval", "Checks your ads every day, pauses what spends without bringing clients and prepares free posts", "Up to 3 projects"],
    team: ["Everything in Pro", "Up to 10 projects", "Multiple users", "Reports across projects", "Priority support"],
  },
  compareTitle: "Compare plans",
  groups: [
    {
      title: "Brain",
      rows: [
        { label: "Interview, local research and proposal", values: { free: true, starter: true, pro: true, team: true } },
        { label: "Market research runs per month", values: { free: "2", starter: "10", pro: "25", team: "60" } },
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
        { label: "Strategy and ready campaigns, with a guide", values: { free: false, starter: false, pro: true, team: true } },
        { label: "The agent publishes campaigns for you", values: { free: false, starter: false, pro: true, team: true } },
        { label: "Daily review of your ads", values: { free: false, starter: false, pro: true, team: true } },
      ],
    },
    {
      title: "Payments",
      rows: [
        { label: "Charge your clients with payment links", values: { free: false, starter: true, pro: true, team: true } },
        { label: "Fee per payment (Stripe included)", values: { free: false, starter: "5%", pro: "5%", team: "5%" } },
      ],
    },
    {
      title: "Affiliates",
      rows: [
        { label: "Other people sell your service and you pay them a commission", values: { free: false, starter: true, pro: true, team: true } },
      ],
    },
    {
      title: "Capital",
      rows: [
        { label: "Credit for your business based on what you charge", values: { free: false, starter: "Coming soon", pro: "Coming soon", team: "Coming soon" } },
      ],
    },
    {
      title: "Account",
      rows: [
        { label: "Projects (services you sell)", values: { free: "1", starter: "1", pro: "3", team: "10" } },
        { label: "Users", values: { free: "1", starter: "1", pro: "1", team: "Multiple" } },
        { label: "AI messages per month", values: { free: "150", starter: "800", pro: "2,000", team: "5,000" } },
        { label: "Support", values: { free: "Email", starter: "Email", pro: "Priority", team: "Priority" } },
      ],
    },
  ],
  lock: {
    plan: "Plan",
    upgrade: "Upgrade plan",
    seePlans: "See plans",
    publishChip: "Publish: Starter plan",
    marketingTitle: "Marketing is in the Pro plan (coming soon)",
    marketingSub: "With Pro, Sevrii builds your marketing strategy, leaves your campaigns ready, and the agent publishes and manages them for you. It's almost out: in Plans you can ask us to let you know.",
    autoPro: "Auto-publish: Pro plan (coming soon)",
    paymentsPro: "Payments comes with the Starter plan: 5% per payment, all included.",
    projectsLocked: (n: number) => `Your plan allows ${n === 1 ? "1 project" : `${n} projects`}`,
    projectsLockedSub: "To sell another service, upgrade your plan.",
  },
};

export const PLANS_TEXT = { es, en };

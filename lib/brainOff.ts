// The Brain (Cerebro) is switched off for now: new projects go straight to
// Store, whose chat asks what they sell and builds the page, and Store and
// Marketing open without an approved strategy. Nothing is deleted: projects
// keep their strategy, and setting this to false brings everything back.
export const BRAIN_OFF = true;

// /start while the Brain is off: the texts that promised its research.
export const START_TEXT_NO_BRAIN = {
  es: {
    newText: "Todavía no tengo mi servicio o quiero independizarme. Cuéntame qué quieres ofrecer y armamos tu página.",
    newProjectNewText: "Quiero empezar a ofrecer algo que todavía no hago. Cuéntame qué es y armamos su página.",
    newProjectExistingText: "Ya lo hago y quiero conseguir más clientes: su propia página y sus cobros.",
    jobText: "Quiero trabajar como empleado. Armamos tu página para presentarte a quienes contratan.",
    note: "Después armas tu página en Store, en un chat solo para este proyecto: le cuentas qué ofreces y cuánto cobras, y la arma contigo.",
    steps: ["Tu cuenta", "Qué vas a crear", "Armas tu página en Store", "Tus clientes y tus cobros"],
  },
  en: {
    newText: "I don't have my service yet, or I want to go independent. Tell us what you want to offer and we'll build your page.",
    newProjectNewText: "I want to start offering something new. Tell us what it is and we'll build its page.",
    newProjectExistingText: "I already do it and want more clients: its own page and payments.",
    jobText: "I want to work as an employee. We'll build your page to present you to employers.",
    note: "Next you build your page in Store, in a chat just for this project: tell it what you offer and what you charge, and it builds it with you.",
    steps: ["Your account", "What you'll create", "You build your page in Store", "Your customers and payments"],
  },
};

import type { BusinessRow } from "@/lib/db";
import { agentMissing, hasTask, offerPriceLabel, welcomeLabel } from "@/lib/serviceAgentConfig";
import type { ChatAgent } from "./ChatWidget";

// What the chat needs to be the owner's service agent (null when it's off).
export function chatAgentFor(business: BusinessRow): ChatAgent | null {
  const sa = business.serviceAgent;
  const site = business.site;
  if (!(sa.enabled && agentMissing(sa).length === 0)) return null;
  return {
    name: sa.name,
    greeting: sa.greeting.replace(/\[(tu nombre|your name|nombre)\]/gi, site.ownerName || business.name),
    offers:
      business.payStatus === "ready" && business.stripeAccountId
        ? sa.offers.map((o) => ({ id: o.id, title: o.title, detail: o.detail, label: offerPriceLabel(o, site.lang), welcome: welcomeLabel(sa, o, site.lang) }))
        : [],
    does: hasTask(sa) ? sa.task.goal : "",
  };
}

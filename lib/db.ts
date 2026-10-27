import { neon } from "@neondatabase/serverless";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ownsBlob, parseSite, type SiteData } from "./site";
import { parseMarketing, parseCampaignSpec, type MarketingData, type CampaignSpec } from "./marketing";
import { parsePlan, type BusinessPlan } from "./plan";
import { parseServiceAgent, type ServiceAgent } from "./serviceAgentConfig";
import { parseAffiliate, type AffiliateSettings } from "./affiliateConfig";

// The Neon Vercel integration injects several connection-string env vars;
// POSTGRES_URL / DATABASE_URL are the pooled connection, which is what a
// serverless function should use.
const connectionString =
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) {
  throw new Error(
    "No Postgres connection string found (DATABASE_URL / POSTGRES_URL). Is the Neon database connected to this project?"
  );
}
const sql = neon(connectionString);

export function newId(): string {
  return randomUUID();
}
export function nowISO(): string {
  return new Date().toISOString();
}

// Postgres (Neon, via Vercel's Storage integration) replaces the old
// node:sqlite-based storage, which wrote to a local file and could not work
// on Vercel's read-only serverless filesystem. Column names are quoted
// wherever they use camelCase so they round-trip exactly like the old
// SQLite schema did (Postgres folds unquoted identifiers to lowercase).
//
// The setup below runs once per schema version, not on every cold start: a
// fingerprint of the setup code is stored in sevrii_meta, and a new server
// only re-runs it when the code changed (a deploy with new tables/columns).
let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const version = createHash("sha1").update(migrate.toString()).digest("hex").slice(0, 16);
      try {
        const rows = (await sql`SELECT value FROM sevrii_meta WHERE key = 'schema'`) as { value: string }[];
        if (rows[0]?.value === version) return;
      } catch {
        // First run: the table doesn't exist yet.
      }
      await migrate();
      await sql`CREATE TABLE IF NOT EXISTS sevrii_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
      await sql`INSERT INTO sevrii_meta (key, value) VALUES ('schema', ${version}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    })().catch((err) => {
      // Don't cache a failed setup forever — let the next request retry.
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function migrate(): Promise<void> {
  {
    {
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          "passwordHash" TEXT NOT NULL,
          salt TEXT NOT NULL,
          "createdAt" TEXT NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS businesses (
          id TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL REFERENCES users(id),
          slug TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          description TEXT NOT NULL,
          city TEXT,
          pitch TEXT NOT NULL,
          whatsapp TEXT,
          "accentColor" TEXT NOT NULL DEFAULT '#122118',
          published INTEGER NOT NULL DEFAULT 1,
          "pageViews" INTEGER NOT NULL DEFAULT 0,
          "whatsappClicks" INTEGER NOT NULL DEFAULT 0,
          "createdAt" TEXT NOT NULL
        )
      `;
      // Businesses created before these two counters existed need them added
      // in place — CREATE TABLE IF NOT EXISTS above is a no-op for a table
      // that already exists.
      await sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS "pageViews" INTEGER NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS "whatsappClicks" INTEGER NOT NULL DEFAULT 0`;
      await sql`
        CREATE TABLE IF NOT EXISTS services (
          id TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL REFERENCES businesses(id),
          name TEXT NOT NULL,
          price TEXT,
          description TEXT,
          "sortOrder" INTEGER NOT NULL DEFAULT 0
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS reviews (
          id TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL REFERENCES businesses(id),
          author TEXT NOT NULL,
          rating INTEGER NOT NULL,
          text TEXT NOT NULL,
          "createdAt" TEXT NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS campaigns (
          id TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL REFERENCES businesses(id),
          title TEXT NOT NULL,
          goal TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          "adCopy" TEXT,
          "budgetNote" TEXT,
          audience TEXT,
          platforms TEXT,
          variations TEXT,
          "createdAt" TEXT NOT NULL
        )
      `;
      // Campaigns created before the richer marketing-agent fields existed
      // need them added in place — CREATE TABLE IF NOT EXISTS above is a
      // no-op for a table that already exists.
      await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS audience TEXT`;
      await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS platforms TEXT`;
      await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS variations TEXT`;
      await sql`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL REFERENCES businesses(id),
          channel TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          "createdAt" TEXT NOT NULL
        )
      `;
      // Server-side sessions: the cookie holds a random token, the database
      // holds only its SHA-256. Logging out deletes the row, so a stolen
      // cookie stops working, and nothing depends on a signing secret.
      await sql`
        CREATE TABLE IF NOT EXISTS sessions (
          "tokenHash" TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL REFERENCES users(id),
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "expiresAt" TIMESTAMPTZ NOT NULL
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions ("userId")`;
      // Fixed-window counters for login/signup attempts and AI usage.
      await sql`
        CREATE TABLE IF NOT EXISTS rate_counters (
          key TEXT PRIMARY KEY,
          count INTEGER NOT NULL DEFAULT 0,
          "windowEndsAt" TIMESTAMPTZ NOT NULL
        )
      `;
      // Store v2: everything the public page shows beyond the basic row.
      await sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS site JSONB NOT NULL DEFAULT '{}'::jsonb`;
      await sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS "callClicks" INTEGER NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS "textClicks" INTEGER NOT NULL DEFAULT 0`;
      await sql`
        CREATE TABLE IF NOT EXISTS page_reports (
          id TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL REFERENCES businesses(id),
          reason TEXT NOT NULL,
          details TEXT,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS marketing JSONB NOT NULL DEFAULT '{}'::jsonb`;
      await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS spec JSONB`;
      await sql`ALTER TABLE services ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false`;
      await sql`ALTER TABLE services ADD COLUMN IF NOT EXISTS tag TEXT`;
      await sql`CREATE INDEX IF NOT EXISTS services_business_idx ON services ("businessId")`;
      await sql`CREATE INDEX IF NOT EXISTS campaigns_business_idx ON campaigns ("businessId")`;
      await sql`CREATE INDEX IF NOT EXISTS chat_messages_business_idx ON chat_messages ("businessId", channel)`;
      // Projects: one account can have several businesses (one per service it
      // sells). Older databases have a UNIQUE constraint on "userId"; drop it.
      await sql`
        DO $$
        DECLARE c text;
        BEGIN
          FOR c IN
            SELECT con.conname FROM pg_constraint con
            JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
            WHERE con.conrelid = 'businesses'::regclass AND con.contype = 'u'
              AND a.attname = 'userId' AND array_length(con.conkey, 1) = 1
          LOOP
            EXECUTE format('ALTER TABLE businesses DROP CONSTRAINT %I', c);
          END LOOP;
        END $$
      `;
      await sql`CREATE INDEX IF NOT EXISTS businesses_user_idx ON businesses ("userId")`;
      await sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS plan JSONB NOT NULL DEFAULT '{}'::jsonb`;
      // AI spend per account per month (micro-dollars), to stop runaway costs.
      await sql`
        CREATE TABLE IF NOT EXISTS ai_usage (
          "userId" TEXT NOT NULL,
          month TEXT NOT NULL,
          "costMicros" BIGINT NOT NULL DEFAULT 0,
          calls INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY ("userId", month)
        )
      `;
      // Marketplace category, set automatically when the page is published.
      await sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS "marketCategory" TEXT`;
      // Brain research runs: one row per task, so the screen can show progress.
      await sql`
        CREATE TABLE IF NOT EXISTS research_jobs (
          id TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL REFERENCES businesses(id),
          "runId" TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          result JSONB,
          error TEXT,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS research_jobs_business_idx ON research_jobs ("businessId", "createdAt")`;
      // Plans and billing (Stripe). The plan belongs to the account, not to a project.
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS "planStatus" TEXT NOT NULL DEFAULT 'none'`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS "planRenewsAt" TIMESTAMPTZ`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS "googleSub" TEXT`;
      // Set once the person proved they own the email (Google sign-in or a reset link).
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMPTZ`;
      await sql`CREATE INDEX IF NOT EXISTS users_stripe_customer_idx ON users ("stripeCustomerId")`;
      await sql`
        CREATE TABLE IF NOT EXISTS plan_waitlist (
          "userId" TEXT NOT NULL REFERENCES users(id),
          plan TEXT NOT NULL,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY ("userId", plan)
        )
      `;
      // Payments: each project (business) can connect its own Stripe account
      // to charge its clients. Status: none | pending | review | ready.
      await sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS "stripeAccountId" TEXT`;
      await sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS "payStatus" TEXT NOT NULL DEFAULT 'none'`;
      await sql`
        CREATE TABLE IF NOT EXISTS payment_links (
          id TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL REFERENCES businesses(id),
          title TEXT NOT NULL,
          "amountCents" INTEGER NOT NULL,
          description TEXT,
          active BOOLEAN NOT NULL DEFAULT true,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS payment_links_business_idx ON payment_links ("businessId", "createdAt")`;
      // Password reset links: only the SHA-256 of the token is stored.
      await sql`
        CREATE TABLE IF NOT EXISTS password_resets (
          "tokenHash" TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL REFERENCES users(id),
          "expiresAt" TIMESTAMPTZ NOT NULL,
          "usedAt" TIMESTAMPTZ
        )
      `;
      // One "you got paid" email per Stripe Checkout session, never two.
      await sql`
        CREATE TABLE IF NOT EXISTS payment_notices (
          "sessionId" TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Quote requests sent from the public page's form.
      await sql`
        CREATE TABLE IF NOT EXISTS leads (
          id TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL,
          name TEXT NOT NULL,
          phone TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          service TEXT NOT NULL DEFAULT '',
          message TEXT NOT NULL DEFAULT '',
          "contactPref" TEXT NOT NULL DEFAULT '',
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS leads_business_idx ON leads ("businessId", "createdAt" DESC)`;
      // Chat on the public page: a visitor talks with the business (AI first, owner any time).
      await sql`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL,
          "tokenHash" TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
          handoff BOOLEAN NOT NULL DEFAULT false,
          "ownerUnread" INTEGER NOT NULL DEFAULT 0,
          "aiReplies" INTEGER NOT NULL DEFAULT 0,
          "lastMessage" TEXT NOT NULL DEFAULT '',
          "lastMessageAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "visitorSeenAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "notifiedAt" TIMESTAMPTZ,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS conversations_business_idx ON conversations ("businessId", "lastMessageAt" DESC)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS conversations_token_idx ON conversations ("tokenHash")`;
      await sql`
        CREATE TABLE IF NOT EXISTS conv_messages (
          seq BIGSERIAL PRIMARY KEY,
          "conversationId" TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS conv_messages_conv_idx ON conv_messages ("conversationId", seq)`;
      // Phones/computers where the owner turned on push notifications.
      await sql`
        CREATE TABLE IF NOT EXISTS push_subs (
          endpoint TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS push_subs_user_idx ON push_subs ("userId")`;
      // Lookups that used to scan whole tables.
      await sql`CREATE INDEX IF NOT EXISTS research_jobs_run_idx ON research_jobs ("runId", kind)`;
      await sql`CREATE INDEX IF NOT EXISTS users_google_sub_idx ON users ("googleSub")`;
      await sql`CREATE INDEX IF NOT EXISTS businesses_stripe_account_idx ON businesses ("stripeAccountId")`;
      await sql`CREATE INDEX IF NOT EXISTS chat_messages_channel_time_idx ON chat_messages ("businessId", channel, "createdAt")`;
      await sql`CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets ("userId")`;
      // Marketing results: what each campaign's link brought (page visits, chats, contacts).
      await sql`
        CREATE TABLE IF NOT EXISTS campaign_events (
          id BIGSERIAL PRIMARY KEY,
          "campaignId" TEXT NOT NULL,
          "businessId" TEXT NOT NULL,
          kind TEXT NOT NULL,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS campaign_events_biz_idx ON campaign_events ("businessId", "createdAt")`;
      await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS "campaignId" TEXT`;
      await sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS "weeklySentAt" TIMESTAMPTZ`;
      // Campaigns launched on Meta by the marketing agent (ids, status, latest numbers).
      await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS meta JSONB`;
      // The marketing agent: what it proposes (waiting for the owner's OK) and what it did.
      await sql`
        CREATE TABLE IF NOT EXISTS agent_items (
          id TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          "campaignId" TEXT,
          payload JSONB,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "resolvedAt" TIMESTAMPTZ
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS agent_items_biz_idx ON agent_items ("businessId", "createdAt")`;
      // Free posts the agent prepares for Facebook, Instagram and Google Business.
      await sql`
        CREATE TABLE IF NOT EXISTS marketing_posts (
          id TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL,
          channel TEXT NOT NULL,
          day TEXT NOT NULL,
          text TEXT NOT NULL,
          photo INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'ready',
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS marketing_posts_biz_idx ON marketing_posts ("businessId", day)`;
      await sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS "agentRanAt" TIMESTAMPTZ`;
      // The owner's Facebook connection (token stored encrypted).
      await sql`
        CREATE TABLE IF NOT EXISTS meta_connections (
          "businessId" TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL,
          "tokenEnc" TEXT NOT NULL,
          "expiresAt" TIMESTAMPTZ,
          "fbUserName" TEXT NOT NULL DEFAULT '',
          "adAccountId" TEXT NOT NULL DEFAULT '',
          "adAccountName" TEXT NOT NULL DEFAULT '',
          "pageId" TEXT NOT NULL DEFAULT '',
          "pageName" TEXT NOT NULL DEFAULT '',
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Service agents: the AI that delivers the owner's service in the page
      // chat, and what customers paid for to use it.
      await sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS "serviceAgent" JSONB NOT NULL DEFAULT '{}'::jsonb`;
      await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS "agentFree" INTEGER NOT NULL DEFAULT 0`;
      await sql`
        CREATE TABLE IF NOT EXISTS agent_access (
          id TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL,
          "conversationId" TEXT NOT NULL,
          "sessionId" TEXT NOT NULL UNIQUE,
          "subscriptionId" TEXT,
          "offerId" TEXT NOT NULL,
          title TEXT NOT NULL,
          billing TEXT NOT NULL,
          "amountCents" INTEGER NOT NULL,
          "replyLimit" INTEGER NOT NULL,
          "repliesUsed" INTEGER NOT NULL DEFAULT 0,
          email TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          "endsAt" TIMESTAMPTZ NOT NULL,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS agent_access_conv_idx ON agent_access ("conversationId", "endsAt")`;
      await sql`CREATE INDEX IF NOT EXISTS agent_access_biz_idx ON agent_access ("businessId", "createdAt")`;
      // Affiliates: owners open a service to people who promote it for a
      // commission on payments made through Sevrii.
      await sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS affiliate JSONB NOT NULL DEFAULT '{}'::jsonb`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS "affCode" TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS "affAccountId" TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS "affPayStatus" TEXT NOT NULL DEFAULT 'none'`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_aff_code_idx ON users ("affCode") WHERE "affCode" IS NOT NULL`;
      await sql`
        CREATE TABLE IF NOT EXISTS affiliate_sales (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL UNIQUE,
          "businessId" TEXT NOT NULL,
          "affiliateUserId" TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          "amountCents" INTEGER NOT NULL,
          "commissionCents" INTEGER NOT NULL,
          "paymentIntentId" TEXT,
          "subscriptionId" TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          "transferId" TEXT,
          "payableAt" TIMESTAMPTZ NOT NULL,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS affiliate_sales_aff_idx ON affiliate_sales ("affiliateUserId", "createdAt")`;
      await sql`CREATE INDEX IF NOT EXISTS affiliate_sales_biz_idx ON affiliate_sales ("businessId", "createdAt")`;
      await sql`CREATE INDEX IF NOT EXISTS affiliate_sales_due_idx ON affiliate_sales (status, "payableAt")`;
      await sql`
        CREATE TABLE IF NOT EXISTS affiliate_visits (
          "businessId" TEXT NOT NULL,
          "affiliateUserId" TEXT NOT NULL,
          day TEXT NOT NULL,
          n INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY ("businessId", "affiliateUserId", day)
        )
      `;
      // Reviews of service agents: only customers who paid for access, one per
      // conversation (they can edit it).
      await sql`
        CREATE TABLE IF NOT EXISTS agent_reviews (
          id TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL,
          "conversationId" TEXT NOT NULL UNIQUE,
          rating INTEGER NOT NULL,
          text TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL DEFAULT '',
          hidden BOOLEAN NOT NULL DEFAULT false,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS agent_reviews_biz_idx ON agent_reviews ("businessId", "createdAt")`;
      // The owner's language: the whole dashboard, the chats and what the
      // marketing agent writes them follow it (not the landing they browsed).
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS lang TEXT`;
      // A service agent's cases: the task it carries out for one customer, with
      // its file (steps, documents, status, verified result) in the chat.
      await sql`
        CREATE TABLE IF NOT EXISTS agent_cases (
          id TEXT PRIMARY KEY,
          "businessId" TEXT NOT NULL,
          "conversationId" TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'working',
          mode TEXT NOT NULL DEFAULT 'test',
          title TEXT NOT NULL DEFAULT '',
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          steps JSONB NOT NULL DEFAULT '[]'::jsonb,
          docs JSONB NOT NULL DEFAULT '[]'::jsonb,
          result JSONB,
          waiting JSONB,
          browser JSONB NOT NULL DEFAULT '{}'::jsonb,
          reminders JSONB NOT NULL DEFAULT '[]'::jsonb,
          memo JSONB NOT NULL DEFAULT '[]'::jsonb,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS agent_cases_conv_idx ON agent_cases ("conversationId", "createdAt" DESC)`;
      // Old strategist messages sent owners to an approve button "in the card
      // here in the chat"; it's in the strategy panel next to the chat.
      await sql`UPDATE chat_messages SET content = regexp_replace(regexp_replace(content, 'en tu tarjeta de estrategia,? (justo )?aqu[ií] en el chat', 'al final del panel «Tu estrategia de marketing», junto al chat', 'gi'), 'in your strategy card,? (right )?here in the chat', 'at the bottom of the "Your marketing strategy" panel next to the chat', 'gi') WHERE channel = 'brain' AND (content ~* 'tarjeta de estrategia,? (justo )?aqu[ií] en el chat' OR content ~* 'strategy card,? (right )?here in the chat')`;
    }
  }
}

// ---------- Sessions ----------
export async function createSessionRow(tokenHash: string, userId: string, maxAgeSeconds: number): Promise<void> {
  await ensureSchema();
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000).toISOString();
  await sql`INSERT INTO sessions ("tokenHash", "userId", "expiresAt") VALUES (${tokenHash}, ${userId}, ${expiresAt})`;
}

export async function getSessionUserId(tokenHash: string): Promise<string | null> {
  await ensureSchema();
  const rows = (await sql`
    SELECT "userId" FROM sessions WHERE "tokenHash" = ${tokenHash} AND "expiresAt" > now()
  `) as { userId: string }[];
  return rows[0]?.userId ?? null;
}

// The signed-in owner's saved language, straight from the session (one query).
export async function getSessionLang(tokenHash: string): Promise<string | null> {
  await ensureSchema();
  const rows = (await sql`
    SELECT u.lang FROM sessions s JOIN users u ON u.id = s."userId"
    WHERE s."tokenHash" = ${tokenHash} AND s."expiresAt" > now()
  `) as { lang: string | null }[];
  return rows[0]?.lang ?? null;
}

export async function setUserLang(userId: string, lang: "es" | "en"): Promise<void> {
  await ensureSchema();
  await sql`UPDATE users SET lang = ${lang} WHERE id = ${userId} AND lang IS DISTINCT FROM ${lang}`;
}

// What the owner reads in Spanish or English (for messages written when
// they're not on the dashboard, like the marketing agent's daily check).
export async function getOwnerLang(userId: string, fallback: "es" | "en"): Promise<"es" | "en"> {
  await ensureSchema();
  const rows = (await sql`SELECT lang FROM users WHERE id = ${userId}`) as { lang: string | null }[];
  const l = rows[0]?.lang;
  return l === "es" || l === "en" ? l : fallback;
}

export async function deleteSessionRow(tokenHash: string): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM sessions WHERE "tokenHash" = ${tokenHash}`;
}

export async function deleteSessionsForUser(userId: string): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM sessions WHERE "userId" = ${userId}`;
}

// ---------- Rate limits ----------
// Atomically bumps a fixed-window counter and returns the new count.
export async function hitRateCounter(key: string, windowSeconds: number): Promise<number> {
  await ensureSchema();
  const windowEndsAt = new Date(Date.now() + windowSeconds * 1000).toISOString();
  const rows = (await sql`
    INSERT INTO rate_counters (key, count, "windowEndsAt") VALUES (${key}, 1, ${windowEndsAt})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_counters."windowEndsAt" <= now() THEN 1 ELSE rate_counters.count + 1 END,
      "windowEndsAt" = CASE WHEN rate_counters."windowEndsAt" <= now() THEN EXCLUDED."windowEndsAt" ELSE rate_counters."windowEndsAt" END
    RETURNING count
  `) as { count: number }[];
  // Now and then, clear what has expired (old counters, sessions and reset
  // links), so these tables don't grow forever.
  if (Math.random() < 0.01) {
    sql`DELETE FROM rate_counters WHERE "windowEndsAt" < now() - interval '1 day'`
      .then(() => sql`DELETE FROM sessions WHERE "expiresAt" < now()`)
      .then(() => sql`DELETE FROM password_resets WHERE "expiresAt" < now() - interval '1 day'`)
      .catch(() => {});
  }
  return rows[0]?.count ?? 1;
}

// Reads a counter without bumping it (0 when its window is over).
export async function peekRateCounter(key: string): Promise<number> {
  await ensureSchema();
  const rows = (await sql`SELECT count FROM rate_counters WHERE key = ${key} AND "windowEndsAt" > now()`) as { count: number }[];
  return rows[0]?.count ?? 0;
}

export async function resetRateCounter(key: string): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM rate_counters WHERE key = ${key}`;
}

// ---------- Users ----------
export type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  plan?: string;
  planStatus?: string;
  planRenewsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  googleSub?: string | null;
  emailVerifiedAt?: string | null;
  affCode?: string | null;
  affAccountId?: string | null;
  affPayStatus?: string;
  lang?: string | null;
};

export async function createUser(
  email: string,
  passwordHash: string,
  salt: string
): Promise<UserRow> {
  await ensureSchema();
  const id = newId();
  const createdAt = nowISO();
  const normalizedEmail = email.toLowerCase().trim();
  await sql`
    INSERT INTO users (id, email, "passwordHash", salt, "createdAt")
    VALUES (${id}, ${normalizedEmail}, ${passwordHash}, ${salt}, ${createdAt})
  `;
  return { id, email: normalizedEmail, passwordHash, salt, createdAt };
}

// Google sign-in: links the Google account to the user (first sign-in only).
// Google proved the email is theirs. If the account was made with a password
// before (anyone can type any email at signup), that password and every open
// session are dropped, so whoever created it can't keep a way in.
export async function setUserGoogleSub(userId: string, sub: string): Promise<void> {
  await ensureSchema();
  const rows = (await sql`
    UPDATE users SET "googleSub" = ${sub}, "passwordHash" = '', salt = '', "emailVerifiedAt" = COALESCE("emailVerifiedAt", now())
    WHERE id = ${userId} AND "googleSub" IS NULL
    RETURNING id
  `) as unknown[];
  if (rows.length) await sql`DELETE FROM sessions WHERE "userId" = ${userId}`;
}

export async function getUserByGoogleSub(sub: string): Promise<UserRow | undefined> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM users WHERE "googleSub" = ${sub}`) as UserRow[];
  return rows[0];
}

export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM users WHERE email = ${email.toLowerCase().trim()}
  `) as UserRow[];
  return rows[0];
}

export async function getUserById(id: string): Promise<UserRow | undefined> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM users WHERE id = ${id}`) as UserRow[];
  return rows[0];
}

// ---------- Businesses ----------
export type BusinessRow = {
  id: string;
  userId: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  city: string | null;
  pitch: string;
  whatsapp: string | null;
  accentColor: string;
  published: number;
  pageViews: number;
  whatsappClicks: number;
  callClicks: number;
  textClicks: number;
  site: SiteData;
  marketing: MarketingData;
  plan: BusinessPlan;
  serviceAgent: ServiceAgent;
  affiliate: AffiliateSettings;
  marketCategory: string | null;
  stripeAccountId?: string | null;
  payStatus?: string;
  createdAt: string;
};

function toBusiness(row: Record<string, unknown> | undefined): BusinessRow | undefined {
  if (!row) return undefined;
  return {
    ...(row as unknown as BusinessRow),
    callClicks: Number(row.callClicks ?? 0),
    textClicks: Number(row.textClicks ?? 0),
    site: parseSite(row.site),
    marketing: parseMarketing(row.marketing),
    plan: parsePlan(row.plan),
    serviceAgent: parseServiceAgent(row.serviceAgent),
    affiliate: parseAffiliate(row.affiliate),
  };
}

export async function isSlugTaken(slug: string): Promise<boolean> {
  await ensureSchema();
  const rows = await sql`SELECT id FROM businesses WHERE slug = ${slug}`;
  return rows.length > 0;
}

export async function createBusiness(input: {
  userId: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  city?: string | null;
  pitch: string;
  whatsapp?: string | null;
  site?: SiteData;
  plan?: BusinessPlan;
}): Promise<BusinessRow> {
  await ensureSchema();
  const id = newId();
  const createdAt = nowISO();
  const accentColor = "#122118";
  const city = input.city ?? null;
  const whatsapp = input.whatsapp ?? null;
  const site = parseSite(input.site ?? {});
  const plan = parsePlan(input.plan ?? {});
  // New pages start as drafts: the owner reviews prices and claims before publishing.
  await sql`
    INSERT INTO businesses
      (id, "userId", slug, name, category, description, city, pitch, whatsapp, "accentColor", published, site, plan, "createdAt")
    VALUES
      (${id}, ${input.userId}, ${input.slug}, ${input.name}, ${input.category}, ${input.description}, ${city}, ${input.pitch}, ${whatsapp}, ${accentColor}, 0, ${JSON.stringify(site)}::jsonb, ${JSON.stringify(plan)}::jsonb, ${createdAt})
  `;
  return {
    id,
    userId: input.userId,
    slug: input.slug,
    name: input.name,
    category: input.category,
    description: input.description,
    city,
    pitch: input.pitch,
    whatsapp,
    accentColor,
    published: 0,
    pageViews: 0,
    whatsappClicks: 0,
    callClicks: 0,
    textClicks: 0,
    site,
    marketing: parseMarketing({}),
    plan,
    serviceAgent: parseServiceAgent({}),
    affiliate: parseAffiliate({}),
    marketCategory: null,
    createdAt,
  };
}

// The most recent project of an account (used when no project is selected).
export async function getBusinessByUserId(userId: string): Promise<BusinessRow | undefined> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM businesses WHERE "userId" = ${userId} ORDER BY "createdAt" DESC LIMIT 1
  `) as Record<string, unknown>[];
  return toBusiness(rows[0]);
}

export async function getBusinessById(id: string): Promise<BusinessRow | undefined> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM businesses WHERE id = ${id}`) as Record<string, unknown>[];
  return toBusiness(rows[0]);
}

// A project only if it belongs to this account.
export async function getBusinessForUser(userId: string, id: string): Promise<BusinessRow | undefined> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM businesses WHERE id = ${id} AND "userId" = ${userId}
  `) as Record<string, unknown>[];
  return toBusiness(rows[0]);
}

export type ProjectSummary = {
  id: string;
  slug: string;
  name: string;
  category: string;
  city: string | null;
  accentColor: string;
  published: boolean;
  pageViews: number;
  contacts: number;
  services: number;
  campaigns: number;
  planService: string;
  planReady: boolean;
  createdAt: string;
  coverUrl: string; // the page's main photo ("" when none)
  ownerName: string;
};

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT b.id, b.slug, b.name, b.category, b.city, b."accentColor", b.published, b."pageViews",
           b."callClicks", b."textClicks", b."whatsappClicks", b.plan, b."createdAt",
           COALESCE(NULLIF(b.site->>'coverUrl', ''), b.site->'gallery'->>0, '') AS "coverUrl",
           COALESCE(b.site->>'ownerName', '') AS "ownerName",
           (SELECT count(*) FROM services s WHERE s."businessId" = b.id) AS services,
           (SELECT count(*) FROM campaigns c WHERE c."businessId" = b.id AND c.spec IS NOT NULL) AS campaigns
    FROM businesses b WHERE b."userId" = ${userId}
    ORDER BY b."createdAt" ASC
  `) as Record<string, unknown>[];
  return rows.map((r) => {
    const plan = parsePlan(r.plan);
    return {
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      category: String(r.category),
      city: (r.city as string | null) ?? null,
      accentColor: String(r.accentColor),
      published: Boolean(r.published),
      pageViews: Number(r.pageViews ?? 0),
      contacts: Number(r.callClicks ?? 0) + Number(r.textClicks ?? 0) + Number(r.whatsappClicks ?? 0),
      services: Number(r.services ?? 0),
      campaigns: Number(r.campaigns ?? 0),
      planService: plan.service,
      planReady: plan.ready,
      createdAt: String(r.createdAt),
      coverUrl: String(r.coverUrl ?? ""),
      ownerName: String(r.ownerName ?? ""),
    };
  });
}

export async function countProjects(userId: string): Promise<number> {
  await ensureSchema();
  const rows = (await sql`SELECT count(*) AS n FROM businesses WHERE "userId" = ${userId}`) as { n: string | number }[];
  return Number(rows[0]?.n ?? 0);
}

export async function updateBusinessPlan(businessId: string, plan: BusinessPlan): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET plan = ${JSON.stringify(plan)}::jsonb WHERE id = ${businessId}`;
}

export async function getBusinessBySlug(slug: string): Promise<BusinessRow | undefined> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM businesses WHERE slug = ${slug}`) as Record<string, unknown>[];
  return toBusiness(rows[0]);
}

export async function updateBusinessWhatsapp(businessId: string, whatsapp: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET whatsapp = ${whatsapp} WHERE id = ${businessId}`;
}

export async function updateBusinessAccent(businessId: string, accentColor: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET "accentColor" = ${accentColor} WHERE id = ${businessId}`;
}

// Generic partial update for the fields the AI page editor is allowed to
// touch. Column names come only from this fixed key set (never from
// user/model input directly), so building the SET clause this way is safe.
export async function updateBusinessDetails(
  businessId: string,
  fields: Partial<{
    name: string;
    category: string;
    description: string;
    city: string | null;
    pitch: string;
  }>
): Promise<void> {
  await ensureSchema();
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const setClauses = entries.map(([key], i) => `"${key}" = $${i + 1}`);
  const values = entries.map(([, v]) => v);
  await sql.query(
    `UPDATE businesses SET ${setClauses.join(", ")} WHERE id = $${entries.length + 1}`,
    [...values, businessId]
  );
}

export async function updateBusinessSite(businessId: string, site: SiteData): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET site = ${JSON.stringify(parseSite(site))}::jsonb WHERE id = ${businessId}`;
}

// Changes only the given fields, so two saves at the same time (e.g. the video
// and a photo) never erase each other.
export async function patchBusinessSite(businessId: string, patch: Partial<SiteData>): Promise<void> {
  await ensureSchema();
  if (!Object.keys(patch).length) return;
  await sql`UPDATE businesses SET site = site || ${JSON.stringify(patch)}::jsonb WHERE id = ${businessId}`;
}

// Validates the merged page, then writes only the fields in the patch, so a
// slow writer (the AI chat) never erases photos saved in the meantime.
export async function mergeBusinessSite(businessId: string, current: SiteData, patch: Partial<SiteData>): Promise<void> {
  const merged = parseSite({ ...current, ...patch }) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) out[k] = merged[k];
  await patchBusinessSite(businessId, out as Partial<SiteData>);
}

// Removes the logo, the main photo (the next gallery photo takes its place)
// or one gallery photo, in a single statement. Returns the page's photos after.
export async function removeSitePhoto(businessId: string, kind: "logo" | "cover" | "gallery", url: string): Promise<{ logoUrl: string; coverUrl: string; gallery: string[] } | null> {
  await ensureSchema();
  const rows = (kind === "logo"
    ? await sql`UPDATE businesses SET site = site || '{"logoUrl":""}'::jsonb WHERE id = ${businessId} RETURNING site`
    : kind === "cover"
      ? await sql`
          UPDATE businesses SET site = site || jsonb_build_object(
            'coverUrl', COALESCE(site->'gallery'->>0, ''),
            'gallery', COALESCE((site->'gallery') - 0, '[]'::jsonb))
          WHERE id = ${businessId} RETURNING site`
      : await sql`
          UPDATE businesses SET site = site || jsonb_build_object('gallery', COALESCE(
            (SELECT jsonb_agg(e) FROM jsonb_array_elements(site->'gallery') e WHERE e <> to_jsonb(${url}::text)), '[]'::jsonb))
          WHERE id = ${businessId} AND site->'gallery' @> jsonb_build_array(${url}::text) RETURNING site`) as { site: unknown }[];
  if (!rows[0]) return null;
  const s = parseSite(rows[0].site);
  return { logoUrl: s.logoUrl, coverUrl: s.coverUrl, gallery: s.gallery };
}

// A gallery photo becomes the main one (the old main photo moves to the
// front of the gallery), in a single statement.
export async function promoteSiteCover(businessId: string, url: string): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`
    UPDATE businesses SET site = site || jsonb_build_object(
      'coverUrl', ${url}::text,
      'gallery', (CASE WHEN COALESCE(site->>'coverUrl', '') <> '' THEN jsonb_build_array(site->'coverUrl') ELSE '[]'::jsonb END)
        || COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(site->'gallery') e WHERE e <> to_jsonb(${url}::text)), '[]'::jsonb))
    WHERE id = ${businessId} AND site->'gallery' @> jsonb_build_array(${url}::text)
    RETURNING id
  `) as unknown[];
  return rows.length > 0;
}

// Adds one photo to the end of the gallery in a single statement.
export async function appendGalleryPhoto(businessId: string, url: string, max: number): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`
    UPDATE businesses
    SET site = jsonb_set(site, '{gallery}', COALESCE(site->'gallery', '[]'::jsonb) || to_jsonb(${url}::text))
    WHERE id = ${businessId} AND jsonb_array_length(COALESCE(site->'gallery', '[]'::jsonb)) < ${max}
    RETURNING id`) as { id: string }[];
  return rows.length > 0;
}

export async function setBusinessPublished(businessId: string, published: boolean): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET published = ${published ? 1 : 0} WHERE id = ${businessId}`;
}

export async function addAiUsage(userId: string, month: string, micros: number): Promise<void> {
  await ensureSchema();
  await sql`
    INSERT INTO ai_usage ("userId", month, "costMicros", calls) VALUES (${userId}, ${month}, ${micros}, 1)
    ON CONFLICT ("userId", month) DO UPDATE SET "costMicros" = ai_usage."costMicros" + ${micros}, calls = ai_usage.calls + 1
  `;
}

export async function getAiSpendMicros(userId: string, month: string): Promise<number> {
  await ensureSchema();
  const rows = (await sql`SELECT "costMicros" FROM ai_usage WHERE "userId" = ${userId} AND month = ${month}`) as { costMicros: string | number }[];
  return Number(rows[0]?.costMicros ?? 0);
}

export async function setBusinessMarketCategory(businessId: string, category: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET "marketCategory" = ${category} WHERE id = ${businessId}`;
}

export type MarketplaceRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  site: SiteData;
  marketCategory: string | null;
  email: string;
  plan: string | null;
  planStatus: string | null;
  googleSub: string | null;
  emailVerifiedAt: string | null;
  planRenewsAt: string | null;
  serviceName: string | null;
  servicePrice: string | null;
  category: string;
  profile: { city: string; state: string; radiusMiles: number | null; serviceMode: string; remoteScope: string };
  agentOn: boolean; // a service agent that works in the page chat
  agentOffers: unknown; // its access prices (priceCents)
  servicePrices: string[] | null;
  rating: number | null; // average of its reviews
  reviews: number;
};

// Published pages for the marketplace, newest first, with their main service.
export async function listMarketplaceRows(limit = 300): Promise<MarketplaceRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT b.id, b.slug, b.name, b.city, b.site, jsonb_build_object('profile', b.plan->'profile') AS "businessPlan", b."marketCategory", b.category,
           u.email, u.plan, u."planStatus", u."planRenewsAt", u."googleSub", u."emailVerifiedAt",
           s.name AS "serviceName", s.price AS "servicePrice",
           COALESCE((b."serviceAgent"->>'enabled')::boolean, false) AS "agentOn",
           b."serviceAgent"->'offers' AS "agentOffers",
           ARRAY(SELECT price FROM services WHERE "businessId" = b.id AND price IS NOT NULL) AS "servicePrices",
           r.avg AS rating, COALESCE(r.n, 0)::int AS reviews
    FROM businesses b
    JOIN users u ON u.id = b."userId"
    LEFT JOIN LATERAL (
      SELECT AVG(rating)::float AS avg, COUNT(*) AS n FROM agent_reviews WHERE "businessId" = b.id AND hidden = false
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT name, price FROM services WHERE "businessId" = b.id
      ORDER BY featured DESC, "sortOrder" ASC LIMIT 1
    ) s ON true
    WHERE b.published = 1
    ORDER BY b."createdAt" DESC
    LIMIT ${limit}
  `) as Record<string, unknown>[];
  return rows.map((r) => {
    const bp = (r.businessPlan && typeof r.businessPlan === "object" ? r.businessPlan : {}) as { profile?: Record<string, unknown> };
    const p = bp.profile ?? {};
    return {
      ...(r as unknown as MarketplaceRow),
      site: parseSite(r.site),
      profile: {
        city: typeof p.city === "string" ? p.city : "",
        state: typeof p.state === "string" ? p.state : "",
        radiusMiles: typeof p.radiusMiles === "number" ? p.radiusMiles : null,
        serviceMode: typeof p.serviceMode === "string" ? p.serviceMode : "",
        remoteScope: typeof p.remoteScope === "string" ? p.remoteScope : "",
      },
    };
  });
}

export async function incrementContactClick(businessId: string, channel: "call" | "text" | "whatsapp"): Promise<void> {
  await ensureSchema();
  if (channel === "call") await sql`UPDATE businesses SET "callClicks" = "callClicks" + 1 WHERE id = ${businessId}`;
  else if (channel === "text") await sql`UPDATE businesses SET "textClicks" = "textClicks" + 1 WHERE id = ${businessId}`;
  else await sql`UPDATE businesses SET "whatsappClicks" = "whatsappClicks" + 1 WHERE id = ${businessId}`;
}

export async function createPageReport(businessId: string, reason: string, details: string | null): Promise<void> {
  await ensureSchema();
  await sql`INSERT INTO page_reports (id, "businessId", reason, details) VALUES (${newId()}, ${businessId}, ${reason}, ${details})`;
}

export async function incrementPageViews(businessId: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET "pageViews" = "pageViews" + 1 WHERE id = ${businessId}`;
}

export async function incrementWhatsappClicks(businessId: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET "whatsappClicks" = "whatsappClicks" + 1 WHERE id = ${businessId}`;
}

// ---------- Services ----------
export type ServiceRow = {
  id: string;
  businessId: string;
  name: string;
  price: string | null;
  description: string | null;
  sortOrder: number;
  featured?: boolean;
  tag?: string | null;
};

export async function addService(
  businessId: string,
  name: string,
  price?: string,
  description?: string,
  sortOrder = 0
): Promise<void> {
  await ensureSchema();
  await sql`
    INSERT INTO services (id, "businessId", name, price, description, "sortOrder")
    VALUES (${newId()}, ${businessId}, ${name}, ${price ?? null}, ${description ?? null}, ${sortOrder})
  `;
}

export async function listServices(businessId: string): Promise<ServiceRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM services WHERE "businessId" = ${businessId} ORDER BY "sortOrder" ASC
  `) as ServiceRow[];
  return rows;
}

export async function getServiceById(serviceId: string): Promise<ServiceRow | undefined> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM services WHERE id = ${serviceId}`) as ServiceRow[];
  return rows[0];
}

export async function updateService(
  serviceId: string,
  fields: Partial<{
    name: string;
    price: string | null;
    description: string | null;
    sortOrder: number;
    featured: boolean;
    tag: string | null;
  }>
): Promise<void> {
  await ensureSchema();
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const setClauses = entries.map(([key], i) => `"${key}" = $${i + 1}`);
  const values = entries.map(([, v]) => v);
  await sql.query(
    `UPDATE services SET ${setClauses.join(", ")} WHERE id = $${entries.length + 1}`,
    [...values, serviceId]
  );
}

export async function deleteService(serviceId: string): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM services WHERE id = ${serviceId}`;
}

// ---------- Reviews (never auto-generated; only real, user-submitted) ----------
export type ReviewRow = {
  id: string;
  businessId: string;
  author: string;
  rating: number;
  text: string;
  createdAt: string;
};

export async function listReviews(businessId: string): Promise<ReviewRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM reviews WHERE "businessId" = ${businessId} ORDER BY "createdAt" DESC
  `) as ReviewRow[];
  return rows;
}

// ---------- Campaigns ----------
// `variations` stores a JSON-stringified array of {headline, body} pairs —
// same "plain TEXT column, parse where it's displayed" approach as the rest
// of this file, rather than a JSON column type.
// What Sevrii knows about a campaign launched on Meta.
export type CampaignMeta = {
  campaignId: string;
  adSetId: string;
  adId: string;
  status: "paused" | "active" | "error";
  error?: string;
  launchedAt: string;
  stats?: { spend: number; impressions: number; clicks: number; at: string };
};

export type CampaignRow = {
  meta?: CampaignMeta | null;
  id: string;
  businessId: string;
  title: string;
  goal: string;
  status: string;
  adCopy: string | null;
  budgetNote: string | null;
  audience: string | null;
  platforms: string | null;
  variations: string | null;
  spec?: CampaignSpec | null;
  createdAt: string;
};

export async function createCampaign(input: {
  businessId: string;
  title: string;
  goal: string;
  adCopy?: string;
  budgetNote?: string;
  audience?: string;
  platforms?: string;
  variations?: string;
}): Promise<CampaignRow> {
  await ensureSchema();
  const id = newId();
  const createdAt = nowISO();
  const adCopy = input.adCopy ?? null;
  const budgetNote = input.budgetNote ?? null;
  const audience = input.audience ?? null;
  const platforms = input.platforms ?? null;
  const variations = input.variations ?? null;
  await sql`
    INSERT INTO campaigns
      (id, "businessId", title, goal, status, "adCopy", "budgetNote", audience, platforms, variations, "createdAt")
    VALUES
      (${id}, ${input.businessId}, ${input.title}, ${input.goal}, 'draft', ${adCopy}, ${budgetNote}, ${audience}, ${platforms}, ${variations}, ${createdAt})
  `;
  return {
    id,
    businessId: input.businessId,
    title: input.title,
    goal: input.goal,
    status: "draft",
    adCopy,
    budgetNote,
    audience,
    platforms,
    variations,
    createdAt,
  };
}

export async function listCampaigns(businessId: string): Promise<CampaignRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM campaigns WHERE "businessId" = ${businessId} ORDER BY "createdAt" DESC
  `) as CampaignRow[];
  return rows.map((r) => ({ ...r, spec: parseCampaignSpec(r.spec) }));
}

export async function updateBusinessMarketing(businessId: string, data: MarketingData): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET marketing = ${JSON.stringify(parseMarketing(data))}::jsonb WHERE id = ${businessId}`;
}

export async function createCampaignSpec(businessId: string, title: string, goal: string, spec: CampaignSpec): Promise<string> {
  await ensureSchema();
  const id = newId();
  await sql`
    INSERT INTO campaigns (id, "businessId", title, goal, status, spec, "createdAt")
    VALUES (${id}, ${businessId}, ${title}, ${goal}, 'draft', ${JSON.stringify(spec)}::jsonb, ${nowISO()})
  `;
  return id;
}

export async function updateCampaignSpec(campaignId: string, businessId: string, title: string, goal: string, spec: CampaignSpec): Promise<void> {
  await ensureSchema();
  await sql`
    UPDATE campaigns SET title = ${title}, goal = ${goal}, spec = ${JSON.stringify(spec)}::jsonb
    WHERE id = ${campaignId} AND "businessId" = ${businessId}
  `;
}

export async function deleteCampaign(campaignId: string, businessId: string): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM campaigns WHERE id = ${campaignId} AND "businessId" = ${businessId}`;
}

// ---------- Chat messages ----------
export type ChatMessageRow = {
  id: string;
  businessId: string;
  channel: string;
  role: string;
  content: string;
  createdAt: string;
};

export async function addChatMessage(
  businessId: string,
  channel: string,
  role: string,
  content: string
): Promise<void> {
  await ensureSchema();
  await sql`
    INSERT INTO chat_messages (id, "businessId", channel, role, content, "createdAt")
    VALUES (${newId()}, ${businessId}, ${channel}, ${role}, ${content}, ${nowISO()})
  `;
}

export async function updateChatMessage(businessId: string, id: string, content: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE chat_messages SET content = ${content} WHERE id = ${id} AND "businessId" = ${businessId}`;
}

export async function listChatMessages(businessId: string, channel: string): Promise<ChatMessageRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM (
      SELECT * FROM chat_messages WHERE "businessId" = ${businessId} AND channel = ${channel}
      ORDER BY "createdAt" DESC LIMIT 200
    ) recent ORDER BY "createdAt" ASC
  `) as ChatMessageRow[];
  return rows;
}

export async function updateBusinessSlug(businessId: string, slug: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET slug = ${slug} WHERE id = ${businessId}`;
}

// ---------- Brain research runs ----------
export type ResearchJobRow = {
  id: string;
  businessId: string;
  runId: string;
  kind: string;
  status: "queued" | "running" | "done" | "failed";
  result: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function createResearchRun(businessId: string, kinds: string[]): Promise<string> {
  await ensureSchema();
  const runId = newId();
  for (const kind of kinds) {
    await sql`INSERT INTO research_jobs (id, "businessId", "runId", kind) VALUES (${newId()}, ${businessId}, ${runId}, ${kind})`;
  }
  return runId;
}

export async function setResearchJob(runId: string, kind: string, status: ResearchJobRow["status"], result?: unknown, error?: string): Promise<void> {
  await ensureSchema();
  await sql`
    UPDATE research_jobs
    SET status = ${status},
        result = COALESCE(${result === undefined ? null : JSON.stringify(result)}::jsonb, result),
        error = ${error ?? null},
        "updatedAt" = now()
    WHERE "runId" = ${runId} AND kind = ${kind}
  `;
}

export async function latestResearchRun(businessId: string): Promise<ResearchJobRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM research_jobs WHERE "runId" = (
      SELECT "runId" FROM research_jobs WHERE "businessId" = ${businessId} ORDER BY "createdAt" DESC LIMIT 1
    ) ORDER BY "createdAt" ASC
  `) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    businessId: String(r.businessId),
    runId: String(r.runId),
    kind: String(r.kind),
    status: String(r.status) as ResearchJobRow["status"],
    result: r.result ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: new Date(r.createdAt as string).toISOString(),
    updatedAt: new Date(r.updatedAt as string).toISOString(),
  }));
}

// Take a job only if nobody else is running it (or the last runner died).
export async function claimResearchJob(runId: string, kind: string, staleSeconds = 200): Promise<boolean> {
  await ensureSchema();
  const rows = await sql`
    UPDATE research_jobs SET status = 'running', error = NULL, "updatedAt" = now()
    WHERE "runId" = ${runId} AND kind = ${kind}
      AND (status = 'queued' OR (status = 'running' AND "updatedAt" < now() - (${staleSeconds}::int * interval '1 second')))
    RETURNING id
  `;
  return rows.length > 0;
}

export async function requeueFailedJobs(runId: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE research_jobs SET status = 'queued', error = NULL, "updatedAt" = now() WHERE "runId" = ${runId} AND status = 'failed'`;
}

// ---------- Plans and billing ----------
// Saves the Stripe customer only if the account has none yet; returns the one stored.
export async function setUserStripeCustomer(userId: string, customerId: string): Promise<string> {
  await ensureSchema();
  await sql`UPDATE users SET "stripeCustomerId" = ${customerId} WHERE id = ${userId} AND "stripeCustomerId" IS NULL`;
  const rows = (await sql`SELECT "stripeCustomerId" FROM users WHERE id = ${userId}`) as { stripeCustomerId: string | null }[];
  return rows[0]?.stripeCustomerId || customerId;
}

// Swaps a customer ID that no longer exists in the connected Stripe account
// (for example after moving to a new Stripe account). Only replaces the exact old value.
export async function replaceUserStripeCustomer(userId: string, oldId: string, newId: string): Promise<string> {
  await ensureSchema();
  await sql`UPDATE users SET "stripeCustomerId" = ${newId} WHERE id = ${userId} AND "stripeCustomerId" = ${oldId}`;
  const rows = (await sql`SELECT "stripeCustomerId" FROM users WHERE id = ${userId}`) as { stripeCustomerId: string | null }[];
  return rows[0]?.stripeCustomerId || newId;
}

export async function getUserByStripeCustomer(customerId: string): Promise<UserRow | undefined> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM users WHERE "stripeCustomerId" = ${customerId}`) as UserRow[];
  return rows[0];
}

export async function updateUserPlan(
  userId: string,
  fields: { plan: string; planStatus: string; planRenewsAt: string | null; cancelAtPeriodEnd: boolean; stripeSubscriptionId: string | null }
): Promise<void> {
  await ensureSchema();
  await sql`
    UPDATE users SET plan = ${fields.plan}, "planStatus" = ${fields.planStatus}, "planRenewsAt" = ${fields.planRenewsAt},
      "cancelAtPeriodEnd" = ${fields.cancelAtPeriodEnd}, "stripeSubscriptionId" = ${fields.stripeSubscriptionId}
    WHERE id = ${userId}
  `;
}

export async function joinPlanWaitlist(userId: string, plan: string): Promise<void> {
  await ensureSchema();
  await sql`INSERT INTO plan_waitlist ("userId", plan) VALUES (${userId}, ${plan}) ON CONFLICT DO NOTHING`;
}

export async function listUserWaitlists(userId: string): Promise<string[]> {
  await ensureSchema();
  const rows = (await sql`SELECT plan FROM plan_waitlist WHERE "userId" = ${userId}`) as { plan: string }[];
  return rows.map((r) => r.plan);
}

// ---------- Payments (Stripe Connect) ----------
export type PayStatus = "none" | "pending" | "review" | "ready";

// Swaps a saved account that no longer exists in Stripe for a new one. Only
// replaces that exact old id, so two clicks at once still end with one account.
export async function replaceBusinessStripeAccount(businessId: string, oldId: string, newId: string): Promise<string> {
  await ensureSchema();
  await sql`UPDATE businesses SET "stripeAccountId" = ${newId}, "payStatus" = 'pending' WHERE id = ${businessId} AND "stripeAccountId" = ${oldId}`;
  const rows = (await sql`SELECT "stripeAccountId" FROM businesses WHERE id = ${businessId}`) as { stripeAccountId: string | null }[];
  return rows[0]?.stripeAccountId || newId;
}

export async function setBusinessStripeAccount(businessId: string, accountId: string): Promise<string> {
  await ensureSchema();
  // Only the first account sticks, so two clicks at once can't leave two accounts.
  await sql`UPDATE businesses SET "stripeAccountId" = ${accountId}, "payStatus" = 'pending' WHERE id = ${businessId} AND "stripeAccountId" IS NULL`;
  const rows = (await sql`SELECT "stripeAccountId" FROM businesses WHERE id = ${businessId}`) as { stripeAccountId: string | null }[];
  return rows[0]?.stripeAccountId || accountId;
}

export async function setBusinessPayStatus(businessId: string, status: PayStatus): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET "payStatus" = ${status} WHERE id = ${businessId}`;
}

export type PaymentLinkRow = {
  id: string;
  businessId: string;
  title: string;
  amountCents: number;
  description: string | null;
  active: boolean;
  createdAt: string;
};

function toLink(r: Record<string, unknown>): PaymentLinkRow {
  return {
    id: String(r.id),
    businessId: String(r.businessId),
    title: String(r.title),
    amountCents: Number(r.amountCents),
    description: (r.description as string | null) ?? null,
    active: Boolean(r.active),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

// Short, unguessable IDs for public pay links (sevrii.com/pay/xxxx).
function linkId(): string {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += abc[b % abc.length];
  return out;
}

export async function createPaymentLink(businessId: string, title: string, amountCents: number, description: string | null): Promise<PaymentLinkRow> {
  await ensureSchema();
  const id = linkId();
  const rows = (await sql`
    INSERT INTO payment_links (id, "businessId", title, "amountCents", description)
    VALUES (${id}, ${businessId}, ${title}, ${amountCents}, ${description})
    RETURNING *
  `) as Record<string, unknown>[];
  return toLink(rows[0]);
}

export async function listPaymentLinks(businessId: string): Promise<PaymentLinkRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM payment_links WHERE "businessId" = ${businessId} ORDER BY "createdAt" DESC LIMIT 100
  `) as Record<string, unknown>[];
  return rows.map(toLink);
}

export async function countPaymentLinks(businessId: string): Promise<number> {
  await ensureSchema();
  const rows = (await sql`SELECT COUNT(*)::int AS n FROM payment_links WHERE "businessId" = ${businessId}`) as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

export async function getPaymentLink(id: string): Promise<PaymentLinkRow | undefined> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM payment_links WHERE id = ${id}`) as Record<string, unknown>[];
  return rows[0] ? toLink(rows[0]) : undefined;
}

export async function setPaymentLinkActive(id: string, businessId: string, active: boolean): Promise<void> {
  await ensureSchema();
  await sql`UPDATE payment_links SET active = ${active} WHERE id = ${id} AND "businessId" = ${businessId}`;
}

// ---------- Payment notices ----------
export async function hasPaymentNotice(sessionId: string): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`SELECT 1 FROM payment_notices WHERE "sessionId" = ${sessionId}`) as unknown[];
  return rows.length > 0;
}

// True only for the first caller, so the owner gets exactly one email.
export async function claimPaymentNotice(sessionId: string, businessId: string): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`
    INSERT INTO payment_notices ("sessionId", "businessId") VALUES (${sessionId}, ${businessId})
    ON CONFLICT ("sessionId") DO NOTHING
    RETURNING "sessionId"
  `) as unknown[];
  return rows.length > 0;
}

export async function releasePaymentNotice(sessionId: string): Promise<void> {
  await sql`DELETE FROM payment_notices WHERE "sessionId" = ${sessionId}`;
}

export async function getBusinessByStripeAccount(accountId: string): Promise<BusinessRow | undefined> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM businesses WHERE "stripeAccountId" = ${accountId} LIMIT 1`) as Record<string, unknown>[];
  return toBusiness(rows[0]);
}

// ---------- Password reset ----------
export async function createPasswordReset(userId: string, tokenHash: string, minutes: number): Promise<void> {
  await ensureSchema();
  // One live link per account: older unused links stop working.
  await sql`UPDATE password_resets SET "usedAt" = now() WHERE "userId" = ${userId} AND "usedAt" IS NULL`;
  await sql`
    INSERT INTO password_resets ("tokenHash", "userId", "expiresAt")
    VALUES (${tokenHash}, ${userId}, now() + make_interval(mins => ${minutes}::int))
  `;
}

export async function isPasswordResetValid(tokenHash: string): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`
    SELECT 1 FROM password_resets WHERE "tokenHash" = ${tokenHash} AND "usedAt" IS NULL AND "expiresAt" > now()
  `) as unknown[];
  return rows.length > 0;
}

// Marks the link used and returns its account, only if it was still valid.
export async function consumePasswordReset(tokenHash: string): Promise<string | null> {
  await ensureSchema();
  const rows = (await sql`
    UPDATE password_resets SET "usedAt" = now()
    WHERE "tokenHash" = ${tokenHash} AND "usedAt" IS NULL AND "expiresAt" > now()
    RETURNING "userId"
  `) as { userId: string }[];
  return rows[0]?.userId ?? null;
}

export async function setUserPassword(userId: string, passwordHash: string, salt: string): Promise<void> {
  await ensureSchema();
  // Only reachable through a link sent to the account's email: it's theirs.
  await sql`UPDATE users SET "passwordHash" = ${passwordHash}, salt = ${salt}, "emailVerifiedAt" = COALESCE("emailVerifiedAt", now()) WHERE id = ${userId}`;
}

// ---------- Account deletion ----------
// Removes the account and everything that belongs to it. Returns the photo
// URLs of its pages so the caller can delete the files too.
// Deletes one project (business) of this account and everything in it.
// Returns the photo URLs to remove from storage, or null if it isn't theirs.
export async function deleteBusinessForUser(userId: string, businessId: string): Promise<string[] | null> {
  await ensureSchema();
  const rows = (await sql`SELECT id, site FROM businesses WHERE id = ${businessId} AND "userId" = ${userId}`) as { id: string; site: unknown }[];
  if (!rows[0]) return null;
  const site = parseSite(rows[0].site);
  const id = rows[0].id;
  await sql`DELETE FROM services WHERE "businessId" = ${id}`;
  await sql`DELETE FROM reviews WHERE "businessId" = ${id}`;
  await sql`DELETE FROM campaigns WHERE "businessId" = ${id}`;
  await sql`DELETE FROM campaign_events WHERE "businessId" = ${id}`;
  await sql`DELETE FROM agent_items WHERE "businessId" = ${id}`;
  await sql`DELETE FROM agent_access WHERE "businessId" = ${id}`;
  await sql`DELETE FROM agent_reviews WHERE "businessId" = ${id}`;
  await sql`DELETE FROM affiliate_visits WHERE "businessId" = ${id}`;
  await sql`DELETE FROM marketing_posts WHERE "businessId" = ${id}`;
  await sql`DELETE FROM meta_connections WHERE "businessId" = ${id}`;
  await sql`DELETE FROM chat_messages WHERE "businessId" = ${id}`;
  await sql`DELETE FROM page_reports WHERE "businessId" = ${id}`;
  await sql`DELETE FROM research_jobs WHERE "businessId" = ${id}`;
  await sql`DELETE FROM payment_links WHERE "businessId" = ${id}`;
  await sql`DELETE FROM payment_notices WHERE "businessId" = ${id}`;
  await sql`DELETE FROM leads WHERE "businessId" = ${id}`;
  await sql`DELETE FROM conv_messages WHERE "conversationId" IN (SELECT id FROM conversations WHERE "businessId" = ${id})`;
  await sql`DELETE FROM conversations WHERE "businessId" = ${id}`;
  await sql`DELETE FROM businesses WHERE id = ${id} AND "userId" = ${userId}`;
  // Only this project's own files (a logo carried over from another project stays).
  return [site.logoUrl, site.ownerPhotoUrl, site.coverUrl, site.videoUrl, ...site.gallery].filter((u) => u && ownsBlob(u, id));
}

export async function deleteUserEverything(userId: string): Promise<string[]> {
  await ensureSchema();
  const businesses = (await sql`SELECT id, site FROM businesses WHERE "userId" = ${userId}`) as { id: string; site: unknown }[];
  const photos: string[] = [];
  for (const b of businesses) {
    const site = parseSite(b.site);
    photos.push(site.logoUrl, site.ownerPhotoUrl, site.coverUrl, site.videoUrl, ...site.gallery);
  }
  const ids = businesses.map((b) => b.id);
  if (ids.length) {
    await sql`DELETE FROM services WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM reviews WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM campaigns WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM campaign_events WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM agent_items WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM agent_access WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM affiliate_visits WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM marketing_posts WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM meta_connections WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM chat_messages WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM page_reports WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM research_jobs WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM payment_links WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM payment_notices WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM leads WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM conv_messages WHERE "conversationId" IN (SELECT id FROM conversations WHERE "businessId" = ANY(${ids}))`;
    await sql`DELETE FROM conversations WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM businesses WHERE "userId" = ${userId}`;
  }
  await sql`DELETE FROM sessions WHERE "userId" = ${userId}`;
  await sql`DELETE FROM password_resets WHERE "userId" = ${userId}`;
  await sql`DELETE FROM plan_waitlist WHERE "userId" = ${userId}`;
  await sql`DELETE FROM ai_usage WHERE "userId" = ${userId} OR "userId" = ${`visitors:${userId}`}`;
  await sql`DELETE FROM push_subs WHERE "userId" = ${userId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
  return photos.filter(Boolean);
}

// ---------- Leads (quote requests from the public page) ----------
export type LeadRow = {
  id: string;
  businessId: string;
  name: string;
  phone: string;
  email: string;
  service: string;
  message: string;
  contactPref: string;
  createdAt: string;
};

export async function addLead(l: Omit<LeadRow, "id" | "createdAt">): Promise<LeadRow> {
  await ensureSchema();
  const id = newId();
  const rows = (await sql`
    INSERT INTO leads (id, "businessId", name, phone, email, service, message, "contactPref")
    VALUES (${id}, ${l.businessId}, ${l.name}, ${l.phone}, ${l.email}, ${l.service}, ${l.message}, ${l.contactPref})
    RETURNING id, "businessId", name, phone, email, service, message, "contactPref", "createdAt"
  `) as LeadRow[];
  return { ...rows[0], createdAt: new Date(rows[0].createdAt).toISOString() };
}

export async function listLeads(businessId: string, limit = 50): Promise<LeadRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT id, "businessId", name, phone, email, service, message, "contactPref", "createdAt"
    FROM leads WHERE "businessId" = ${businessId}
    ORDER BY "createdAt" DESC LIMIT ${limit}
  `) as LeadRow[];
  return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
}

// ---------- Page chat (visitor ↔ AI ↔ owner) ----------
export type ConversationRow = {
  id: string;
  businessId: string;
  name: string;
  phone: string;
  email: string;
  aiEnabled: boolean;
  handoff: boolean;
  ownerUnread: number;
  aiReplies: number;
  agentFree: number;
  lastMessage: string;
  lastMessageAt: string;
  visitorSeenAt: string;
  notifiedAt: string | null;
  createdAt: string;
};
export type ConvMessageRow = { seq: number; role: "visitor" | "ai" | "owner"; content: string; createdAt: string };

function convRow(r: Record<string, unknown>): ConversationRow {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : "");
  return {
    id: String(r.id),
    businessId: String(r.businessId),
    name: String(r.name ?? ""),
    phone: String(r.phone ?? ""),
    email: String(r.email ?? ""),
    aiEnabled: Boolean(r.aiEnabled),
    handoff: Boolean(r.handoff),
    ownerUnread: Number(r.ownerUnread ?? 0),
    aiReplies: Number(r.aiReplies ?? 0),
    agentFree: Number(r.agentFree ?? 0),
    lastMessage: String(r.lastMessage ?? ""),
    lastMessageAt: iso(r.lastMessageAt),
    visitorSeenAt: iso(r.visitorSeenAt),
    notifiedAt: r.notifiedAt ? iso(r.notifiedAt) : null,
    createdAt: iso(r.createdAt),
  };
}

export async function createConversation(businessId: string, tokenHash: string): Promise<ConversationRow> {
  await ensureSchema();
  const rows = (await sql`
    INSERT INTO conversations (id, "businessId", "tokenHash") VALUES (${newId()}, ${businessId}, ${tokenHash})
    RETURNING *
  `) as Record<string, unknown>[];
  return convRow(rows[0]);
}

export async function getConversationByToken(businessId: string, tokenHash: string): Promise<ConversationRow | null> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM conversations WHERE "tokenHash" = ${tokenHash} AND "businessId" = ${businessId}`) as Record<string, unknown>[];
  return rows[0] ? convRow(rows[0]) : null;
}

export async function getConversationForBusiness(businessId: string, id: string): Promise<ConversationRow | null> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM conversations WHERE id = ${id} AND "businessId" = ${businessId}`) as Record<string, unknown>[];
  return rows[0] ? convRow(rows[0]) : null;
}

export async function listConversations(businessId: string, limit = 40): Promise<ConversationRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM conversations WHERE "businessId" = ${businessId}
    ORDER BY "lastMessageAt" DESC LIMIT ${limit}
  `) as Record<string, unknown>[];
  return rows.map(convRow);
}

export async function countUnreadConversations(businessId: string): Promise<number> {
  await ensureSchema();
  const rows = (await sql`SELECT COUNT(*)::int AS n FROM conversations WHERE "businessId" = ${businessId} AND "ownerUnread" > 0`) as { n: number }[];
  return rows[0]?.n ?? 0;
}

export async function addConvMessage(conversationId: string, role: "visitor" | "ai" | "owner", content: string): Promise<ConvMessageRow> {
  await ensureSchema();
  const rows = (await sql`
    INSERT INTO conv_messages ("conversationId", role, content) VALUES (${conversationId}, ${role}, ${content})
    RETURNING seq, role, content, "createdAt"
  `) as { seq: string | number; role: ConvMessageRow["role"]; content: string; createdAt: string }[];
  const preview = content.slice(0, 140);
  if (role === "visitor") {
    await sql`UPDATE conversations SET "lastMessage" = ${preview}, "lastMessageAt" = now(), "visitorSeenAt" = now(), "ownerUnread" = "ownerUnread" + 1 WHERE id = ${conversationId}`;
  } else if (role === "ai") {
    await sql`UPDATE conversations SET "lastMessage" = ${preview}, "lastMessageAt" = now(), "aiReplies" = "aiReplies" + 1 WHERE id = ${conversationId}`;
  } else {
    await sql`UPDATE conversations SET "lastMessage" = ${preview}, "lastMessageAt" = now(), "ownerUnread" = 0 WHERE id = ${conversationId}`;
  }
  const r = rows[0];
  return { seq: Number(r.seq), role: r.role, content: r.content, createdAt: new Date(r.createdAt).toISOString() };
}

// Reserves one AI reply for this conversation, atomically (two tabs sending at
// once can't both slip past the cap).
export async function claimAiReply(conversationId: string, max: number): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`
    UPDATE conversations SET "aiReplies" = "aiReplies" + 1
    WHERE id = ${conversationId} AND "aiEnabled" AND "aiReplies" < ${max}
    RETURNING id
  `) as unknown[];
  return rows.length > 0;
}

// Saves the assistant's answer only if the owner hasn't taken the chat over
// while it was being written (AI turned off, or an owner message after the
// visitor's). Returns null when it was dropped.
export async function addAiMessageIfStillAi(conversationId: string, content: string, visitorSeq: number): Promise<ConvMessageRow | null> {
  await ensureSchema();
  const rows = (await sql`
    INSERT INTO conv_messages ("conversationId", role, content)
    SELECT ${conversationId}, 'ai', ${content}
    WHERE EXISTS (SELECT 1 FROM conversations WHERE id = ${conversationId} AND "aiEnabled")
      AND NOT EXISTS (SELECT 1 FROM conv_messages WHERE "conversationId" = ${conversationId} AND role = 'owner' AND seq > ${visitorSeq})
    RETURNING seq, role, content, "createdAt"
  `) as { seq: string | number; role: ConvMessageRow["role"]; content: string; createdAt: string }[];
  const r = rows[0];
  if (!r) return null;
  await sql`UPDATE conversations SET "lastMessage" = ${content.slice(0, 140)}, "lastMessageAt" = now() WHERE id = ${conversationId}`;
  return { seq: Number(r.seq), role: r.role, content: r.content, createdAt: new Date(r.createdAt).toISOString() };
}

// Flags a chat as waiting for the owner. True only the first time (so the
// owner gets one "wants to book" alert, not one per message).
export async function setHandoffOnce(conversationId: string): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`UPDATE conversations SET handoff = true WHERE id = ${conversationId} AND NOT handoff RETURNING id`) as unknown[];
  return rows.length > 0;
}

export async function listConvMessages(conversationId: string, afterSeq = 0, limit = 80): Promise<ConvMessageRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT seq, role, content, "createdAt" FROM conv_messages
    WHERE "conversationId" = ${conversationId} AND seq > ${afterSeq}
    ORDER BY seq DESC LIMIT ${limit}
  `) as { seq: string | number; role: ConvMessageRow["role"]; content: string; createdAt: string }[];
  return rows.reverse().map((r) => ({ seq: Number(r.seq), role: r.role, content: r.content, createdAt: new Date(r.createdAt).toISOString() }));
}

export async function updateConversation(
  id: string,
  patch: { name?: string; phone?: string; email?: string; aiEnabled?: boolean; handoff?: boolean; read?: boolean; seen?: boolean; notified?: boolean }
): Promise<void> {
  await ensureSchema();
  if (patch.name !== undefined) await sql`UPDATE conversations SET name = ${patch.name} WHERE id = ${id}`;
  if (patch.phone !== undefined) await sql`UPDATE conversations SET phone = ${patch.phone} WHERE id = ${id}`;
  if (patch.email !== undefined) await sql`UPDATE conversations SET email = ${patch.email} WHERE id = ${id}`;
  if (patch.aiEnabled !== undefined) await sql`UPDATE conversations SET "aiEnabled" = ${patch.aiEnabled} WHERE id = ${id}`;
  if (patch.handoff !== undefined) await sql`UPDATE conversations SET handoff = ${patch.handoff} WHERE id = ${id}`;
  if (patch.read) await sql`UPDATE conversations SET "ownerUnread" = 0 WHERE id = ${id}`;
  if (patch.seen) await sql`UPDATE conversations SET "visitorSeenAt" = now() WHERE id = ${id}`;
  if (patch.notified) await sql`UPDATE conversations SET "notifiedAt" = now() WHERE id = ${id}`;
}

// ---------- Push notifications (owner devices) ----------
export type PushSubRow = { endpoint: string; userId: string; p256dh: string; auth: string; label: string };

export async function savePushSub(sub: PushSubRow): Promise<void> {
  await ensureSchema();
  await sql`
    INSERT INTO push_subs (endpoint, "userId", p256dh, auth, label) VALUES (${sub.endpoint}, ${sub.userId}, ${sub.p256dh}, ${sub.auth}, ${sub.label})
    ON CONFLICT (endpoint) DO UPDATE SET "userId" = EXCLUDED."userId", p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, label = EXCLUDED.label
  `;
}

export async function listPushSubs(userId: string): Promise<PushSubRow[]> {
  await ensureSchema();
  return (await sql`SELECT endpoint, "userId", p256dh, auth, label FROM push_subs WHERE "userId" = ${userId} LIMIT 20`) as PushSubRow[];
}

export async function deletePushSub(endpoint: string, userId?: string): Promise<void> {
  await ensureSchema();
  if (userId) await sql`DELETE FROM push_subs WHERE endpoint = ${endpoint} AND "userId" = ${userId}`;
  else await sql`DELETE FROM push_subs WHERE endpoint = ${endpoint}`;
}


// ---------- Marketing results ----------
export type CampaignEventKind = "view" | "chat" | "contact";

export async function addCampaignEvent(businessId: string, campaignId: string, kind: CampaignEventKind): Promise<void> {
  await ensureSchema();
  await sql`INSERT INTO campaign_events ("campaignId", "businessId", kind) VALUES (${campaignId}, ${businessId}, ${kind})`;
}

// Is this a campaign of this business? (A link someone edited can't count for another.)
export async function campaignBelongs(businessId: string, campaignId: string): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`SELECT 1 FROM campaigns WHERE id = ${campaignId} AND "businessId" = ${businessId}`) as unknown[];
  return rows.length > 0;
}

export type CampaignStats = { views: number; chats: number; contacts: number };

// Totals per campaign since a date (all time when omitted).
export async function campaignStats(businessId: string, since?: Date): Promise<Record<string, CampaignStats>> {
  await ensureSchema();
  const from = (since ?? new Date(0)).toISOString();
  const rows = (await sql`
    SELECT "campaignId", kind, count(*)::int AS n FROM campaign_events
    WHERE "businessId" = ${businessId} AND "createdAt" >= ${from}
    GROUP BY "campaignId", kind
  `) as { campaignId: string; kind: CampaignEventKind; n: number }[];
  const out: Record<string, CampaignStats> = {};
  for (const r of rows) {
    const s = (out[r.campaignId] ??= { views: 0, chats: 0, contacts: 0 });
    if (r.kind === "view") s.views = r.n;
    else if (r.kind === "chat") s.chats = r.n;
    else if (r.kind === "contact") s.contacts = r.n;
  }
  return out;
}

export async function setConversationCampaign(conversationId: string, campaignId: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE conversations SET "campaignId" = ${campaignId} WHERE id = ${conversationId} AND "campaignId" IS NULL`;
}

export async function getConversationCampaign(conversationId: string): Promise<string | null> {
  await ensureSchema();
  const rows = (await sql`SELECT "campaignId" FROM conversations WHERE id = ${conversationId}`) as { campaignId: string | null }[];
  return rows[0]?.campaignId ?? null;
}

// Page-wide numbers for a period (for the weekly summary).
export async function businessWeekNumbers(businessId: string, from: Date, to: Date): Promise<{ chats: number; contacts: number }> {
  await ensureSchema();
  const rows = (await sql`
    SELECT count(*)::int AS chats, count(*) FILTER (WHERE phone <> '' OR email <> '')::int AS contacts
    FROM conversations WHERE "businessId" = ${businessId} AND "createdAt" >= ${from.toISOString()} AND "createdAt" < ${to.toISOString()}
  `) as { chats: number; contacts: number }[];
  return rows[0] ?? { chats: 0, contacts: 0 };
}

// Published pages whose weekly summary is due (none in the last 6 days).
export async function listWeeklyDue(limit = 200): Promise<{ id: string; userId: string }[]> {
  await ensureSchema();
  return (await sql`
    SELECT id, "userId" FROM businesses
    WHERE published = 1 AND ("weeklySentAt" IS NULL OR "weeklySentAt" < now() - interval '6 days')
    ORDER BY "weeklySentAt" NULLS FIRST LIMIT ${limit}
  `) as { id: string; userId: string }[];
}

// Claims this week's summary for a business (true only once per 6 days).
export async function claimWeekly(businessId: string): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`
    UPDATE businesses SET "weeklySentAt" = now()
    WHERE id = ${businessId} AND ("weeklySentAt" IS NULL OR "weeklySentAt" < now() - interval '6 days')
    RETURNING id
  `) as unknown[];
  return rows.length > 0;
}

export async function setCampaignMeta(businessId: string, campaignId: string, meta: CampaignMeta | null): Promise<void> {
  await ensureSchema();
  await sql`UPDATE campaigns SET meta = ${meta ? JSON.stringify(meta) : null}::jsonb WHERE id = ${campaignId} AND "businessId" = ${businessId}`;
}

// ---------- Meta (Facebook) connection ----------
export type MetaConnectionRow = {
  businessId: string;
  userId: string;
  tokenEnc: string;
  expiresAt: string | null;
  fbUserName: string;
  adAccountId: string;
  adAccountName: string;
  pageId: string;
  pageName: string;
};

export async function getMetaConnection(businessId: string): Promise<MetaConnectionRow | null> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM meta_connections WHERE "businessId" = ${businessId}`) as MetaConnectionRow[];
  return rows[0] ?? null;
}

export async function saveMetaConnection(c: Pick<MetaConnectionRow, "businessId" | "userId" | "tokenEnc" | "expiresAt" | "fbUserName">): Promise<void> {
  await ensureSchema();
  await sql`
    INSERT INTO meta_connections ("businessId", "userId", "tokenEnc", "expiresAt", "fbUserName")
    VALUES (${c.businessId}, ${c.userId}, ${c.tokenEnc}, ${c.expiresAt}, ${c.fbUserName})
    ON CONFLICT ("businessId") DO UPDATE SET "userId" = EXCLUDED."userId", "tokenEnc" = EXCLUDED."tokenEnc",
      "expiresAt" = EXCLUDED."expiresAt", "fbUserName" = EXCLUDED."fbUserName"
  `;
}

export async function setMetaAssets(businessId: string, a: { adAccountId: string; adAccountName: string; pageId: string; pageName: string }): Promise<void> {
  await ensureSchema();
  await sql`
    UPDATE meta_connections SET "adAccountId" = ${a.adAccountId}, "adAccountName" = ${a.adAccountName}, "pageId" = ${a.pageId}, "pageName" = ${a.pageName}
    WHERE "businessId" = ${businessId}
  `;
}

export async function deleteMetaConnection(businessId: string): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM meta_connections WHERE "businessId" = ${businessId}`;
}


// ---------- Marketing agent ----------
export type AgentItemRow = {
  id: string;
  businessId: string;
  kind: string;
  status: string;
  title: string;
  detail: string;
  campaignId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
};

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export async function addAgentItem(i: { businessId: string; kind: string; status: string; title: string; detail?: string; campaignId?: string | null; payload?: Record<string, unknown> | null }): Promise<string> {
  await ensureSchema();
  const id = newId();
  await sql`
    INSERT INTO agent_items (id, "businessId", kind, status, title, detail, "campaignId", payload, "resolvedAt")
    VALUES (${id}, ${i.businessId}, ${i.kind}, ${i.status}, ${i.title.slice(0, 200)}, ${(i.detail ?? "").slice(0, 2000)}, ${i.campaignId ?? null},
            ${i.payload ? JSON.stringify(i.payload) : null}::jsonb, ${i.status === "pending" ? null : new Date().toISOString()})
  `;
  return id;
}

export async function listAgentItems(businessId: string, limit = 60): Promise<AgentItemRow[]> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM agent_items WHERE "businessId" = ${businessId} ORDER BY "createdAt" DESC LIMIT ${limit}`) as Record<string, unknown>[];
  return rows.map((r) => ({ ...(r as unknown as AgentItemRow), createdAt: iso(r.createdAt) ?? "", resolvedAt: iso(r.resolvedAt) }));
}

export async function getAgentItem(businessId: string, id: string): Promise<AgentItemRow | null> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM agent_items WHERE id = ${id} AND "businessId" = ${businessId}`) as Record<string, unknown>[];
  const r = rows[0];
  return r ? { ...(r as unknown as AgentItemRow), createdAt: iso(r.createdAt) ?? "", resolvedAt: iso(r.resolvedAt) } : null;
}

// Moves a pending item to a final status, once (two clicks can't approve twice).
export async function resolveAgentItem(businessId: string, id: string, status: "approved" | "done" | "dismissed"): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`
    UPDATE agent_items SET status = ${status}, "resolvedAt" = now()
    WHERE id = ${id} AND "businessId" = ${businessId} AND status = 'pending' RETURNING id
  `) as unknown[];
  return rows.length > 0;
}

export async function setAgentItemStatus(businessId: string, id: string, status: string, detail?: string): Promise<void> {
  await ensureSchema();
  if (detail !== undefined) await sql`UPDATE agent_items SET status = ${status}, detail = ${detail.slice(0, 2000)}, "resolvedAt" = now() WHERE id = ${id} AND "businessId" = ${businessId}`;
  else await sql`UPDATE agent_items SET status = ${status}, "resolvedAt" = now() WHERE id = ${id} AND "businessId" = ${businessId}`;
}

export type MarketingPostRow = { id: string; businessId: string; channel: string; day: string; text: string; photo: number; status: string; createdAt: string };

export async function addMarketingPosts(businessId: string, posts: { channel: string; day: string; text: string; photo: number }[]): Promise<void> {
  await ensureSchema();
  for (const p of posts.slice(0, 30)) {
    await sql`INSERT INTO marketing_posts (id, "businessId", channel, day, text, photo) VALUES (${newId()}, ${businessId}, ${p.channel}, ${p.day}, ${p.text.slice(0, 2200)}, ${Math.max(0, Math.min(20, Math.round(p.photo || 0)))})`;
  }
}

export async function listMarketingPosts(businessId: string, fromDay: string, limit = 40): Promise<MarketingPostRow[]> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM marketing_posts WHERE "businessId" = ${businessId} AND day >= ${fromDay} ORDER BY day ASC, channel ASC LIMIT ${limit}`) as Record<string, unknown>[];
  return rows.map((r) => ({ ...(r as unknown as MarketingPostRow), createdAt: iso(r.createdAt) ?? "" }));
}

export async function setMarketingPostStatus(businessId: string, id: string, status: "ready" | "used"): Promise<void> {
  await ensureSchema();
  await sql`UPDATE marketing_posts SET status = ${status} WHERE id = ${id} AND "businessId" = ${businessId}`;
}

export async function setCampaignStatus(businessId: string, campaignId: string, status: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE campaigns SET status = ${status} WHERE id = ${campaignId} AND "businessId" = ${businessId}`;
}

export async function markAgentRan(businessId: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET "agentRanAt" = now() WHERE id = ${businessId}`;
}

// Businesses whose agent works on its own every day (it was started, with Marketing in their plan).
export async function listAgentBusinesses(limit = 200): Promise<{ id: string; userId: string; agentRanAt: string | null }[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT id, "userId", "agentRanAt" FROM businesses
    WHERE "agentRanAt" IS NOT NULL ORDER BY "agentRanAt" ASC LIMIT ${limit}
  `) as Record<string, unknown>[];
  return rows.map((r) => ({ id: r.id as string, userId: r.userId as string, agentRanAt: iso(r.agentRanAt) }));
}

// ---------- Service agents ----------
export async function setServiceAgent(businessId: string, agent: ServiceAgent): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET "serviceAgent" = ${JSON.stringify(parseServiceAgent(agent))}::jsonb WHERE id = ${businessId}`;
}

// One free reply for a customer who hasn't paid (false when they used them all).
export async function claimAgentFree(conversationId: string, max: number): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`
    UPDATE conversations SET "agentFree" = "agentFree" + 1
    WHERE id = ${conversationId} AND "aiEnabled" AND "agentFree" < ${max}
    RETURNING id
  `) as unknown[];
  return rows.length > 0;
}

export type AgentAccessRow = {
  id: string;
  businessId: string;
  conversationId: string;
  sessionId: string;
  subscriptionId: string | null;
  offerId: string;
  title: string;
  billing: "once" | "monthly";
  amountCents: number;
  replyLimit: number;
  repliesUsed: number;
  email: string | null;
  status: string;
  endsAt: string;
  createdAt: string;
};

function accessRow(r: Record<string, unknown>): AgentAccessRow {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : "");
  return {
    id: String(r.id),
    businessId: String(r.businessId),
    conversationId: String(r.conversationId),
    sessionId: String(r.sessionId),
    subscriptionId: r.subscriptionId ? String(r.subscriptionId) : null,
    offerId: String(r.offerId),
    title: String(r.title),
    billing: r.billing === "monthly" ? "monthly" : "once",
    amountCents: Number(r.amountCents) || 0,
    replyLimit: Number(r.replyLimit) || 0,
    repliesUsed: Number(r.repliesUsed) || 0,
    email: r.email ? String(r.email) : null,
    status: String(r.status),
    endsAt: iso(r.endsAt),
    createdAt: iso(r.createdAt),
  };
}

// Saves a paid access once per Stripe session (null if it was already saved).
export async function addAgentAccess(a: Omit<AgentAccessRow, "id" | "repliesUsed" | "status" | "createdAt">): Promise<AgentAccessRow | null> {
  await ensureSchema();
  const rows = (await sql`
    INSERT INTO agent_access (id, "businessId", "conversationId", "sessionId", "subscriptionId", "offerId", title, billing, "amountCents", "replyLimit", email, "endsAt")
    VALUES (${newId()}, ${a.businessId}, ${a.conversationId}, ${a.sessionId}, ${a.subscriptionId}, ${a.offerId}, ${a.title}, ${a.billing}, ${a.amountCents}, ${a.replyLimit}, ${a.email}, ${a.endsAt})
    ON CONFLICT ("sessionId") DO NOTHING
    RETURNING *
  `) as Record<string, unknown>[];
  return rows[0] ? accessRow(rows[0]) : null;
}

// The newest access of this chat that is still on (or a monthly one to re-check).
export async function latestAgentAccess(conversationId: string): Promise<AgentAccessRow | null> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM agent_access WHERE "conversationId" = ${conversationId} AND status = 'active'
    ORDER BY "endsAt" DESC LIMIT 1
  `) as Record<string, unknown>[];
  return rows[0] ? accessRow(rows[0]) : null;
}

// Uses one reply of a paid access (false when it ran out or expired).
export async function useAgentReply(accessId: string): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`
    UPDATE agent_access SET "repliesUsed" = "repliesUsed" + 1
    WHERE id = ${accessId} AND status = 'active' AND "repliesUsed" < "replyLimit" AND "endsAt" > now()
    RETURNING id
  `) as unknown[];
  return rows.length > 0;
}

// A monthly access renewed (new period: replies start over) or ended.
export async function renewAgentAccess(accessId: string, endsAt: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE agent_access SET "endsAt" = ${endsAt}, "repliesUsed" = 0 WHERE id = ${accessId}`;
}
export async function endAgentAccess(accessId: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE agent_access SET status = 'ended' WHERE id = ${accessId}`;
}

export async function countAgentAccess(conversationId: string): Promise<number> {
  await ensureSchema();
  const rows = (await sql`SELECT COUNT(*)::int AS n FROM agent_access WHERE "conversationId" = ${conversationId}`) as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

export async function listAgentAccess(businessId: string, limit = 50): Promise<AgentAccessRow[]> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM agent_access WHERE "businessId" = ${businessId} ORDER BY "createdAt" DESC LIMIT ${limit}`) as Record<string, unknown>[];
  return rows.map(accessRow);
}

// ---------- Affiliates ----------
export async function setBusinessAffiliate(businessId: string, a: AffiliateSettings): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET affiliate = ${JSON.stringify(parseAffiliate(a))}::jsonb WHERE id = ${businessId}`;
}

// The person's affiliate code (made once, 8 letters and numbers).
export async function ensureAffCode(userId: string): Promise<string> {
  await ensureSchema();
  const rows = (await sql`SELECT "affCode" FROM users WHERE id = ${userId}`) as { affCode: string | null }[];
  if (rows[0]?.affCode) return rows[0].affCode;
  for (let i = 0; i < 6; i++) {
    const code = randomBytes(6).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toLowerCase();
    if (code.length < 6) continue;
    try {
      const done = (await sql`UPDATE users SET "affCode" = ${code} WHERE id = ${userId} AND "affCode" IS NULL RETURNING "affCode"`) as { affCode: string }[];
      if (done[0]) return done[0].affCode;
      const again = (await sql`SELECT "affCode" FROM users WHERE id = ${userId}`) as { affCode: string | null }[];
      if (again[0]?.affCode) return again[0].affCode;
    } catch {
      // taken: try another
    }
  }
  throw new Error("could not make an affiliate code");
}

export async function getUserByAffCode(code: string): Promise<UserRow | undefined> {
  await ensureSchema();
  if (!/^[a-z0-9]{6,12}$/.test(code)) return undefined;
  const rows = (await sql`SELECT * FROM users WHERE "affCode" = ${code}`) as UserRow[];
  return rows[0];
}

export async function setAffAccount(userId: string, accountId: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE users SET "affAccountId" = ${accountId} WHERE id = ${userId}`;
}
export async function setAffPayStatus(userId: string, status: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE users SET "affPayStatus" = ${status} WHERE id = ${userId}`;
}

export async function addAffiliateVisit(businessId: string, affiliateUserId: string): Promise<void> {
  await ensureSchema();
  const day = nowISO().slice(0, 10);
  await sql`
    INSERT INTO affiliate_visits ("businessId", "affiliateUserId", day, n) VALUES (${businessId}, ${affiliateUserId}, ${day}, 1)
    ON CONFLICT ("businessId", "affiliateUserId", day) DO UPDATE SET n = affiliate_visits.n + 1
  `;
}

export type AffiliateSaleRow = {
  id: string;
  key: string;
  businessId: string;
  affiliateUserId: string;
  kind: string;
  title: string;
  amountCents: number;
  commissionCents: number;
  paymentIntentId: string | null;
  subscriptionId: string | null;
  status: "pending" | "paid" | "void" | "held";
  transferId: string | null;
  payableAt: string;
  createdAt: string;
};

function saleRow(r: Record<string, unknown>): AffiliateSaleRow {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : "");
  return {
    id: String(r.id),
    key: String(r.key),
    businessId: String(r.businessId),
    affiliateUserId: String(r.affiliateUserId),
    kind: String(r.kind),
    title: String(r.title ?? ""),
    amountCents: Number(r.amountCents) || 0,
    commissionCents: Number(r.commissionCents) || 0,
    paymentIntentId: r.paymentIntentId ? String(r.paymentIntentId) : null,
    subscriptionId: r.subscriptionId ? String(r.subscriptionId) : null,
    status: (["pending", "paid", "void", "held"].includes(String(r.status)) ? r.status : "pending") as AffiliateSaleRow["status"],
    transferId: r.transferId ? String(r.transferId) : null,
    payableAt: iso(r.payableAt),
    createdAt: iso(r.createdAt),
  };
}

// One commission per payment (key = the Stripe session or invoice).
export async function addAffiliateSale(a: Omit<AffiliateSaleRow, "id" | "status" | "transferId" | "createdAt">): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`
    INSERT INTO affiliate_sales (id, key, "businessId", "affiliateUserId", kind, title, "amountCents", "commissionCents", "paymentIntentId", "subscriptionId", "payableAt")
    VALUES (${newId()}, ${a.key}, ${a.businessId}, ${a.affiliateUserId}, ${a.kind}, ${a.title}, ${a.amountCents}, ${a.commissionCents}, ${a.paymentIntentId}, ${a.subscriptionId}, ${a.payableAt})
    ON CONFLICT (key) DO NOTHING
    RETURNING id
  `) as unknown[];
  return rows.length > 0;
}

export async function listAffiliateSales(affiliateUserId: string, limit = 50): Promise<AffiliateSaleRow[]> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM affiliate_sales WHERE "affiliateUserId" = ${affiliateUserId} ORDER BY "createdAt" DESC LIMIT ${limit}`) as Record<string, unknown>[];
  return rows.map(saleRow);
}

export async function listBusinessAffiliateSales(businessId: string, limit = 50): Promise<AffiliateSaleRow[]> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM affiliate_sales WHERE "businessId" = ${businessId} ORDER BY "createdAt" DESC LIMIT ${limit}`) as Record<string, unknown>[];
  return rows.map(saleRow);
}

export async function listDueAffiliateSales(limit = 50): Promise<AffiliateSaleRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM affiliate_sales WHERE status IN ('pending', 'held') AND "payableAt" <= now()
    ORDER BY "payableAt" ASC LIMIT ${limit}
  `) as Record<string, unknown>[];
  return rows.map(saleRow);
}

export async function setAffiliateSaleStatus(id: string, status: AffiliateSaleRow["status"], transferId: string | null = null): Promise<void> {
  await ensureSchema();
  await sql`UPDATE affiliate_sales SET status = ${status}, "transferId" = COALESCE(${transferId}, "transferId") WHERE id = ${id}`;
}

// Monthly accesses sold through an affiliate: their renewals pay commission too.
export async function listAffiliateSubscriptions(limit = 200): Promise<{ businessId: string; affiliateUserId: string; subscriptionId: string; title: string }[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT DISTINCT ON ("subscriptionId") "businessId", "affiliateUserId", "subscriptionId", title
    FROM affiliate_sales WHERE "subscriptionId" IS NOT NULL AND status <> 'void'
    ORDER BY "subscriptionId", "createdAt" ASC LIMIT ${limit}
  `) as { businessId: string; affiliateUserId: string; subscriptionId: string; title: string }[];
  return rows;
}

export async function businessAffiliateStats(businessId: string): Promise<{ affiliates: number; visits: number; sales: number; salesCents: number; commissionCents: number }> {
  await ensureSchema();
  const v = (await sql`SELECT COUNT(DISTINCT "affiliateUserId")::int AS a, COALESCE(SUM(n), 0)::int AS v FROM affiliate_visits WHERE "businessId" = ${businessId}`) as { a: number; v: number }[];
  const s = (await sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM("amountCents"), 0)::int AS amt, COALESCE(SUM("commissionCents"), 0)::int AS com
    FROM affiliate_sales WHERE "businessId" = ${businessId} AND status <> 'void'
  `) as { n: number; amt: number; com: number }[];
  return { affiliates: v[0]?.a ?? 0, visits: v[0]?.v ?? 0, sales: s[0]?.n ?? 0, salesCents: s[0]?.amt ?? 0, commissionCents: s[0]?.com ?? 0 };
}

export async function affiliateVisitsByBusiness(affiliateUserId: string): Promise<Record<string, number>> {
  await ensureSchema();
  const rows = (await sql`SELECT "businessId", COALESCE(SUM(n), 0)::int AS v FROM affiliate_visits WHERE "affiliateUserId" = ${affiliateUserId} GROUP BY "businessId"`) as { businessId: string; v: number }[];
  return Object.fromEntries(rows.map((r) => [r.businessId, r.v]));
}

// Published businesses open to affiliates (the caller checks plans and payments).
export async function listOpenAffiliateBusinesses(limit = 200): Promise<BusinessRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM businesses WHERE published = 1 AND (affiliate->>'enabled') = 'true' AND "payStatus" = 'ready'
    ORDER BY "createdAt" DESC LIMIT ${limit}
  `) as Record<string, unknown>[];
  return rows.map((r) => toBusiness(r)!).filter(Boolean);
}

// ---------- Agent reviews ----------
export type AgentReviewRow = { id: string; businessId: string; conversationId: string; rating: number; text: string; name: string; createdAt: string };

function reviewRow(r: Record<string, unknown>): AgentReviewRow {
  return {
    id: String(r.id),
    businessId: String(r.businessId),
    conversationId: String(r.conversationId),
    rating: Number(r.rating),
    text: String(r.text ?? ""),
    name: String(r.name ?? ""),
    createdAt: new Date(String(r.createdAt)).toISOString(),
  };
}

// Did this conversation ever pay for the agent? (only buyers can review)
export async function conversationPaidAgent(conversationId: string): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`SELECT 1 FROM agent_access WHERE "conversationId" = ${conversationId} LIMIT 1`) as unknown[];
  return rows.length > 0;
}

export async function getAgentReviewByConversation(conversationId: string): Promise<AgentReviewRow | null> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM agent_reviews WHERE "conversationId" = ${conversationId}`) as Record<string, unknown>[];
  return rows[0] ? reviewRow(rows[0]) : null;
}

export async function saveAgentReview(input: { businessId: string; conversationId: string; rating: number; text: string; name: string }): Promise<AgentReviewRow> {
  await ensureSchema();
  const rows = (await sql`
    INSERT INTO agent_reviews (id, "businessId", "conversationId", rating, text, name)
    VALUES (${newId()}, ${input.businessId}, ${input.conversationId}, ${input.rating}, ${input.text}, ${input.name})
    ON CONFLICT ("conversationId") DO UPDATE SET rating = EXCLUDED.rating, text = EXCLUDED.text, name = EXCLUDED.name, "updatedAt" = now()
    RETURNING *
  `) as Record<string, unknown>[];
  return reviewRow(rows[0]);
}

export async function listAgentReviews(businessId: string, limit = 12): Promise<{ list: AgentReviewRow[]; avg: number | null; count: number }> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM agent_reviews WHERE "businessId" = ${businessId} AND hidden = false ORDER BY "createdAt" DESC LIMIT ${limit}`) as Record<string, unknown>[];
  const stats = (await sql`SELECT AVG(rating)::float AS avg, COUNT(*)::int AS n FROM agent_reviews WHERE "businessId" = ${businessId} AND hidden = false`) as { avg: number | null; n: number }[];
  return { list: rows.map(reviewRow), avg: stats[0]?.avg ?? null, count: stats[0]?.n ?? 0 };
}


// ---------- Service agents: cases (the task done for one customer) ----------
export type AgentCaseStatus = "working" | "needs_input" | "needs_ok" | "blocked" | "done" | "pending";
export type AgentCaseStep = { label: string; status: "done" | "doing" | "todo" | "failed"; at: string };
export type AgentCaseDoc = { name: string; url: string };
export type AgentCaseResult = { kind: string; value: string; url: string; verifiedAt: string; test: boolean };
export type AgentCaseWaiting = { kind: "sensitive" | "confirm" | "captcha" | "info"; label: string; detail: string; url: string };
export type AgentCaseRow = {
  id: string;
  businessId: string;
  conversationId: string;
  status: AgentCaseStatus;
  mode: "live" | "test";
  title: string;
  data: Record<string, string>;
  steps: AgentCaseStep[];
  docs: AgentCaseDoc[];
  result: AgentCaseResult | null;
  waiting: AgentCaseWaiting | null;
  browser: { sessionId?: string; liveUrl?: string; url?: string; sandbox?: Record<string, unknown> };
  reminders: { dueAt: string; text: string; sentAt: string | null }[];
  memo: { role: string; content: unknown }[];
  createdAt: string;
  updatedAt: string;
};

function caseRow(r: Record<string, unknown>): AgentCaseRow {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : "");
  return {
    id: String(r.id),
    businessId: String(r.businessId),
    conversationId: String(r.conversationId),
    status: String(r.status) as AgentCaseStatus,
    mode: r.mode === "live" ? "live" : "test",
    title: String(r.title ?? ""),
    data: (r.data as Record<string, string>) ?? {},
    steps: (r.steps as AgentCaseStep[]) ?? [],
    docs: (r.docs as AgentCaseDoc[]) ?? [],
    result: (r.result as AgentCaseResult | null) ?? null,
    waiting: (r.waiting as AgentCaseWaiting | null) ?? null,
    browser: (r.browser as AgentCaseRow["browser"]) ?? {},
    reminders: (r.reminders as AgentCaseRow["reminders"]) ?? [],
    memo: (r.memo as AgentCaseRow["memo"]) ?? [],
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export async function createAgentCase(input: { businessId: string; conversationId: string; mode: "live" | "test"; title: string; data: Record<string, string> }): Promise<AgentCaseRow> {
  await ensureSchema();
  const rows = (await sql`
    INSERT INTO agent_cases (id, "businessId", "conversationId", mode, title, data)
    VALUES (${newId()}, ${input.businessId}, ${input.conversationId}, ${input.mode}, ${input.title}, ${JSON.stringify(input.data)}::jsonb)
    RETURNING *
  `) as Record<string, unknown>[];
  return caseRow(rows[0]);
}

export async function getAgentCase(id: string): Promise<AgentCaseRow | null> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM agent_cases WHERE id = ${id}`) as Record<string, unknown>[];
  return rows[0] ? caseRow(rows[0]) : null;
}

// The case still open in a chat (one at a time per conversation).
export async function openCaseForConversation(conversationId: string): Promise<AgentCaseRow | null> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM agent_cases WHERE "conversationId" = ${conversationId} AND status NOT IN ('done')
    ORDER BY "createdAt" DESC LIMIT 1
  `) as Record<string, unknown>[];
  return rows[0] ? caseRow(rows[0]) : null;
}

export async function listCasesForConversation(conversationId: string): Promise<AgentCaseRow[]> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM agent_cases WHERE "conversationId" = ${conversationId} ORDER BY "createdAt" DESC LIMIT 10`) as Record<string, unknown>[];
  return rows.map(caseRow);
}

export async function updateAgentCase(id: string, patch: Partial<Pick<AgentCaseRow, "status" | "title" | "data" | "steps" | "docs" | "result" | "waiting" | "browser" | "reminders" | "memo">>): Promise<AgentCaseRow | null> {
  await ensureSchema();
  const cur = await getAgentCase(id);
  if (!cur) return null;
  const n = { ...cur, ...patch };
  const rows = (await sql`
    UPDATE agent_cases SET status = ${n.status}, title = ${n.title}, data = ${JSON.stringify(n.data)}::jsonb,
      steps = ${JSON.stringify(n.steps)}::jsonb, docs = ${JSON.stringify(n.docs)}::jsonb,
      result = ${n.result ? JSON.stringify(n.result) : null}::jsonb, waiting = ${n.waiting ? JSON.stringify(n.waiting) : null}::jsonb,
      browser = ${JSON.stringify(n.browser)}::jsonb, reminders = ${JSON.stringify(n.reminders)}::jsonb,
      memo = ${JSON.stringify(n.memo)}::jsonb, "updatedAt" = now()
    WHERE id = ${id} RETURNING *
  `) as Record<string, unknown>[];
  return rows[0] ? caseRow(rows[0]) : null;
}

// Reminders that are due and not sent yet (for the daily run).
export async function listCasesWithDueReminders(limit = 200): Promise<AgentCaseRow[]> {
  await ensureSchema();
  const now = nowISO();
  const rows = (await sql`
    SELECT * FROM agent_cases
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(reminders) r WHERE (r->>'sentAt') IS NULL AND (r->>'dueAt') <= ${now})
    LIMIT ${limit}
  `) as Record<string, unknown>[];
  return rows.map(caseRow);
}

export async function getConversationById(id: string): Promise<ConversationRow | null> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM conversations WHERE id = ${id}`) as Record<string, unknown>[];
  return rows[0] ? convRow(rows[0]) : null;
}

// Cases left pending (the office hadn't confirmed yet), last touched a day ago or more.
export async function listPendingCasesToRecheck(limit = 20): Promise<AgentCaseRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM agent_cases WHERE status = 'pending' AND "updatedAt" < now() - interval '20 hours'
    ORDER BY "updatedAt" ASC LIMIT ${limit}
  `) as Record<string, unknown>[];
  return rows.map(caseRow);
}

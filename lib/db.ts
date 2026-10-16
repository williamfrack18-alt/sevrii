import { neon } from "@neondatabase/serverless";
import { randomBytes, randomUUID } from "node:crypto";
import { ownsBlob, parseSite, type SiteData } from "./site";
import { parseMarketing, parseCampaignSpec, type MarketingData, type CampaignSpec } from "./marketing";
import { parsePlan, type BusinessPlan } from "./plan";

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
let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
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
    })().catch((err) => {
      // Don't cache a failed setup forever — let the next request retry.
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
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
  return rows[0]?.count ?? 1;
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
export async function setUserGoogleSub(userId: string, sub: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE users SET "googleSub" = ${sub} WHERE id = ${userId} AND "googleSub" IS NULL`;
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
};

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT b.id, b.slug, b.name, b.category, b.city, b."accentColor", b.published, b."pageViews",
           b."callClicks", b."textClicks", b."whatsappClicks", b.plan, b."createdAt",
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
  serviceName: string | null;
  servicePrice: string | null;
  category: string;
};

// Published pages for the marketplace, newest first, with their main service.
export async function listMarketplaceRows(limit = 300): Promise<MarketplaceRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT b.id, b.slug, b.name, b.city, b.site, b."marketCategory", b.category, u.email, u.plan, u."planStatus",
           s.name AS "serviceName", s.price AS "servicePrice"
    FROM businesses b
    JOIN users u ON u.id = b."userId"
    LEFT JOIN LATERAL (
      SELECT name, price FROM services WHERE "businessId" = b.id
      ORDER BY featured DESC, "sortOrder" ASC LIMIT 1
    ) s ON true
    WHERE b.published = 1
    ORDER BY b."createdAt" DESC
    LIMIT ${limit}
  `) as Record<string, unknown>[];
  return rows.map((r) => ({ ...(r as unknown as MarketplaceRow), site: parseSite(r.site) }));
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
export type CampaignRow = {
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
  await sql`UPDATE users SET "passwordHash" = ${passwordHash}, salt = ${salt} WHERE id = ${userId}`;
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
  return [site.logoUrl, site.coverUrl, site.videoUrl, ...site.gallery].filter((u) => u && ownsBlob(u, id));
}

export async function deleteUserEverything(userId: string): Promise<string[]> {
  await ensureSchema();
  const businesses = (await sql`SELECT id, site FROM businesses WHERE "userId" = ${userId}`) as { id: string; site: unknown }[];
  const photos: string[] = [];
  for (const b of businesses) {
    const site = parseSite(b.site);
    photos.push(site.logoUrl, site.coverUrl, site.videoUrl, ...site.gallery);
  }
  const ids = businesses.map((b) => b.id);
  if (ids.length) {
    await sql`DELETE FROM services WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM reviews WHERE "businessId" = ANY(${ids})`;
    await sql`DELETE FROM campaigns WHERE "businessId" = ANY(${ids})`;
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
  await sql`DELETE FROM ai_usage WHERE "userId" = ${userId}`;
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

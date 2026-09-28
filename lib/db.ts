import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

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
          "userId" TEXT UNIQUE NOT NULL REFERENCES users(id),
          slug TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          description TEXT NOT NULL,
          city TEXT,
          pitch TEXT NOT NULL,
          whatsapp TEXT,
          "accentColor" TEXT NOT NULL DEFAULT '#122118',
          published INTEGER NOT NULL DEFAULT 1,
          "createdAt" TEXT NOT NULL
        )
      `;
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
          "createdAt" TEXT NOT NULL
        )
      `;
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
    })();
  }
  return schemaReady;
}

// ---------- Users ----------
export type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
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
  createdAt: string;
};

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
}): Promise<BusinessRow> {
  await ensureSchema();
  const id = newId();
  const createdAt = nowISO();
  const accentColor = "#122118";
  const city = input.city ?? null;
  const whatsapp = input.whatsapp ?? null;
  await sql`
    INSERT INTO businesses
      (id, "userId", slug, name, category, description, city, pitch, whatsapp, "accentColor", published, "createdAt")
    VALUES
      (${id}, ${input.userId}, ${input.slug}, ${input.name}, ${input.category}, ${input.description}, ${city}, ${input.pitch}, ${whatsapp}, ${accentColor}, 1, ${createdAt})
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
    published: 1,
    createdAt,
  };
}

export async function getBusinessByUserId(userId: string): Promise<BusinessRow | undefined> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM businesses WHERE "userId" = ${userId}
  `) as BusinessRow[];
  return rows[0];
}

export async function getBusinessBySlug(slug: string): Promise<BusinessRow | undefined> {
  await ensureSchema();
  const rows = (await sql`SELECT * FROM businesses WHERE slug = ${slug}`) as BusinessRow[];
  return rows[0];
}

export async function updateBusinessWhatsapp(businessId: string, whatsapp: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET whatsapp = ${whatsapp} WHERE id = ${businessId}`;
}

export async function updateBusinessAccent(businessId: string, accentColor: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE businesses SET "accentColor" = ${accentColor} WHERE id = ${businessId}`;
}

// ---------- Services ----------
export type ServiceRow = {
  id: string;
  businessId: string;
  name: string;
  price: string | null;
  description: string | null;
  sortOrder: number;
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
export type CampaignRow = {
  id: string;
  businessId: string;
  title: string;
  goal: string;
  status: string;
  adCopy: string | null;
  budgetNote: string | null;
  createdAt: string;
};

export async function createCampaign(input: {
  businessId: string;
  title: string;
  goal: string;
  adCopy?: string;
  budgetNote?: string;
}): Promise<CampaignRow> {
  await ensureSchema();
  const id = newId();
  const createdAt = nowISO();
  const adCopy = input.adCopy ?? null;
  const budgetNote = input.budgetNote ?? null;
  await sql`
    INSERT INTO campaigns (id, "businessId", title, goal, status, "adCopy", "budgetNote", "createdAt")
    VALUES (${id}, ${input.businessId}, ${input.title}, ${input.goal}, 'draft', ${adCopy}, ${budgetNote}, ${createdAt})
  `;
  return {
    id,
    businessId: input.businessId,
    title: input.title,
    goal: input.goal,
    status: "draft",
    adCopy,
    budgetNote,
    createdAt,
  };
}

export async function listCampaigns(businessId: string): Promise<CampaignRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM campaigns WHERE "businessId" = ${businessId} ORDER BY "createdAt" DESC
  `) as CampaignRow[];
  return rows;
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
    SELECT * FROM chat_messages WHERE "businessId" = ${businessId} AND channel = ${channel} ORDER BY "createdAt" ASC
  `) as ChatMessageRow[];
  return rows;
}

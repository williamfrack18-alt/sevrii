import { DatabaseSync, type StatementResultingChanges } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

const DB_PATH = process.env.DATABASE_PATH || "./data/sevri.db";
const resolvedPath = path.resolve(process.cwd(), DB_PATH);
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

const globalForDb = globalThis as unknown as { __sevriDb?: DatabaseSync };
export const db = globalForDb.__sevriDb ?? new DatabaseSync(resolvedPath);
if (process.env.NODE_ENV !== "production") globalForDb.__sevriDb = db;

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    salt TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    userId TEXT UNIQUE NOT NULL REFERENCES users(id),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    city TEXT,
    pitch TEXT NOT NULL,
    whatsapp TEXT,
    accentColor TEXT NOT NULL DEFAULT '#122118',
    published INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    businessId TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    price TEXT,
    description TEXT,
    sortOrder INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    businessId TEXT NOT NULL REFERENCES businesses(id),
    author TEXT NOT NULL,
    rating INTEGER NOT NULL,
    text TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    businessId TEXT NOT NULL REFERENCES businesses(id),
    title TEXT NOT NULL,
    goal TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    adCopy TEXT,
    budgetNote TEXT,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    businessId TEXT NOT NULL REFERENCES businesses(id),
    channel TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`);

export function newId(): string {
  return randomUUID();
}
export function nowISO(): string {
  return new Date().toISOString();
}

// node:sqlite returns row objects that are not always plain Object
// instances (e.g. they can carry a different prototype). Next.js Server
// Actions/Components refuse to serialize anything but plain objects when
// passing data to Client Components, so every row read from the database
// is copied into a genuine plain object before it leaves this module.
function plain<T>(row: T | undefined): T | undefined {
  return row === undefined ? undefined : ({ ...(row as any) } as T);
}
function plainAll<T>(rows: T[]): T[] {
  return rows.map((r) => ({ ...(r as any) }) as T);
}

// ---------- Users ----------
export type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
};

export function createUser(email: string, passwordHash: string, salt: string): UserRow {
  const id = newId();
  const createdAt = nowISO();
  db.prepare(
    `INSERT INTO users (id, email, passwordHash, salt, createdAt) VALUES (?, ?, ?, ?, ?)`
  ).run(id, email.toLowerCase().trim(), passwordHash, salt, createdAt);
  return { id, email, passwordHash, salt, createdAt };
}

export function getUserByEmail(email: string): UserRow | undefined {
  return plain(
    db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase().trim()) as
      | UserRow
      | undefined
  );
}

export function getUserById(id: string): UserRow | undefined {
  return plain(db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined);
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

export function isSlugTaken(slug: string): boolean {
  const row = db.prepare(`SELECT id FROM businesses WHERE slug = ?`).get(slug);
  return !!row;
}

export function createBusiness(input: {
  userId: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  city?: string | null;
  pitch: string;
  whatsapp?: string | null;
}): BusinessRow {
  const id = newId();
  const createdAt = nowISO();
  const accentColor = "#122118";
  db.prepare(
    `INSERT INTO businesses (id, userId, slug, name, category, description, city, pitch, whatsapp, accentColor, published, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    id,
    input.userId,
    input.slug,
    input.name,
    input.category,
    input.description,
    input.city ?? null,
    input.pitch,
    input.whatsapp ?? null,
    accentColor,
    createdAt
  );
  return {
    id,
    userId: input.userId,
    slug: input.slug,
    name: input.name,
    category: input.category,
    description: input.description,
    city: input.city ?? null,
    pitch: input.pitch,
    whatsapp: input.whatsapp ?? null,
    accentColor,
    published: 1,
    createdAt,
  };
}

export function getBusinessByUserId(userId: string): BusinessRow | undefined {
  return plain(
    db.prepare(`SELECT * FROM businesses WHERE userId = ?`).get(userId) as BusinessRow | undefined
  );
}

export function getBusinessBySlug(slug: string): BusinessRow | undefined {
  return plain(
    db.prepare(`SELECT * FROM businesses WHERE slug = ?`).get(slug) as BusinessRow | undefined
  );
}

export function updateBusinessWhatsapp(businessId: string, whatsapp: string) {
  db.prepare(`UPDATE businesses SET whatsapp = ? WHERE id = ?`).run(whatsapp, businessId);
}

export function updateBusinessAccent(businessId: string, accentColor: string) {
  db.prepare(`UPDATE businesses SET accentColor = ? WHERE id = ?`).run(accentColor, businessId);
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

export function addService(
  businessId: string,
  name: string,
  price?: string,
  description?: string,
  sortOrder = 0
): void {
  db.prepare(
    `INSERT INTO services (id, businessId, name, price, description, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(newId(), businessId, name, price ?? null, description ?? null, sortOrder);
}

export function listServices(businessId: string): ServiceRow[] {
  return plainAll(
    db.prepare(`SELECT * FROM services WHERE businessId = ? ORDER BY sortOrder ASC`).all(
      businessId
    ) as ServiceRow[]
  );
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

export function listReviews(businessId: string): ReviewRow[] {
  return plainAll(
    db.prepare(`SELECT * FROM reviews WHERE businessId = ? ORDER BY createdAt DESC`).all(
      businessId
    ) as ReviewRow[]
  );
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

export function createCampaign(input: {
  businessId: string;
  title: string;
  goal: string;
  adCopy?: string;
  budgetNote?: string;
}): CampaignRow {
  const id = newId();
  const createdAt = nowISO();
  db.prepare(
    `INSERT INTO campaigns (id, businessId, title, goal, status, adCopy, budgetNote, createdAt)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(id, input.businessId, input.title, input.goal, input.adCopy ?? null, input.budgetNote ?? null, createdAt);
  return {
    id,
    businessId: input.businessId,
    title: input.title,
    goal: input.goal,
    status: "draft",
    adCopy: input.adCopy ?? null,
    budgetNote: input.budgetNote ?? null,
    createdAt,
  };
}

export function listCampaigns(businessId: string): CampaignRow[] {
  return plainAll(
    db.prepare(`SELECT * FROM campaigns WHERE businessId = ? ORDER BY createdAt DESC`).all(
      businessId
    ) as CampaignRow[]
  );
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

export function addChatMessage(businessId: string, channel: string, role: string, content: string) {
  db.prepare(
    `INSERT INTO chat_messages (id, businessId, channel, role, content, createdAt) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(newId(), businessId, channel, role, content, nowISO());
}

export function listChatMessages(businessId: string, channel: string): ChatMessageRow[] {
  return plainAll(
    db
      .prepare(`SELECT * FROM chat_messages WHERE businessId = ? AND channel = ? ORDER BY createdAt ASC`)
      .all(businessId, channel) as ChatMessageRow[]
  );
}

export type { StatementResultingChanges };

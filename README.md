# Sevri — MVP

A real, working version of the Sevri flow: sign up, tell the AI about your business in a chat,
get a live page, and manage it (plus a simulated marketing chat) from a dashboard.

This is an MVP of the core path. AI replies, campaign drafts, and ad performance are simulated —
see "What's simulated vs. real" below.

## Stack

- **Next.js 14** (App Router) + TypeScript + Tailwind CSS
- **Database:** SQLite via Node's built-in `node:sqlite` module — no external database or native
  binary download required. Data is stored in `data/sevri.db` (created automatically).
- **Auth:** custom email/password auth. Passwords are hashed with `scrypt` (Node's `crypto`
  module); sessions are a signed, HTTP-only cookie (HMAC-SHA256, no third-party auth library).
- No external API calls anywhere in the app — it runs fully offline once installed, aside from
  loading Google Fonts in the browser (cosmetic; the app works fine without them).

## Running it

```bash
npm install
npm run dev     # http://localhost:3000
```

For a production build:

```bash
npm run build
npm start
```

The first request creates `data/sevri.db` automatically. Delete that file (and the `data/`
folder) any time to reset all data.

### Environment variables (`.env`)

- `DATABASE_PATH` — where the SQLite file lives (default `./data/sevri.db`)
- `SESSION_SECRET` — HMAC signing key for session cookies. **Change this before deploying
  anywhere real** — the checked-in value is a dev-only placeholder.

## The flow

1. **`/signup`** — create an account (email + password).
2. **`/start`** — "How do you want to start?" Pick one of two paths (this is the real, wired-up
   version of the prototype's Bifurcación screen), then press **Continue**:
   - **"I already offer a service"** → **`/onboarding`** — a short guided chat: business name,
     category, city, and a one-line description.
   - **"I want to offer one, but I'm not sure what"** → **`/discover`** — a longer, multi-screen
     path, all real (no hardcoded example business):
     1. A discovery chat (location, background/experience, licenses, time & tools).
     2. An analysis screen — "local demand," "your fit," and "startup cost" cards generated
        from what you actually typed, plus a "what we ruled out" section that filters out any
        suggested idea that would need a license you said you don't have.
     3. Three suggested service ideas, picked from a small rule-based idea bank keyed off your
        background text (construction/handyman, cleaning, landscaping, or a general fallback) —
        with a "show me other ideas" alternate set.
     4. A second chat to nail down the business name, pricing, service area/contact preference,
        and whether you have real project photos.
     5. A proposal screen summarizing all of it, with a field to add your real WhatsApp number,
        before it creates your business for real.

   Either path ends by writing a real `Business` row (pitch, starter service, unique slug) — not
   a mock — and lands on `/dashboard`.
3. **`/dashboard`** — two tabs:
   - **Website**: your generated page's content, a link to the live page, and a field to save
     your WhatsApp number (the live page's contact button uses it).
   - **Marketing**: a chat where you describe a goal ("get more weekend bookings") and Sevri
     drafts a campaign (ad copy + a suggested budget) and saves it as a draft under "Your
     campaigns."
4. **`/site/[slug]`** — the public generated page for the business, with a WhatsApp deep link
   if a number was saved.

## What's simulated vs. real

This was intentionally scoped as an MVP of the *product flow*, with real integrations left as
a clearly-marked next step rather than faked:

- **Sevri AI's replies** (`lib/ai.ts`) are template-based, not calls to a real language model.
  Every function there is small and pure on purpose — swap the body of `generatePitch`,
  `nextOnboardingPrompt`, `nextDiscoveryPrompt`, `generateAnalysis`, `generateIdeas`, and
  `draftCampaign` for real LLM calls (OpenAI, Anthropic, etc.) without touching any UI or
  database code. The discovery path's idea bank (`IDEA_BANK` in `lib/ai.ts`) is a small,
  rule-based set of options per skill cluster — a real model would generate these live instead
  of picking from a fixed list.
- **Campaigns are always created as drafts.** Nothing calls the real Meta Ads API. The chat
  reply says this explicitly rather than pretending a campaign is live.
- **Reviews are never auto-generated.** The database has a `reviews` table and the public page
  renders them, but nothing writes fake reviews into it — a real business page should never
  show testimonials that didn't happen. Wire up a real review-collection flow before this table
  is used for anything user-facing.
- **No WhatsApp Business API, Meta Ads, or Google Business Profile integration** — the
  "Message on WhatsApp" button is a real `wa.me` deep link (that part works today with no API
  key), but there's no server-side integration with any of those platforms yet.

## Known limitations before a real deployment

- `node:sqlite` is still an experimental Node.js API. It's solid for an MVP, but for a
  production deployment with concurrent writers, consider moving to Postgres (the query
  functions are all isolated in `lib/db.ts`, so this is a contained change).
- `npm audit` will flag Next.js 14.2.x against several advisories that are only fully patched in
  Next.js 15/16. Most don't apply to this app's usage (no custom server, no Image Optimization
  remote patterns, no i18n middleware), but upgrading before a public production deploy is
  recommended.
- Google Fonts are loaded via a `<link>` tag (like the original design prototype) rather than
  `next/font`, so they need outbound internet access in whatever environment serves the app —
  the app itself has no other network dependency.

## Project layout

```
app/
  actions.ts            server actions: signup, login, both onboarding paths, WhatsApp, marketing chat
  page.tsx               marketing home page for the app itself
  signup/, login/        auth forms
  start/                  "How do you want to start?" — picks between the two paths below
  onboarding/             path A: "I already offer a service" chat + page wrapper
  discover/               path B: "not sure what" — discovery chat → analysis → ideas → detail chat → proposal
  dashboard/              Website / Marketing tabs, marketing chat
  site/[slug]/            the public generated business page
lib/
  db.ts                  SQLite schema + all data access functions
  auth.ts                password hashing + session token sign/verify
  session.ts             reads the current logged-in user (+ their business) from the cookie
  ai.ts                  all "Sevri AI" logic, both paths — swap for a real model here
```

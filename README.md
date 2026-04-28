# Govroll

It's Congress, finally readable.

Govroll is a civic transparency platform that makes legislation accessible to everyday people. Track bills, see how your representatives vote, and engage with the legislative process.

**Production:** [govroll.com](https://govroll.com)

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** PostgreSQL via Prisma (with `@prisma/adapter-pg`)
- **Auth:** Supabase Auth
- **Hosting:** Vercel
- **AI:** OpenAI + Anthropic (bill chat)
- **Payments:** Stripe (donations)
- **Data Sources:** GovTrack API, Congress.gov API

## Local Development

### Prerequisites

- Node.js 20+
- Docker (for local PostgreSQL)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template and fill in your values
cp .env.example .env

# 3. Start local PostgreSQL
docker compose up -d

# 4. Run database migrations
npx prisma migrate deploy

# 5. Seed with sample data
npm run db:seed

# 6. Start dev server
npm run dev
```

The app runs at **http://localhost:1776**.

### Useful Commands

| Command                  | Description                                 |
| ------------------------ | ------------------------------------------- |
| `npm run dev`            | Start dev server on port 1776               |
| `npm run db:seed`        | Seed local DB with sample data              |
| `npm run db:reset`       | Reset DB and re-run all migrations          |
| `npm run db:studio`      | Open Prisma Studio (DB browser)             |
| `npm run lint`           | Run ESLint                                  |
| `npx prisma migrate dev` | Create a new migration after schema changes |

### Data Backfill Scripts

To populate your local DB with real data from legislative APIs:

```bash
npx tsx src/scripts/fetch-representatives.ts      # ~5s, no API key needed
npx tsx src/scripts/fetch-bills.ts                 # ~3min, no API key needed
npx tsx src/scripts/fetch-bill-text.ts --limit 20  # ~1min, needs CONGRESS_DOT_GOV_API_KEY
npx tsx src/scripts/fetch-bill-actions.ts          # ~2min, needs CONGRESS_DOT_GOV_API_KEY
npx tsx src/scripts/fetch-votes.ts                 # ~15min, no API key needed
```

## Environment Strategy

| File            | Committed | Purpose                                     |
| --------------- | --------- | ------------------------------------------- |
| `.env.example`  | Yes       | Template with placeholder values            |
| `.env`          | No        | Local dev config (copy from `.env.example`) |
| Vercel env vars | N/A       | Production secrets (set in dashboard)       |

There is no staging environment. All changes go directly from local dev to production via `main` branch pushes.

### Syncing Env Vars to Vercel

```bash
./scripts/setup-vercel-env.sh
```

This script reads your `.env` and upserts each variable into Vercel project settings. `NEXT_PUBLIC_*` vars go to all environments; secrets go to production only. `DATABASE_URL` is excluded (production uses a different database).

## Deployment

Push to `main` triggers an automatic Vercel deployment. The build runs:

```
prisma generate && next build
```

### Ingestion (GitHub Actions)

Govroll runs on Vercel Hobby, which caps cron jobs at once-per-day. To get
fresher data (recorded floor votes in ~30 minutes, not ~24 hours), the
data pipeline is scheduled by **GitHub Actions** (`.github/workflows/ingest.yml`),
which calls idempotent, CRON_SECRET-gated endpoints on govroll.com.

| Endpoint                            | Cadence              | Purpose                                    |
| ----------------------------------- | -------------------- | ------------------------------------------ |
| `/api/cron/compute-congress-status` | every 10 min         | In-session / recess / break detector       |
| `/api/cron/fetch-votes`             | every 30 min         | Recorded roll-call votes (last 7d window)  |
| `/api/cron/compute-momentum`        | hourly               | Recomputes alive/dormant/dead signal       |
| `/api/cron/backfill-bill-text`      | hourly               | Fills missing bill text (small batch)      |
| `/api/cron/backfill-bill-actions`   | every 2h             | Status / action history for active bills   |
| `/api/cron/backfill-cosponsors`     | every 2h             | Individual cosponsor rows                  |
| `/api/cron/fetch-bills`             | every 3h             | New bills since our latest                 |
| `/api/cron/refresh-bill-metadata`   | every 6h             | Sponsor / policyArea / CRS summary refresh |
| `/api/cron/evaluate-budget`         | daily 00:00 UTC      | Recomputes AI budget gate                  |
| `/api/cron/fetch-representatives`   | weekly Mon 10:00 UTC | Member roster refresh                      |

The AI precompute crons (`generate-change-summaries`, `generate-bill-explainers`,
`generate-section-captions`) exist as endpoints but are not on any schedule —
manual-only since `937d70f` killed pre-launch precompute spend. AI for those
features now runs lazily on user action.

**One-time setup in the GitHub repo:**

1. `Settings → Secrets and variables → Actions → Secrets` — add `CRON_SECRET` matching the Vercel env var.
2. `Settings → Secrets and variables → Actions → Variables` — add `GOVROLL_BASE_URL` = `https://govroll.com` (no trailing slash).

**Manual trigger:** `Actions → ingest → Run workflow → pick endpoint`. Useful
for one-off backfills or forcing fresh data after a deploy.

**Why not Vercel cron?** Hobby allows 100 crons but only at daily minimum
interval (`0 */4 * * *` fails to deploy). GH Actions cron is free, supports
5-minute intervals, and has its own run history. If we upgrade to Vercel
Pro, we can move some of these back to Vercel cron for simpler operations.

## Architecture Notes

- **API routes** live in `src/app/api/`. Protected routes use `getAuthenticatedUserId()` from `src/lib/auth.ts`.
- **Admin endpoints** (`/api/admin/*`) require the `ADMIN_API_KEY` header.
- **AI chat** is budget-gated: if monthly AI spend exceeds donation income, chat is automatically disabled. See `src/lib/budget.ts` and `src/lib/ai-gate.ts`.
- **Bill data** flows: GovTrack (bills, votes, reps) + Congress.gov (text, actions, metadata). The daily cron keeps both in sync.

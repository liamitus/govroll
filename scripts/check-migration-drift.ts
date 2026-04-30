/**
 * Detect drift between `prisma/migrations/*` (source of truth in repo)
 * and the `_prisma_migrations` tracker on a target database.
 *
 * Why: govroll applies prod migrations manually via the Supabase MCP
 * (Vercel builds can't reach port 5432 — see MEMORY.md). That workflow
 * has a quiet failure mode: a developer commits a migration but forgets
 * to apply it, and the code that depends on the new schema ships
 * anyway. PR #55 (AiSummaryFeedback) hit this on 2026-04-27 — the
 * thumbs-up/-down endpoint returned 500 for 3 days before anyone
 * noticed. This script blocks that class of bug at PR time.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/check-migration-drift.ts
 *
 * Exit codes:
 *   0 — repo and tracker agree on every migration (name + checksum).
 *   1 — drift detected. The script prints what's missing/extra/wrong
 *       and how to fix it.
 *   2 — could not connect or read state. Treated as a hard failure
 *       (don't silently pass when we can't actually verify).
 *
 * What "agree" means:
 *   - Every directory under prisma/migrations/ has a row in
 *     _prisma_migrations whose migration_name matches.
 *   - Each row's checksum matches sha256(migration.sql).
 *   - No "extra" rows in the tracker that don't have a directory
 *     (would indicate a deleted-but-applied migration, also bad).
 *
 * The script is read-only — it never modifies the database. Fixing
 * drift is intentionally a manual step (apply via Supabase MCP, then
 * INSERT into _prisma_migrations with the right checksum) so a human
 * eyeballs the underlying state.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = resolve(process.cwd(), "prisma/migrations");

interface RepoMigration {
  name: string;
  checksum: string;
}

interface TrackerRow {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

function loadRepoMigrations(): RepoMigration[] {
  const entries = readdirSync(MIGRATIONS_DIR);
  const out: RepoMigration[] = [];
  for (const name of entries) {
    const dir = join(MIGRATIONS_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const sqlPath = join(dir, "migration.sql");
    let sql: string;
    try {
      sql = readFileSync(sqlPath, "utf8");
    } catch {
      // A directory without migration.sql is a malformed migration —
      // surface it loudly rather than silently skipping.
      console.error(
        `[drift] ${name}: directory has no migration.sql — malformed migration`,
      );
      process.exit(2);
    }
    const checksum = createHash("sha256").update(sql).digest("hex");
    out.push({ name, checksum });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadTracker(): Promise<TrackerRow[]> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "[drift] DATABASE_URL is not set. Cannot verify tracker state.",
    );
    process.exit(2);
  }
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (e) {
    console.error("[drift] could not connect to database:", e);
    process.exit(2);
  }
  try {
    const res = await client.query<TrackerRow>(
      `SELECT migration_name, checksum, finished_at, rolled_back_at
       FROM _prisma_migrations
       ORDER BY migration_name`,
    );
    return res.rows;
  } finally {
    await client.end();
  }
}

async function main() {
  const repo = loadRepoMigrations();
  const tracker = await loadTracker();

  const trackerByName = new Map(tracker.map((r) => [r.migration_name, r]));
  const repoByName = new Map(repo.map((m) => [m.name, m]));

  const missing: RepoMigration[] = []; // in repo, not in tracker
  const extra: TrackerRow[] = []; // in tracker, not in repo
  const checksumMismatch: { name: string; repo: string; tracker: string }[] =
    [];
  const rolledBack: TrackerRow[] = [];

  for (const m of repo) {
    const row = trackerByName.get(m.name);
    if (!row) {
      missing.push(m);
      continue;
    }
    if (row.checksum !== m.checksum) {
      checksumMismatch.push({
        name: m.name,
        repo: m.checksum,
        tracker: row.checksum,
      });
    }
    if (row.rolled_back_at !== null) {
      rolledBack.push(row);
    }
  }

  for (const row of tracker) {
    if (!repoByName.has(row.migration_name)) {
      extra.push(row);
    }
  }

  const ok =
    missing.length === 0 &&
    extra.length === 0 &&
    checksumMismatch.length === 0 &&
    rolledBack.length === 0;

  if (ok) {
    console.log(
      `[drift] ✓ ${repo.length} migrations in repo, all present in tracker with matching checksums.`,
    );
    process.exit(0);
  }

  console.error("[drift] ✗ migration tracker drift detected:\n");

  if (missing.length > 0) {
    console.error(
      `  ${missing.length} migration(s) in repo but NOT applied to this database:`,
    );
    for (const m of missing) {
      console.error(`    - ${m.name}`);
    }
    console.error(
      "\n    Fix: apply each via Supabase MCP `apply_migration`, then insert a row\n" +
        "    into _prisma_migrations with checksum = sha256(migration.sql).",
    );
  }

  if (extra.length > 0) {
    console.error(
      `\n  ${extra.length} migration(s) in tracker but NOT in repo (deleted?):`,
    );
    for (const r of extra) {
      console.error(`    - ${r.migration_name}`);
    }
    console.error(
      "\n    Fix: either restore the migration directory or, if intentionally\n" +
        "    removed, delete the tracker row.",
    );
  }

  if (checksumMismatch.length > 0) {
    console.error(
      `\n  ${checksumMismatch.length} migration(s) with checksum mismatch (file edited after apply?):`,
    );
    for (const m of checksumMismatch) {
      console.error(
        `    - ${m.name}\n      repo:    ${m.repo}\n      tracker: ${m.tracker}`,
      );
    }
    console.error(
      "\n    Fix: never edit a migration after applying it. If the change is\n" +
        "    needed, write a new migration.",
    );
  }

  if (rolledBack.length > 0) {
    console.error(`\n  ${rolledBack.length} migration(s) marked rolled back:`);
    for (const r of rolledBack) {
      console.error(`    - ${r.migration_name}`);
    }
  }

  process.exit(1);
}

main().catch((e) => {
  console.error("[drift] unexpected error:", e);
  process.exit(2);
});

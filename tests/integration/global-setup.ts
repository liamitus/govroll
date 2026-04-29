import { execSync } from "node:child_process";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";

let container: StartedPostgreSqlContainer | undefined;

export async function setup() {
  if (process.env.TEST_DATABASE_URL) {
    console.log("[integration] Reusing TEST_DATABASE_URL from environment");
  } else {
    console.log(
      "[integration] Starting Postgres 16 + pgvector testcontainer...",
    );
    // pgvector image bundles Postgres 16 with the `vector` extension
    // preinstalled. The bill-embedding migration runs `CREATE
    // EXTENSION IF NOT EXISTS vector` and vanilla postgres:16-alpine
    // doesn't ship the .control file.
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withDatabase("govroll_test")
      .withUsername("govroll")
      .withPassword("govroll")
      .start();
    process.env.TEST_DATABASE_URL = container.getConnectionUri();
    console.log(
      `[integration] Postgres ready on ${container.getHost()}:${container.getMappedPort(5432)}`,
    );
  }

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: "inherit",
  });
  console.log("[integration] Migrations applied");
}

export async function teardown() {
  if (container) {
    await container.stop();
    console.log("[integration] Postgres container stopped");
  }
}

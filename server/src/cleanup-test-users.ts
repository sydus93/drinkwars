/**
 * Reset helper: delete every anonymous player the transport auto-created
 * (`anon-*@drinkwars.local`). Deleting the auth user cascades its `users` row +
 * `team_members` (FK on delete cascade); resolved games' append-only rows stay.
 *
 *   Run:  npm run cleanup:test   (from server/)
 *
 * ⚠ This removes ALL anonymous players, including those in any active game —
 * run it between sessions / before a fresh class, not mid-round.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

try {
  const envPath = new URL("../.env", import.meta.url);
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  /* env may be supplied externally */
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in server/.env");
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Collect all matching ids first (don't mutate while paginating).
  const targets: { id: string; email: string }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    if (!data.users.length) break;
    for (const u of data.users) {
      if (u.email && /^anon-.*@drinkwars\.local$/.test(u.email)) targets.push({ id: u.id, email: u.email });
    }
    if (data.users.length < 1000) break;
  }

  console.log(`Found ${targets.length} anonymous test player(s) to remove.`);
  let deleted = 0;
  for (const u of targets) {
    const { error } = await db.auth.admin.deleteUser(u.id);
    if (error) console.warn(`  ! ${u.email}: ${error.message}`);
    else deleted++;
  }
  console.log(`Removed ${deleted}/${targets.length}. (Resolved games' append-only rows are kept by design.)`);
}

main().catch((e) => {
  console.error("cleanup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

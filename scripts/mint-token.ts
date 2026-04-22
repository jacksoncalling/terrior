/**
 * Mint a new Terroir API token.
 *
 * Usage:
 *   npx ts-node --skip-project scripts/mint-token.ts \
 *     --name "Claude Code dev" \
 *     --scopes read,write,synthesis
 *
 *   # Project-scoped (e.g. Matthias eoniq token):
 *   npx ts-node --skip-project scripts/mint-token.ts \
 *     --name "Matthias eoniq" \
 *     --scopes read,write \
 *     --project <project-uuid>
 *
 * Output:
 *   Prints the plaintext token once — copy it to .env.local or Render/Vercel env.
 *   The token is NOT stored in plaintext anywhere — only a SHA-256 hash goes to Supabase.
 *
 * Rotation:
 *   Run again with the same name to mint a replacement, then revoke the old token
 *   by setting revoked_at in Supabase:
 *     UPDATE api_tokens SET revoked_at = now() WHERE name = 'old token name';
 *
 * Required env vars (reads from .env.local or environment):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY  (needs INSERT on api_tokens — use service key for this script)
 *   SUPABASE_SERVICE_KEY           — preferred for script use (bypasses RLS)
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "crypto";
import { config } from "dotenv";
import { resolve } from "path";

// Script is run from terroir/ — .env.local is in the same directory
config({ path: resolve(process.cwd(), ".env.local") });

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

const name = getArg("--name");
const scopesRaw = getArg("--scopes") ?? "read";
const projectScope = getArg("--project") ?? null;

if (!name) {
  console.error("Usage: npx ts-node --skip-project scripts/mint-token.ts --name <name> [--scopes read,write,synthesis] [--project <uuid>]");
  process.exit(1);
}

const scopes = scopesRaw.split(",").map((s) => s.trim());

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const plaintext = randomBytes(32).toString("hex"); // 64-char hex token
  const hash = createHash("sha256").update(plaintext).digest("hex");

  const { data, error } = await supabase
    .from("api_tokens")
    .insert({
      name,
      token_hash: hash,
      scopes,
      project_scope: projectScope,
    })
    .select("id, name, scopes, project_scope, created_at")
    .single();

  if (error) {
    console.error("Failed to insert token:", error.message);
    process.exit(1);
  }

  console.log("\n✅ Token minted successfully\n");
  console.log("  Name:          ", data.name);
  console.log("  ID:            ", data.id);
  console.log("  Scopes:        ", data.scopes.join(", "));
  console.log("  Project scope: ", data.project_scope ?? "all projects");
  console.log("  Created at:    ", data.created_at);
  console.log("\n  PLAINTEXT TOKEN (copy now — not shown again):");
  console.log("\n  ", plaintext, "\n");
  console.log("  Add to .env.local:  TERROIR_API_TOKEN=" + plaintext);
  console.log("  Add to Render/Vercel env as TERROIR_API_TOKEN\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Bearer token authentication for /api/v1/ routes.
 *
 * Tokens are stored hashed (SHA-256) in the api_tokens table.
 * The consumer sends the plaintext token; we hash it on the way in and
 * compare against token_hash. Plaintext is never stored.
 *
 * Mint tokens with: npm run mint-token (scripts/mint-token.ts)
 */

import { createClient } from "@supabase/supabase-js";

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  if (!url || !key) throw new AuthError(401, "Auth not configured — missing Supabase env vars");
  return createClient(url, key);
}

export interface AuthContext {
  tokenId: string;
  name: string;
  scopes: string[];
  projectScope: string | null;
}

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function authenticate(authHeader: string | null): Promise<AuthContext> {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError(401, "Missing or malformed Authorization header");
  }

  const plaintext = authHeader.slice(7).trim();
  const hash = await sha256Hex(plaintext);

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .select("id, name, scopes, project_scope, revoked_at")
    .eq("token_hash", hash)
    .single();

  if (error || !data) {
    throw new AuthError(401, "Invalid token");
  }

  if (data.revoked_at) {
    throw new AuthError(401, "Token has been revoked");
  }

  return {
    tokenId: data.id,
    name: data.name,
    scopes: data.scopes as string[],
    projectScope: data.project_scope ?? null,
  };
}

export function assertScope(ctx: AuthContext, scope: string): void {
  if (!ctx.scopes.includes(scope)) {
    throw new AuthError(403, `Token does not have '${scope}' scope`);
  }
}

export function assertProject(ctx: AuthContext, projectId: string): void {
  if (ctx.projectScope !== null && ctx.projectScope !== projectId) {
    throw new AuthError(403, "Token is not authorised for this project");
  }
}

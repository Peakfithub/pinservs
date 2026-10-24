// One-step deploy used by the "Deploy Turnkey Store" GitHub action.
// 1. creates the private file bucket and the members database if they don't exist
// 2. deploys the store to Cloudflare Workers
// 3. sets the store's secrets from your GitHub repository secrets
// 4. writes the live store address into the shop (member/store-config.js)
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(APP, "..", "store-config.js");
const WRANGLER = join(APP, "node_modules", ".bin", "wrangler");
const BUCKET = "turnkey-site-files";
const KV_TITLE = "turnkey-store-data";
const env = process.env;

const output = (k, v) => env.GITHUB_OUTPUT && appendFileSync(env.GITHUB_OUTPUT, `${k}=${v}\n`);
const fail = (msg) => { console.error(`\n::error::${msg}`); process.exit(1); };

function wrangler(args, { allowFail = false } = {}) {
  const r = spawnSync(WRANGLER, args, { cwd: APP, encoding: "utf8", env: { ...env, CI: "true", WRANGLER_SEND_METRICS: "false" } });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  if (r.status !== 0 && !allowFail) fail(`wrangler ${args.join(" ")} failed:\n${out.trim()}`);
  return { ok: r.status === 0, out, stdout: r.stdout || "" };
}
const jsonFrom = (text) => {
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  if (a < 0 || b < a) return [];
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return []; }
};

// ---- 0. Required settings ----
if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
  console.log("::notice::Store not deployed: add the CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID repository secrets, then run this action again.");
  output("skipped", "true");
  process.exit(0);
}
const missing = ["ADMIN_EMAIL", "ADMIN_PASSWORD", "STRIPE_SECRET_KEY"].filter((k) => !env[k]);
if (missing.length) fail(`Add these repository secrets first: ${missing.join(", ")}.`);
if (env.ADMIN_PASSWORD.length < 12) fail("ADMIN_PASSWORD must be at least 12 characters.");
if (!/^(sk|rk)_(test|live)_/.test(env.STRIPE_SECRET_KEY)) fail("STRIPE_SECRET_KEY should start with sk_test_, sk_live_, rk_test_ or rk_live_.");

// ---- 1. Storage ----
console.log("Checking the private file bucket…");
const r2 = wrangler(["r2", "bucket", "create", BUCKET], { allowFail: true });
if (!r2.ok && !/already exists|already own/i.test(r2.out)) {
  if (/enable R2|10042/i.test(r2.out)) fail("Turn on R2 once in the Cloudflare dashboard (R2 Object Storage > Get started), then run this action again.");
  fail(`Couldn't create the file bucket:\n${r2.out.trim()}`);
}

console.log("Checking the members database…");
const findKv = () => jsonFrom(wrangler(["kv", "namespace", "list"]).stdout).find((n) => n.title === KV_TITLE || String(n.title).endsWith(KV_TITLE));
let kv = findKv();
if (!kv) { wrangler(["kv", "namespace", "create", KV_TITLE]); kv = findKv(); }
if (!kv) fail("Couldn't find or create the members database (KV namespace).");
const tomlPath = join(APP, "wrangler.toml");
writeFileSync(tomlPath, readFileSync(tomlPath, "utf8").replace(/^id = ".*"$/m, `id = "${kv.id}"`));

// ---- 2. Deploy ----
console.log("Deploying the store…");
const dep = wrangler(["deploy"]);
const url = (dep.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i) || [])[0];
if (!url) fail("Deployed, but no workers.dev address was printed. In Cloudflare, open Workers & Pages once and choose your workers.dev subdomain, then run this action again.");

// ---- 3. Secrets ----
console.log("Setting secrets…");
const existing = jsonFrom(wrangler(["secret", "list"], { allowFail: true }).stdout).map((s) => s.name);
const secrets = { ADMIN_EMAIL: env.ADMIN_EMAIL, ADMIN_PASSWORD: env.ADMIN_PASSWORD, STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY };
if (env.STRIPE_WEBHOOK_SECRET) secrets.STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
if (!existing.includes("SIGNING_SECRET")) secrets.SIGNING_SECRET = randomBytes(32).toString("base64url"); // kept on later deploys
const tmp = join(APP, ".secrets.json");
try {
  writeFileSync(tmp, JSON.stringify(secrets), { mode: 0o600 });
  wrangler(["secret", "bulk", tmp]);
} finally {
  if (existsSync(tmp)) unlinkSync(tmp);
}

// ---- 4. Tell the shop where the store lives ----
writeFileSync(CONFIG, `// Written automatically by the "Deploy Turnkey Store" GitHub action.\nwindow.TURNKEY_STORE_URL = ${JSON.stringify(url)};\n`);
output("url", url);
console.log(`\nStore is live at ${url}\nAdmin dashboard: ${url}/admin/login`);
console.log(`::notice::Store is live at ${url} (admin: ${url}/admin/login)`);

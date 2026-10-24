// Shared helpers: crypto, tokens, passwords, cookies, escaping, storage keys.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const now = () => Math.floor(Date.now() / 1000);
export const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
export const normEmail = (e) => String(e || "").trim().toLowerCase();
export const validEmail = (e) => /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"']{2,}$/.test(e);

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ----- base64url -----
export const b64u = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// ----- signed tokens (sessions, access links) -----
async function hmacKey(secret) {
  if (!secret || secret.length < 16) throw new Error("SIGNING_SECRET missing or too short");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sign(env, payload) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env.SIGNING_SECRET), enc.encode(body));
  return `${body}.${b64u(sig)}`;
}

export async function verify(env, token, type) {
  const [body, sig, extra] = String(token || "").split(".");
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env.SIGNING_SECRET), unb64u(sig), enc.encode(body));
    if (!ok) return null;
    const data = JSON.parse(dec.decode(unb64u(body)));
    if (!data || data.t !== type || typeof data.x !== "number" || now() > data.x) return null;
    return data;
  } catch {
    return null;
  }
}

// ----- Stripe webhook signature -----
export async function verifyStripeSignature(secret, header, rawBody, toleranceSecs = 300) {
  if (!secret || !header) return false;
  const parts = {};
  const v1 = [];
  for (const kv of header.split(",")) {
    const [k, v] = kv.split("=");
    if (k === "t") parts.t = v;
    if (k === "v1") v1.push(v);
  }
  if (!parts.t || !v1.length || Math.abs(now() - Number(parts.t)) > toleranceSecs) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${parts.t}.${rawBody}`)));
  const a = enc.encode(expected);
  return v1.some((s) => {
    const b = enc.encode(s);
    return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
  });
}

// ----- passwords (PBKDF2-SHA256; Workers allow up to 100k iterations) -----
const PBKDF2_ITER = 100000;

export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? unb64u(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" }, key, 256);
  return { salt: b64u(salt), hash: b64u(bits), iter: PBKDF2_ITER };
}

export async function checkPassword(password, pw) {
  if (!pw) {
    await hashPassword(password); // same work either way, so timing doesn't reveal accounts
    return false;
  }
  const { hash } = await hashPassword(password, pw.salt);
  const a = enc.encode(hash), b = enc.encode(pw.hash);
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}

export async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

export const randomId = (n = 16) => b64u(crypto.getRandomValues(new Uint8Array(n)));

// ----- cookies -----
export const COOKIE = "tks";
export function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
export const sessionCookie = (token, maxAge) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// ----- files -----
export const ALLOWED = { pdf: "application/pdf", zip: "application/zip" };
export function safeFileName(name) {
  const base = String(name || "").split(/[\\/]/).pop().replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "").slice(0, 120).trim();
  const ext = (base.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase();
  return base && ALLOWED[ext] ? { name: base, ext, type: ALLOWED[ext] } : null;
}
export const fileKey = (site, name) => `files/${site}/${name}`;
export const fileExt = (name) => (name.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() || "";
export function fmtSize(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB";
  return Math.max(1, Math.round(b / 1024)) + " KB";
}

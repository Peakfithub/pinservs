// Data layer. Members and orders live in KV; files live in the private R2 bucket.
//   member:<email>   { email, sites[], pw|null, pwv, created, lastLogin }
//   order:<session>  { id, email, site, amount, currency, created, source }

import { SITES } from "./sites.js";
import { normEmail, now, fileKey } from "./util.js";

export async function getMember(env, email) {
  const raw = await env.DATA.get(`member:${normEmail(email)}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveMember(env, m) {
  await env.DATA.put(`member:${m.email}`, JSON.stringify(m));
  return m;
}

export function newMember(email) {
  return { email: normEmail(email), sites: [], pw: null, pwv: 0, created: now(), lastLogin: null };
}

export async function grant(env, email, site) {
  if (!SITES[site]) throw new Error("Unknown product");
  const m = (await getMember(env, email)) || newMember(email);
  if (!m.sites.includes(site)) m.sites.push(site);
  return saveMember(env, m);
}

export async function revoke(env, email, site) {
  const m = await getMember(env, email);
  if (!m) return null;
  m.sites = m.sites.filter((s) => s !== site);
  return saveMember(env, m);
}

export async function listMembers(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.DATA.list({ prefix: "member:", cursor });
    const vals = await Promise.all(page.keys.map((k) => env.DATA.get(k.name)));
    vals.forEach((v) => v && out.push(JSON.parse(v)));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out.sort((a, b) => b.created - a.created);
}

// Records a paid Stripe Checkout session once, and gives the buyer access.
export async function recordOrder(env, session, source) {
  const site = session.metadata && session.metadata.site;
  const email = normEmail(session.customer_details?.email || session.customer_email);
  if (!SITES[site] || !email) return null;
  const key = `order:${session.id}`;
  if (!(await env.DATA.get(key))) {
    await env.DATA.put(key, JSON.stringify({
      id: session.id, email, site,
      amount: session.amount_total ?? SITES[site].price,
      currency: session.currency || "usd",
      created: session.created || now(), source,
    }));
  }
  const m = await grant(env, email, site);
  return { email, site, member: m };
}

export async function listOrders(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.DATA.list({ prefix: "order:", cursor });
    const vals = await Promise.all(page.keys.map((k) => env.DATA.get(k.name)));
    vals.forEach((v) => v && out.push(JSON.parse(v)));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out.sort((a, b) => b.created - a.created);
}

export async function listFiles(env, site) {
  const out = [];
  let cursor;
  do {
    const page = await env.FILES.list({ prefix: `files/${site}/`, cursor, include: ["customMetadata", "httpMetadata"] });
    for (const o of page.objects) {
      out.push({ name: o.key.slice(`files/${site}/`.length), size: o.size, uploaded: o.uploaded.toISOString() });
    }
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export const getFile = (env, site, name) => env.FILES.get(fileKey(site, name));
export const putFile = (env, site, f, body) =>
  env.FILES.put(fileKey(site, f.name), body, { httpMetadata: { contentType: f.type } });
export const deleteFile = (env, site, name) => env.FILES.delete(fileKey(site, name));

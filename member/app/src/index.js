// Turnkey Store: sells your websites with Stripe Checkout, gives every buyer a
// member account, and serves their PDF and ZIP files from private storage.
//
// Buyer routes
//   GET  /buy/<site>                  start Stripe Checkout for one website
//   GET  /success?session_id=...      after payment: verify with Stripe, give access, set password
//   GET  /claim?token=...             access link from the owner: set or reset password
//   POST /claim                       save the password, sign in
//   GET  /login   POST /login         member sign in
//   POST /logout                      sign out
//   GET  /members                     member downloads
//   GET  /members/file/<site>/<name>  one file, only if the member owns <site>
// Stripe
//   POST /stripe/webhook              backup: records paid orders even if the buyer closes the tab
// Owner (password)
//   GET  /admin and /admin/api/...    dashboard: files, members, orders

import { SITES, CURRENCY } from "./sites.js";
import { adminRoute } from "./admin.js";
import { html, notice, loginPage, setPasswordPage, membersPage } from "./pages.js";
import { getMember, saveMember, newMember, recordOrder, listFiles, getFile } from "./store.js";
import {
  now, num, normEmail, validEmail, esc, sign, verify, verifyStripeSignature, hashPassword, checkPassword,
  readCookie, sessionCookie, clearCookie, COOKIE, safeFileName,
} from "./util.js";

const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;
const SESSION_DAYS = 14;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const m = request.method;
    try {
      // Every form post must come from this site
      if (m === "POST" && path !== "/stripe/webhook" && !path.startsWith("/admin")) {
        const origin = request.headers.get("Origin");
        if (origin && origin !== url.origin) return notice(env, "Request blocked", "That form didn't come from this site.", 403);
      }
      if (path === "/admin" || path.startsWith("/admin/")) return adminRoute(request, env, url, path);
      if (m === "GET" && path.startsWith("/buy/")) return buy(request, env, decodeURIComponent(path.slice(5)));
      if (m === "GET" && path === "/success") return success(request, env, url);
      if (m === "POST" && path === "/stripe/webhook") return webhook(request, env);
      if (path === "/claim") return m === "POST" ? claimPost(request, env) : claimGet(request, env, url);
      if (path === "/login") return m === "POST" ? loginPost(request, env) : loginGet(request, env, url);
      if (m === "POST" && path === "/logout") return redirect("/login?out=1", { "Set-Cookie": clearCookie() });
      if (m === "GET" && path === "/members") return members(request, env, url);
      if (m === "GET" && path.startsWith("/members/file/")) return memberFile(request, env, path);
      if (path === "/") return redirect("/members");
      return notice(env, "Page not found", "That page doesn't exist.", 404, await currentMember(request, env));
    } catch (err) {
      console.error(err);
      return notice(env, "Something went wrong", "Please try again in a minute. If you already paid, your purchase is safe.", 500);
    }
  },
};

// ---------- Checkout ----------

async function buy(request, env, siteId) {
  const site = SITES[siteId];
  if (!site) return notice(env, "Not for sale", "That website isn't in the shop.", 404);
  const origin = new URL(request.url).origin;
  const form = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": CURRENCY,
    "line_items[0][price_data][unit_amount]": String(site.price),
    "line_items[0][price_data][product_data][name]": `${site.name} website`,
    "metadata[site]": siteId,
    "payment_intent_data[metadata][site]": siteId,
    success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: env.SHOP_URL,
  });
  const res = await stripe(env, "POST", "/v1/checkout/sessions", form);
  if (!res.ok) {
    console.error("Stripe create session failed", res.status, await res.text());
    return notice(env, "Checkout unavailable", "Checkout isn't available right now. No payment was taken. Please try again shortly.", 502);
  }
  return Response.redirect((await res.json()).url, 303);
}

// Fetch a checkout session from Stripe and confirm it is paid, recent and for a real product.
async function paidSession(env, sessionId) {
  if (!SESSION_RE.test(sessionId || "")) return { error: [400, "Invalid link", "Open the link from your purchase, or contact the seller."] };
  const res = await stripe(env, "GET", `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (!res.ok) return { error: [404, "Purchase not found", "We couldn't find that purchase. Contact the seller with your receipt."] };
  const s = await res.json();
  if (s.payment_status !== "paid" || !SITES[s.metadata && s.metadata.site]) {
    return { error: [402, "Payment not complete", "Stripe hasn't confirmed this payment yet. If you just paid, wait a moment and refresh."] };
  }
  if (now() - s.created > num(env.SUCCESS_WINDOW_DAYS, 7) * 86400) {
    return { error: [410, "Link expired", "This purchase link has expired. Sign in to your member area, or ask the seller for an access link."] };
  }
  return { session: s };
}

async function success(request, env, url) {
  const sessionId = url.searchParams.get("session_id") || "";
  const { session, error } = await paidSession(env, sessionId);
  if (error) return notice(env, error[1], error[2], error[0]);
  const rec = await recordOrder(env, session, "success page");
  if (!rec) return notice(env, "Almost there", "Your payment went through, but we couldn't read your email from Stripe. Contact the seller with your receipt.", 500);
  const siteName = SITES[rec.site].name;
  const current = await currentMember(request, env);

  if (current && current.email === rec.email) return redirect("/members?bought=" + encodeURIComponent(rec.site));
  if (!rec.member.pw) {
    return setPasswordPage(env, {
      heading: `Payment confirmed. ${siteName} is yours.`,
      intro: `Create a password for your member area. You'll sign in with <b>${esc(rec.email)}</b> to download your files any time.`,
      hidden: { session_id: sessionId },
      email: rec.email,
    });
  }
  return html("Payment confirmed", `<main class="col"><div class="card">
    <p class="eyebrow">Payment confirmed</p><h1>${esc(siteName)} is in your member area</h1>
    <p>You already have an account as <b>${esc(rec.email)}</b>. Sign in to download your files.</p>
    <p><a class="btn" href="/login?email=${encodeURIComponent(rec.email)}">Sign in to download</a></p></div></main>`, { env });
}

async function webhook(request, env) {
  const raw = await request.text();
  const ok = await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, request.headers.get("Stripe-Signature"), raw);
  if (!ok) return new Response("Bad signature", { status: 400 });
  const event = JSON.parse(raw);
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const s = event.data.object;
    if (s.payment_status === "paid") await recordOrder(env, s, "webhook");
  }
  return new Response("ok");
}

// ---------- Passwords ----------

async function claimGet(request, env, url) {
  const token = url.searchParams.get("token") || "";
  const t = await verify(env, token, "s");
  if (!t || (await env.DATA.get(`used:${t.n}`))) return notice(env, "Link not valid", "This access link has expired or was already used. Ask the seller for a new one.", 410);
  const member = await getMember(env, t.e);
  if (!member) return notice(env, "Link not valid", "This account no longer exists. Contact the seller.", 410);
  return setPasswordPage(env, {
    heading: member.pw ? "Choose a new password" : "Create your member password",
    intro: "Set a password, then you'll go straight to your downloads.",
    hidden: { token },
    email: member.email,
  });
}

async function claimPost(request, env) {
  const f = await request.formData();
  const password = String(f.get("password") || "");
  const confirm = String(f.get("confirm") || "");
  const sessionId = String(f.get("session_id") || "");
  const token = String(f.get("token") || "");

  let email, tokenData = null;
  if (token) {
    tokenData = await verify(env, token, "s");
    if (!tokenData || (await env.DATA.get(`used:${tokenData.n}`))) return notice(env, "Link not valid", "This access link has expired or was already used. Ask the seller for a new one.", 410);
    email = tokenData.e;
  } else {
    const { session, error } = await paidSession(env, sessionId);
    if (error) return notice(env, error[1], error[2], error[0]);
    email = normEmail(session.customer_details?.email || session.customer_email);
  }
  let member = await getMember(env, email);
  if (!member) {
    if (token) return notice(env, "Link not valid", "This account no longer exists. Contact the seller.", 410);
    member = newMember(email);
  }
  // A purchase link can create a password once. Changing an existing one needs an access link from the owner.
  if (!token && member.pw) return redirect("/login?email=" + encodeURIComponent(email));

  const hidden = token ? { token } : { session_id: sessionId };
  const again = (error) => setPasswordPage(env, { heading: "Create your member password", intro: "Set a password, then you'll go straight to your downloads.", hidden, email, error, status: 400 });
  if (password.length < 8) return again("Use at least 8 characters.");
  if (password.length > 200) return again("Use 200 characters or fewer.");
  if (password !== confirm) return again("The two passwords don't match. Type them again.");

  member.pw = await hashPassword(password);
  member.pwv = (member.pwv || 0) + 1; // signs out any older sessions
  member.lastLogin = now();
  await saveMember(env, member);
  if (tokenData) await env.DATA.put(`used:${tokenData.n}`, "1", { expirationTtl: 4 * 86400 });
  return startSession(env, member, "/members?welcome=1");
}

// ---------- Sign in ----------

async function loginGet(request, env, url) {
  if (await currentMember(request, env)) return redirect("/members");
  return loginPage(env, { email: url.searchParams.get("email") || "", info: url.searchParams.get("out") ? "You're signed out." : "" });
}

async function loginPost(request, env) {
  const f = await request.formData();
  const email = normEmail(f.get("email"));
  const password = String(f.get("password") || "");
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const rlKey = `rl:${ip}`;
  const tries = Number((await env.DATA.get(rlKey)) || 0);
  if (tries >= 10) return loginPage(env, { email, error: "Too many attempts. Wait 15 minutes, then try again.", status: 429 });

  const member = validEmail(email) ? await getMember(env, email) : null;
  const ok = await checkPassword(password, member && member.pw);
  if (!ok) {
    await env.DATA.put(rlKey, String(tries + 1), { expirationTtl: 900 });
    return loginPage(env, { email, error: "That email and password don't match. Check both and try again.", status: 401 });
  }
  member.lastLogin = now();
  await saveMember(env, member);
  return startSession(env, member, "/members");
}

async function startSession(env, member, to) {
  const token = await sign(env, { t: "m", e: member.email, v: member.pwv, x: now() + SESSION_DAYS * 86400 });
  return redirect(to, { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) });
}

async function currentMember(request, env) {
  const data = await verify(env, readCookie(request, COOKIE), "m");
  if (!data) return null;
  const member = await getMember(env, data.e);
  return member && member.pw && member.pwv === data.v ? member : null;
}

// ---------- Member area ----------

async function members(request, env, url) {
  const member = await currentMember(request, env);
  if (!member) return redirect("/login");
  const products = await Promise.all(member.sites.filter((s) => SITES[s]).map(async (id) => ({ id, files: await listFiles(env, id) })));
  const bought = url.searchParams.get("bought");
  const flash = url.searchParams.get("welcome") ? "Your password is set. Your files are below."
    : bought && SITES[bought] ? `${SITES[bought].name} has been added to your downloads.` : "";
  return membersPage(env, member, products, flash);
}

async function memberFile(request, env, path) {
  const member = await currentMember(request, env);
  if (!member) return redirect("/login");
  const [, site, name] = path.slice("/members/file/".length).match(/^([^/]+)\/(.+)$/) || [];
  const siteId = site ? decodeURIComponent(site) : "";
  const fileName = name ? decodeURIComponent(name) : "";
  const f = safeFileName(fileName);
  if (!SITES[siteId] || !member.sites.includes(siteId) || !f || f.name !== fileName) {
    return notice(env, "No access", "This file isn't part of your purchases.", 403, member);
  }
  const obj = await getFile(env, siteId, fileName);
  if (!obj) return notice(env, "File not found", "This file was removed or replaced. Go back to your downloads for the current files.", 404, member);
  const headers = new Headers({
    "Content-Type": f.type,
    "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (obj.size) headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { headers });
}

// ---------- Helpers ----------

function stripe(env, method, path, body) {
  return fetch((env.STRIPE_API_BASE || "https://api.stripe.com") + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ? body.toString() : undefined,
  });
}

function redirect(to, headers = {}) {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store", ...headers } });
}

// HTML for buyer-facing pages: layout, sign in, set password, member downloads.

import { SITES } from "./sites.js";
import { esc, fmtSize, fileExt } from "./util.js";

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap">`;

export const CSS = `
/* Layout: the shop's showroom look carried into a quiet locker room. Narrow column, one card per purchase, files as rows. */
:root{
  --bg:#eef1f4;--surface:#fff;--ink:#142030;--muted:#566273;--line:#d6dce3;--soft:#f6f8fa;
  --tag:#f2a900;--tag-ink:#1d1500;--accent:#1d5fd1;--ok:#1d7a4c;--bad:#b3261e;--pdf:#b3261e;--zip:#1d5fd1;
  --f-display:"Bricolage Grotesque","Avenir Next",system-ui,sans-serif;
  --f-body:"Figtree",system-ui,-apple-system,"Segoe UI",sans-serif;
  --f-mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;
  color-scheme:light}
@media (prefers-color-scheme:dark){:root{
  --bg:#0f151d;--surface:#17202b;--ink:#e7edf4;--muted:#9aa7b6;--line:#2a3644;--soft:#1c2632;
  --tag:#f5b82a;--accent:#7aa8ff;--ok:#5fd39a;--bad:#ff8b80;--pdf:#ff8b80;--zip:#7aa8ff;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 var(--f-body)}
a{color:var(--accent)}
:focus-visible{outline:3px solid var(--tag);outline-offset:2px}
h1,h2,h3{font-family:var(--f-display);line-height:1.1;margin:0;text-wrap:balance}
h1{font-size:clamp(1.9rem,5vw,2.6rem);font-weight:800;letter-spacing:-.01em}
h2{font-size:1.35rem;font-weight:800}
p{margin:0}
.eyebrow{font:600 .74rem var(--f-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.small{font-size:.9rem;color:var(--muted)}
header.top{border-bottom:1px solid var(--line);background:var(--bg)}
header.top{position:relative;z-index:20}
header.top .in{max-width:1080px;margin:0 auto;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{font:800 1.2rem var(--f-display);color:var(--ink);text-decoration:none;display:flex;align-items:center;gap:10px}
.brand i{width:13px;height:13px;border-radius:3px;background:var(--tag);transform:rotate(45deg)}
nav.links{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
nav.links a,nav.links button{font:500 .92rem var(--f-body);color:var(--muted);text-decoration:none;padding:8px 12px;border-radius:999px;background:none;border:0;cursor:pointer;min-height:40px}
nav.links a:hover,nav.links button:hover{color:var(--ink);background:var(--surface)}
nav.links form{margin:0;display:flex}
nav.links .inline{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.burger{display:none;position:relative}
.burger summary{list-style:none;display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:10px;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer}
.burger summary::-webkit-details-marker{display:none}
.burger summary svg{width:22px;height:22px}
.burger .x{display:none}
.burger[open] .bars{display:none}
.burger[open] .x{display:block}
.burger .panel{position:absolute;right:0;top:calc(100% + 8px);z-index:30;min-width:220px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:8px;display:grid;gap:2px;box-shadow:0 16px 40px -12px rgba(10,20,35,.35)}
.burger .panel a,.burger .panel button{display:flex;width:100%;text-align:left;border-radius:8px;padding:12px 14px;min-height:44px;color:var(--ink);font-size:1rem}
.burger .panel form{display:block}
@media (max-width:640px){nav.links .inline{display:none}.burger{display:block}}
main.col{max-width:720px;margin:0 auto;padding-inline:16px;padding-block:48px 72px;display:grid;gap:24px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:24px;display:grid;gap:16px;min-width:0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--tag);color:var(--tag-ink);font:700 1rem var(--f-body);text-decoration:none;border:0;border-radius:8px;padding:12px 18px;cursor:pointer;min-height:44px}
.btn.dark{background:var(--ink);color:var(--bg)}
.btn.ghost{background:transparent;color:var(--ink);border:1.5px solid var(--line)}
form.stack{display:grid;gap:14px}
label{display:grid;gap:4px;font-size:.88rem;font-weight:600}
input[type=email],input[type=password],input[type=text],select{font:inherit;font-weight:400;width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:8px;background:var(--soft);color:var(--ink);min-height:44px}
.alert{border-radius:8px;padding:12px 14px;font-size:.92rem;background:var(--soft);border:1px solid var(--line)}
.alert.bad{color:var(--bad);border-color:currentColor}
.alert.ok{color:var(--ok);border-color:currentColor}
.files{list-style:none;margin:0;padding:0;display:grid;border-top:1px solid var(--line)}
.files li{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)}
.files li>div{min-width:0}
.fname{font-weight:600;overflow-wrap:anywhere}
.badge{font:600 .68rem var(--f-mono);letter-spacing:.06em;border:1.5px solid currentColor;border-radius:4px;padding:2px 6px}
.badge.pdf{color:var(--pdf)}.badge.zip{color:var(--zip)}
.dl{font:700 .9rem var(--f-body);text-decoration:none;color:var(--ink);border:1.5px solid var(--line);border-radius:8px;padding:8px 12px;min-height:40px;display:inline-flex;align-items:center;white-space:nowrap}
.dl:hover{border-color:var(--ink)}
.empty{color:var(--muted);font-size:.95rem;padding:12px 0;border-top:1px solid var(--line)}
@media (max-width:520px){.files li{grid-template-columns:auto 1fr}.files li .dl{grid-column:1/-1;justify-content:center}}
`;

const SEC_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
};

export function html(title, body, { status = 200, member = null, env, headers = {}, script = false, extraCss = "", navHtml = null } = {}) {
  const shop = env?.SHOP_URL || "/";
  const items = navHtml != null ? navHtml : `<a href="${esc(shop)}">Shop</a>` + (member
    ? `<a href="/members">My downloads</a><form method="post" action="/logout"><button type="submit">Sign out</button></form>`
    : `<a href="/login">Member sign in</a>`);
  const nav = `<div class="inline">${items}</div><details class="burger"><summary aria-label="Menu"><svg class="bars" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><svg class="x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></summary><div class="panel">${items}</div></details>`;
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex">${FONTS}<style>${CSS}${extraCss}</style></head><body>
<header class="top"><div class="in"><a class="brand" href="${esc(shop)}"><i aria-hidden="true"></i>Turnkey Site Shop</a><nav class="links" aria-label="Account">${nav}</nav></div></header>
${body}</body></html>`;
  const csp = `default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'${script ? "; script-src 'unsafe-inline'; connect-src 'self'" : ""}`;
  return new Response(doc, { status, headers: { ...SEC_HEADERS, "Content-Security-Policy": csp, ...headers } });
}

export const notice = (env, title, msg, status, member) =>
  html(title, `<main class="col"><div class="card"><h1>${esc(title)}</h1><p>${msg}</p><p><a href="${esc(env.SHOP_URL)}">Back to the shop</a></p></div></main>`, { status, env, member });

export function loginPage(env, { email = "", error = "", info = "", status = 200 } = {}) {
  return html("Member sign in", `<main class="col">
  <div class="card">
    <p class="eyebrow">Members</p>
    <h1>Sign in to your downloads</h1>
    ${error ? `<p class="alert bad" role="alert">${esc(error)}</p>` : ""}${info ? `<p class="alert ok" role="status">${esc(info)}</p>` : ""}
    <form class="stack" method="post" action="/login">
      <label for="email">Email used at checkout<input id="email" name="email" type="email" autocomplete="email" required value="${esc(email)}"></label>
      <label for="password">Password<input id="password" name="password" type="password" autocomplete="current-password" required minlength="8"></label>
      <button class="btn dark" type="submit">Sign in</button>
    </form>
    <p class="small">First time here? Your account is created when you buy. You set your password on the page you see right after payment. Lost it? Ask the seller for a new access link.</p>
  </div></main>`, { env, status });
}

export function setPasswordPage(env, { heading, intro, hidden, email, error = "", status = 200 }) {
  const inputs = Object.entries(hidden).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
  return html("Create your password", `<main class="col">
  <div class="card">
    <p class="eyebrow">Member access</p>
    <h1>${esc(heading)}</h1>
    <p>${intro}</p>
    ${error ? `<p class="alert bad" role="alert">${esc(error)}</p>` : ""}
    <form class="stack" method="post" action="/claim">
      ${inputs}
      <label for="em">Email<input id="em" type="email" value="${esc(email)}" readonly autocomplete="username"></label>
      <label for="pw">New password (8 characters or more)<input id="pw" name="password" type="password" autocomplete="new-password" required minlength="8"></label>
      <label for="pw2">Repeat password<input id="pw2" name="confirm" type="password" autocomplete="new-password" required minlength="8"></label>
      <button class="btn" type="submit">Create password and open downloads</button>
    </form>
  </div></main>`, { env, status });
}

export function membersPage(env, member, products, flash = "") {
  const cards = products.length
    ? products.map(({ id, files }) => {
        const site = SITES[id];
        const list = files.length
          ? `<ul class="files">${files.map((f) => {
              const ext = fileExt(f.name);
              return `<li><span class="badge ${ext}">${ext.toUpperCase()}</span>
                <div><p class="fname">${esc(f.name)}</p><p class="small">${fmtSize(f.size)} · added ${esc(f.uploaded.slice(0, 10))}</p></div>
                <a class="dl" href="/members/file/${encodeURIComponent(id)}/${encodeURIComponent(f.name)}">Download</a></li>`;
            }).join("")}</ul>`
          : `<p class="empty">Files coming soon. They'll appear here as soon as the seller uploads them.</p>`;
        return `<section class="card" aria-labelledby="p-${esc(id)}"><div><p class="eyebrow">Purchased website</p><h2 id="p-${esc(id)}">${esc(site ? site.name : id)}</h2></div>${list}</section>`;
      }).join("")
    : `<div class="card"><h2>No purchases yet</h2><p class="small">When you buy a website, its files show up here.</p><p><a class="btn" href="${esc(env.SHOP_URL)}">Browse the shop</a></p></div>`;
  return html("My downloads", `<main class="col">
    <div><p class="eyebrow">Signed in as ${esc(member.email)}</p><h1>My downloads</h1></div>
    ${flash ? `<p class="alert ok" role="status">${esc(flash)}</p>` : ""}
    ${cards}
  </main>`, { env, member });
}

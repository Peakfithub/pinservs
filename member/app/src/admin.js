// Owner dashboard (password protected): files per product, members, orders.

import { SITES } from "./sites.js";
import { html } from "./pages.js";
import { sha256, safeFileName, normEmail, validEmail, sign, verify, randomId, now, esc, b64u } from "./util.js";
import { listMembers, listOrders, listFiles, getMember, grant, revoke, putFile, deleteFile, getFile } from "./store.js";

export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024; // Workers accept request bodies up to 100 MB on the free plan

// ---------- Admin sign-in ----------
// Username = ADMIN_EMAIL (wrangler.toml), password = ADMIN_PASSWORD (secret).
// A signed-in admin holds a signed cookie scoped to /admin that lasts 12 hours.
// Changing ADMIN_PASSWORD signs out every admin session.

const ADMIN_COOKIE = "tka";
const ADMIN_HOURS = 12;

async function passwordTag(env) {
  return b64u(await sha256(`${env.ADMIN_PASSWORD}|${env.SIGNING_SECRET}`)).slice(0, 12);
}

function readAdminCookie(request) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === ADMIN_COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

export async function authorized(request, env) {
  if (!env.ADMIN_PASSWORD || !env.ADMIN_EMAIL) return false;
  const data = await verify(env, readAdminCookie(request), "a");
  return !!data && data.e === normEmail(env.ADMIN_EMAIL) && data.v === (await passwordTag(env));
}

async function checkAdmin(env, email, password) {
  const [a, b, c, d] = await Promise.all([sha256(normEmail(email)), sha256(normEmail(env.ADMIN_EMAIL)), sha256(password), sha256(env.ADMIN_PASSWORD)]);
  const emailOk = crypto.subtle.timingSafeEqual(a, b);
  const passOk = crypto.subtle.timingSafeEqual(c, d);
  return emailOk && passOk;
}

function adminLoginPage(env, { email = "", error = "", info = "", status = 200 } = {}) {
  const ready = env.ADMIN_EMAIL && env.ADMIN_PASSWORD;
  return html("Owner sign in", `<main class="col">
  <div class="card">
    <p class="eyebrow">Owner only</p>
    <h1>Sign in to your dashboard</h1>
    ${!ready ? `<p class="alert bad" role="alert">Admin sign-in isn't set up yet. Set ADMIN_EMAIL in wrangler.toml and the ADMIN_PASSWORD secret, then deploy again.</p>` : ""}
    ${error ? `<p class="alert bad" role="alert">${esc(error)}</p>` : ""}${info ? `<p class="alert ok" role="status">${esc(info)}</p>` : ""}
    <form class="stack" method="post" action="/admin/login">
      <label for="a-email">Admin email<input id="a-email" name="email" type="email" autocomplete="username" required value="${esc(email)}"></label>
      <label for="a-pass">Password<input id="a-pass" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn dark" type="submit">Sign in</button>
    </form>
    <p class="small">Forgot the password? Set a new one with <code>npx wrangler secret put ADMIN_PASSWORD</code>. That also signs out every open admin session.</p>
  </div></main>`, { env, status, navHtml: `<a href="${esc(env.SHOP_URL)}">Shop</a>` });
}

const redirect = (to, headers = {}) =>
  new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store", ...headers } });

async function loginRoute(request, env, url, path) {
  if (request.method === "GET" && path === "/admin/login") {
    if (await authorized(request, env)) return redirect("/admin");
    return adminLoginPage(env, { info: url.searchParams.get("out") ? "You're signed out." : "" });
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return adminLoginPage(env, { error: "That form didn't come from this site.", status: 403 });

  if (path === "/admin/logout") {
    return redirect("/admin/login?out=1", { "Set-Cookie": `${ADMIN_COOKIE}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }

  // POST /admin/login
  const f = await request.formData();
  const email = String(f.get("email") || "");
  const password = String(f.get("password") || "");
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return adminLoginPage(env, { email, status: 503 });

  const rlKey = `rl:admin:${request.headers.get("CF-Connecting-IP") || "local"}`;
  const tries = Number((await env.DATA.get(rlKey)) || 0);
  if (tries >= 5) return adminLoginPage(env, { email, error: "Too many attempts. Wait 15 minutes, then try again.", status: 429 });

  if (!(await checkAdmin(env, email, password))) {
    await env.DATA.put(rlKey, String(tries + 1), { expirationTtl: 900 });
    return adminLoginPage(env, { email, error: "That email and password don't match. Check both and try again.", status: 401 });
  }
  await env.DATA.delete(rlKey);
  const token = await sign(env, { t: "a", e: normEmail(env.ADMIN_EMAIL), v: await passwordTag(env), x: now() + ADMIN_HOURS * 3600 });
  return redirect("/admin", { "Set-Cookie": `${ADMIN_COOKIE}=${token}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_HOURS * 3600}` });
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function adminRoute(request, env, url, path) {
  if (path === "/admin/login" || (path === "/admin/logout" && request.method === "POST")) return loginRoute(request, env, url, path);
  if (!(await authorized(request, env))) {
    if (path.startsWith("/admin/api/")) return json({ error: "Your sign-in expired. Reload the page and sign in again." }, 401);
    return redirect("/admin/login");
  }
  const m = request.method;
  if (m !== "GET") {
    const origin = request.headers.get("Origin");
    if (!origin || origin !== url.origin) return json({ error: "Blocked: request didn't come from your dashboard." }, 403);
  }

  if (m === "GET" && path === "/admin") return dashboard(env, url.origin);

  // Files: /admin/api/files/<site>/<name>
  const fm = path.match(/^\/admin\/api\/files\/([^/]+)(?:\/(.+))?$/);
  if (fm) {
    const site = decodeURIComponent(fm[1]);
    if (!SITES[site]) return json({ error: "Unknown product." }, 404);
    const name = fm[2] ? decodeURIComponent(fm[2]) : "";
    if (m === "PUT" && !name) {
      const f = safeFileName(request.headers.get("X-File-Name"));
      if (!f) return json({ error: "Only .pdf and .zip files can be uploaded." }, 400);
      const len = Number(request.headers.get("Content-Length") || 0);
      if (!len) return json({ error: "The file is empty." }, 400);
      if (len > MAX_UPLOAD_BYTES) return json({ error: "Over 95 MB. Upload this one in the Cloudflare dashboard (see the guide)." }, 413);
      await putFile(env, site, f, request.body);
      return json({ ok: true, name: f.name });
    }
    const f = safeFileName(name);
    if (!f || f.name !== name) return json({ error: "Unknown file." }, 404);
    if (m === "DELETE") { await deleteFile(env, site, name); return json({ ok: true }); }
    if (m === "GET") {
      const obj = await getFile(env, site, name);
      if (!obj) return json({ error: "Unknown file." }, 404);
      return new Response(obj.body, { headers: { "Content-Type": f.type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
    }
  }

  // Members
  if (m === "POST" && path.startsWith("/admin/api/members/")) {
    let body = {};
    try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
    const email = normEmail(body.email);
    if (!validEmail(email)) return json({ error: "Enter a valid email address." }, 400);
    const action = path.slice("/admin/api/members/".length);

    if (action === "grant") {
      if (!SITES[body.site]) return json({ error: "Choose a product." }, 400);
      await grant(env, email, body.site);
      return json({ ok: true });
    }
    if (action === "revoke") {
      await revoke(env, email, body.site);
      return json({ ok: true });
    }
    if (action === "link") {
      const member = await getMember(env, email);
      if (!member) return json({ error: "No member with that email." }, 404);
      const hours = 72;
      const token = await sign(env, { t: "s", e: email, n: randomId(), x: now() + hours * 3600 });
      return json({ ok: true, url: `${url.origin}/claim?token=${token}`, hours });
    }
    if (action === "delete") {
      await env.DATA.delete(`member:${email}`);
      return json({ ok: true });
    }
  }

  return json({ error: "Not found." }, 404);
}

async function dashboard(env, origin) {
  const [members, orders, products] = await Promise.all([
    listMembers(env),
    listOrders(env),
    Promise.all(Object.entries(SITES).map(async ([id, s]) => ({ id, name: s.name, price: s.price, files: await listFiles(env, id) }))),
  ]);
  const data = {
    origin,
    products,
    members: members.map((mm) => ({ email: mm.email, sites: mm.sites, hasPw: !!mm.pw, created: mm.created, lastLogin: mm.lastLogin })),
    orders,
  };
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  return html("Turnkey Store Admin", `<main class="wide">
  <div class="head"><div><p class="eyebrow">Owner dashboard</p><h1>Turnkey Store</h1></div>
  <nav class="tabs" role="tablist" aria-label="Dashboard sections">
    <button role="tab" id="t-overview" aria-controls="overview">Overview</button>
    <button role="tab" id="t-files" aria-controls="files">Files</button>
    <button role="tab" id="t-members" aria-controls="members">Members</button>
    <button role="tab" id="t-orders" aria-controls="orders">Orders</button>
  </nav></div>
  <section id="overview" role="tabpanel" aria-labelledby="t-overview"></section>
  <section id="files" role="tabpanel" aria-labelledby="t-files" hidden></section>
  <section id="members" role="tabpanel" aria-labelledby="t-members" hidden></section>
  <section id="orders" role="tabpanel" aria-labelledby="t-orders" hidden></section>
  </main>
  <script id="data" type="application/json">${payload}</script>
  <script>${CLIENT_JS.replace("__MAX__", String(MAX_UPLOAD_BYTES))}</script>`, { env, script: true, extraCss: ADMIN_CSS, navHtml: `<a href="/members">Member area</a><a href="${esc(env.SHOP_URL)}">Shop</a><form method="post" action="/admin/logout"><button type="submit">Sign out</button></form>` });
}

const ADMIN_CSS = `
[hidden]{display:none!important}
main.wide{max-width:1080px;margin:0 auto;padding-inline:16px;padding-block:32px 72px;display:grid;gap:24px}
.head{display:flex;justify-content:space-between;align-items:end;gap:16px;flex-wrap:wrap}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);overflow-x:auto}
.tabs button{font:600 .95rem var(--f-body);background:none;border:0;color:var(--muted);padding:10px 14px;margin-bottom:-1px;border-bottom:3px solid transparent;cursor:pointer;min-height:44px;white-space:nowrap}
.tabs button[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--ink)}
section[role=tabpanel]{display:grid;gap:18px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);background:var(--surface);border:1px solid var(--line);border-radius:12px}
.stats div{padding:18px;display:grid;gap:2px;min-width:0}
.stats div+div{border-left:1px solid var(--line)}
.stats b{font:800 2rem var(--f-display);font-variant-numeric:tabular-nums;line-height:1.1}
.stats span{font-size:.85rem;color:var(--muted)}
.todo{display:grid;gap:8px}
.todo li{font-size:.95rem}
.prod{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start}
.prod>div{min-width:0}
.buy{font:.8rem var(--f-mono);color:var(--muted);overflow-wrap:anywhere;user-select:all}
.uploader{display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:var(--soft);border:1.5px dashed var(--line);border-radius:10px;padding:14px}
.uploader input[type=file]{font:inherit;font-size:.9rem;max-width:100%;flex:1 1 220px}
.uploader.drag{border-color:var(--accent)}
.rowacts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.mini{font:600 .85rem var(--f-body);background:transparent;color:var(--ink);border:1.5px solid var(--line);border-radius:8px;padding:6px 10px;min-height:36px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;white-space:nowrap}
.mini:hover{border-color:var(--ink)}
.mini.danger{color:var(--bad)}
.mini.danger.armed{background:var(--bad);color:var(--surface);border-color:var(--bad)}
.msg{font-size:.88rem;color:var(--muted)}
.msg.err{color:var(--bad)}
.tablewrap{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:top}
th{font:600 .72rem var(--f-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
tr:last-child td{border-bottom:0}
td.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:4px;background:var(--soft);border:1px solid var(--line);border-radius:999px;padding:2px 4px 2px 10px;font-size:.84rem}
.chip button{background:none;border:0;color:var(--muted);cursor:pointer;font-size:1rem;line-height:1;padding:4px 6px;border-radius:999px}
.chip button:hover{color:var(--bad)}
.state{font:600 .72rem var(--f-mono);letter-spacing:.06em;text-transform:uppercase;border-radius:4px;padding:2px 6px;white-space:nowrap}
.state.on{color:var(--ok);border:1.5px solid currentColor}
.state.off{color:var(--muted);border:1.5px dashed currentColor}
.inline{display:flex;gap:8px;flex-wrap:wrap;align-items:end}
.inline label{flex:1 1 200px}
.cell select{min-height:36px;padding:6px 8px;font-size:.88rem;width:auto;flex:1 1 160px}
.cell{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center}
.linkout{display:grid;gap:6px;margin-top:8px;background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:10px}
.linkout code{font:.78rem var(--f-mono);overflow-wrap:anywhere;user-select:all}
@media (max-width:720px){.stats{grid-template-columns:1fr 1fr}.stats div:nth-child(3){border-left:0}.stats div:nth-child(n+3){border-top:1px solid var(--line)}.prod{grid-template-columns:1fr}}
`;

// Client script for the dashboard. Builds every element with textContent (no
// HTML strings from data), so names and emails can't inject markup.
const CLIENT_JS = String.raw`
(function(){
var D = JSON.parse(document.getElementById("data").textContent);
var MAX = __MAX__;
var NAMES = {}; D.products.forEach(function(p){ NAMES[p.id] = p.name; });

function el(tag, attrs){
  var n = document.createElement(tag);
  if (attrs) for (var k in attrs){
    var v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "text") n.textContent = v;
    else if (k === "class") n.className = v;
    else if (k.slice(0,2) === "on") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (var i = 2; i < arguments.length; i++){
    var c = arguments[i];
    if (c == null || c === false) continue;
    if (Array.isArray(c)) c.forEach(function(x){ if (x) n.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
    else n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return n;
}
function money(c){ return "$" + (c/100).toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2}); }
function size(b){ return b >= 1048576 ? (b/1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b/1024)) + " KB"; }
function day(s){ if (!s) return "Never"; var d = typeof s === "number" ? new Date(s*1000) : new Date(s); return d.toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric"}); }
function ext(n){ var m = /\.([A-Za-z0-9]+)$/.exec(n); return m ? m[1].toLowerCase() : ""; }

function api(path, method, body){
  return fetch(path, { method: method, headers: body ? {"Content-Type":"application/json"} : {}, body: body ? JSON.stringify(body) : undefined })
    .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){ if (!r.ok) throw new Error(d.error || ("Request failed (" + r.status + ")")); return d; }); });
}
function reloadTo(tab){ location.hash = tab; location.reload(); }
function confirmButton(label, armedLabel, run){
  var armed = false, t;
  var b = el("button", {type:"button", class:"mini danger", text:label});
  b.addEventListener("click", function(){
    if (!armed){ armed = true; b.classList.add("armed"); b.textContent = armedLabel; t = setTimeout(function(){ armed = false; b.classList.remove("armed"); b.textContent = label; }, 4000); return; }
    clearTimeout(t); b.disabled = true; run(b);
  });
  return b;
}
function copyBtn(getText){
  var b = el("button", {type:"button", class:"mini", text:"Copy"});
  b.addEventListener("click", function(){
    var done = function(){ b.textContent = "Copied"; setTimeout(function(){ b.textContent = "Copy"; }, 1500); };
    try { navigator.clipboard.writeText(getText()).then(done, function(){ b.textContent = "Select and copy"; }); } catch(e){ b.textContent = "Select and copy"; }
  });
  return b;
}

// ---- Tabs ----
var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
function show(id){
  tabs.forEach(function(t){ var on = t.getAttribute("aria-controls") === id; t.setAttribute("aria-selected", on); t.tabIndex = on ? 0 : -1; document.getElementById(t.getAttribute("aria-controls")).hidden = !on; });
}
tabs.forEach(function(t){ t.addEventListener("click", function(){ show(t.getAttribute("aria-controls")); history.replaceState(null, "", "#" + t.getAttribute("aria-controls")); }); });
show(["overview","files","members","orders"].indexOf(location.hash.slice(1)) >= 0 ? location.hash.slice(1) : "overview");

// ---- Overview ----
(function(){
  var revenue = D.orders.reduce(function(s,o){ return s + (o.amount || 0); }, 0);
  var missing = D.products.filter(function(p){ return !p.files.length; });
  var noPw = D.members.filter(function(m){ return !m.hasPw && m.sites.length; });
  var box = document.getElementById("overview");
  box.appendChild(el("div", {class:"stats"},
    el("div", null, el("b", {text: money(revenue)}), el("span", {text:"Revenue from Stripe orders"})),
    el("div", null, el("b", {text: String(D.orders.length)}), el("span", {text:"Orders"})),
    el("div", null, el("b", {text: String(D.members.length)}), el("span", {text:"Members"})),
    el("div", null, el("b", {text: String(D.products.reduce(function(s,p){ return s + p.files.length; }, 0))}), el("span", {text:"Files stored"}))
  ));
  var todo = [];
  missing.forEach(function(p){ todo.push(el("li", null, el("b", {text:p.name}), " has no files yet. Buyers can pay but will see \"Files coming soon\".")); });
  noPw.forEach(function(m){ todo.push(el("li", null, el("b", {text:m.email}), " hasn't created a password. Send them an access link from Members.")); });
  box.appendChild(el("div", {class:"card"}, el("h2", {text: todo.length ? "Needs attention" : "All set"}),
    todo.length ? el("ul", {class:"todo"}, todo) : el("p", {class:"small", text:"Every product has files and every member can sign in."})));
  var recent = D.orders.slice(0,5);
  box.appendChild(el("div", {class:"card"}, el("h2", {text:"Latest orders"}),
    recent.length ? el("ul", {class:"todo"}, recent.map(function(o){ return el("li", null, day(o.created) + " · " + (NAMES[o.site] || o.site) + " · " + money(o.amount) + " · " + o.email); }))
                  : el("p", {class:"small", text:"No orders yet. Paid Stripe checkouts appear here automatically."})));
})();

// ---- Files ----
(function(){
  var box = document.getElementById("files");
  box.appendChild(el("p", {class:"small", text:"Upload the PDF and ZIP files each buyer should get. Members who own a website see its files in their downloads right away."}));
  D.products.forEach(function(p){
    var input = el("input", {type:"file", id:"up-" + p.id, accept:".pdf,.zip,application/pdf,application/zip", multiple:true, "aria-label":"Choose PDF or ZIP files for " + p.name});
    var msg = el("p", {class:"msg", role:"status", "aria-live":"polite"});
    var go = el("button", {type:"button", class:"btn dark", text:"Upload"});
    var zone = el("div", {class:"uploader"}, input, go);
    function upload(files){
      files = Array.prototype.slice.call(files || []);
      if (!files.length){ msg.textContent = "Choose one or more .pdf or .zip files first."; msg.className = "msg err"; return; }
      var bad = files.filter(function(f){ return ["pdf","zip"].indexOf(ext(f.name)) < 0; });
      if (bad.length){ msg.textContent = bad[0].name + " isn't a PDF or ZIP."; msg.className = "msg err"; return; }
      var big = files.filter(function(f){ return f.size > MAX; });
      if (big.length){ msg.textContent = big[0].name + " is over 95 MB. Upload it in the Cloudflare dashboard instead."; msg.className = "msg err"; return; }
      go.disabled = true; msg.className = "msg";
      var i = 0;
      (function next(){
        if (i >= files.length){ msg.textContent = "Uploaded " + files.length + " file" + (files.length > 1 ? "s" : "") + "."; setTimeout(function(){ reloadTo("files"); }, 600); return; }
        var f = files[i];
        msg.textContent = "Uploading " + f.name + " (" + (i+1) + " of " + files.length + ")…";
        fetch("/admin/api/files/" + encodeURIComponent(p.id), { method:"PUT", body:f, headers:{"X-File-Name": f.name} })
          .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){ if (!r.ok) throw new Error(d.error || "Upload failed"); }); })
          .then(function(){ i++; next(); })
          .catch(function(e){ msg.textContent = f.name + ": " + e.message; msg.className = "msg err"; go.disabled = false; });
      })();
    }
    go.addEventListener("click", function(){ upload(input.files); });
    zone.addEventListener("dragover", function(e){ e.preventDefault(); zone.classList.add("drag"); });
    zone.addEventListener("dragleave", function(){ zone.classList.remove("drag"); });
    zone.addEventListener("drop", function(e){ e.preventDefault(); zone.classList.remove("drag"); upload(e.dataTransfer.files); });

    var buyUrl = D.origin + "/buy/" + p.id;
    var rows = p.files.length ? el("ul", {class:"files"}, p.files.map(function(f){
      var x = ext(f.name);
      var path = "/admin/api/files/" + encodeURIComponent(p.id) + "/" + encodeURIComponent(f.name);
      return el("li", null,
        el("span", {class:"badge " + x, text:x.toUpperCase()}),
        el("div", null, el("p", {class:"fname", text:f.name}), el("p", {class:"small", text: size(f.size) + " · uploaded " + day(f.uploaded)})),
        el("div", {class:"rowacts"},
          el("a", {class:"mini", href:path, text:"Download"}),
          confirmButton("Delete", "Confirm delete", function(b){ api(path, "DELETE").then(function(){ reloadTo("files"); }).catch(function(e){ b.disabled = false; msg.textContent = e.message; msg.className = "msg err"; }); })
        ));
    })) : el("p", {class:"empty", text:"No files yet."});
    box.appendChild(el("article", {class:"card"},
      el("div", {class:"prod"},
        el("div", null, el("p", {class:"eyebrow", text: money(p.price) + " · id " + p.id}), el("h2", {text:p.name}), el("p", {class:"buy", text:"Buy link: " + buyUrl})),
        copyBtn(function(){ return buyUrl; })),
      rows, zone, msg));
  });
})();

// ---- Members ----
(function(){
  var box = document.getElementById("members");
  var opts = function(){ return [el("option", {value:"", text:"Choose a website"})].concat(D.products.map(function(p){ return el("option", {value:p.id, text:p.name}); })); };

  var email = el("input", {type:"email", id:"new-email", placeholder:"buyer@example.com", autocomplete:"off"});
  var prod = el("select", {id:"new-prod"}, opts());
  var addMsg = el("p", {class:"msg", role:"status", "aria-live":"polite"});
  var add = el("form", {class:"inline", novalidate:true},
    el("label", {for:"new-email"}, "Buyer email", email),
    el("label", {for:"new-prod"}, "Website", prod),
    el("button", {type:"submit", class:"btn dark", text:"Give access"}));
  add.addEventListener("submit", function(e){
    e.preventDefault();
    if (!prod.value){ addMsg.textContent = "Choose a website."; addMsg.className = "msg err"; return; }
    api("/admin/api/members/grant", "POST", {email: email.value, site: prod.value}).then(function(){ reloadTo("members"); }).catch(function(err){ addMsg.textContent = err.message; addMsg.className = "msg err"; });
  });
  box.appendChild(el("div", {class:"card"}, el("h2", {text:"Add a member"}),
    el("p", {class:"small", text:"For buyers who paid outside Stripe, like an accepted offer. Then create an access link so they can set a password."}), add, addMsg));

  if (!D.members.length){ box.appendChild(el("div", {class:"card"}, el("p", {class:"small", text:"No members yet. Buyers become members automatically when a Stripe payment succeeds."}))); return; }

  var tbody = el("tbody");
  D.members.forEach(function(m){
    var msg = el("p", {class:"msg", role:"status", "aria-live":"polite"});
    var out = el("div");
    var sel = el("select", {"aria-label":"Add a website for " + m.email}, opts());
    var chips = el("div", {class:"chips"}, m.sites.length ? m.sites.map(function(s){
      return el("span", {class:"chip"}, NAMES[s] || s, el("button", {type:"button", "aria-label":"Remove " + (NAMES[s] || s) + " from " + m.email, text:"×", onclick:function(){
        api("/admin/api/members/revoke", "POST", {email:m.email, site:s}).then(function(){ reloadTo("members"); }).catch(function(e){ msg.textContent = e.message; msg.className = "msg err"; });
      }}));
    }) : el("span", {class:"small", text:"No websites"}));
    var addBtn = el("button", {type:"button", class:"mini", text:"Add", onclick:function(){
      if (!sel.value) return;
      api("/admin/api/members/grant", "POST", {email:m.email, site:sel.value}).then(function(){ reloadTo("members"); }).catch(function(e){ msg.textContent = e.message; msg.className = "msg err"; });
    }});
    var linkBtn = el("button", {type:"button", class:"mini", text: m.hasPw ? "Password reset link" : "Create access link", onclick:function(){
      api("/admin/api/members/link", "POST", {email:m.email}).then(function(d){
        out.textContent = "";
        var code = el("code", {text:d.url});
        out.appendChild(el("div", {class:"linkout"}, el("span", {class:"small", text:"Send this to " + m.email + ". It works once, for " + d.hours + " hours."}), code, copyBtn(function(){ return d.url; })));
      }).catch(function(e){ msg.textContent = e.message; msg.className = "msg err"; });
    }});
    var del = confirmButton("Remove", "Confirm remove", function(b){
      api("/admin/api/members/delete", "POST", {email:m.email}).then(function(){ reloadTo("members"); }).catch(function(e){ b.disabled = false; msg.textContent = e.message; msg.className = "msg err"; });
    });
    tbody.appendChild(el("tr", null,
      el("td", null, el("b", {text:m.email}), el("p", {class:"small", text:"Joined " + day(m.created)})),
      el("td", null, chips, el("div", {class:"cell"}, sel, addBtn)),
      el("td", null, el("span", {class:"state " + (m.hasPw ? "on" : "off"), text: m.hasPw ? "Active" : "No password"}), el("p", {class:"small", text:"Last sign-in: " + day(m.lastLogin)})),
      el("td", null, el("div", {class:"rowacts"}, linkBtn, del), out, msg)));
  });
  box.appendChild(el("div", {class:"tablewrap"}, el("table", null,
    el("thead", null, el("tr", null, el("th", {text:"Member"}), el("th", {text:"Websites"}), el("th", {text:"Status"}), el("th", {text:"Actions"}))), tbody)));
})();

// ---- Orders ----
(function(){
  var box = document.getElementById("orders");
  if (!D.orders.length){ box.appendChild(el("div", {class:"card"}, el("p", {class:"small", text:"No orders yet. Each paid Stripe checkout is recorded here and gives the buyer access automatically."}))); return; }
  box.appendChild(el("div", {class:"tablewrap"}, el("table", null,
    el("thead", null, el("tr", null, el("th", {text:"Date"}), el("th", {text:"Buyer"}), el("th", {text:"Website"}), el("th", {text:"Amount"}), el("th", {text:"Stripe checkout"}))),
    el("tbody", null, D.orders.map(function(o){
      return el("tr", null, el("td", {class:"num", text:day(o.created)}), el("td", {text:o.email}), el("td", {text:NAMES[o.site] || o.site}), el("td", {class:"num", text:money(o.amount)}), el("td", null, el("code", {class:"buy", text:o.id})));
    })))));
})();
})();
`;

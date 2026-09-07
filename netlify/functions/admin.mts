import type { Context } from "@netlify/functions";
import { neon } from "@netlify/neon";
import { eur, esc, json } from "../lib/catalogue.mts";

// Tableau de bord des commandes, protege par un jeton.
//   GET  /api/admin?token=XXX          -> la page
//   GET  /api/admin?token=XXX&json=1   -> les commandes en JSON (pour les notifs)
//   POST /api/admin  {token, order, status, tracking_number, tracking_url}
// ADMIN_TOKEN se definit dans les variables d'environnement Netlify.

const STATUSES = ["a_commander", "commandee", "expediee", "livree", "annulee", "remboursee"];
const LABELS: Record<string, string> = {
  a_commander: "À commander", commandee: "Commandée", expediee: "Expédiée",
  livree: "Livrée", annulee: "Annulée", remboursee: "Remboursée",
};

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function loadOrders(sql: any) {
  return await sql`
    select o.*, coalesce(json_agg(json_build_object(
      'name', i.product_name, 'variant', i.variant, 'quantity', i.quantity,
      'url', i.supplier_url, 'sku', i.supplier_sku
    ) order by i.id) filter (where i.id is not null), '[]') as items
    from orders o left join order_items i on i.order_id = o.id
    group by o.id order by o.order_number desc limit 100`;
}

export default async (req: Request, _ctx: Context) => {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return new Response("ADMIN_TOKEN non configuré", { status: 500 });

  const url = new URL(req.url);
  const sql = neon();

  // --- Mise a jour du statut / du suivi ---
  if (req.method === "POST") {
    let b: any;
    try { b = await req.json(); } catch { return json({ error: "Requête invalide." }, 400); }
    if (!safeEqual(String(b.token ?? ""), expected)) return json({ error: "Jeton invalide." }, 401);
    if (!STATUSES.includes(String(b.status))) return json({ error: "Statut inconnu." }, 400);

    await sql`
      update orders set
        status = ${b.status}::order_status,
        tracking_number = nullif(coalesce(${b.tracking_number ?? null}, tracking_number), ''),
        tracking_url = nullif(coalesce(${b.tracking_url ?? null}, tracking_url), ''),
        updated_at = now()
      where order_number = ${parseInt(String(b.order), 10)}`;
    return json({ ok: true });
  }

  const token = String(url.searchParams.get("token") ?? "");
  if (!safeEqual(token, expected)) return new Response("Jeton invalide", { status: 401 });

  // --- Flux JSON, interroge toutes les 30 s par la page pour les notifications ---
  if (url.searchParams.get("json")) {
    const orders = await loadOrders(sql);
    return json({
      orders: orders.map((o: any) => ({
        n: o.order_number, status: o.status, total: o.total_cents,
        city: o.ship_city, name: o.customer_name,
        created_at: o.created_at,
      })),
    });
  }

  // --- La page ---
  const orders = await loadOrders(sql);

  const rows = orders.map((o: any) => {
    const adresse = [
      o.customer_name, o.ship_line1, o.ship_line2,
      [o.ship_postal_code, o.ship_city].filter(Boolean).join(" "),
      o.ship_country, o.customer_phone,
    ].filter(Boolean).join("\n");

    const arts = (o.items as any[]).map((i) => `
      <div class="art">
        <div class="art-n">${i.quantity} × ${esc(i.name)}</div>
        ${i.variant ? `<div class="art-v">${esc(i.variant)}</div>` : ""}
        ${i.sku ? `<div class="art-s">Choisir : <b>${esc(i.sku)}</b></div>` : ""}
        ${i.url ? `<button class="go" data-url="${esc(i.url)}" data-addr="${esc(adresse)}">
            Copier l'adresse &amp; commander →</button>` : ""}
      </div>`).join("");

    return `<tr data-row="${o.order_number}">
      <td>
        <div class="num">n°${o.order_number}</div>
        <div class="date">${new Date(o.created_at).toLocaleString("fr-FR")}</div>
        <div class="st st-${o.status}">${LABELS[o.status] ?? o.status}</div>
      </td>
      <td>${arts}</td>
      <td>
        <pre>${esc(adresse)}</pre>
        <button class="copy" data-addr="${esc(adresse)}">Copier l'adresse</button>
        <div class="mail"><a href="mailto:${esc(o.customer_email)}">${esc(o.customer_email)}</a></div>
      </td>
      <td class="money">
        <div class="tot">${eur(o.total_cents)}</div>
        <div class="marge">marge ${eur(o.total_cents - o.cost_cents)}</div>
      </td>
      <td>
        <select data-order="${o.order_number}">
          ${STATUSES.map((st) => `<option value="${st}"${st === o.status ? " selected" : ""}>${LABELS[st]}</option>`).join("")}
        </select>
        <input data-track="${o.order_number}" placeholder="n° de suivi" value="${esc(o.tracking_number ?? "")}">
        <button class="save" data-save="${o.order_number}">Enregistrer</button>
      </td></tr>`;
  }).join("");

  const maxN = orders.length ? orders[0].order_number : 0;

  const html = `<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Carza — commandes</title>
<style>
:root{--ink:#131c17;--mute:#54635c;--line:#d3ddd8;--jade:#2b6a50;--paper:#f7f9f8}
*{box-sizing:border-box}
body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#eef1f0;margin:0;padding:20px;color:var(--ink)}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px;flex-wrap:wrap}
h1{font-weight:400;margin:0;font-size:26px}
.bell{border:1px solid var(--line);background:#fff;padding:9px 15px;border-radius:999px;cursor:pointer;font-size:13px}
.bell.on{background:var(--jade);color:#fff;border-color:var(--jade)}
.live{font-size:12px;color:var(--mute)}
table{width:100%;border-collapse:collapse;background:#fff;font-size:14px;box-shadow:0 1px 3px rgba(10,22,18,.08)}
th,td{padding:13px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{background:#0e1917;color:#eaf0ee;font-size:11px;letter-spacing:.14em;text-transform:uppercase}
.num{font-size:16px;font-weight:700}
.date{color:var(--mute);font-size:12px;margin-top:2px}
.st{display:inline-block;margin-top:7px;font-size:11px;padding:3px 9px;border-radius:999px;background:var(--paper);border:1px solid var(--line)}
.st-a_commander{background:#fdf1e3;border-color:#f0d5b0}
.st-expediee{background:#e6f2ec;border-color:#a9d4c0}
.st-livree{background:#e8ebff;border-color:#bcc4f0}
.art{padding-bottom:11px;margin-bottom:11px;border-bottom:1px dashed var(--line)}
.art:last-child{border:0;margin:0;padding:0}
.art-n{font-weight:600}
.art-v{color:var(--jade);font-weight:700;font-size:13px;margin-top:2px}
.art-s{color:var(--mute);font-size:12.5px;margin-top:2px}
pre{margin:0 0 8px;font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre-wrap;background:var(--paper);border:1px solid var(--line);padding:10px}
.mail{font-size:12.5px;margin-top:7px}
.mail a{color:var(--jade)}
.money{white-space:nowrap}
.tot{font-weight:700;font-size:15px}
.marge{color:var(--jade);font-size:12.5px;margin-top:3px}
select,input{padding:7px;margin-bottom:6px;width:100%;border:1px solid var(--line);border-radius:3px;font-size:13px}
button{border:0;cursor:pointer;border-radius:3px;font-size:13px;font-weight:600}
.go{background:#0e1917;color:#eaf0ee;padding:9px 13px;margin-top:8px;width:100%}
.copy{background:#fff;color:var(--ink);border:1px solid var(--line);padding:7px 11px;font-weight:500}
.save{background:var(--jade);color:#fff;padding:8px 12px;width:100%}
.new{animation:flash 2.4s ease}
@keyframes flash{0%,60%{background:#fff8dc}100%{background:transparent}}
@media(max-width:820px){table,thead,tbody,tr,td,th{display:block}th{display:none}
 tr{margin-bottom:14px;background:#fff}td{border:0;border-bottom:1px solid var(--line)}}
</style></head><body>

<header>
  <h1>Commandes</h1>
  <div style="display:flex;align-items:center;gap:12px">
    <span class="live" id="live">Actualisation toutes les 30 s</span>
    <button class="bell" id="bell">🔔 Activer les alertes</button>
  </div>
</header>

<table><thead><tr>
  <th>Commande</th><th>À commander</th><th>Livrer à</th><th>Montant</th><th>Suivi</th>
</tr></thead>
<tbody id="tb">${rows || '<tr><td colspan="5">Aucune commande pour le moment.</td></tr>'}</tbody></table>

<script>
const token = new URLSearchParams(location.search).get("token");
let lastMax = ${maxN};

/* --- Copier l'adresse, puis ouvrir la fiche fournisseur ------------------ */
async function copier(txt){
  try { await navigator.clipboard.writeText(txt); return true; }
  catch {
    const t = document.createElement("textarea");
    t.value = txt; document.body.appendChild(t); t.select();
    document.execCommand("copy"); t.remove(); return true;
  }
}
document.addEventListener("click", async (e) => {
  const go = e.target.closest(".go");
  if (go){
    await copier(go.dataset.addr);
    go.textContent = "Adresse copiée ✓";
    window.open(go.dataset.url, "_blank", "noopener");
    setTimeout(() => { go.textContent = "Copier l'adresse & commander →"; }, 2500);
    return;
  }
  const cp = e.target.closest(".copy");
  if (cp){
    await copier(cp.dataset.addr);
    cp.textContent = "Copiée ✓";
    setTimeout(() => { cp.textContent = "Copier l'adresse"; }, 1800);
    return;
  }
  const b = e.target.closest(".save");
  if (b){
    const n = b.dataset.save;
    b.disabled = true; b.textContent = "…";
    await fetch(location.pathname, { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ token, order:n,
        status: document.querySelector('[data-order="'+n+'"]').value,
        tracking_number: document.querySelector('[data-track="'+n+'"]').value || null }) });
    b.textContent = "Enregistré ✓";
    setTimeout(() => { b.disabled = false; b.textContent = "Enregistrer"; }, 1400);
  }
});

/* --- Alertes : son + notification systeme + titre d'onglet --------------- */
const bell = document.getElementById("bell");
function bellState(){
  const on = Notification.permission === "granted";
  bell.classList.toggle("on", on);
  bell.textContent = on ? "🔔 Alertes activées" : "🔔 Activer les alertes";
}
bell.addEventListener("click", async () => {
  if (Notification.permission !== "granted") await Notification.requestPermission();
  bellState(); bip();
});
if (window.Notification) bellState();

function bip(){
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination);
    o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(.0001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(.25, a.currentTime + .02);
    g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + .5);
    o.start(); o.stop(a.currentTime + .5);
  } catch {}
}

let enAttente = 0;
function marquer(n){
  enAttente += n;
  document.title = enAttente ? "(" + enAttente + ") Commandes — Carza" : "Carza — commandes";
}
window.addEventListener("focus", () => { enAttente = 0; marquer(0); });

/* --- Interrogation toutes les 30 s -------------------------------------- */
async function verifier(){
  try {
    const r = await fetch(location.pathname + "?json=1&token=" + encodeURIComponent(token));
    if (!r.ok) return;
    const d = await r.json();
    const nouvelles = d.orders.filter(o => o.n > lastMax);
    document.getElementById("live").textContent =
      "Dernière vérification à " + new Date().toLocaleTimeString("fr-FR");
    if (!nouvelles.length) return;

    lastMax = Math.max(...d.orders.map(o => o.n));
    bip(); marquer(nouvelles.length);

    if (Notification.permission === "granted"){
      nouvelles.forEach(o => {
        const n = new Notification("Nouvelle commande n°" + o.n, {
          body: (o.total/100).toFixed(2).replace(".", ",") + " € — " + (o.name || "") +
                (o.city ? " · " + o.city : ""),
          tag: "carza-" + o.n,
        });
        n.onclick = () => { window.focus(); n.close(); };
      });
    }
    // On recharge la page pour afficher la commande complete
    setTimeout(() => location.reload(), 1200);
  } catch {}
}
setInterval(verifier, 30000);
</script></body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
};

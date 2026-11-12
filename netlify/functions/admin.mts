// VipOptimizer — admin.mts (Netlify Blobs)
// GET  ?pw=...                 -> { orders, apps, collabs }
// GET  ?pw=...&check=CODE      -> vérifie un code
// POST ?pw=... (ou pw in body) -> actions collaborateurs :
//   {action:"accept", id}      -> accepte une demande, crée un lien d'affiliation
//   {action:"reject", id}      -> refuse une demande
//   {action:"free_code", ref}  -> génère un code gratuit pour un collaborateur
import { getStore } from "@netlify/blobs";

const ADMIN_PW = process.env.ADMIN_PASSWORD || "";
const SITE = (process.env.SITE_URL || "https://carza.fr").replace(/\/+$/, "");

function cors(extra: Record<string, string> = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    ...extra,
  };
}
function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: cors() });
}
const licenses = () => getStore({ name: "vip_licenses", consistency: "strong" });
const apps = () => getStore({ name: "vip_collab_apps", consistency: "strong" });
const collabs = () => getStore({ name: "vip_collabs", consistency: "strong" });

function genRef(): string {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += L[Math.floor(Math.random() * L.length)];
  return s;
}
function genCode(): string {
  const D = "0123456789", L = "ABCDEFGHJKLMNPQRSTUVWXYZ", a: string[] = [];
  for (let i = 0; i < 7; i++) a.push(D[Math.floor(Math.random() * D.length)]);
  for (let i = 0; i < 3; i++) a.push(L[Math.floor(Math.random() * L.length)]);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.join("");
}

async function listJson(store: any, skipPrefix?: string) {
  const out: any[] = [];
  const listed = await store.list();
  for (const b of (listed.blobs || [])) {
    if (skipPrefix && b.key.startsWith(skipPrefix)) continue;
    const v = await store.get(b.key, { type: "json" });
    if (v) out.push(v);
  }
  return out;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors() });

  const url = new URL(req.url);

  // ---------- ACTIONS (POST) ----------
  if (req.method === "POST") {
    const body: any = await req.json().catch(() => ({}));
    const pw = (body.pw || url.searchParams.get("pw") || "");
    if (!ADMIN_PW || pw !== ADMIN_PW) return json({ error: "unauthorized" }, 401);
    const action = body.action;

    if (action === "accept") {
      const a: any = await apps().get(body.id, { type: "json" });
      if (!a) return json({ error: "not_found" }, 404);
      let ref = genRef();
      for (let i = 0; i < 5; i++) { if (!(await collabs().get(ref, { type: "json" }))) break; ref = genRef(); }
      const col = {
        ref, name: a.name, discord: a.discord, followers: a.followers,
        type: "collab", status: "active", app_id: a.id, created_at: new Date().toISOString(),
      };
      await collabs().setJSON(ref, col);
      a.status = "accepted"; a.ref = ref;
      await apps().setJSON(a.id, a);
      return json({ ok: true, ref, link: `${SITE}/?ref=${ref}` });
    }

    if (action === "reject") {
      const a: any = await apps().get(body.id, { type: "json" });
      if (!a) return json({ error: "not_found" }, 404);
      a.status = "rejected";
      await apps().setJSON(a.id, a);
      return json({ ok: true });
    }

    if (action === "remove") {
      const ref = (body.ref || "").toString().trim().toUpperCase();
      if (!ref) return json({ error: "no_ref" }, 400);
      try { await collabs().delete(ref); } catch (e) { /* déjà absent */ }
      return json({ ok: true });
    }

    if (action === "free_code") {
      const ref = (body.ref || "").toString().trim().toUpperCase();
      const col: any = await collabs().get(ref, { type: "json" });
      if (!col) return json({ error: "not_found" }, 404);
      let code = genCode();
      for (let i = 0; i < 5; i++) { if (!(await licenses().get(code, { type: "text" }))) break; code = genCode(); }
      const lic = {
        code, session_id: "free_" + Date.now(), email: "", plan: "Offert (collab)", amount: 0,
        used: false, used_at: null, machine_id: null, ref, ref_name: col.name, free: true,
        created_at: new Date().toISOString(),
      };
      await licenses().setJSON(code, lic);
      return json({ ok: true, code });
    }

    return json({ error: "bad_action" }, 400);
  }

  // ---------- LECTURE (GET) ----------
  const pw = url.searchParams.get("pw") || "";
  if (!ADMIN_PW || pw !== ADMIN_PW) return json({ error: "unauthorized" }, 401);

  const check = url.searchParams.get("check");
  if (check) {
    const lic: any = await licenses().get(check.trim().toUpperCase(), { type: "json" });
    return json({ found: !!lic, order: lic || null });
  }

  const orders = (await listJson(licenses(), "sid:")).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const appsList = (await listJson(apps())).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const colList = await listJson(collabs());

  // calcul des gains par collaborateur (50% du CA)
  const colOut = colList.map((c: any) => {
    const type = c.type || "collab";
    const sales = orders.filter((o: any) => o.ref === c.ref && o.amount > 0);
    const revenue = sales.reduce((s: number, o: any) => s + (o.amount || 0), 0);
    return {
      ref: c.ref, name: c.name, discord: c.discord, followers: c.followers,
      type, status: c.status,
      link: `${SITE}/?ref=${c.ref}`,
      sales_count: sales.length,
      revenue: Math.round(revenue * 100) / 100,
      commission: type === "collab" ? Math.round(revenue * 50) / 100 : 0,   // 50% (collab only)
      free_code_earned: sales.length >= 2,
      reward_code: c.reward_code || null,   // code offert auto-généré à la 2e vente
      created_at: c.created_at,
    };
  }).sort((a, b) => b.sales_count - a.sales_count);

  return json({ orders, apps: appsList, collabs: colOut });
};

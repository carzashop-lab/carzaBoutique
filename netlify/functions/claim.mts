// VipOptimizer — claim.mts (stockage Netlify Blobs, pas de base externe)
// merci.html l'appelle apres paiement : verifie Stripe, cree UN vrai code, le stocke, le renvoie.
// GET /.netlify/functions/claim?session_id=cs_...
import { getStore } from "@netlify/blobs";

const STRIPE = process.env.STRIPE_SECRET_KEY || "";

function cors(extra: Record<string, string> = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    ...extra,
  };
}
function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: cors() });
}
function store() {
  return getStore({ name: "vip_licenses", consistency: "strong" });
}
function genCode(): string {
  const D = "0123456789";
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const a: string[] = [];
  for (let i = 0; i < 7; i++) a.push(D[Math.floor(Math.random() * D.length)]);
  for (let i = 0; i < 3; i++) a.push(L[Math.floor(Math.random() * L.length)]);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.join("");
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors() });
  if (!STRIPE) return json({ error: "config" }, 500);

  const url = new URL(req.url);
  const sid = url.searchParams.get("session_id");
  if (!sid || !sid.startsWith("cs_")) return json({ error: "no_session" }, 400);

  const s = store();

  // 1) deja un code pour cette session ? (idempotent)
  const existing = await s.get("sid:" + sid, { type: "text" });
  if (existing) {
    const lic: any = await s.get(existing, { type: "json" });
    return json({ code: existing, plan: lic?.plan, reused: true });
  }

  // 2) verifier le paiement aupres de Stripe
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sid)}`, {
    headers: { Authorization: `Bearer ${STRIPE}` },
  });
  if (!r.ok) return json({ error: "stripe_unreachable" }, 502);
  const sess: any = await r.json();
  if (sess.payment_status !== "paid") return json({ error: "not_paid" }, 402);

  const email = sess.customer_details?.email || sess.customer_email || "";
  const amount = (sess.amount_total || 0) / 100;
  const plan = amount >= 24 ? "Pro" : "Standard";

  // parrain / collaborateur : passe via ?client_reference_id=REF dans le lien Stripe
  let ref = (sess.client_reference_id || "").toString().trim().toUpperCase();
  let ref_name = "";
  if (ref) {
    const col: any = await getStore({ name: "vip_collabs", consistency: "strong" }).get(ref, { type: "json" });
    if (col && col.status === "active") ref_name = col.name || "";
    else ref = ""; // ref inconnu/inactif -> on ignore
  }

  // 3) generer un code unique
  let code = genCode();
  for (let i = 0; i < 5; i++) {
    const clash = await s.get(code, { type: "text" });
    if (!clash) break;
    code = genCode();
  }

  const lic = {
    code, session_id: sid, email, plan, amount,
    used: false, used_at: null, machine_id: null,
    ref, ref_name,
    created_at: new Date().toISOString(),
  };
  await s.setJSON(code, lic);
  await s.set("sid:" + sid, code);

  return json({ code, plan, email, amount, ref_name });
};

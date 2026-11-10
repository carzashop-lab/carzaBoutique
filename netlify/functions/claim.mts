// VipOptimizer — claim.mts
// Appelée par merci.html apres paiement : verifie le paiement Stripe,
// genere UN vrai code (ou renvoie celui deja cree pour cette session),
// le stocke dans Supabase, et le renvoie.
// GET /.netlify/functions/claim?session_id=cs_...

const SUPA = process.env.SUPABASE_URL || "";
const SKEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
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

function genCode(): string {
  const D = "0123456789";
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sans I et O (confusion)
  const a: string[] = [];
  for (let i = 0; i < 7; i++) a.push(D[Math.floor(Math.random() * D.length)]);
  for (let i = 0; i < 3; i++) a.push(L[Math.floor(Math.random() * L.length)]);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.join("");
}

async function supa(path: string, init: RequestInit = {}) {
  return fetch(`${SUPA}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SKEY,
      Authorization: `Bearer ${SKEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors() });
  if (!SUPA || !SKEY || !STRIPE) return json({ error: "config" }, 500);

  const url = new URL(req.url);
  const sid = url.searchParams.get("session_id");
  if (!sid || !sid.startsWith("cs_")) return json({ error: "no_session" }, 400);

  // 1) deja un code pour cette session ? on le renvoie (idempotent)
  const ex = await supa(`vip_licenses?session_id=eq.${encodeURIComponent(sid)}&select=code,plan`);
  const rows = await ex.json().catch(() => []);
  if (Array.isArray(rows) && rows.length) {
    return json({ code: rows[0].code, plan: rows[0].plan, reused: true });
  }

  // 2) verifier le paiement aupres de Stripe
  const s = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sid)}`, {
    headers: { Authorization: `Bearer ${STRIPE}` },
  });
  if (!s.ok) return json({ error: "stripe_unreachable" }, 502);
  const sess: any = await s.json();
  if (sess.payment_status !== "paid") return json({ error: "not_paid" }, 402);

  const email = sess.customer_details?.email || sess.customer_email || "";
  const amount = (sess.amount_total || 0) / 100;
  const plan = amount >= 24 ? "Pro" : "Standard";

  // 3) creer le code (retry si collision unique)
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    code = genCode();
    const ins = await supa(`vip_licenses`, {
      method: "POST",
      body: JSON.stringify({ code, session_id: sid, email, plan, amount, used: false }),
    });
    if (ins.ok) {
      return json({ code, plan, email, amount });
    }
    // 23505 = collision ; si c'est la session (concurrence), on relit
    const again = await supa(`vip_licenses?session_id=eq.${encodeURIComponent(sid)}&select=code,plan`);
    const r2 = await again.json().catch(() => []);
    if (Array.isArray(r2) && r2.length) return json({ code: r2[0].code, plan: r2[0].plan, reused: true });
  }
  return json({ error: "insert_failed" }, 500);
};

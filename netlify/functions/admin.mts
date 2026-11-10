// VipOptimizer — admin.mts
// Liste les commandes/codes depuis Supabase. Protege par mot de passe (env ADMIN_PASSWORD).
// GET /.netlify/functions/admin?pw=...   -> { orders: [...] }
// GET /.netlify/functions/admin?pw=...&check=CODE  -> verifie un code precis

const SUPA = process.env.SUPABASE_URL || "";
const SKEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ADMIN_PW = process.env.ADMIN_PASSWORD || "";

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

async function supa(path: string, init: RequestInit = {}) {
  return fetch(`${SUPA}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SKEY,
      Authorization: `Bearer ${SKEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors() });
  if (!SUPA || !SKEY) return json({ error: "config" }, 500);

  const url = new URL(req.url);
  const pw = url.searchParams.get("pw") || "";
  if (!ADMIN_PW || pw !== ADMIN_PW) return json({ error: "unauthorized" }, 401);

  const check = url.searchParams.get("check");
  if (check) {
    const r = await supa(
      `vip_licenses?code=eq.${encodeURIComponent(check.trim().toUpperCase())}&select=code,email,plan,amount,used,used_at,created_at,machine_id`
    );
    const rows = await r.json().catch(() => []);
    return json({ found: Array.isArray(rows) && rows.length > 0, order: rows[0] || null });
  }

  const r = await supa(
    `vip_licenses?select=code,email,plan,amount,used,used_at,created_at,machine_id&order=created_at.desc&limit=500`
  );
  const rows = await r.json().catch(() => []);
  return json({ orders: Array.isArray(rows) ? rows : [] });
};

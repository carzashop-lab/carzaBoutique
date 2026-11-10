// VipOptimizer — activate.mts
// Appelee par l'appli au demarrage. Valide le code et le lie a UNE machine.
// Un code = une seule machine. Reactivation possible seulement sur la meme machine.
// POST /.netlify/functions/activate   body: { "code": "...", "machine": "..." }

const SUPA = process.env.SUPABASE_URL || "";
const SKEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function cors(extra: Record<string, string> = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
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
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors() });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  if (!SUPA || !SKEY) return json({ ok: false, error: "config" }, 500);

  const body: any = await req.json().catch(() => ({}));
  const code = (body.code || "").toString().trim().toUpperCase();
  const machine = (body.machine || "").toString().trim().slice(0, 128);
  if (!code) return json({ ok: false, error: "no_code" }, 400);

  const r = await supa(`vip_licenses?code=eq.${encodeURIComponent(code)}&select=*`);
  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return json({ ok: false, error: "invalid" });

  const lic = rows[0];

  // deja utilise
  if (lic.used) {
    if (lic.machine_id && machine && lic.machine_id === machine) {
      return json({ ok: true, plan: lic.plan, reactivation: true });
    }
    return json({ ok: false, error: "used" });
  }

  // premiere activation -> on verrouille sur la machine
  const upd = await supa(`vip_licenses?code=eq.${encodeURIComponent(code)}&used=eq.false`, {
    method: "PATCH",
    body: JSON.stringify({
      used: true,
      used_at: new Date().toISOString(),
      machine_id: machine || null,
    }),
  });
  const updated = await upd.json().catch(() => []);
  if (!upd.ok || !Array.isArray(updated) || !updated.length) {
    // une autre machine a verrouille entre-temps
    return json({ ok: false, error: "used" });
  }
  return json({ ok: true, plan: lic.plan, reactivation: false });
};

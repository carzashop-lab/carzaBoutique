// VipOptimizer — activate.mts (Netlify Blobs)
// L'appli l'appelle au demarrage. Code valable 1 fois, lie a 1 PC.
// POST /.netlify/functions/activate   body: { "code":"...", "machine":"..." }
import { getStore } from "@netlify/blobs";

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
function store() {
  return getStore({ name: "vip_licenses", consistency: "strong" });
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors() });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const body: any = await req.json().catch(() => ({}));
  const code = (body.code || "").toString().trim().toUpperCase();
  const machine = (body.machine || "").toString().trim().slice(0, 128);
  if (!code) return json({ ok: false, error: "no_code" }, 400);

  const s = store();
  const lic: any = await s.get(code, { type: "json" });
  if (!lic) return json({ ok: false, error: "invalid" });

  if (lic.used) {
    if (lic.machine_id && machine && lic.machine_id === machine) {
      return json({ ok: true, plan: lic.plan, reactivation: true });
    }
    return json({ ok: false, error: "used" });
  }

  lic.used = true;
  lic.used_at = new Date().toISOString();
  lic.machine_id = machine || null;
  await s.setJSON(code, lic);

  return json({ ok: true, plan: lic.plan, reactivation: false });
};

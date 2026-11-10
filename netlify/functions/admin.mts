// VipOptimizer — admin.mts (Netlify Blobs)
// admin.html l'appelle. Protege par ADMIN_PASSWORD.
// GET /.netlify/functions/admin?pw=...            -> { orders: [...] }
// GET /.netlify/functions/admin?pw=...&check=CODE -> verifie un code
import { getStore } from "@netlify/blobs";

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
function store() {
  return getStore({ name: "vip_licenses", consistency: "strong" });
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors() });

  const url = new URL(req.url);
  const pw = url.searchParams.get("pw") || "";
  if (!ADMIN_PW || pw !== ADMIN_PW) return json({ error: "unauthorized" }, 401);

  const s = store();

  const check = url.searchParams.get("check");
  if (check) {
    const lic: any = await s.get(check.trim().toUpperCase(), { type: "json" });
    return json({ found: !!lic, order: lic || null });
  }

  const listed = await s.list();
  const keys = (listed.blobs || [])
    .map((b: any) => b.key)
    .filter((k: string) => k && !k.startsWith("sid:"));

  const orders: any[] = [];
  for (const k of keys) {
    const lic: any = await s.get(k, { type: "json" });
    if (lic) orders.push(lic);
  }
  orders.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return json({ orders });
};

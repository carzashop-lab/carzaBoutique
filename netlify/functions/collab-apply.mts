// VipOptimizer — collab-apply.mts
// Reçoit une demande "devenir collaborateur" depuis le site (public).
// POST /.netlify/functions/collab-apply
// body: { name, discord, reason, followers }
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
  return getStore({ name: "vip_collab_apps", consistency: "strong" });
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors() });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const b: any = await req.json().catch(() => ({}));
  const name = (b.name || "").toString().trim().slice(0, 80);
  const discord = (b.discord || "").toString().trim().slice(0, 80);
  const reason = (b.reason || "").toString().trim().slice(0, 600);
  const followers = (b.followers || "").toString().trim().slice(0, 40);
  if (!name || !discord) return json({ ok: false, error: "missing" }, 400);

  const id = "app_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const app = {
    id, name, discord, reason, followers,
    status: "pending", ref: null,
    created_at: new Date().toISOString(),
  };
  await store().setJSON(id, app);
  return json({ ok: true });
};

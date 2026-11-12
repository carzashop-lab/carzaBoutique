// VipOptimizer — parrain-link.mts
// Offre PARRAINAGE (séparée des collaborateurs) : lien immédiat, sans validation.
// 2 potes achètent via ton lien -> tu reçois un code VipOptimizer gratuit.
// POST /.netlify/functions/parrain-link   body: { name, discord }
import { getStore } from "@netlify/blobs";

const SITE = (process.env.SITE_URL || "https://carza.fr").replace(/\/+$/, "");

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
const collabs = () => getStore({ name: "vip_collabs", consistency: "strong" });

function genRef(): string {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "P"; // P = parrain
  for (let i = 0; i < 5; i++) s += L[Math.floor(Math.random() * L.length)];
  return s;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors() });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const b: any = await req.json().catch(() => ({}));
  const name = (b.name || "").toString().trim().slice(0, 80);
  const discord = (b.discord || "").toString().trim().slice(0, 80);
  if (!name) return json({ ok: false, error: "missing" }, 400);

  let ref = genRef();
  for (let i = 0; i < 6; i++) { if (!(await collabs().get(ref, { type: "json" }))) break; ref = genRef(); }

  const col = {
    ref, name, discord, followers: "",
    type: "parrain", status: "active",
    created_at: new Date().toISOString(),
  };
  await collabs().setJSON(ref, col);

  return json({ ok: true, ref, link: `${SITE}/?ref=${ref}` });
};

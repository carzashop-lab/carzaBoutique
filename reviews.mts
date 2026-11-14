import { getStore } from "@netlify/blobs";

const H = { "Content-Type": "application/json" };

export default async (req: Request) => {
  const store = getStore("vip_reviews");
  const url = new URL(req.url);
  const pw = url.searchParams.get("pw");
  const ADMIN = process.env.ADMIN_PASSWORD || "";

  // ---------- GET ----------
  if (req.method === "GET") {
    const { blobs } = await store.list();
    const all: any[] = [];
    for (const b of blobs) {
      const r = await store.get(b.key, { type: "json" });
      if (r) all.push(r);
    }
    all.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    // admin : tout
    if (pw && pw === ADMIN) {
      return new Response(JSON.stringify({ reviews: all }), { headers: H });
    }
    // public : approuvés seulement, champs limités
    const pub = all
      .filter((r) => r.status === "approved")
      .map((r) => ({ name: r.name, handle: r.handle, platform: r.platform, stars: r.stars, text: r.text, gain: r.gain }));
    return new Response(JSON.stringify({ reviews: pub }), { headers: H });
  }

  // ---------- POST ----------
  if (req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch {}

    // --- modération admin ---
    if (body.action) {
      if (body.pw !== ADMIN) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: H });
      const id = String(body.id || "");
      if (!id) return new Response(JSON.stringify({ error: "no_id" }), { status: 400, headers: H });

      if (body.action === "delete" || body.action === "reject") {
        await store.delete(id);
        return new Response(JSON.stringify({ ok: true }), { headers: H });
      }
      if (body.action === "approve") {
        const r: any = await store.get(id, { type: "json" });
        if (!r) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: H });
        r.status = "approved";
        await store.setJSON(id, r);
        return new Response(JSON.stringify({ ok: true }), { headers: H });
      }
      return new Response(JSON.stringify({ error: "bad_action" }), { status: 400, headers: H });
    }

    // --- soumission publique d'un avis ---
    const name = (body.name || "").toString().trim().slice(0, 40);
    const text = (body.text || "").toString().trim().slice(0, 400);
    if (!name || !text) return new Response(JSON.stringify({ error: "missing" }), { status: 400, headers: H });

    let stars = parseInt(body.stars, 10);
    if (!(stars >= 1 && stars <= 5)) stars = 5;

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const review = {
      id,
      name,
      handle: (body.handle || "").toString().trim().slice(0, 40),
      platform: (body.platform || "").toString().trim().slice(0, 20),
      stars,
      text,
      gain: (body.gain || "").toString().trim().slice(0, 60),
      status: "pending",
      created_at: Date.now(),
    };
    await store.setJSON(id, review);
    return new Response(JSON.stringify({ ok: true }), { headers: H });
  }

  return new Response(JSON.stringify({ error: "method" }), { status: 405, headers: H });
};

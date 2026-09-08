import type { Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import {
  variantOf, eur, esc, addBusinessDays, frDate, sendMail,
} from "../lib/catalogue.mts";

// Recoit la notification de paiement de Stripe.
// C'est LA fonction de verification : tant que la signature n'est pas valide,
// rien n'est enregistre. Personne ne peut simuler une commande payee.

async function verify(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const timestamp = parts["t"], signature = parts["v1"];
  if (!timestamp || !signature) return false;
  // Rejoue impossible : on refuse tout ce qui a plus de 5 minutes.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  // Comparaison a temps constant.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// --- 1. Email au vendeur : quoi commander, ou, et pour qui -------------------
async function sendAlert(order: any, items: any[]) {
  const to = process.env.ALERT_EMAIL;
  if (!to) return;
  const from = process.env.ALERT_FROM ?? "Carza <onboarding@resend.dev>";
  const marge = (order.total_cents ?? 0) - (order.cost_cents ?? 0);

  const adresse = [
    order.customer_name, order.ship_line1, order.ship_line2,
    [order.ship_postal_code, order.ship_city].filter(Boolean).join(" "),
    order.ship_country, order.customer_phone,
  ].filter(Boolean).join("\n");

  const lignes = items.map((it) => {
    const pierre = it.variant
      ? `<div style="font-size:13px;color:#2b6a50;font-weight:700;margin-top:4px">Pierre commandée : ${esc(it.variant)}</div>` : "";
    const sku = it.supplier_sku
      ? `<div style="font-size:12.5px;color:#54635c;margin-top:2px">Variante à sélectionner : <b>${esc(it.supplier_sku)}</b></div>` : "";
    const lien = it.supplier_url
      ? `<div style="margin-top:8px"><a href="${esc(it.supplier_url)}" style="display:inline-block;background:#0e1917;color:#eaf0ee;text-decoration:none;padding:9px 15px;font-size:13px;font-weight:600;border-radius:3px">Commander chez le fournisseur →</a></div>` : "";
    return `<tr><td style="padding:14px 0;border-bottom:1px solid #e2e8e4">
      <div style="font-size:15px;font-weight:600">${it.quantity} &times; ${esc(it.product_name)}</div>
      ${pierre}${sku}${lien}</td>
      <td style="padding:14px 0;border-bottom:1px solid #e2e8e4;text-align:right;white-space:nowrap;vertical-align:top;font-size:15px">${eur(it.unit_price_cents * it.quantity)}</td></tr>`;
  }).join("");

  const html = `<!doctype html><html><body style="margin:0;background:#eef1f0;padding:24px;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#131c17">
<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #d3ddd8">
  <div style="background:#0e1917;color:#eaf0ee;padding:20px 24px">
    <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#66c199">Nouvelle commande</div>
    <div style="font-size:26px;margin-top:6px">Commande n°${order.order_number}</div>
  </div>
  <div style="padding:22px 24px">
    <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#87938c;font-weight:700;margin-bottom:4px">À commander</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${lignes}
      <tr><td style="padding:14px 0 0;font-weight:700">Total encaissé</td><td style="padding:14px 0 0;text-align:right;font-weight:700">${eur(order.total_cents)}</td></tr>
      <tr><td style="padding:4px 0;color:#54635c">Coût fournisseur estimé</td><td style="padding:4px 0;text-align:right;color:#54635c">${eur(order.cost_cents)}</td></tr>
      <tr><td style="padding:4px 0;color:#2b6a50;font-weight:700">Marge brute</td><td style="padding:4px 0;text-align:right;color:#2b6a50;font-weight:700">${eur(marge)}</td></tr>
    </table>
    <div style="margin-top:26px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#87938c;font-weight:700">Livrer à</div>
    <pre style="margin:8px 0 0;padding:14px;background:#f7f9f8;border:1px solid #d3ddd8;font-family:ui-monospace,Menlo,monospace;font-size:14px;line-height:1.7;white-space:pre-wrap">${esc(adresse)}</pre>
    <div style="margin-top:8px;font-size:12.5px;color:#54635c">Sélectionne ce bloc et colle-le dans le formulaire d'adresse du fournisseur.</div>
    <div style="margin-top:22px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#87938c;font-weight:700">Client</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:6px">
      <tr><td style="padding:3px 0;color:#54635c;width:110px">Nom</td><td style="padding:3px 0">${esc(order.customer_name)}</td></tr>
      <tr><td style="padding:3px 0;color:#54635c">Email</td><td style="padding:3px 0"><a href="mailto:${esc(order.customer_email)}" style="color:#2b6a50">${esc(order.customer_email)}</a></td></tr>
      ${order.customer_phone ? `<tr><td style="padding:3px 0;color:#54635c">Téléphone</td><td style="padding:3px 0">${esc(order.customer_phone)}</td></tr>` : ""}
    </table>
  </div>
</div></body></html>`;

  await sendMail({
    from, to: [to],
    subject: `Commande n°${order.order_number} — ${eur(order.total_cents)} — ${order.ship_city ?? ""}`,
    html,
  });
}

// --- 2. Email de remerciement au client --------------------------------------
async function sendReceipt(order: any, items: any[]) {
  // Necessite un domaine verifie chez Resend : onboarding@resend.dev ne peut
  // ecrire qu'a ta propre adresse. Sans CUSTOMER_FROM, on saute simplement.
  const from = process.env.CUSTOMER_FROM;
  const to = order.customer_email;
  if (!from || !to || to === "inconnu") return;

  const site = (process.env.SITE_URL ?? process.env.URL ?? "").replace(/\/$/, "");
  const contact = process.env.CONTACT_EMAIL ?? "carzashop@gmail.com";
  const paid = new Date(order.paid_at ?? order.created_at ?? Date.now());

  const lignes = items.map((it) => `<tr>
      <td style="padding:12px 0;border-bottom:1px solid #e2e8e4">
        <div style="font-size:15px">${it.quantity} &times; ${esc(it.product_name)}</div>
        ${it.variant ? `<div style="font-size:13px;color:#54635c;margin-top:3px">${esc(it.variant)}</div>` : ""}
      </td>
      <td style="padding:12px 0;border-bottom:1px solid #e2e8e4;text-align:right;white-space:nowrap">${eur(it.unit_price_cents * it.quantity)}</td>
    </tr>`).join("");

  const adresse = [
    order.customer_name, order.ship_line1, order.ship_line2,
    [order.ship_postal_code, order.ship_city].filter(Boolean).join(" "),
    order.ship_country,
  ].filter(Boolean).map(esc).join("<br>");

  const html = `<!doctype html><html><body style="margin:0;background:#eef1f0;padding:24px;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#131c17">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #d3ddd8">
  <div style="background:#0e1917;color:#eaf0ee;padding:28px 26px">
    <div style="font-size:13px;letter-spacing:.3em;text-transform:uppercase">C A R Z A</div>
    <div style="font-size:27px;margin-top:14px;line-height:1.25">Merci pour votre achat.</div>
  </div>
  <div style="padding:24px 26px">
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#2f3f38">
      Votre commande est bien enregistrée et le paiement a été accepté. Nous la préparons,
      et vous recevrez un numéro de suivi dès son expédition.
    </p>

    <div style="background:#f7f9f8;border:1px solid #d3ddd8;padding:16px 18px">
      <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#87938c;font-weight:700">Votre numéro de commande</div>
      <div style="font-size:24px;font-family:ui-monospace,Menlo,monospace;margin-top:5px">${esc(order.order_number)}</div>
      <div style="font-size:12.5px;color:#54635c;margin-top:8px">Gardez-le : il vous servira à suivre votre colis.</div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:22px">${lignes}
      <tr><td style="padding:14px 0 0;font-weight:700">Total payé</td><td style="padding:14px 0 0;text-align:right;font-weight:700">${eur(order.total_cents)}</td></tr>
      <tr><td style="padding:4px 0;color:#54635c">Livraison</td><td style="padding:4px 0;text-align:right;color:#2b6a50;font-weight:600">Offerte</td></tr>
    </table>

    <div style="margin-top:26px;padding:16px 18px;border:1px solid #d3ddd8">
      <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#87938c;font-weight:700">Livraison estimée</div>
      <div style="font-size:16px;margin-top:6px">Entre le <b>${frDate(addBusinessDays(paid, 5))} et le ${frDate(addBusinessDays(paid, 12))}</b></div>
      <div style="font-size:12.5px;color:#54635c;margin-top:6px">5 à 12 jours ouvrés. Livraison offerte, sans frais supplémentaires.</div>
    </div>

    <div style="margin-top:22px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#87938c;font-weight:700">Adresse de livraison</div>
    <div style="margin-top:7px;font-size:14px;line-height:1.7">${adresse}</div>

    ${site ? `<div style="margin-top:26px"><a href="${esc(site)}/#suivi" style="display:inline-block;background:#2b6a50;color:#fff;text-decoration:none;padding:13px 24px;font-size:14px;font-weight:600;border-radius:999px">Suivre ma commande</a></div>` : ""}

    <div style="margin-top:28px;padding-top:18px;border-top:1px solid #d3ddd8;font-size:13px;line-height:1.7;color:#54635c">
      Vous disposez de 14 jours après réception pour changer d'avis.<br>
      Une question ? Répondez à cet email ou écrivez à
      <a href="mailto:${esc(contact)}" style="color:#2b6a50">${esc(contact)}</a>.
    </div>
  </div>
</div></body></html>`;

  await sendMail({
    from, to: [to], reply_to: contact,
    subject: `Merci pour votre commande — n°${order.order_number}`,
    html,
  });
}

export default async (req: Request, _ctx: Context) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();

  if (!secret || !sig || !(await verify(raw, sig, secret))) {
    return new Response("Signature invalide", { status: 400 });
  }

  const event = JSON.parse(raw);
  if (event.type !== "checkout.session.completed") return new Response("ok", { status: 200 });

  const s = event.data.object;
  const sql = getDatabase().sql;

  // Stripe peut renvoyer deux fois le meme evenement : on n'enregistre qu'une fois.
  const already = await sql`select id from orders where stripe_session_id = ${s.id} limit 1`;
  if (already.length) return new Response("deja traite", { status: 200 });

  const ship = s.shipping_details ?? s.customer_details;
  const addr = ship?.address ?? {};

  let cart: { slug: string; q: number; v?: string; vl?: string }[] = [];
  try { cart = JSON.parse(s.metadata?.cart ?? "[]"); } catch { /* panier vide */ }

  const all = await sql`select id, slug, name, price_cents, cost_cents,
                               supplier_url, supplier_sku from products`;
  const slugs = new Set(cart.map((c) => c.slug));
  const products = (all as any[]).filter((p) => slugs.has(p.slug));

  const cost = cart.reduce((sum, c) => {
    const p = products.find((x: any) => x.slug === c.slug);
    return sum + ((p?.cost_cents ?? 0) + (variantOf(c.slug, c.v)?.cost ?? 0)) * c.q;
  }, 0);

  const [order] = await sql`
    insert into orders (
      stripe_session_id, stripe_payment_intent, customer_email, customer_name,
      customer_phone, ship_line1, ship_line2, ship_postal_code, ship_city,
      ship_country, total_cents, cost_cents, paid_at
    ) values (
      ${s.id}, ${s.payment_intent ?? null},
      ${s.customer_details?.email ?? "inconnu"},
      ${ship?.name ?? s.customer_details?.name ?? null},
      ${s.customer_details?.phone ?? null},
      ${addr.line1 ?? null}, ${addr.line2 ?? null},
      ${addr.postal_code ?? null}, ${addr.city ?? null},
      ${addr.country ?? "FR"},
      ${s.amount_total ?? 0}, ${cost}, now()
    ) returning *`;

  const items = cart.map((c) => {
    const p: any = products.find((x: any) => x.slug === c.slug);
    const v = variantOf(c.slug, c.v);
    return {
      order_id: order.id,
      product_id: p?.id ?? null,
      product_name: p?.name ?? c.slug,
      supplier_url: v?.url ?? p?.supplier_url ?? null,
      supplier_sku: v?.sku ?? p?.supplier_sku ?? null,
      quantity: c.q,
      unit_price_cents: (p?.price_cents ?? 0) + (v?.plus ?? 0),
      unit_cost_cents: (p?.cost_cents ?? 0) + (v?.cost ?? 0),
      variant: v?.label ?? c.vl ?? null,
    };
  });

  for (const it of items) {
    await sql`insert into order_items (
        order_id, product_id, product_name, supplier_url, supplier_sku,
        quantity, unit_price_cents, unit_cost_cents, variant
      ) values (
        ${it.order_id}, ${it.product_id}, ${it.product_name}, ${it.supplier_url},
        ${it.supplier_sku}, ${it.quantity}, ${it.unit_price_cents},
        ${it.unit_cost_cents}, ${it.variant}
      )`;
  }

  // Les emails partent APRES l'enregistrement : une panne d'email ne perd
  // jamais une commande.
  await sendAlert(order, items);
  await sendReceipt(order, items);

  return new Response("ok", { status: 200 });
};
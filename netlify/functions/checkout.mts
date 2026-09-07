  import type { Context } from "@netlify/functions";
import { neon } from "@netlify/neon";
import { variantOf, json } from "../lib/catalogue.mts";

// Ouvre une session de paiement Stripe.
// Regle d'or : le navigateur envoie des identifiants de produit et de pierre,
// JAMAIS un prix. Tous les montants sont relus en base ici.

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json({ error: "Stripe n'est pas encore configuré." }, 500);

  let cart: { slug: string; quantity: number; variant?: string }[];
  try {
    const body = await req.json();
    cart = Array.isArray(body?.items) ? body.items : [];
  } catch {
    return json({ error: "Requête invalide." }, 400);
  }
  if (cart.length === 0) return json({ error: "Le panier est vide." }, 400);

  const sql = neon();
  const slugs = [...new Set(cart.map((i) => String(i.slug)))];
  const products = await sql`
    select slug, name, tagline, price_cents, image_url
    from products
    where active = true and slug = any(${slugs})
  `;
  if (!products.length) return json({ error: "Produit introuvable." }, 400);

  const site = (process.env.SITE_URL ?? process.env.URL ?? "").replace(/\/$/, "");

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("locale", "fr");
  form.set("success_url", `${site}/?commande=ok&session={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${site}/?commande=annulee`);
  form.set("billing_address_collection", "auto");
  form.set("phone_number_collection[enabled]", "true");
  ["FR", "BE", "LU", "CH", "MC"].forEach((c, i) =>
    form.set(`shipping_address_collection[allowed_countries][${i}]`, c)
  );

  const meta: { slug: string; q: number; v?: string; vl?: string }[] = [];
  let index = 0;

  for (const item of cart) {
    const p = products.find((x: any) => x.slug === item.slug);
    if (!p) continue;

    const qty = Math.min(Math.max(parseInt(String(item.quantity)) || 1, 1), 10);
    const vid = item.variant ? String(item.variant) : "";
    const v = variantOf(p.slug, vid);
    const unit = p.price_cents + (v?.plus ?? 0);

    form.set(`line_items[${index}][quantity]`, String(qty));
    form.set(`line_items[${index}][price_data][currency]`, "eur");
    form.set(`line_items[${index}][price_data][unit_amount]`, String(unit));
    form.set(
      `line_items[${index}][price_data][product_data][name]`,
      v ? `${p.name} — ${v.label}` : p.name,
    );
    const desc = v ? `Pierre : ${v.label}` : (p.tagline ?? "");
    if (desc) form.set(`line_items[${index}][price_data][product_data][description]`, desc);
    if (p.image_url) form.set(`line_items[${index}][price_data][product_data][images][0]`, p.image_url);

    meta.push(v ? { slug: p.slug, q: qty, v: vid, vl: v.label } : { slug: p.slug, q: qty });
    index++;
  }
  if (index === 0) return json({ error: "Le panier est vide." }, 400);

  // Livraison TOUJOURS offerte : elle est deja comprise dans le prix affiche.
  form.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  form.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", "0");
  form.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "eur");
  form.set("shipping_options[0][shipping_rate_data][display_name]", "Livraison offerte");
  form.set("shipping_options[0][shipping_rate_data][delivery_estimate][minimum][unit]", "business_day");
  form.set("shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]", "5");
  form.set("shipping_options[0][shipping_rate_data][delivery_estimate][maximum][unit]", "business_day");
  form.set("shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]", "12");

  form.set("metadata[cart]", JSON.stringify(meta));

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });

  const session = await res.json();
  if (!res.ok) {
    console.error("Stripe error", session);
    return json({ error: "Le paiement n'a pas pu être ouvert. Réessaie dans un instant." }, 502);
  }
  return json({ url: session.url });
};

import type { Context } from "@netlify/functions";
import { neon } from "@netlify/neon";
import { json, addBusinessDays, frDate } from "../lib/catalogue.mts";

// Page de suivi client.
// Aucune donnee fournisseur ne sort d'ici : ni nom de vendeur, ni reference
// d'achat, ni cout. Le client voit sa commande, pas ta chaine d'appro.

const STEPS = ["a_commander", "commandee", "expediee", "livree"];

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  let body: { order?: string; email?: string };
  try { body = await req.json(); } catch { return json({ error: "Requête invalide." }, 400); }

  const num = parseInt(String(body.order ?? "").replace(/[^0-9]/g, ""), 10);
  const email = String(body.email ?? "").trim();

  if (!num || !email.includes("@")) {
    return json({ error: "Indiquez votre numéro de commande et l'email utilisé lors de l'achat." }, 400);
  }

  const sql = neon();

  // Le numero seul ne suffit pas : l'email doit correspondre.
  const [order] = await sql`
    select order_number, status, created_at, paid_at, updated_at,
           tracking_number, tracking_url, ship_city, total_cents
    from orders
    where order_number = ${num} and lower(customer_email) = lower(${email})
    limit 1`;

  if (!order) return json({ error: "Aucune commande ne correspond à ces informations." }, 404);

  const items = await sql`
    select product_name, variant, quantity from order_items
    where order_id = (select id from orders where order_number = ${num})`;

  const paid = new Date(order.paid_at ?? order.created_at);
  const done = ["livree", "annulee", "remboursee"].includes(order.status);
  const idx = STEPS.indexOf(order.status);

  return json({
    order_number: order.order_number,
    status: order.status,
    step: idx < 0 ? 0 : idx,
    city: order.ship_city,
    total_cents: order.total_cents,
    items: items.map((i: any) => ({
      name: i.variant ? `${i.product_name} — ${i.variant}` : i.product_name,
      quantity: i.quantity,
    })),
    window: done ? null : `${frDate(addBusinessDays(paid, 5))} et le ${frDate(addBusinessDays(paid, 12))}`,
    tracking: order.tracking_number ?? null,
    tracking_url: order.tracking_url ?? null,
    updated_at: order.updated_at,
  });
};

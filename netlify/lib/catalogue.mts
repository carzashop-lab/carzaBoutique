// ---------------------------------------------------------------------------
// Variantes par produit — cote serveur uniquement.
// Le navigateur n'envoie qu'un identifiant de pierre ; le libelle, le
// supplement de prix et le cout d'achat viennent tous d'ici. Personne ne peut
// donc payer une amethyste au prix du jade en bidouillant la page.
//
//   plus = supplement de prix de vente, en centimes
//   cost = supplement de cout fournisseur, en centimes
//   url  = fiche fournisseur propre a cette variante (sinon celle du produit)
//   sku  = nom exact de la variante a selectionner chez le fournisseur
// ---------------------------------------------------------------------------

export type Variant = {
  label: string;
  plus: number;
  cost: number;
  url?: string;
  sku?: string;
};

export const VARIANTS: Record<string, Record<string, Variant>> = {
  // Achat : jade 12,49 / obsidienne 15,79 / quartz 18,29 / amethyste 26,99
  // (le cout de base en BDD est celui du jade)
  "rituel-visage": {
    jade:       { label: "Jade vert",   plus: 0,    cost: 0,    sku: "Set jade vert" },
    obsidienne: { label: "Obsidienne",  plus: 500,  cost: 330,  sku: "Set obsidienne" },
    quartz:     { label: "Quartz rose", plus: 1000, cost: 580,  sku: "Set quartz rose" },
    amethyste:  { label: "Améthyste",   plus: 1500, cost: 1450, sku: "Set améthyste" },
  },

  // Achat + port : obsidienne 5,29 / quartz 6,49 / aventurine 6,69 / acier 6,69 / tigre 8,49
  "gua-sha-jade": {
    obsidienne: { label: "Obsidienne",   plus: 0,   cost: 0,   sku: "obsidian" },
    quartz:     { label: "Quartz rose",  plus: 200, cost: 120, sku: "rose quartz" },
    aventurine: { label: "Aventurine",   plus: 200, cost: 140, sku: "aventurine" },
    acier:      { label: "Acier poli",   plus: 200, cost: 140, sku: "stainless steel" },
    tigre:      { label: "Œil-de-tigre", plus: 700, cost: 320, sku: "tiger eye" },
  },

  // UNE FICHE FOURNISSEUR DIFFERENTE PAR PIERRE
  "rouleau-jade": {
    obsidienne: { label: "Obsidienne",  plus: 0,   cost: 0,
      url: "https://fr.aliexpress.com/item/1005001570281409.html", sku: "Type G" },
    quartz:     { label: "Quartz rose", plus: 200, cost: 140,
      url: "https://fr.aliexpress.com/item/1005006296170321.html", sku: "Type 07" },
    jaspe:      { label: "Jaspe bleu",  plus: 200, cost: 160,
      url: "https://fr.aliexpress.com/item/1005006032268304.html", sku: "Type F" },
    amethyste:  { label: "Améthyste",   plus: 200, cost: 210,
      url: "https://fr.aliexpress.com/item/1005002190431930.html", sku: "type 4" },
  },
};

export const variantOf = (slug: string, id?: string | null): Variant | undefined =>
  id ? VARIANTS[slug]?.[id] : undefined;

// --- Petits utilitaires partages ---------------------------------------------

export const eur = (cents: number) =>
  (cents / 100).toFixed(2).replace(".", ",") + " €";

export const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

/** Ajoute des jours ouvres (week-ends exclus). */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w !== 0 && w !== 6) left--;
  }
  return d;
}

export const frDate = (d: Date) =>
  d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

/** Envoi d'un email via Resend. N'echoue jamais bruyamment. */
export async function sendMail(payload: Record<string, unknown>) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error("Resend", res.status, await res.text());
  } catch (e) {
    console.error("Envoi email impossible", e);
  }
}

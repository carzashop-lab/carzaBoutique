-- Baisse des prix du 16 septembre 2026.
-- Objectif : au moins 20 EUR de marge nette sur CHAQUE variante,
-- frais Stripe deduits (1,5 % + 0,25 EUR).
--
-- Les prix barres correspondent au prix reellement pratique pendant les
-- 30 jours precedents, comme l'exige la directive Omnibus.
--
-- Rappel : checkout.mts lit price_cents ICI, jamais dans le navigateur.
-- Tant que cette migration n'est pas appliquee, le client paierait
-- l'ancien prix meme si le site affiche le nouveau.

update products set
  price_cents       = 3490,   -- 69,90 -> 34,90
  compare_at_cents  = 6990,
  cost_cents        = 1249
where slug = 'rituel-visage';

update products set
  price_cents       = 2490,   -- 37,90 -> 24,90
  compare_at_cents  = 3790,
  cost_cents        = 329     -- corrige : l'obsidienne coute 3,29 et non 5,29
where slug = 'gua-sha-jade';

update products set
  price_cents       = 2990,   -- 42,90 -> 29,90
  compare_at_cents  = 4190,
  cost_cents        = 919
where slug = 'rouleau-jade';

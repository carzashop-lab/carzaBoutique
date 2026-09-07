-- =============================================================================
-- Carza — schema de la base
-- A executer UNE FOIS dans Netlify Database (Netlify -> Database -> SQL editor).
-- Relancer ce fichier ne casse rien : tout est en "if not exists" / "on conflict".
-- =============================================================================

-- Etats possibles d'une commande
do $$ begin
  create type order_status as enum (
    'a_commander', 'commandee', 'expediee', 'livree', 'annulee', 'remboursee'
  );
exception when duplicate_object then null;
end $$;

-- --- Produits ----------------------------------------------------------------
-- Les prix vivent ici, pas dans le code : tu peux les changer sans redeployer.
-- Les VARIANTES (pierres) sont dans netlify/lib/catalogue.mts.
create table if not exists products (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique not null,
  name             text not null,
  tagline          text,
  description      text,
  price_cents      integer not null,          -- prix de la variante la moins chere
  compare_at_cents integer,
  cost_cents       integer not null default 0, -- achat de la variante la moins chere
  supplier_url     text,
  supplier_name    text,
  supplier_sku     text,
  image_url        text,
  position         integer not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- --- Commandes ---------------------------------------------------------------
create sequence if not exists order_number_seq start 1001;

create table if not exists orders (
  id                    uuid primary key default gen_random_uuid(),
  order_number          bigint not null unique default nextval('order_number_seq'),
  status                order_status not null default 'a_commander',
  stripe_session_id     text unique,
  stripe_payment_intent text,
  customer_email        text not null,
  customer_name         text,
  customer_phone        text,
  ship_line1            text,
  ship_line2            text,
  ship_postal_code      text,
  ship_city             text,
  ship_country          text default 'FR',
  total_cents           integer not null default 0,
  cost_cents            integer not null default 0,
  supplier_order_ref    text,
  tracking_number       text,
  tracking_url          text,
  notes                 text,
  paid_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists orders_number_idx on orders (order_number);
create index if not exists orders_email_idx  on orders (lower(customer_email));

create table if not exists order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,
  product_id       uuid references products(id),
  product_name     text not null,
  variant          text,
  supplier_url     text,
  supplier_sku     text,
  quantity         integer not null default 1,
  unit_price_cents integer not null,
  unit_cost_cents  integer not null default 0
);

create index if not exists order_items_order_idx on order_items (order_id);

-- --- Le catalogue ------------------------------------------------------------
insert into products
  (slug, name, tagline, description, price_cents, compare_at_cents, cost_cents,
   supplier_url, supplier_name, supplier_sku, image_url, position)
values
  ('rituel-visage', 'Le Rituel Visage',
   'Coffret 2 pièces — la pierre au choix',
   'Un rouleau et un gua sha taillés dans la même pierre, dans un coffret aimanté. Jade vert, obsidienne, quartz rose ou améthyste.',
   6990, 8280, 1249,
   'https://fr.aliexpress.com/item/1005009139251018.html',
   'YHCTEC DropShipping Store', 'Set correspondant à la pierre choisie',
   'https://ae-pic-a1.aliexpress-media.com/kf/Hfe7a895a7eb04dc793b391aee6a6e0271.jpg', 1),

  ('gua-sha-jade', 'Le Gua Sha',
   'Pierre naturelle — cinq finitions au choix', null,
   3790, 4790, 529,
   'https://fr.aliexpress.com/item/1005008207314609.html',
   'Hdeshi Wholesale Store', 'Couleur correspondant à la finition choisie',
   'https://ae-pic-a1.aliexpress-media.com/kf/Hfe7a895a7eb04dc793b391aee6a6e0271.jpg', 2),

  ('rouleau-jade', 'Le Rouleau',
   'Pierre naturelle — quatre pierres au choix', null,
   4290, 5490, 919,
   'https://fr.aliexpress.com/item/1005001570281409.html',
   'YHCTECHealth Store', 'Voir la variante dans l''email de commande',
   'https://ae-pic-a1.aliexpress-media.com/kf/Sf90b89964cb044edb8327ef7f5d02576O.jpg', 3)

on conflict (slug) do update set
  name = excluded.name, tagline = excluded.tagline, description = excluded.description,
  price_cents = excluded.price_cents, compare_at_cents = excluded.compare_at_cents,
  cost_cents = excluded.cost_cents, supplier_url = excluded.supplier_url,
  supplier_name = excluded.supplier_name, supplier_sku = excluded.supplier_sku,
  image_url = excluded.image_url, position = excluded.position, active = true;

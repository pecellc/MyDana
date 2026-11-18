-- ============================================================================
-- KEUANGANKU - SUPABASE SCHEMA
-- Jalankan seluruh file ini di Supabase Dashboard -> SQL Editor -> Run.
-- Aman dijalankan ulang (idempotent untuk sebagian besar objek).
--
-- Model:
--   auth.users      : kredensial (password di-hash oleh Supabase Auth)
--   profiles        : username + role owner/buyer + hash IP
--   ip_registry     : 1 IP = 1 akun (hanya service role / Edge Function)
--   transactions    : catatan keuangan owner (private)
--   quests          : wishlist owner (private)
--   app_settings    : konfigurasi modal owner (private)
--   public_status   : HANYA saldo modal yang boleh dilihat buyer
--   products        : katalog jualan (public read)
--   orders          : pesanan buyer (buyer lihat miliknya, owner lihat semua)
-- ============================================================================

create extension if not exists pgcrypto;

-- Jangan validasi body function saat CREATE (menghindari error urutan tabel).
set check_function_bodies = false;

-- ============================================================================
-- 1. PROFILES
--    Tabel ini HARUS dibuat lebih dulu, karena fungsi is_owner() di bawah
--    membaca public.profiles saat body-nya divalidasi.
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  role text not null default 'buyer' check (role in ('owner', 'buyer')),
  ip_hash text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists avatar_url text;

-- Username selalu huruf kecil & unik
create unique index if not exists profiles_username_unique
  on public.profiles (lower(username));

-- Satu IP hanya boleh terhubung ke satu akun (buyer).
-- Owner memakai ip_hash NULL sehingga tidak terkena aturan ini.
create unique index if not exists profiles_ip_hash_unique
  on public.profiles (ip_hash)
  where ip_hash is not null;

-- ============================================================================
-- 2. HELPER: cek apakah user yang login adalah owner
--    SECURITY DEFINER agar tidak terjadi infinite recursion pada RLS profiles.
-- ============================================================================
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'owner'
  );
$$;

revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

-- RLS profiles (setelah is_owner() tersedia)
alter table public.profiles enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists profiles_select_owner on public.profiles;
create policy profiles_select_owner
  on public.profiles for select
  to authenticated
  using (public.is_owner());

drop policy if exists profiles_update_owner on public.profiles;
create policy profiles_update_owner
  on public.profiles for update
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Tidak ada policy INSERT/DELETE untuk client.
-- Pembuatan profil dilakukan oleh trigger auth.users / Edge Function (service role).

-- ============================================================================
-- 3. TRIGGER: otomatis buat profil saat user baru dibuat
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text;
begin
  uname := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
  uname := regexp_replace(uname, '[^a-z0-9._]', '', 'g');

  if uname is null or length(uname) < 3 then
    uname := 'user' || substr(new.id::text, 1, 8);
  end if;

  begin
    insert into public.profiles (id, username, role)
    values (new.id, uname, 'buyer')
    on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.profiles (id, username, role)
    values (new.id, uname || '_' || substr(new.id::text, 1, 4), 'buyer')
    on conflict (id) do nothing;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 4. IP REGISTRY (1 IP = 1 akun)
--    Tabel ini TIDAK bisa diakses client. Hanya service role di Edge Function.
-- ============================================================================
create table if not exists public.ip_registry (
  ip_hash text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.ip_registry enable row level security;
-- Sengaja tanpa policy: anon/authenticated tidak bisa baca/tulis.

-- ============================================================================
-- 4b. SERVER CONFIG (hanya service role / Edge Function)
--     Dipakai Edge Function signup-ip untuk membaca salt hash IP kalau
--     Edge secret IP_HASH_SALT tidak di-set.
--
--     Isi salt-nya manual (jangan pakai contoh ini), sekali saja:
--     insert into public.server_config (key, value)
--     values ('ip_hash_salt', 'string-acak-panjang-pilihanmu')
--     on conflict (key) do update set value = excluded.value;
-- ============================================================================
create table if not exists public.server_config (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);

alter table public.server_config enable row level security;
revoke all on public.server_config from anon, authenticated;

-- ============================================================================
-- 5. DATA KEUANGAN OWNER (PRIVATE)
-- ============================================================================
create table if not exists public.transactions (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date timestamptz not null default now(),
  type text check (type in ('in', 'out')),
  amount numeric not null default 0,
  description text default '',
  location text default 'Dompet',
  debtor_name text,
  is_pulsa boolean not null default false,
  is_debt boolean not null default false,
  pulsa_customer text,
  pulsa_total numeric,
  pulsa_modal numeric,
  pulsa_profit numeric,
  source_wallet text,
  is_cold_money boolean not null default false,
  is_tambah_modal boolean not null default false,
  is_kurangi_modal boolean not null default false,
  is_setor_modal boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists transactions_owner_date_idx
  on public.transactions (owner_id, date desc);

alter table public.transactions enable row level security;

drop policy if exists transactions_owner_all on public.transactions;
create policy transactions_owner_all
  on public.transactions for all
  to authenticated
  using (owner_id = auth.uid() and public.is_owner())
  with check (owner_id = auth.uid() and public.is_owner());

-- ----------------------------------------------------------------------------
create table if not exists public.quests (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  target_amount numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists quests_owner_idx
  on public.quests (owner_id, created_at desc);

alter table public.quests enable row level security;

drop policy if exists quests_owner_all on public.quests;
create policy quests_owner_all
  on public.quests for all
  to authenticated
  using (owner_id = auth.uid() and public.is_owner())
  with check (owner_id = auth.uid() and public.is_owner());

-- ----------------------------------------------------------------------------
create table if not exists public.app_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  pulsa_config jsonb not null default '{"baseModal":0,"manualModalOffset":0}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists app_settings_owner_all on public.app_settings;
create policy app_settings_owner_all
  on public.app_settings for all
  to authenticated
  using (owner_id = auth.uid() and public.is_owner())
  with check (owner_id = auth.uid() and public.is_owner());

-- ============================================================================
-- 6. STATUS PUBLIK: HANYA SALDO MODAL (UANG PANAS)
--    Buyer boleh membaca, owner yang menulis.
-- ============================================================================
create table if not exists public.public_status (
  id integer primary key default 1 check (id = 1),
  owner_id uuid references auth.users(id) on delete set null,
  modal_amount numeric not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.public_status (id, modal_amount)
values (1, 0)
on conflict (id) do nothing;

alter table public.public_status enable row level security;

drop policy if exists public_status_read on public.public_status;
create policy public_status_read
  on public.public_status for select
  to anon, authenticated
  using (true);

drop policy if exists public_status_owner_insert on public.public_status;
create policy public_status_owner_insert
  on public.public_status for insert
  to authenticated
  with check (public.is_owner());

drop policy if exists public_status_owner_update on public.public_status;
create policy public_status_owner_update
  on public.public_status for update
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ============================================================================
-- 7. KATALOG PRODUK
-- ============================================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  description text default '',
  price numeric not null default 0 check (price >= 0),
  original_price numeric default null,
  admin_fee numeric not null default 0 check (admin_fee >= 0),
  sort_order integer not null default 0,
  category text default 'pulsa',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Migrasi jika tabel products sudah ada
alter table public.products add column if not exists original_price numeric default null;
alter table public.products add column if not exists admin_fee numeric not null default 0;
alter table public.products add column if not exists sort_order integer not null default 0;

create index if not exists products_active_idx
  on public.products (active, sort_order asc, created_at desc);

alter table public.products enable row level security;

drop policy if exists products_read_active on public.products;
create policy products_read_active
  on public.products for select
  to anon, authenticated
  using (active = true);

drop policy if exists products_owner_all on public.products;
create policy products_owner_all
  on public.products for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ============================================================================
-- 8. PESANAN BUYER
-- ============================================================================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete cascade,
  buyer_username text,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  amount numeric not null default 0 check (amount >= 0),
  admin_fee numeric not null default 0 check (admin_fee >= 0),
  payment_proof text,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  notes text default '',
  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'transfer', 'qris', 'dana', 'ovo', 'gopay', 'shopeepay')),
  pay_timing text not null default 'now'
    check (pay_timing in ('now', 'later')),
  due_date date,
  owner_note text,
  responded_at timestamptz,
  responded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_due_date_check
    check (pay_timing = 'now' or due_date is not null),
  constraint orders_response_note_check
    check (status not in ('confirmed', 'cancelled')
           or (owner_note is not null and length(btrim(owner_note)) > 0))
);

-- Migrasi untuk tabel orders yang sudah terlanjur dibuat versi lama.
alter table public.orders add column if not exists payment_method text not null default 'cash';
alter table public.orders add column if not exists pay_timing text not null default 'now';
alter table public.orders add column if not exists due_date date;
alter table public.orders add column if not exists owner_note text;
alter table public.orders add column if not exists responded_at timestamptz;
alter table public.orders add column if not exists responded_by uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists admin_fee numeric not null default 0;
alter table public.orders add column if not exists payment_proof text;

-- Pesanan ditolak otomatis kalau MODAL POKOK (di luar jatah admin) melebihi
-- saldo modal kios. Reserved dihitung dari modal pokok order pending+confirmed.
create or replace function public.enforce_order_modal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modal numeric := 0;
  v_reserved numeric := 0;
  v_admin numeric := 0;
  v_needed numeric := 0;
  v_price numeric;
  v_product_admin numeric := 0;
  v_active boolean;
begin
  if tg_op = 'UPDATE' and new.status not in ('pending', 'confirmed') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.product_id is not null then
      select price, coalesce(admin_fee, 0), active
        into v_price, v_product_admin, v_active
      from public.products
      where id = new.product_id;

      if v_price is null then
        raise exception 'Produk tidak ditemukan.' using errcode = 'P0001';
      end if;

      if v_active is not true then
        raise exception 'Produk sedang tidak aktif.' using errcode = 'P0001';
      end if;

      if coalesce(new.amount, 0) <> v_price then
        raise exception 'Harga produk berubah (katalog Rp %, pesanan Rp %). Muat ulang halaman lalu pesan lagi.',
          replace(to_char(v_price, 'FM999,999,999,999'), ',', '.'),
          replace(to_char(coalesce(new.amount, 0), 'FM999,999,999,999'), ',', '.')
          using errcode = 'P0001';
      end if;

      v_admin := v_product_admin;
      new.admin_fee := least(greatest(v_admin, 0), coalesce(new.amount, 0));
    else
      -- Custom order: buyer tidak berhak menentukan admin.
      new.admin_fee := 0;
    end if;
  else
    new.admin_fee := least(
      greatest(coalesce(new.admin_fee, 0), 0),
      coalesce(new.amount, 0)
    );
  end if;

  select coalesce(modal_amount, 0)
    into v_modal
  from public.public_status
  where id = 1;

  if v_modal is null then v_modal := 0; end if;

  select coalesce(sum(greatest(0, amount - coalesce(admin_fee, 0))), 0)
    into v_reserved
  from public.orders
  where status in ('pending', 'confirmed')
    and id <> new.id;

  v_needed := greatest(0, coalesce(new.amount, 0) - coalesce(new.admin_fee, 0));

  if v_needed > greatest(0, v_modal - v_reserved) then
    raise exception 'Saldo modal kios tidak cukup. Tersedia Rp %, modal pokok yang dibutuhkan Rp % (admin Rp %).',
      replace(to_char(greatest(0, v_modal - v_reserved), 'FM999,999,999,999'), ',', '.'),
      replace(to_char(v_needed, 'FM999,999,999,999'), ',', '.'),
      replace(to_char(coalesce(new.admin_fee, 0), 'FM999,999,999,999'), ',', '.')
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_enforce_modal on public.orders;
create trigger orders_enforce_modal
  before insert or update of status, amount, admin_fee on public.orders
  for each row execute function public.enforce_order_modal();

-- BATAS TEMPO MAKSIMAL 4 HARI.
-- Buyer hanya boleh memesan dengan tempo paling lambat 4 hari dari hari ini
-- (WIB). Pengaman server: walau klien dimodifikasi, due_date > hari ini + 4
-- tetap ditolak. Owner dikecualikan agar tetap bisa menyesuaikan tempo.
create or replace function public.enforce_order_due_max()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_is_owner boolean := false;
begin
  -- Bayar sekarang: tidak boleh menyimpan tanggal tempo.
  if new.pay_timing = 'now' then
    new.due_date := null;
    return new;
  end if;

  begin
    select exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'owner'
    ) into v_is_owner;
  exception when others then
    v_is_owner := false;
  end;

  if v_is_owner then
    return new;
  end if;

  if new.due_date is null then
    raise exception 'Tanggal jatuh tempo wajib diisi untuk pembayaran tempo.'
      using errcode = 'P0001';
  end if;

  if new.due_date < v_today then
    raise exception 'Tanggal jatuh tempo tidak boleh di masa lalu (hari ini %).',
      to_char(v_today, 'DD-MM-YYYY')
      using errcode = 'P0001';
  end if;

  if new.due_date > v_today + 4 then
    raise exception 'Batas tempo maksimal 4 hari. Paling lambat %.',
      to_char(v_today + 4, 'DD-MM-YYYY')
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_enforce_due_max on public.orders;
create trigger orders_enforce_due_max
  before insert or update of pay_timing, due_date on public.orders
  for each row execute function public.enforce_order_due_max();

-- Self-heal modal publik: hitung ulang pool GROSS dari ledger lalu NAIKKAN
-- modal_amount bila lebih kecil (mis. tersimpan neto dari klien lama).
-- Raise-only: tidak pernah menurunkan.
create or replace function public.heal_modal_pool()
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_modal numeric := 0;
  v_pool numeric := 0;
  v_base numeric := 0;
  v_offset numeric := 0;
  v_tambah numeric := 0;
  v_kurang numeric := 0;
  v_setor numeric := 0;
  v_offline numeric := 0;
begin
  select owner_id, coalesce(modal_amount, 0)
    into v_owner, v_modal
  from public.public_status
  where id = 1;

  if not found then
    return 0;
  end if;

  if v_owner is null then
    select owner_id into v_owner from public.app_settings limit 1;
  end if;

  if v_owner is null then
    return coalesce(v_modal, 0);
  end if;

  select coalesce((pulsa_config->>'baseModal')::numeric, 0),
         coalesce((pulsa_config->>'manualModalOffset')::numeric, 0)
    into v_base, v_offset
  from public.app_settings
  where owner_id = v_owner
  limit 1;

  v_base := coalesce(v_base, 0);
  v_offset := coalesce(v_offset, 0);

  select
    coalesce(sum(case when coalesce(payload->>'isTambahModal', 'false') = 'true'
                      then amount else 0 end), 0),
    coalesce(sum(case when coalesce(payload->>'isKurangiModal', 'false') = 'true'
                       or coalesce(payload->>'isModalExpense', 'false') = 'true'
                      then amount else 0 end), 0),
    coalesce(sum(case when coalesce(payload->>'isSetorModal', 'false') = 'true'
                      then amount else 0 end), 0),
    coalesce(sum(case when is_pulsa
                       and coalesce(payload->>'isDebt', 'false') = 'true'
                       and coalesce(payload->>'orderId', '') = ''
                       and coalesce(payload->>'isSettled', 'false') <> 'true'
                      then coalesce((payload->>'pulsaModal')::numeric, 0)
                      else 0 end), 0)
    into v_tambah, v_kurang, v_setor, v_offline
  from public.transactions
  where owner_id = v_owner;

  v_pool := greatest(0, v_base + v_tambah - v_kurang + v_offset - v_offline - v_setor);

  if v_pool > v_modal + 0.5 then
    update public.public_status
       set modal_amount = v_pool,
           updated_at = now()
     where id = 1;
    return v_pool;
  end if;

  return v_modal;
end;
$$;

revoke all on function public.heal_modal_pool() from public;

-- Status modal publik: reserved hanya modal pokok.
create or replace function public.modal_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modal numeric := 0;
  v_reserved numeric := 0;
  v_updated timestamptz;
begin
  v_modal := public.heal_modal_pool();

  select coalesce(modal_amount, 0), updated_at
    into v_modal, v_updated
  from public.public_status
  where id = 1;

  if v_modal is null then v_modal := 0; end if;

  select coalesce(sum(greatest(0, amount - coalesce(admin_fee, 0))), 0)
    into v_reserved
  from public.orders
  where status in ('pending', 'confirmed');

  return jsonb_build_object(
    'modal_amount', v_modal,
    'reserved', v_reserved,
    'available', greatest(0, v_modal - v_reserved),
    'updated_at', v_updated
  );
end;
$$;

-- RPC status order: atomic + validasi modal pokok.
create or replace function public.accept_order(p_order_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_modal numeric := 0;
  v_reserved numeric := 0;
  v_needed numeric := 0;
begin
  if not public.is_owner() then
    raise exception 'Hanya owner yang bisa ACC pesanan.' using errcode = '42501';
  end if;

  if p_note is null or btrim(p_note) = '' then
    raise exception 'Keterangan persetujuan wajib diisi.' using errcode = 'P0001';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pesanan tidak ditemukan.' using errcode = 'P0001';
  end if;

  if v_order.status <> 'pending' then
    raise exception 'Pesanan sudah berstatus %.', v_order.status using errcode = 'P0001';
  end if;

  -- Menyembuhkan modal_amount basi (neto) sebelum validasi.
  perform public.heal_modal_pool();

  select coalesce(modal_amount, 0)
    into v_modal
  from public.public_status
  where id = 1
  for update;

  if v_modal is null then v_modal := 0; end if;

  select coalesce(sum(greatest(0, amount - coalesce(admin_fee, 0))), 0)
    into v_reserved
  from public.orders
  where status in ('pending', 'confirmed')
    and id <> p_order_id;

  v_needed := greatest(0, v_order.amount - coalesce(v_order.admin_fee, 0));

  if v_needed > greatest(0, v_modal - v_reserved) then
    raise exception 'Saldo modal kios tidak cukup. Tersedia Rp %, modal pokok yang dibutuhkan Rp % (admin Rp %).',
      replace(to_char(greatest(0, v_modal - v_reserved), 'FM999,999,999,999'), ',', '.'),
      replace(to_char(v_needed, 'FM999,999,999,999'), ',', '.'),
      replace(to_char(coalesce(v_order.admin_fee, 0), 'FM999,999,999,999'), ',', '.')
      using errcode = 'P0001';
  end if;

  update public.orders
  set status = 'confirmed',
      owner_note = p_note,
      responded_at = now(),
      responded_by = auth.uid(),
      updated_at = now()
  where id = p_order_id
  returning * into v_order;

  return jsonb_build_object(
    'ok', true,
    'available', greatest(0, v_modal - v_reserved - v_needed)
  );
end;
$$;

create or replace function public.decline_order(p_order_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if not public.is_owner() then
    raise exception 'Hanya owner yang bisa menolak pesanan.' using errcode = '42501';
  end if;

  if p_note is null or btrim(p_note) = '' then
    raise exception 'Alasan penolakan wajib diisi.' using errcode = 'P0001';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pesanan tidak ditemukan.' using errcode = 'P0001';
  end if;

  if v_order.status not in ('pending', 'confirmed') then
    raise exception 'Pesanan sudah berstatus %.', v_order.status using errcode = 'P0001';
  end if;

  update public.orders
  set status = 'cancelled',
      owner_note = p_note,
      responded_at = now(),
      responded_by = auth.uid(),
      updated_at = now()
  where id = p_order_id
  returning * into v_order;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.complete_order(p_order_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_note text;
begin
  if not public.is_owner() then
    raise exception 'Hanya owner yang bisa menyelesaikan pesanan.' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pesanan tidak ditemukan.' using errcode = 'P0001';
  end if;

  if v_order.status <> 'confirmed' then
    raise exception 'Pesanan harus di-ACC dulu sebelum diselesaikan.' using errcode = 'P0001';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is null then
    v_note := coalesce(nullif(v_order.owner_note, ''), 'Pesanan selesai.');
  end if;

  update public.orders
  set status = 'completed',
      owner_note = v_note,
      updated_at = now()
  where id = p_order_id
  returning * into v_order;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.upload_order_proof(p_order_id uuid, p_proof text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer uuid;
begin
  select buyer_id into v_buyer
  from public.orders
  where id = p_order_id;

  if v_buyer is null then
    raise exception 'Pesanan tidak ditemukan.';
  end if;

  -- WAJIB login. Perbandingan harus pakai IS DISTINCT FROM supaya anon
  -- (auth.uid() = null) tidak lolos karena hasil NULL.
  if auth.uid() is null
     or (v_buyer is distinct from auth.uid() and not public.is_owner()) then
    raise exception 'Akses ditolak: Hanya pembeli yang bersangkutan yang dapat mengunggah bukti transfer.'
      using errcode = '42501';
  end if;

  update public.orders
  set payment_proof = p_proof,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('ok', true);
end;
$$;

create index if not exists orders_buyer_idx
  on public.orders (buyer_id, created_at desc);

create index if not exists orders_status_idx
  on public.orders (status, created_at desc);

alter table public.orders enable row level security;

drop policy if exists orders_buyer_insert on public.orders;
create policy orders_buyer_insert
  on public.orders for insert
  to authenticated
  with check (
    buyer_id = auth.uid()
    and status = 'pending'
  );

drop policy if exists orders_buyer_select on public.orders;
create policy orders_buyer_select
  on public.orders for select
  to authenticated
  using (buyer_id = auth.uid());

drop policy if exists orders_buyer_update_proof on public.orders;
create policy orders_buyer_update_proof
  on public.orders for update
  to authenticated
  using (buyer_id = auth.uid())
  with check (buyer_id = auth.uid());

drop policy if exists orders_owner_all on public.orders;
create policy orders_owner_all
  on public.orders for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Buyer hanya boleh mengubah bukti transfer (payment_proof), bukan status
-- atau nominal pesanannya. Owner tetap bebas (ACC / TOLAK / SELESAI).
create or replace function public.guard_buyer_order_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role / SQL editor (maintenance) bebas. Anon TIDAK dibebaskan,
  -- supaya validasi bukti tetap berlaku kalau ada celah policy lain.
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.payment_proof is not null and length(new.payment_proof) > 2000000 then
    raise exception 'Ukuran bukti transfer terlalu besar (maksimal sekitar 2 MB).'
      using errcode = '22001';
  end if;

  if new.payment_proof is not null
     and btrim(new.payment_proof) <> ''
     and new.payment_proof not like 'data:image/%' then
    raise exception 'Bukti transfer harus berupa gambar (data:image/...).'
      using errcode = '22001';
  end if;

  if public.is_owner() then
    return new;
  end if;

  if new.buyer_id is distinct from old.buyer_id
     or new.status is distinct from old.status
     or new.product_id is distinct from old.product_id
     or new.product_name is distinct from old.product_name
     or new.amount is distinct from old.amount
     or new.admin_fee is distinct from old.admin_fee
     or new.notes is distinct from old.notes
     or new.payment_method is distinct from old.payment_method
     or new.pay_timing is distinct from old.pay_timing
     or new.due_date is distinct from old.due_date
     or new.owner_note is distinct from old.owner_note
     or new.responded_at is distinct from old.responded_at
     or new.responded_by is distinct from old.responded_by then
    raise exception 'Pembeli hanya boleh mengunggah bukti transfer pada pesanannya.'
      using errcode = '42501';
  end if;

  if old.status = 'cancelled' then
    raise exception 'Pesanan yang sudah ditolak tidak bisa diubah.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_buyer_order_update on public.orders;
create trigger guard_buyer_order_update
  before update on public.orders
  for each row execute function public.guard_buyer_order_update();

-- ============================================================================
-- 9. TRIGGER updated_at
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Pastikan nama buyer di pesanan diambil dari profil, bukan dari client.
create or replace function public.set_order_buyer_username()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text;
begin
  select username into uname
  from public.profiles
  where id = new.buyer_id;

  if uname is not null then
    new.buyer_username := uname;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_set_buyer_username on public.orders;
create trigger orders_set_buyer_username
  before insert on public.orders
  for each row execute function public.set_order_buyer_username();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

drop trigger if exists public_status_set_updated_at on public.public_status;
create trigger public_status_set_updated_at
  before update on public.public_status
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 10. GRANTS (RLS tetap yang menentukan baris mana yang boleh diakses)
-- ============================================================================
grant usage on schema public to anon, authenticated;

grant select on public.public_status to anon, authenticated;
grant select on public.products to anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.quests to authenticated;
grant select, insert, update, delete on public.app_settings to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update on public.orders to authenticated;
grant insert, update on public.public_status to authenticated;

grant execute on function public.modal_status() to anon, authenticated;
grant execute on function public.accept_order(uuid, text) to authenticated;
grant execute on function public.decline_order(uuid, text) to authenticated;
grant execute on function public.complete_order(uuid, text) to authenticated;
grant execute on function public.upload_order_proof(uuid, text) to authenticated;
grant execute on function public.guard_buyer_order_update() to authenticated;

-- ============================================================================
-- 11. REALTIME (buyer bisa lihat perubahan saldo modal & status pesanan)
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'public_status'
  ) then
    alter publication supabase_realtime add table public.public_status;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

-- ============================================================================
-- 12. CARA MENJADIKAN AKUN SEBAGAI OWNER
-- ============================================================================
-- 1. Dashboard -> Authentication -> Users -> Add user.
--    Email    : excel@keuanganku.app
--    Password : (password kuat pilihanmu)
--    Centang "Auto Confirm User".
-- 2. Jalankan SQL berikut (ganti email jika perlu):
--
--    insert into public.profiles (id, username, role, ip_hash)
--    select id, 'excel', 'owner', null
--    from auth.users
--    where email = 'excel@keuanganku.app'
--    on conflict (id) do update
--      set username = 'excel', role = 'owner', ip_hash = null;
--
-- Login di aplikasi memakai username "excel" + password yang kamu isi.
-- Password TIDAK disimpan di kode/aplikasi; Supabase Auth yang menyimpannya
-- dalam bentuk hash.
-- ============================================================================

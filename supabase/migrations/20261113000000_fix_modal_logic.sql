-- ============================================================================
-- FIX LOGIC MODAL & ADMIN FEE
-- ----------------------------------------------------------------------------
-- Aturan resmi (GEMINI.md):
--   Harga jual = Modal Pokok + Admin
--   Validasi modal HANYA memakai Modal Pokok (harga - admin), bukan harga total.
--
-- Migrasi ini:
--   1. Menambah kolom admin_fee di orders dan memastikan kolom products ada.
--   2. Mengisi admin_fee produk lama dari marker/deskripsi/nama.
--   3. Menghitung reserved HANYA dari modal pokok (amount - admin_fee).
--   4. Mengabaikan admin yang diketik buyer; admin produk diambil dari katalog.
--   5. Membuat RPC accept/decline/complete yang atomic dan tetap cek modal.
--
-- Jalankan di Supabase SQL Editor (atau `supabase db push`).
-- Aman dijalankan berulang (idempotent).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. KOLOM
-- ----------------------------------------------------------------------------
alter table public.products
  add column if not exists admin_fee numeric not null default 0;

alter table public.products
  add column if not exists sort_order integer not null default 0;

alter table public.orders
  add column if not exists admin_fee numeric not null default 0;

-- Pastikan nilai tidak negatif (tanpa menggagalkan kalau constraint sudah ada).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_admin_fee_non_negative'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_admin_fee_non_negative check (admin_fee >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'products_admin_fee_non_negative'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_admin_fee_non_negative check (admin_fee >= 0);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. BACKFILL admin_fee PRODUK LAMA
--    Prioritas: nominal di nama produk (modal pokok) -> marker [admin:N] ->
--    teks "admin 4k". Nominal nama didahulukan karena marker lama bisa basi
--    akibat bug edit produk (admin berubah, teks lama tidak ikut berubah).
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  v_admin numeric;
  m text[];
  v_num numeric;
  v_unit text;
begin
  for r in
    select id, name, description, price, coalesce(admin_fee, 0) as admin_fee
    from public.products
  loop
    continue when coalesce(r.admin_fee, 0) > 0;

    v_admin := 0;

    -- 1. Nominal di nama produk dianggap modal pokok.
    m := regexp_match(
      coalesce(r.name, ''),
      '([0-9]+(?:[.,][0-9]+)?)\s*(k|rb|ribu)',
      'i'
    );
    if m is not null then
      v_num := replace(m[1], ',', '.')::numeric * 1000;
      if v_num > 0 and v_num < coalesce(r.price, 0) then
        v_admin := coalesce(r.price, 0) - v_num;
      end if;
    end if;

    -- 2. Marker eksplisit.
    if v_admin = 0 then
      m := regexp_match(coalesce(r.description, ''), '\[admin:([0-9]+)\]');
      if m is not null then
        v_admin := m[1]::numeric;
      end if;
    end if;

    -- 3. Teks admin legacy.
    if v_admin = 0 then
      m := regexp_match(
        coalesce(r.description, ''),
        'admin\s*[:=]?\s*(?:rp\.?\s*)?([0-9]+(?:[.,][0-9]+)?)\s*(k|rb|ribu|jt|juta)?',
        'i'
      );

      if m is not null then
        if m[1] ~ '^[0-9]{1,3}([.,][0-9]{3})+$' then
          v_num := replace(replace(m[1], '.', ''), ',', '')::numeric;
        else
          v_num := replace(m[1], ',', '.')::numeric;
        end if;

        v_unit := lower(coalesce(m[2], ''));
        if v_unit in ('k', 'rb', 'ribu') then
          v_num := v_num * 1000;
        elsif v_unit in ('jt', 'juta') then
          v_num := v_num * 1000000;
        end if;
        v_admin := round(v_num);
      end if;
    end if;

    if v_admin < 0 then v_admin := 0; end if;
    if v_admin > coalesce(r.price, 0) then v_admin := coalesce(r.price, 0); end if;

    if v_admin > 0 then
      update public.products set admin_fee = v_admin where id = r.id;
    end if;
  end loop;
end $$;

-- Backfill order lama berdasarkan produk katalog.
update public.orders o
set admin_fee = least(o.amount, greatest(0, p.admin_fee))
from public.products p
where o.product_id = p.id
  and coalesce(o.admin_fee, 0) = 0
  and coalesce(p.admin_fee, 0) > 0;

-- ----------------------------------------------------------------------------
-- 3. STATUS MODAL PUBLIK
--    reserved = jumlah MODAL POKOK order pending + confirmed.
-- ----------------------------------------------------------------------------
-- Drop dulu supaya tipe return/param versi lama tidak bentrok.
do $$
declare
  r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'modal_status'
  loop
    execute format('drop function public.%I(%s)', r.proname, r.args);
  end loop;
end $$;

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

revoke all on function public.modal_status() from public;
grant execute on function public.modal_status() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. TRIGGER INSERT/UPDATE ORDER
--    - Admin produk diambil dari katalog (buyer tidak bisa menentukannya).
--    - Order custom: admin 0 saat insert; owner boleh menyesuaikan saat ACC.
--    - Reservasi memakai modal pokok, bukan harga total.
-- ----------------------------------------------------------------------------
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
  -- Order yang selesai/ditolak tidak lagi menahan modal.
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
    -- Update hanya boleh dilakukan owner (RLS). Clamp nilai admin.
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

-- ----------------------------------------------------------------------------
-- 5. RPC STATUS ORDER (atomic + cek modal)
-- ----------------------------------------------------------------------------
-- Drop versi lama supaya nama/tipenya tidak bentrok.
do $$
declare
  r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('accept_order', 'decline_order', 'complete_order')
  loop
    execute format('drop function public.%I(%s)', r.proname, r.args);
  end loop;
end $$;

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

revoke all on function public.accept_order(uuid, text) from public;
revoke all on function public.decline_order(uuid, text) from public;
revoke all on function public.complete_order(uuid, text) from public;

grant execute on function public.accept_order(uuid, text) to authenticated;
grant execute on function public.decline_order(uuid, text) to authenticated;
grant execute on function public.complete_order(uuid, text) to authenticated;

commit;

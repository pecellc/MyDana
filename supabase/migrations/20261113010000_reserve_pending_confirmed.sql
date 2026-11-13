-- Pastikan modal yang "tertahan" dihitung dari order pending + confirmed.
--
-- Sebelumnya fungsi di live DB sempat regresi: reserved hanya menghitung
-- status = 'pending', sehingga saat owner meng-ACC order (status -> confirmed)
-- modal yang tertahan langsung dilepas dan "modal tersedia" di panel buyer
-- terlihat naik padahal order masih berjalan.
--
-- Jalankan file ini di Supabase SQL Editor (atau `supabase db push`).

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

-- Status modal publik: reserved = modal pokok order pending + confirmed.
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

-- RPC status order: atomic + validasi modal pokok (pending + confirmed).
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

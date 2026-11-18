-- =====================================================================
-- SELF-HEAL MODAL PUBLIK (18 Nov 2026)
-- ---------------------------------------------------------------------
-- Masalah: public_status.modal_amount bisa tersimpan NETO (mis. 150.000
-- dari klien versi lama) padahal pool GROSS sebenarnya 300.000. Akibatnya
-- modal_status()/accept_order() melihat "tersedia Rp 0" dan ACC ditolak
-- dengan pesan "Saldo modal kios tidak cukup" walau saldo masih ada.
--
-- Solusi: hitung ulang pool GROSS dari ledger (tabel transactions) +
-- pulsa_config, lalu NAIKKAN modal_amount bila lebih kecil.
-- Raise-only: tidak pernah menurunkan nilai yang sudah ada.
-- =====================================================================

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

  -- public_status.owner_id bisa null (data lama) -> pakai owner app_settings.
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
    -- Tambah modal
    coalesce(sum(case when coalesce(payload->>'isTambahModal', 'false') = 'true'
                      then amount else 0 end), 0),
    -- Kurangi modal + pengeluaran langsung dari uang panas
    coalesce(sum(case when coalesce(payload->>'isKurangiModal', 'false') = 'true'
                       or coalesce(payload->>'isModalExpense', 'false') = 'true'
                      then amount else 0 end), 0),
    -- Setor / belanja modal pulsa
    coalesce(sum(case when coalesce(payload->>'isSetorModal', 'false') = 'true'
                      then amount else 0 end), 0),
    -- Modal pesanan OFFLINE yang masih tertahan (tidak dihitung DB reserved)
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

-- Hanya dipakai internal (accept_order/modal_status). Jangan diekspos ke anon.
revoke all on function public.heal_modal_pool() from public;

-- ---------------------------------------------------------------------
-- modal_status: pakai pool hasil self-heal (angka jujur ke buyer).
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- accept_order: self-heal dulu sebelum validasi modal pokok.
-- ---------------------------------------------------------------------
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

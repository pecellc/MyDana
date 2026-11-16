-- ============================================================================
-- TAMBAH KOLOM payment_proof PADA TABEL orders
-- ----------------------------------------------------------------------------
-- Memungkinkan buyer mengunggah bukti transfer screenshot (DANA / Bank),
-- dan owner dapat meninjau screenshot tersebut sebelum meng-ACC uang masuk.
-- ============================================================================

begin;

-- 1. Tambah kolom payment_proof jika belum ada
alter table public.orders
  add column if not exists payment_proof text;

-- 2. Kebijakan RLS agar buyer dapat memperbarui pesanan miliknya (khususnya bukti transfer)
drop policy if exists orders_buyer_update_proof on public.orders;
create policy orders_buyer_update_proof
  on public.orders for update
  to authenticated
  using (buyer_id = auth.uid())
  with check (buyer_id = auth.uid());

-- 3. Function security definer agar upload bukti transfer 100% tembus RLS
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

  if v_buyer <> auth.uid() and not public.is_owner() then
    raise exception 'Akses ditolak: Hanya pembeli yang bersangkutan yang dapat mengunggah bukti transfer.';
  end if;

  update public.orders
  set payment_proof = p_proof,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.upload_order_proof(uuid, text) to authenticated;

commit;

-- ============================================================================
-- BATASI UPDATE ORDERS OLEH BUYER HANYA UNTUK BUKTI TRANSFER
-- ----------------------------------------------------------------------------
-- Policy orders_buyer_update_proof sebelumnya mengizinkan buyer mengubah
-- SEMUA kolom pesanannya sendiri (status, amount, owner_note, dll). Trigger
-- ini mengunci buyer agar hanya bisa menyimpan payment_proof + updated_at.
-- Owner tetap bebas mengubah semua kolom (ACC / TOLAK / SELESAI / admin fee).
-- ============================================================================

begin;

create or replace function public.guard_buyer_order_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role / SQL editor (maintenance) bebas, tidak lewat JWT authenticated.
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;

  -- Batas ukuran bukti transfer (data URL base64) untuk client.
  if new.payment_proof is not null and length(new.payment_proof) > 2000000 then
    raise exception 'Ukuran bukti transfer terlalu besar (maksimal sekitar 2 MB).'
      using errcode = '22001';
  end if;

  -- Owner punya akses penuh (ACC / TOLAK / SELESAI / ubah admin fee).
  if public.is_owner() then
    return new;
  end if;

  -- Buyer hanya boleh mengganti bukti transfer pada pesanan yang belum ditolak.
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

-- Service role boleh memicu function (dipakai untuk admin/maintenance).
revoke all on function public.guard_buyer_order_update() from public;
grant execute on function public.guard_buyer_order_update() to authenticated;

commit;

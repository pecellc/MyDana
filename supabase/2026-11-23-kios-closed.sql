-- ============================================================
-- STATUS BUKA/TUTUP KIOS + KETERANGAN PENUTUPAN
-- ============================================================
-- Owner bisa menutup kios sementara dengan keterangan wajib.
-- Buyer melihat layar "kios tutup" + keterangan tersebut dan
-- tidak bisa membuat pesanan baru (dijaga juga di server).

alter table public.public_status
  add column if not exists is_open boolean not null default true,
  add column if not exists closed_note text,
  add column if not exists closed_at timestamptz;

-- Pastikan baris status selalu ada.
insert into public.public_status (id, modal_amount, is_open)
values (1, 0, true)
on conflict (id) do nothing;

-- modal_status(): sertakan status buka/tutup supaya buyer bisa membacanya.
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
  v_is_open boolean := true;
  v_closed_note text;
  v_closed_at timestamptz;
begin
  v_modal := public.heal_modal_pool();

  select coalesce(modal_amount, 0), updated_at,
         coalesce(is_open, true), closed_note, closed_at
    into v_modal, v_updated, v_is_open, v_closed_note, v_closed_at
  from public.public_status
  where id = 1;

  if v_modal is null then v_modal := 0; end if;
  if v_is_open is null then v_is_open := true; end if;

  select coalesce(sum(greatest(0, amount - coalesce(admin_fee, 0))), 0)
    into v_reserved
  from public.orders
  where status in ('pending', 'confirmed');

  return jsonb_build_object(
    'modal_amount', v_modal,
    'reserved', v_reserved,
    'available', greatest(0, v_modal - v_reserved),
    'updated_at', v_updated,
    'is_open', v_is_open,
    'closed_note', v_closed_note,
    'closed_at', v_closed_at
  );
end;
$$;

-- Tolak pesanan baru saat kios ditutup (pengaman server).
create or replace function public.enforce_kios_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open boolean := true;
  v_note text;
begin
  select coalesce(is_open, true), closed_note
    into v_open, v_note
  from public.public_status
  where id = 1;

  if v_open is false then
    raise exception 'Kios sedang tutup%.',
      case
        when v_note is null or btrim(v_note) = '' then ''
        else ': ' || v_note
      end
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_enforce_kios_open on public.orders;
create trigger orders_enforce_kios_open
  before insert on public.orders
  for each row execute function public.enforce_kios_open();

-- Verifikasi
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'public_status'
  and column_name in ('is_open', 'closed_note', 'closed_at');
select tgname from pg_trigger
where tgrelid = 'public.orders'::regclass and tgname = 'orders_enforce_kios_open';

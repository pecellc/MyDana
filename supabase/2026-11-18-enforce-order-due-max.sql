-- ============================================================
-- BATAS TEMPO MAKSIMAL 4 HARI (VERIFIKASI 2 LANGKAH BUYER)
-- ============================================================
-- Buyer hanya boleh memesan dengan tempo paling lambat 4 hari
-- dari hari ini (WIB). Berlaku sebagai pengaman server: walau
-- klien dimodifikasi, order dengan due_date > hari ini + 4 tetap
-- ditolak. Owner dikecualikan agar tetap bisa menyesuaikan tempo
-- hasil kesepakatan dengan pembeli.

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

  -- Owner boleh mengubah/memperpanjang tempo secara manual.
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

-- Verifikasi
select proname from pg_proc where proname = 'enforce_order_due_max';
select tgname from pg_trigger
where tgrelid = 'public.orders'::regclass and tgname = 'orders_enforce_due_max';

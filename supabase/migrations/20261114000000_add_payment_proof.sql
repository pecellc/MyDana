-- ============================================================================
-- TAMBAH KOLOM payment_proof PADA TABEL orders
-- ----------------------------------------------------------------------------
-- Memungkinkan buyer mengunggah bukti transfer screenshot (DANA / Bank),
-- dan owner dapat meninjau screenshot tersebut sebelum meng-ACC uang masuk.
-- ============================================================================

begin;

alter table public.orders
  add column if not exists payment_proof text;

commit;

-- Migrasi: Tambah kolom original_price untuk efek diskon psikologi produk
alter table public.products add column if not exists original_price numeric default null;

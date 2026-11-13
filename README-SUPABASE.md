# 🔌 Setup Supabase — KeuanganKu

Integrasi ini menambahkan:

- Login **username + password** untuk owner dan buyer (password di-hash oleh Supabase Auth, bukan disimpan di kode).
- Sesi tersimpan di browser, jadi tidak perlu login ulang saat membuka web lagi.
- **1 IP = 1 akun** untuk buyer (ditegakkan Edge Function + unique index).
- Owner memakai aplikasi lama; buyer memakai tampilan toko sendiri.
- Buyer **hanya bisa melihat saldo modal (uang panas)**, bukan total saldo owner.
- Data keuangan owner (transaksi, quest, pengaturan modal) disimpan di Supabase.
- Katalog produk + pesanan buyer.

> Password owner yang lama (`synei0529`) sudah dihapus dari kode. Password sekarang sepenuhnya dikelola Supabase Auth.

---

## 1. Ambil URL & anon key

1. Buka [Supabase Dashboard](https://supabase.com/dashboard).
2. Pilih project.
3. Masuk **Project Settings → API**.
4. Catat:
   - **Project URL** → `https://xxxx.supabase.co`
   - **anon / publishable key** → `eyJ...`

Jangan pernah menaruh **service_role key** di browser/aplikasi. Service role hanya dipakai di Edge Function.

---

## 2. Isi konfigurasi

Ada dua cara:

### Cara A — lewat aplikasi (paling mudah)
1. Buka `index.html` / `Buka_KeuanganKu.bat`.
2. Akan muncul layar **Setup Supabase**.
3. Tempel Project URL + anon key → **SIMPAN & MUAT ULANG**.

Konfigurasi disimpan di `localStorage` browser.

### Cara B — edit file
Edit `supabase-config.js`:

```js
const DEFAULT_CONFIG = {
  url: 'https://xxxx.supabase.co',
  anonKey: 'eyJ...',
  authEmailDomain: 'keuanganku.app',
  signupFunction: 'signup-ip'
};
```

---

## 3. Pasang tabel & RLS

1. Supabase Dashboard → **SQL Editor** → **New query**.
2. Copy seluruh isi `supabase/schema.sql`.
3. Klik **Run**.

Yang dibuat:

| Tabel | Fungsi |
|---|---|
| `profiles` | username, role owner/buyer, hash IP |
| `ip_registry` | kunci 1 IP = 1 akun (hanya service role) |
| `transactions` | catatan keuangan owner (private) |
| `quests` | wishlist owner (private) |
| `app_settings` | konfigurasi modal owner (private) |
| `public_status` | **hanya** saldo modal yang boleh dibaca buyer |
| `products` | katalog jualan |
| `orders` | pesanan buyer |

RLS memastikan buyer tidak bisa membaca transaksi, quest, atau total saldo owner.

### Sudah pernah pasang schema sebelumnya?

Jalankan juga file migrasi terbaru di `supabase/migrations/` lewat SQL Editor,
berurutan:

| Migrasi | Isi |
|---|---|
| `20261113000000_fix_modal_logic.sql` | validasi modal pokok (harga - admin), RPC ACC atomik |
| `20261113010000_reserve_pending_confirmed.sql` | modal tertahan dihitung dari order `pending` **dan** `confirmed` |

Tanpa migrasi terakhir, saat owner meng-ACC pesanan modal yang tertahan akan
terlepas dan saldo modal di panel buyer terlihat naik padahal pesanan masih
berjalan.

---

## 4. Buat akun owner

1. Dashboard → **Authentication → Users → Add user → Create new user**.
2. Isi:
   - **Email**: `excel@keuanganku.app`
   - **Password**: password kuat pilihanmu
   - Centang **Auto Confirm User**
3. Jalankan SQL ini di SQL Editor:

```sql
insert into public.profiles (id, username, role, ip_hash)
select id, 'excel', 'owner', null
from auth.users
where email = 'excel@keuanganku.app'
on conflict (id) do update
  set username = 'excel',
      role = 'owner',
      ip_hash = null;
```

4. Login di aplikasi dengan:
   - Username: `excel`
   - Password: password yang kamu isi tadi

Ganti `excel` / email jika mau username lain. Username owner tidak boleh sama dengan username buyer.

---

## 5. Deploy Edge Function `signup-ip` (aturan 1 IP = 1 akun)

Edge Function ini yang membaca IP asli dari request, membuat akun buyer, dan mengunci IP.

### Prasyarat
- [Supabase CLI](https://supabase.com/docs/guides/cli) terpasang.
- Sudah `supabase login`.

### Langkah

```bash
# di folder project ini
supabase link --project-ref <PROJECT_REF>

# salt untuk hash IP (buat string acak panjang, jangan dishare)
supabase secrets set IP_HASH_SALT="ganti-dengan-string-acak-panjang"

# deploy (tanpa JWT karena dipanggil sebelum user punya sesi)
supabase functions deploy signup-ip --no-verify-jwt
```

Opsional, ganti domain email internal:

```bash
supabase secrets set AUTH_EMAIL_DOMAIN="keuanganku.app"
```

> `SUPABASE_URL` dan key server otomatis tersedia di Edge Function. Jangan menyalin secret/service key ke file client.

### Kalau tidak memakai CLI / tidak bisa set Edge secret

Function `signup-ip` juga bisa membaca salt dari tabel `public.server_config`.
Jalankan sekali di SQL Editor (ganti salt-nya):

```sql
insert into public.server_config (key, value)
values ('ip_hash_salt', 'string-acak-panjang-pilihanmu')
on conflict (key) do update set value = excluded.value;
```

Urutan pembacaan salt: Edge secret `IP_HASH_SALT` → tabel `server_config`.
Tabel itu hanya bisa dibaca service role, client tidak bisa mengaksesnya.

### Catatan tentang API key format baru

Project baru Supabase memakai `sb_publishable_...` / `sb_secret_...`, bukan JWT lama.
Di Edge Function:

- `SUPABASE_URL` → otomatis
- `SUPABASE_SECRET_KEYS` → JSON dictionary berisi secret key (pengganti `SUPABASE_SERVICE_ROLE_KEY`)
- `SUPABASE_PUBLISHABLE_KEYS` → JSON dictionary berisi publishable key

Kode `signup-ip` otomatis mendukung keduanya (legacy `SUPABASE_SERVICE_ROLE_KEY`
maupun `SUPABASE_SECRET_KEYS`).

### Kalau belum deploy
Pendaftaran buyer akan menampilkan pesan:
“Edge Function `signup-ip` belum di-deploy. Hubungi owner.”

Login owner tetap bisa.

---

## 6. Pengaturan Auth tambahan

Di **Authentication → Providers → Email**:

- **Enable Email Provider**: ON.
- **Confirm email**: boleh OFF karena akun buyer dibuat lewat Edge Function dengan `email_confirm: true`.
- **Allow new users to sign up**: sebenarnya tidak wajib, karena pendaftaran buyer memakai Admin API di Edge Function. Boleh OFF untuk menutup pendaftaran langsung.
- **Minimum password length**: 6 atau lebih.

Buyer memakai email internal `username@keuanganku.app`, jadi tidak perlu verifikasi email.

---

## 7. Cara kerja harian

### Owner
1. Login username + password owner.
2. Aplikasi lama tampil seperti biasa.
3. Setiap transaksi disimpan ke cache lokal **dan** Supabase (debounce ±0,5 detik).
4. Tombol **Tambah Modal** memindahkan uang dingin yang sudah ada menjadi modal.
   Modal tidak bisa dibuat dari udara: kalau uang dingin kurang, catat dulu
   pemasukan (mis. "tambah 100k"), baru pindahkan ke modal.
5. Saldo modal dipublikasikan ke `public_status` saat owner mengubah modal,
   ACC/menyelesaikan pesanan, atau mencatat transaksi. Aplikasi tidak menimpa
   modal dengan angka 0 hanya karena tab baru dibuka.

### Buyer
1. Buka web → **DAFTAR** → isi username + password.
2. Edge Function mengecek IP; jika IP sudah dipakai, pendaftaran ditolak.
3. Setelah daftar, buyer otomatis login dan masuk ke **KeuanganKu Store**.
4. Buyer melihat:
   - saldo modal kios (bukan total saldo owner),
   - katalog produk,
   - form pesanan custom,
   - status pesanan miliknya.
5. Pesanan masuk ke tab **KIOS PULSA & MODAL** milik owner. Owner bisa **PROSES / SELESAI / BATAL** dan menambah produk lewat tombol **+ PRODUK**.

---

## 7b. Alur pesanan buyer (modal, pembayaran, ACC/TOLAK)

1. Buyer membuka toko, melihat **saldo modal** dan katalog.
   Katalog punya tab **SEMUA / PULSA / SALDO DANA**; kategori diatur owner saat
   menambah atau mengedit produk (kolom `category`). Kalau produk lama belum
   punya kategori, aplikasi menebaknya dari nama produk.
2. Buyer mengisi pesanan:
   - nama produk / nominal,
   - **kategori pembayaran**: DANA (satu-satunya metode di UI saat ini; order lama dengan metode lain tetap tampil & didukung),
   - **bayar kapan**: sekarang, atau nanti + pilih tanggal,
   - catatan (nomor tujuan, provider, dll).
3. **Validasi memakai MODAL POKOK (harga jual - jatah admin), bukan harga total.** Dicek dua lapis:
   - di browser (pesan langsung, tanpa request),
   - di database lewat trigger `enforce_order_modal()` + RPC `accept_order()` (tidak bisa diakali).
   Pesanan `pending` **dan** `confirmed` lain ikut mengurangi saldo tersedia
   (modal baru dilepas setelah order `completed`/`cancelled`). Contoh: produk
   Rp 14.000 dengan modal Rp 10.000 dan admin Rp 4.000 tetap bisa dipesan kalau
   modal tersedia Rp 10.000.
4. Pesanan masuk ke tab **KIOS PULSA** milik owner (realtime).
5. Owner menekan:
   - **ACC** → wajib mengisi keterangan untuk buyer (contoh: "Diterima, pulsa dikirim 5 menit lagi").
   - **TOLAK** → wajib mengisi alasan (contoh: "Stok pulsa habis").
   - **SELESAI** → menandai pesanan beres.
6. Buyer melihat status terbaru + pesan owner di daftar "Pesanan Saya".

Status pesanan: `pending` (menunggu) → `confirmed` (diterima) → `completed` (selesai), atau `cancelled` (ditolak).

> Keterangan/alasan wajib diisi juga dijaga constraint database
> `orders_response_note_check`, jadi tidak bisa ACC/TOLAK tanpa pesan.

---

## 8. Struktur file baru

| File | Fungsi |
|---|---|
| `supabase-config.js` | URL + anon key |
| `auth.js` | login, daftar, sesi, routing owner/buyer |
| `db.js` | baca/tulis Supabase (RLS-aware) |
| `buyer.js` | UI toko buyer |
| `supabase/schema.sql` | tabel, RLS, trigger, grant |
| `supabase/functions/signup-ip/index.ts` | Edge Function 1 IP = 1 akun |

---

## 9. Catatan penting

1. **Satu IP = 1 akun bersifat ketat.** Pengguna yang berbagi IP (WiFi publik, kantor, atau carrier-grade NAT operator seluler) bisa ikut terblokir. Kalau nanti terlalu ketat, aturan bisa dilonggarkan dengan mengubah Edge Function.
2. Hash IP memakai salt `IP_HASH_SALT`. Jangan ganti salt setelah ada akun, karena hash lama tidak akan cocok.
3. Jangan pernah commit **service_role key**. Anon key aman dipublikasikan.
4. File `app.js` tetap menyimpan cache di `localStorage` supaya aplikasi tidak blank saat internet putus. Data sumber utama tetap Supabase.
5. Karena aplikasi dibuka lewat `file://`, pastikan browser mengizinkan `localStorage` (Chrome normalnya mengizinkan). Kalau ada masalah sesi, jalankan lewat server lokal:
   ```bash
   python -m http.server 8080
   ```
   lalu buka `http://localhost:8080`.
6. Realtime (perubahan saldo modal & status pesanan) memakai publication `supabase_realtime` yang sudah diaktifkan di `schema.sql`. Kalau tidak aktif, tombol **REFRESH** tetap berfungsi.

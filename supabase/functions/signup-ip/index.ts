// ============================================================================
// EDGE FUNCTION: signup-ip
// ----------------------------------------------------------------------------
// Membuat akun buyer dengan aturan 1 IP = 1 akun.
// Dipanggil oleh auth.js saat pelanggan mendaftar.
//
// Deploy:
//   supabase functions deploy signup-ip --no-verify-jwt
//
// Secrets yang wajib di-set:
//   supabase secrets set IP_HASH_SALT="string-acak-panjang"
//   (SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY sudah otomatis tersedia)
//
// Optional:
//   supabase secrets set AUTH_EMAIL_DOMAIN="keuanganku.app"
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESERVED_USERNAMES = new Set([
  'admin', 'owner', 'excel', 'pecel', 'keuanganku', 'supabase', 'root', 'system'
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') || '';
  const first = forwarded.split(',')[0].trim();
  if (first) return first;
  return (req.headers.get('x-real-ip') || '').trim();
}

function readServiceKey(): string {
  // Proyek lama: JWT service_role
  const legacy = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (legacy) return legacy;

  // Proyek baru: secret key (sb_secret_...) berbentuk JSON dictionary
  for (const name of ['SUPABASE_SECRET_KEYS', 'SUPABASE_SECRET_KEY']) {
    const raw = (Deno.env.get(name) || '').trim();
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string' && parsed) return parsed;
      if (parsed && typeof parsed === 'object') {
        const preferred = (parsed as Record<string, unknown>)['default'];
        if (typeof preferred === 'string' && preferred) return preferred;
        const first = Object.values(parsed)[0];
        if (typeof first === 'string' && first) return first;
      }
    } catch {
      // Bukan JSON: anggap key mentah
      return raw;
    }
  }

  return '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method tidak diizinkan.' }, 405);
  }

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim();
  const serviceKey = readServiceKey();

  if (!supabaseUrl || !serviceKey) {
    return json({
      error: 'Server belum dikonfigurasi.',
      missing: {
        SUPABASE_URL: !supabaseUrl,
        SERVICE_KEY: !serviceKey,
      },
    }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Salt IP: utamakan env (Edge secret), kalau tidak ada baca dari tabel
  // public.server_config (hanya bisa diakses service role).
  let ipSalt = (Deno.env.get('IP_HASH_SALT') || '').trim();
  if (!ipSalt) {
    try {
      const { data } = await admin
        .from('server_config')
        .select('value')
        .eq('key', 'ip_hash_salt')
        .maybeSingle();
      ipSalt = String(data?.value || '').trim();
    } catch {
      ipSalt = '';
    }
  }

  if (!ipSalt) {
    return json({
      error: 'Salt IP belum diatur.',
      missing: { IP_HASH_SALT: true },
    }, 500);
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body JSON tidak valid.' }, 400);
  }

  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!/^[a-z0-9._]{3,24}$/.test(username) || username.startsWith('.') || username.endsWith('.')) {
    return json({
      error: 'Username 3-24 karakter. Hanya huruf kecil, angka, titik, dan underscore.',
    }, 400);
  }
  if (RESERVED_USERNAMES.has(username)) {
    return json({ error: 'Username ini tidak boleh dipakai. Pilih nama lain.' }, 409);
  }
  if (password.length < 6) {
    return json({ error: 'Password minimal 6 karakter.' }, 400);
  }
  if (password.length > 72) {
    return json({ error: 'Password maksimal 72 karakter.' }, 400);
  }

  const ip = clientIp(req);
  if (!ip) {
    return json({ error: 'IP tidak terdeteksi. Coba lagi.' }, 400);
  }

  const ipHash = await sha256Hex(`${ipSalt}:${ip}`);

  // 1. Cek IP sudah dipakai atau belum
  const { data: existingIp, error: ipLookupError } = await admin
    .from('ip_registry')
    .select('user_id')
    .eq('ip_hash', ipHash)
    .maybeSingle();

  if (ipLookupError) {
    return json({ error: 'Gagal memeriksa IP: ' + ipLookupError.message }, 500);
  }
  if (existingIp) {
    return json({ error: 'IP ini sudah terdaftar. Satu IP hanya boleh punya satu akun.' }, 409);
  }

  // 2. Cek username
  const { data: existingProfile, error: profileLookupError } = await admin
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (profileLookupError) {
    return json({ error: 'Gagal memeriksa username: ' + profileLookupError.message }, 500);
  }
  if (existingProfile) {
    return json({ error: 'Username sudah dipakai. Pilih yang lain.' }, 409);
  }

  // 3. Buat user di Supabase Auth (password di-hash oleh Supabase)
  const domain = Deno.env.get('AUTH_EMAIL_DOMAIN') || 'keuanganku.app';
  const email = `${username}@${domain}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  });

  if (createError || !created?.user) {
    const message = createError?.message || 'Gagal membuat akun.';
    const isDuplicate = /already|exists|registered/i.test(message);
    return json({ error: isDuplicate ? 'Username sudah dipakai. Pilih yang lain.' : message }, 409);
  }

  const userId = created.user.id;

  // 4. Pastikan profil berisi ip_hash (trigger sudah membuat profil dasar)
  const { error: profileUpsertError } = await admin
    .from('profiles')
    .upsert(
      { id: userId, username, role: 'buyer', ip_hash: ipHash },
      { onConflict: 'id' }
    );

  if (profileUpsertError) {
    await admin.auth.admin.deleteUser(userId);
    return json({ error: 'Profil gagal dibuat: ' + profileUpsertError.message }, 500);
  }

  // 5. Kunci IP. Jika race condition, batalkan pembuatan akun.
  const { error: ipInsertError } = await admin
    .from('ip_registry')
    .insert({ ip_hash: ipHash, user_id: userId });

  if (ipInsertError) {
    await admin.from('profiles').delete().eq('id', userId);
    await admin.auth.admin.deleteUser(userId);
    return json({ error: 'IP ini sudah terdaftar. Satu IP hanya boleh punya satu akun.' }, 409);
  }

  return json({ ok: true, username, email });
});

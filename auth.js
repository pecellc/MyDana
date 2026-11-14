/**
 * AUTH SUPABASE - KEUANGANKU
 * ------------------------------------------------------------------
 * - Login memakai username + password (dipetakan ke email internal).
 * - Sesi disimpan di localStorage oleh supabase-js, jadi tidak perlu
 *   login ulang saat membuka web lagi.
 * - Role diambil dari tabel public.profiles (owner / buyer).
 * - Pendaftaran buyer lewat Edge Function "signup-ip" (1 IP = 1 akun).
 */
(function () {
  'use strict';

  const cfg = window.SUPABASE_CONFIG || {};
  const configured = typeof window.isSupabaseConfigured === 'function'
    ? window.isSupabaseConfigured()
    : false;

  const PROFILE_CACHE_KEY = 'keuanganku_profile_v1';

  let client = null;
  let routedUserId = null;
  let currentProfile = null;
  let manualLogout = false;

  if (configured && window.supabase?.createClient) {
    client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'keuanganku_auth_v1'
      }
    });
  }

  // ---------------------------------------------------------------- helpers
  function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase();
  }

  function usernameToEmail(username) {
    return `${normalizeUsername(username)}@${cfg.authEmailDomain || 'keuanganku.app'}`;
  }

  function isValidUsername(username) {
    return /^[a-z0-9._]{3,24}$/.test(username) &&
      !username.startsWith('.') &&
      !username.endsWith('.');
  }

  function el(id) {
    return document.getElementById(id);
  }

  function setError(message) {
    const box = el('auth-error');
    if (!box) return;
    if (!message) {
      box.hidden = true;
      box.textContent = '';
      return;
    }
    box.hidden = false;
    box.textContent = message;
  }

  function setBusy(button, busy, labelWhenBusy = 'MEMPROSES...') {
    if (!button) return;
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = labelWhenBusy;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalLabel || button.textContent;
      button.disabled = false;
    }
  }

  function friendlyError(error) {
    const message = String(error?.message || error || 'Terjadi kesalahan.');
    if (/invalid login credentials/i.test(message)) return 'Username atau password salah.';
    if (/email not confirmed/i.test(message)) return 'Akun belum dikonfirmasi. Hubungi owner.';
    if (/user already registered/i.test(message)) return 'Username sudah dipakai.';
    if (/password should be at least/i.test(message)) return 'Password minimal 6 karakter.';
    if (/failed to fetch|networkerror|load failed/i.test(message)) {
      return 'Tidak bisa terhubung ke Supabase. Periksa koneksi internet dan URL project.';
    }
    return message;
  }

  function showSetup(show) {
    const setup = el('auth-setup');
    const forms = el('auth-forms');
    if (setup) setup.hidden = !show;
    if (forms) forms.hidden = !!show;
  }

  function setScreen(name) {
    document.documentElement.classList.remove('auth-pending');
    document.documentElement.setAttribute('data-screen', name);

    const authScreen = el('auth-screen');
    const buyerApp = el('buyer-app');
    const ownerApp = el('owner-app');

    if (authScreen) authScreen.hidden = name !== 'auth';
    if (buyerApp) buyerApp.hidden = name !== 'buyer';
    if (ownerApp) ownerApp.hidden = name !== 'owner';

    if (name === 'auth') {
      setError('');
      showSetup(!configured);
      if (!configured) {
        const setupUrl = el('setup-url');
        if (setupUrl) {
          if (!setupUrl.value && cfg.url && !/GANTI/i.test(cfg.url)) {
            setupUrl.value = cfg.url;
          }
          setTimeout(() => {
            if (setupUrl.value) {
              el('setup-key')?.focus();
            } else {
              setupUrl.focus();
            }
          }, 80);
        }
      } else {
        const userInput = el('login-username');
        if (userInput) setTimeout(() => userInput.focus(), 80);
      }
    }
  }

  function cacheProfile(profile) {
    try {
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    } catch (e) { /* ignore */ }
  }

  function readCachedProfile() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  function clearCachedProfile() {
    try {
      localStorage.removeItem(PROFILE_CACHE_KEY);
    } catch (e) { /* ignore */ }
  }

  // Kalau sesi Supabase benar-benar berakhir (refresh token gagal / logout
  // dari tab lain), jangan biarkan UI owner palsu tetap terbuka. Kembalikan
  // ke layar login supaya request berikutnya tidak kena RLS.
  function handleSessionLost(message) {
    currentProfile = null;
    routedUserId = null;
    window.__AUTH_ROLE__ = null;
    window.__AUTH_READY__ = false;
    if (window.KeuanganAuth) window.KeuanganAuth.profile = null;
    clearCachedProfile();
    setScreen('auth');
    setError(message || 'Sesi login sudah berakhir. Silakan login ulang.');
  }

  // ---------------------------------------------------------------- routing
  function routeProfile(profile) {
    if (!profile) {
      setScreen('auth');
      return;
    }

    currentProfile = profile;
    window.__AUTH_ROLE__ = profile.role;
    window.__AUTH_READY__ = true;
    window.KeuanganAuth.profile = profile;

    cacheProfile(profile);

    if (routedUserId !== profile.id) {
      routedUserId = profile.id;

      if (profile.role === 'owner') {
        setScreen('owner');
      } else {
        setScreen('buyer');
        if (window.BuyerApp?.start) {
          window.BuyerApp.start(profile);
        }
      }

      window.dispatchEvent(new CustomEvent('auth:ready', {
        detail: { role: profile.role, profile }
      }));
    }
  }

  // ---------------------------------------------------------------- API
  const Auth = {
    client,
    configured,
    profile: null,

    async init() {
      if (!configured) {
        setScreen('auth');
        showSetup(true);
        return null;
      }

      if (!client) {
        setScreen('auth');
        setError('Library Supabase gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.');
        return null;
      }

      const { data: { session }, error } = await client.auth.getSession();
      if (error) {
        console.warn('getSession error:', error);
      }
      if (!session?.user) {
        setScreen('auth');
        return null;
      }

      return this.loadProfile(session.user);
    },

    async loadProfile(user) {
      let profile = null;

      try {
        const { data, error } = await client
          .from('profiles')
          .select('id, username, role, created_at')
          .eq('id', user.id)
          .maybeSingle();

        if (error) throw error;
        if (data) profile = data;
      } catch (error) {
        console.warn('Gagal memuat profil dari Supabase:', error);
        const msg = String(error?.message || error || '');
        if (/jwt|not authenticated|invalid claim|permission denied|row-level security|refresh token/i.test(msg)) {
          // Token sudah tidak valid: jangan pakai cache owner, karena UI akan
          // terlihat login padahal semua tulisannya ditolak RLS.
          handleSessionLost('Sesi login sudah berakhir. Silakan login ulang.');
          return null;
        }
        const cached = readCachedProfile();
        if (cached?.id === user.id) {
          profile = cached;
        }
      }

      if (!profile) {
        const fallbackUsername =
          user.user_metadata?.username ||
          String(user.email || '').split('@')[0] ||
          'user';

        profile = {
          id: user.id,
          username: fallbackUsername,
          role: 'buyer',
          created_at: user.created_at
        };
      }

      routeProfile(profile);
      return profile;
    },

    async signIn(username, password) {
      if (!client) throw new Error('Supabase belum siap.');

      const cleanUsername = normalizeUsername(username);
      if (!isValidUsername(cleanUsername)) {
        throw new Error('Username 3-24 karakter. Hanya huruf kecil, angka, titik, dan underscore.');
      }
      if (!password) throw new Error('Password wajib diisi.');

      const { data, error } = await client.auth.signInWithPassword({
        email: usernameToEmail(cleanUsername),
        password
      });

      if (error) throw new Error(friendlyError(error));
      return this.loadProfile(data.user);
    },

    async signUp(username, password) {
      if (!client) throw new Error('Supabase belum siap.');

      const cleanUsername = normalizeUsername(username);
      if (!isValidUsername(cleanUsername)) {
        throw new Error('Username 3-24 karakter. Hanya huruf kecil, angka, titik, dan underscore.');
      }
      if (password.length < 6) {
        throw new Error('Password minimal 6 karakter.');
      }

      const functionName = cfg.signupFunction || 'signup-ip';
      const endpoint = `${cfg.url.replace(/\/$/, '')}/functions/v1/${functionName}`;

      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: cfg.anonKey,
            Authorization: `Bearer ${cfg.anonKey}`
          },
          body: JSON.stringify({ username: cleanUsername, password })
        });
      } catch (error) {
        throw new Error('Tidak bisa menghubungi server pendaftaran. Periksa koneksi internet.');
      }

      let payload = {};
      try {
        payload = await response.json();
      } catch (e) {
        payload = {};
      }

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Edge Function "signup-ip" belum di-deploy. Hubungi owner.');
        }
        throw new Error(payload.error || 'Pendaftaran gagal. Coba lagi.');
      }

      return this.signIn(cleanUsername, password);
    },

    async updatePassword(newPassword, oldPassword = null) {
      if (!client) throw new Error('Supabase belum siap.');
      const cleanNew = String(newPassword || '').trim();
      if (!cleanNew || cleanNew.length < 6) {
        throw new Error('Password baru minimal 6 karakter.');
      }

      // Jika diberikan oldPassword, verifikasi dulu kecocokannya
      if (oldPassword && currentProfile?.username) {
        const { error: verifyErr } = await client.auth.signInWithPassword({
          email: usernameToEmail(currentProfile.username),
          password: oldPassword
        });
        if (verifyErr) {
          throw new Error('Password lama salah. Periksa kembali.');
        }
      }

      const { data, error } = await client.auth.updateUser({
        password: cleanNew
      });

      if (error) {
        throw new Error(friendlyError(error));
      }

      return data;
    },

    async logout() {
      manualLogout = true;
      try {
        if (client) await client.auth.signOut();
      } catch (error) {
        console.warn('Logout error:', error);
      }
      clearCachedProfile();
      window.location.reload();
    }
  };

  window.KeuanganAuth = Auth;
  window.Auth = Auth;

  // Pantau perubahan sesi Supabase. Kalau token mati / logout dari tab lain,
  // paksa kembali ke layar login supaya tidak ada owner UI palsu.
  if (client?.auth?.onAuthStateChange) {
    client.auth.onAuthStateChange((event, session) => {
      if (manualLogout) return;
      if (event === 'SIGNED_OUT' || ((event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && !session)) {
        handleSessionLost('Sesi login sudah berakhir. Silakan login ulang.');
      }
    });
  }

  // ---------------------------------------------------------------- UI wiring
  document.addEventListener('DOMContentLoaded', async () => {
    // Tab login / daftar
    const tabLogin = el('tab-login');
    const tabRegister = el('tab-register');
    const loginForm = el('login-form');
    const registerForm = el('register-form');

    function showLoginTab() {
      tabLogin?.classList.add('active');
      tabRegister?.classList.remove('active');
      if (loginForm) loginForm.hidden = false;
      if (registerForm) registerForm.hidden = true;
      setError('');
    }

    function showRegisterTab() {
      tabRegister?.classList.add('active');
      tabLogin?.classList.remove('active');
      if (registerForm) registerForm.hidden = false;
      if (loginForm) loginForm.hidden = true;
      setError('');
    }

    tabLogin?.addEventListener('click', showLoginTab);
    tabRegister?.addEventListener('click', showRegisterTab);

    // Form login
    loginForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      setError('');
      const submitBtn = loginForm.querySelector('button[type="submit"]');
      const username = el('login-username')?.value || '';
      const password = el('login-password')?.value || '';

      setBusy(submitBtn, true, 'MASUK...');
      try {
        await Auth.signIn(username, password);
        const passEl = el('login-password');
        if (passEl) passEl.value = '';
      } catch (error) {
        setError(friendlyError(error));
      } finally {
        setBusy(submitBtn, false);
      }
    });

    // Form daftar
    registerForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      setError('');

      const submitBtn = registerForm.querySelector('button[type="submit"]');
      const username = el('register-username')?.value || '';
      const password = el('register-password')?.value || '';
      const confirm = el('register-confirm')?.value || '';

      if (password !== confirm) {
        setError('Konfirmasi password tidak sama.');
        return;
      }

      setBusy(submitBtn, true, 'MEMBUAT AKUN...');
      try {
        await Auth.signUp(username, password);
        const passEl = el('register-password');
        const confirmEl = el('register-confirm');
        if (passEl) passEl.value = '';
        if (confirmEl) confirmEl.value = '';
      } catch (error) {
        setError(friendlyError(error));
      } finally {
        setBusy(submitBtn, false);
      }
    });

    // Form setup Supabase (jika config belum diisi)
    el('setup-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const url = String(el('setup-url')?.value || '').trim().replace(/\/$/, '');
      const anonKey = String(el('setup-key')?.value || '').trim();

      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
        setError('URL harus berbentuk https://xxxx.supabase.co');
        return;
      }
      if (anonKey.length < 20) {
        setError('Anon key tidak valid.');
        return;
      }

      try {
        localStorage.setItem('keuanganku_supabase_config', JSON.stringify({
          url,
          anonKey,
          authEmailDomain: cfg.authEmailDomain || 'keuanganku.app',
          signupFunction: cfg.signupFunction || 'signup-ip'
        }));
      } catch (e) {
        setError('Gagal menyimpan konfigurasi di browser.');
        return;
      }

      window.location.reload();
    });

    // Logout buyer
    el('buyer-logout')?.addEventListener('click', () => Auth.logout());

    // Saat tab dibuka lagi, cek apakah sesi masih hidup. Tab lama yang
    // refresh token-nya sudah tidak valid akan dikembalikan ke layar login.
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible' || !client) return;
      try {
        const { data, error } = await client.auth.getSession();
        if (error || !data?.session) {
          handleSessionLost('Sesi login sudah berakhir. Silakan login ulang.');
        }
      } catch (e) {
        console.warn('Cek sesi saat tab aktif gagal:', e);
      }
    });

    // Jalankan pemeriksaan sesi
    try {
      await Auth.init();
    } catch (error) {
      setScreen('auth');
      setError(friendlyError(error));
    }
  });
})();

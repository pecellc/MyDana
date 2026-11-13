/**
 * KONFIGURASI SUPABASE
 * ------------------------------------------------------------------
 * Isi url + anonKey dari:
 *   Supabase Dashboard -> Project Settings -> API
 *
 * Catatan keamanan:
 * - anonKey memang boleh ada di browser (public key).
 * - SERVICE ROLE KEY TIDAK BOLEH ditaruh di file ini. Service role hanya
 *   dipakai di Edge Function (signup-ip) sebagai secret server.
 *
 * Bisa juga diisi lewat layar "Setup Supabase" di aplikasi (disimpan di
 * localStorage browser) tanpa mengedit file ini.
 */
(function () {
  'use strict';

  const DEFAULT_CONFIG = {
    url: 'https://ziibivkhualutrdiojto.supabase.co',
    anonKey: 'sb_publishable_ANRQlXziic4fI7Okoc8sfQ_5QzeEEKY',
    authEmailDomain: 'keuanganku.app',
    signupFunction: 'signup-ip'
  };

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('keuanganku_supabase_config') || '{}');
  } catch (e) {
    saved = {};
  }

  window.SUPABASE_CONFIG = Object.assign({}, DEFAULT_CONFIG, saved || {});

  window.isSupabaseConfigured = function () {
    const cfg = window.SUPABASE_CONFIG || {};
    return Boolean(
      cfg.url &&
      cfg.anonKey &&
      !/GANTI/i.test(cfg.url) &&
      !/GANTI/i.test(cfg.anonKey)
    );
  };
})();

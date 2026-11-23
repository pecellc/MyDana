/**
 * KeuanganKu - MINECRAFT SKY EDITION
 * Sistem Pemisahan Uang Panas vs Uang Dingin & Kios Pulsa HUD
 * 
 * 1. 🧊 UANG DINGIN: Uang riil bersih milik pribadi (gaji, cuan, bonus, sisa jajan)
 *    -> SATU-SATUNYA yang BOLEH masuk ke Milestone Wishlist!
 * 2. 🔥 UANG PANAS (DOMPET MODAL): Modal usaha pulsa yang wajib diputar kembali
 *    -> TIDAK BOLEH masuk ke Milestone Wishlist!
 * 3. Dompet Modal otomatis bertambah utuh saat pulsa terjual, dan bisa ditambah (+) atau dikurangi (-).
 * 4. Milestone Perayaan Uang Dingin:
 *    - >= 100k: Konfeti partikel Minecraft!
 *    - >= 200k: Konfeti + Banner Selamat (Advancement Made)!
 *    - >= 300k: Konfeti + Banner Selamat + Refrain "Money Talk" 8-bit Riff!
 * 5. Multi-Split Parser: misal "masuk 100k 50k dingin 50k panas di dana"
 * 6. Typo Tolerance Kategori: "gopayyyy" -> GoPay, "daana" -> DANA, dll.
 *    Jika tidak ada kategori yang disebut -> otomatis masuk ke Dompet!
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'keuanganku_minecraft_v5';

  const ALLOWED_LOCATIONS = [
    'DANA',
    'GoPay',
    'Dompet',
    'Uang Akan Datang (Hutang)'
  ];

  let state = {
    locations: [...ALLOWED_LOCATIONS],
    items: [],
    quests: [], // Wishlist / Quest target barang
    filterLocation: 'all',
    searchQuery: '',
    recapPeriod: 'month', // 'today', 'month', 'year', 'all'
    pulsaConfig: {
      baseModal: 0,
      manualModalOffset: 0
    },
    settings: {
      sfx: true,
      bgm: true,
      theme: 'night',
      floatingPhotos: false
    },
    auth: {
      isLoggedIn: false,
      user: ''
    },
    activeDebtorModal: null,
    ownerCatalog: []
  };

  // ===================================================================
  // OWNER PRODUK & KATALOG MANAGER (TAB 2 PREVIEW & TAB 6 LENGKAP)
  // ===================================================================
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Kategori produk sekarang: `dana` dan `gopay` (tab PULSA sudah diganti
  // GOPAY). Nilai lama tetap dipetakan supaya produk lama tidak rusak.
  function normalizeProductCategory(value) {
    const raw = String(value || '').toLowerCase().trim();
    if (raw === 'dana' || raw === 'saldo' || raw === 'saldo-dana') return 'dana';
    if (raw === 'pulsa' || raw === 'kuota' || raw === 'token' || raw === 'data') return 'pulsa';
    return 'gopay';
  }

  function renderOwnerProducts(products) {
    const prods = Array.isArray(products) ? products : [];

    // 1. Render Preview Cards di Tab 2 (Kios Pulsa)
    const previewEl = document.getElementById('kios-tab-products-preview');
    if (previewEl) {
      if (!prods.length) {
        previewEl.innerHTML = `
          <div style="background: rgba(15,23,42,0.6); border: 1.5px dashed #475569; padding: 10px 14px; border-radius: 6px; width: 100%; color: #94a3b8; font-size: 0.78rem;">
            Belum ada produk di katalog. Klik <strong>[➕ TAMBAH PRODUK]</strong> untuk menambahkan produk pulsa/saldo.
          </div>
        `;
      } else {
        previewEl.innerHTML = prods.map(p => {
          const modal = p.modal_needed != null ? p.modal_needed : Math.max(0, p.price - (p.admin_fee || 0));
          const admin = p.admin_fee || 0;
          const isActive = p.active !== false;
          return `
            <div style="background: rgba(15,23,42,0.85); border: 1.5px solid ${isActive ? '#334155' : '#475569'}; opacity: ${isActive ? '1' : '0.65'}; padding: 8px 12px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex: 1 1 210px;">
              <div>
                <div style="font-weight:700; color:#fff; font-size:0.86rem; display:flex; align-items:center; gap:5px;">
                  <span>${esc(p.name)}</span>
                  ${!isActive ? '<span style="font-size:9px; background:#475569; padding:1px 4px; border-radius:3px;">OFF</span>' : ''}
                </div>
                <div style="font-size:0.68rem; color:#94a3b8; margin-top:2px;">
                  🔥 Modal: <strong style="color:#fb923c;">${formatRupiah(modal)}</strong> •
                  💎 Admin: <strong style="color:var(--mc-emerald);">${formatRupiah(admin)}</strong>
                </div>
              </div>
              <div style="text-align:right;">
                <div style="font-family:var(--mc-pixel-font); font-size:9.5px; color:var(--mc-gold);">${formatRupiah(p.price)}</div>
                <button class="mc-btn" style="padding:2px 7px; font-size:7px; margin-top:3px;" onclick="window.App.openProductModal('${p.id}')">✏️ EDIT</button>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 2. Render Tabel Lengkap di Tab 6 (Katalog & Harga)
    const tbody = document.getElementById('owner-products-body');
    if (tbody) {
      if (!prods.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align:center; color:#94a3b8; padding:32px 16px;">
              <div style="font-size:2rem; margin-bottom:8px;">📦</div>
              <div style="font-size:0.92rem; font-weight:700; color:#f1f5f9;">Belum Ada Produk di Katalog</div>
              <div style="font-size:0.75rem; color:#94a3b8; margin-top:4px;">Tambahkan produk pulsa / saldo agar pembeli bisa memesan dari aplikasinya.</div>
              <button class="mc-btn mc-btn-green" style="margin-top:14px;" onclick="window.App.openProductModal()">
                ➕ TAMBAH PRODUK BARU
              </button>
            </td>
          </tr>
        `;
      } else {
        tbody.innerHTML = prods.map((p, idx) => {
          const modal = p.modal_needed != null ? p.modal_needed : Math.max(0, p.price - (p.admin_fee || 0));
          const admin = p.admin_fee || 0;
          const isFirst = idx === 0;
          const isLast = idx === prods.length - 1;

          return `
            <tr>
              <td style="text-align:center;">
                <div class="mini-btn-group" style="justify-content:center;">
                  <button class="mc-sort-btn" onclick="window.App.moveProductSort('${p.id}', -1)" ${isFirst ? 'disabled' : ''} title="Pindah Naik">⬆️</button>
                  <button class="mc-sort-btn" onclick="window.App.moveProductSort('${p.id}', 1)" ${isLast ? 'disabled' : ''} title="Pindah Turun">⬇️</button>
                </div>
              </td>
              <td>
                <div style="font-weight:700; color:#f8fafc; font-size:0.88rem;">${esc(p.name)}</div>
                ${p.description ? `<div style="font-size:0.72rem; color:#94a3b8; margin-top:2px;">${esc(p.description)}</div>` : ''}
              </td>
              <td style="text-align:right; font-weight:700; color:#fb923c;">
                ${formatRupiah(modal)}
              </td>
              <td style="text-align:right; font-weight:700; color:var(--mc-emerald);">
                ${formatRupiah(admin)}
              </td>
              <td style="text-align:right;">
                <div style="font-family:var(--mc-pixel-font); font-size:9.5px; color:var(--mc-gold);">${formatRupiah(p.price)}</div>
                ${(p.original_price && p.original_price > p.price) ? `
                  <div style="font-size:0.7rem; color:#94a3b8; margin-top:2px;">
                    <span style="text-decoration:line-through;">${formatRupiah(p.original_price)}</span>
                    <span class="mc-discount-badge" style="font-size:6px; padding:1px 4px;">-${p.discount_percent}%</span>
                  </div>
                ` : ''}
              </td>
              <td style="text-align:center;">
                <span class="${p.active !== false ? 'status-pill-visible' : 'status-pill-hidden'}" onclick="window.App.toggleProductActive('${p.id}', ${p.active !== false})" title="Klik untuk ubah status visibilitas">
                  ${p.active !== false ? '🟢 TAMPIL' : '👁️‍🗨️ SEMBUNYI'}
                </span>
              </td>
              <td style="text-align:center;">
                <div style="display:flex; justify-content:center; gap:6px;">
                  <button class="mc-btn" style="padding:4px 8px; font-size:7.5px;" onclick="window.App.openProductModal('${p.id}')" title="Edit Produk">
                    ✏️ EDIT
                  </button>
                  <button class="mc-btn mc-btn-redstone" style="padding:4px 8px; font-size:7.5px;" onclick="window.App.deleteProduct('${p.id}')" title="Hapus Produk">
                    🗑️
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  }

  function autoStartBgm() {
    state.settings.bgm = true;
    try {
      localStorage.setItem('keuanganku_sky_bgm', 'true');
    } catch (e) {}

    const updateBgmUi = () => {
      ['bgm-btn', 'buyer-bgm-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
          btn.innerHTML = `<span class="bgm-icon">🎵</span> BGM: ON`;
          btn.classList.add('active');
        }
      });
      ['sfx-btn', 'buyer-sfx-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
          btn.textContent = state.settings?.sfx !== false ? '🔊 SFX: ON' : '🔇 SFX: OFF';
        }
      });
    };
    updateBgmUi();

    try {
      AudioEngine.init();
      if (AudioEngine.ctx && AudioEngine.ctx.state === 'running' && !AudioEngine.bgmIsPlaying) {
        AudioEngine.startBgm();
      }
    } catch (e) {}

    const startOnFirstAction = () => {
      if (state.settings?.bgm !== false) {
        try {
          AudioEngine.init();
          if (AudioEngine.ctx) {
            if (AudioEngine.ctx.state === 'suspended') {
              AudioEngine.ctx.resume().then(() => {
                if (!AudioEngine.bgmIsPlaying) AudioEngine.startBgm();
                updateBgmUi();
              }).catch(() => {});
            } else if (!AudioEngine.bgmIsPlaying) {
              AudioEngine.startBgm();
              updateBgmUi();
            }
          }
        } catch (e) {}
      }
      if (AudioEngine.bgmIsPlaying) {
        ['click', 'keydown', 'touchstart', 'pointerdown'].forEach(ev => {
          window.removeEventListener(ev, startOnFirstAction);
          document.removeEventListener(ev, startOnFirstAction);
        });
      }
    };

    ['click', 'keydown', 'touchstart', 'pointerdown'].forEach(ev => {
      window.addEventListener(ev, startOnFirstAction, { passive: true });
      document.addEventListener(ev, startOnFirstAction, { passive: true });
    });
  }
  function isOwnerName(name) {
    if (!name) return false;
    const clean = String(name).trim().toLowerCase();
    return clean === 'excel' || clean === 'pecel' || clean === 'admin' || clean === 'owner';
  }

  // Helper Format Rupiah
  function formatRupiah(num, prefix = 'Rp ') {
    if (isNaN(num)) num = 0;
    const formatted = Math.round(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return prefix + formatted;
  }

  // Helper parse nominal dari prompt: "12k", "1,5jt", "250000", "12.000"
  function parseRupiahInput(input) {
    if (!input) return 0;
    const text = String(input).toLowerCase().trim().replace(/\s+/g, '');
    const numberPart = parseFloat(text.replace(/[^\d.,]/g, '').replace(',', '.'));

    if (!isFinite(numberPart)) return 0;
    if (/jt|juta|mio/.test(text)) return Math.round(numberPart * 1000000);
    if (/rb|ribu|k\b|\dk/.test(text)) return Math.round(numberPart * 1000);
    return Math.round(parseInt(text.replace(/[^\d]/g, ''), 10) || 0);
  }

  // ===================================================================
  // FORMATTER RIBUAN OTOMATIS (5000 -> 5.000) UNTUK INPUT NOMINAL
  // ===================================================================
  function attachRupiahInputFormatter(inputEl) {
    if (!inputEl || inputEl._rupiahFormatterBound) return;
    inputEl._rupiahFormatterBound = true;

    inputEl.addEventListener('input', function () {
      if (inputEl.dataset.rupiah !== '1') return;

      const raw = inputEl.value || '';
      const digits = raw.replace(/\D/g, '');
      const caret = typeof inputEl.selectionStart === 'number' ? inputEl.selectionStart : raw.length;
      const digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, '').length;

      if (!digits) {
        if (raw !== '') inputEl.value = '';
        return;
      }

      const trimmed = digits.replace(/^0+(?=\d)/, '');
      const formatted = trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      if (formatted === raw) return;

      inputEl.value = formatted;

      // Kembalikan posisi kursor setelah jumlah digit yang sama.
      let pos = 0;
      let seen = 0;
      while (pos < formatted.length && seen < digitsBeforeCaret) {
        if (/\d/.test(formatted[pos])) seen++;
        pos++;
      }
      try {
        inputEl.setSelectionRange(pos, pos);
      } catch (err) {}
    });
  }

  function applyRupiahInitialFormat(inputEl) {
    if (!inputEl || inputEl.dataset.rupiah !== '1') return;
    const raw = String(inputEl.value || '').trim();
    if (!/^\d+$/.test(raw)) return;
    inputEl.value = raw.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function setupRupiahInput(inputEl) {
    if (!inputEl) return;
    inputEl.type = 'text';
    inputEl.inputMode = 'numeric';
    inputEl.dataset.rupiah = '1';
    attachRupiahInputFormatter(inputEl);
    applyRupiahInitialFormat(inputEl);
  }

  // Waktu & Tanggal Lengkap (WIB)
  function formatDateTime(isoStr) {
    if (!isoStr) return '-';
    const d = new Date(isoStr);
    const datePart = d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    const timePart = d.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    }).replace('.', ':') + ' WIB';

    return `<div style="line-height: 1.35;"><span style="font-weight: 700;">${datePart}</span><br><span style="font-size: 0.74rem; color: #94a3b8; font-weight: 600;">⏰ ${timePart}</span></div>`;
  }

  // Helper Pengecekan Tanggal
  function isToday(d) {
    const n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  }

  function isThisMonth(d) {
    const n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
  }

  function isThisYear(d) {
    const n = new Date();
    return d.getFullYear() === n.getFullYear();
  }

  // Levenshtein distance untuk pencocokan typo
  function levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        }
      }
    }
    return matrix[b.length][a.length];
  }

  // Deteksi Kategori dengan Toleransi Typo (misal: "gopayyyy", "daana", dll.)
  // Jika tidak menyebutkan kategori sama sekali -> kembalikan null (akan default ke 'Dompet')
  function detectCategoryWithTypo(text) {
    if (!text) return null;
    const lower = text.toLowerCase();

    // 1. Gopay variants & typos (gopayyyy, goopay, gpay, gojek, gopy, gopai)
    if (/\b(?:g+o+p+a+y+|g+o+j+e+k+|g+p+a+y+|g+o+p+y+|g+o+p+a+i+|g+p+a+i+)\b/i.test(lower)) {
      return 'GoPay';
    }
    if (/\bg+o+p+[aeiy]+/i.test(lower)) {
      return 'GoPay';
    }

    // 2. DANA variants & typos (daana, danaaa, dannna, danna, edana)
    if (/\b(?:e*[-_]?d+a+n+a+|d+a+n+n+a+|d+a+h?n+a+)\b/i.test(lower)) {
      return 'DANA';
    }
    if (/\bd+a+n+a+\b/i.test(lower)) {
      return 'DANA';
    }

    // 3. Dompet / Cash / Tunai variants
    if (/\b(?:d+o+m+p+e*t+|d+m+p+e*t+|t+u+n+a+[iy]+|c+a+s+h+|f+i+s+i+k+|l+a+c+i+|s+a+k+u+)\b/i.test(lower)) {
      return 'Dompet';
    }

    // 4. Hutang variants
    if (/\b\w*(?:h+u+t+a+n+g+|n+g+u+t+a+n+g+|p+i+n+j+a+m+|p+i+n+j+e+m+|p+i+u+t+a+n+g+|k+a+s+b+o+n+)\w*\b/i.test(lower)) {
      return 'Uang Akan Datang (Hutang)';
    }

    // Levenshtein fuzzy match
    const words = lower.split(/[^a-z0-9]+/);
    for (const w of words) {
      if (w.length >= 3) {
        if (levenshtein(w, 'gopay') <= 2) return 'GoPay';
        if (levenshtein(w, 'dana') <= 1 && w !== 'dan') return 'DANA';
        if (levenshtein(w, 'dompet') <= 2) return 'Dompet';
        if (levenshtein(w, 'tunai') <= 2) return 'Dompet';
      }
    }

    return null; // Tidak ada kategori yang disebut -> akan default ke 'Dompet'
  }

  // ===================================================================
  // WEB AUDIO API 8-BIT RETRO SOUND ENGINE (WITH "MONEY TALK" & TERRARIA BGM)
  // ===================================================================
  const AudioEngine = {
    ctx: null,
    bgmGainNode: null,
    bgmTimer: null,
    bgmIsPlaying: false,
    bgmStep: 0,

    init: function () {
      if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      if (this.ctx && !this.bgmGainNode) {
        this.bgmGainNode = this.ctx.createGain();
        this.bgmGainNode.gain.setValueAtTime(0.12, this.ctx.currentTime); // Volume santai & jelas terdengar
        this.bgmGainNode.connect(this.ctx.destination);
      }
    },
    play: function (type) {
      if (!state.settings?.sfx) return;
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        if (type === 'coin') {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(987.77, now);
          osc.frequency.setValueAtTime(1318.51, now + 0.08);
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.35);
        } else if (type === 'trade' || type === 'pulsa') {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(523.25, now);        // C5
          osc.frequency.setValueAtTime(659.25, now + 0.07); // E5
          osc.frequency.setValueAtTime(783.99, now + 0.14); // G5
          osc.frequency.setValueAtTime(1046.50, now + 0.21); // C6
          gain.gain.setValueAtTime(0.14, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.45);
        } else if (type === 'click') {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(440, now);
          gain.gain.setValueAtTime(0.08, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.09);
        } else if (type === 'fanfare') {
          const freqs = [523.25, 659.25, 783.99, 1046.50];
          freqs.forEach((f, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const t = now + (i * 0.08);
            osc.type = 'square';
            osc.frequency.setValueAtTime(f, t);
            gain.gain.setValueAtTime(0.09, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(t);
            osc.stop(t + 0.2);
          });
        } else if (type === 'hurt') {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.exponentialRampToValueAtTime(55, now + 0.22);
          gain.gain.setValueAtTime(0.18, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.28);
        } else if (type === 'disappointed') {
          // 8-Bit Suara Kecewa / Sad Trombone "wah-wah-wah-waaah" saat Uang Panas diambil
          const sadNotes = [
            { f: 311.13, d: 0.20, t: 0.00 }, // Eb4 (wah)
            { f: 293.66, d: 0.20, t: 0.22 }, // D4  (wah)
            { f: 277.18, d: 0.20, t: 0.44 }, // Db4 (wah)
            { f: 261.63, endF: 233.08, d: 0.85, t: 0.66 } // C4 slide down ke Bb3 (waaaaah...)
          ];

          sadNotes.forEach(n => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const startTime = now + n.t;

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(n.f, startTime);
            if (n.endF) {
              osc.frequency.exponentialRampToValueAtTime(n.endF, startTime + n.d);
            }

            gain.gain.setValueAtTime(0.18, startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + n.d);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + n.d + 0.05);
          });
        }
      } catch (e) {
        // Audio error handling
      }
    },

    // 8-Bit Retro Refrain Hook "Money Talks" (Duration: ~3.2 detik)
    playMoneyTalkRefrain: function () {
      if (!state.settings?.sfx) return;
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime + 0.05;

        // AC/DC Moneytalks Chorus Refrain: "Money talks... yeah, yeah, money talks!"
        const riff = [
          // "Money talks..."
          { f: 659.25, d: 0.12, t: 0.00 }, // E5
          { f: 659.25, d: 0.12, t: 0.14 }, // E5
          { f: 587.33, d: 0.13, t: 0.28 }, // D5
          { f: 659.25, d: 0.22, t: 0.43 }, // E5
          { f: 783.99, d: 0.24, t: 0.68 }, // G5
          { f: 880.00, d: 0.45, t: 0.94 }, // A5 (TALKS!)
          // "Yeah, yeah!"
          { f: 659.25, d: 0.12, t: 1.50 }, // E5
          { f: 783.99, d: 0.14, t: 1.64 }, // G5
          { f: 880.00, d: 0.35, t: 1.80 }, // A5
          // "...money talks!"
          { f: 659.25, d: 0.12, t: 2.25 }, // E5
          { f: 587.33, d: 0.12, t: 2.39 }, // D5
          { f: 523.25, d: 0.14, t: 2.53 }, // C5
          { f: 440.00, d: 0.60, t: 2.70 }  // A4 (TALKS!)
        ];

        const bass = [
          { f: 110.00, d: 0.65, t: 0.00 },
          { f: 110.00, d: 0.65, t: 0.70 },
          { f: 110.00, d: 0.65, t: 1.45 },
          { f: 110.00, d: 0.85, t: 2.20 }
        ];

        riff.forEach(note => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const startTime = now + note.t;

          osc.type = 'square';
          osc.frequency.setValueAtTime(note.f, startTime);

          gain.gain.setValueAtTime(0.18, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + note.d + 0.08);

          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + note.d + 0.1);
        });

        bass.forEach(b => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const startTime = now + b.t;

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(b.f, startTime);

          gain.gain.setValueAtTime(0.24, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + b.d);

          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + b.d + 0.05);
        });

      } catch (e) {
        console.warn('Audio money talk error:', e);
      }
    },

    // ===================================================================
    // TERRARIA OVERWORLD DAY STYLE PIXELATED 8-BIT BGM ENGINE (CHIPTUNE)
    // ===================================================================
    startBgm: function () {
      if (this.bgmIsPlaying) return;
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }

      this.bgmIsPlaying = true;
      this.bgmStep = 0;
      if (this.bgmTimer) {
        clearInterval(this.bgmTimer);
        this.bgmTimer = null;
      }

      // 32-step Looping Adventure Melodic Theme (Terraria Day Vibe, C Major, 128 BPM)
      const leadMelody = [
        // Bar 1: C - E - G - E | D - B - C - D
        523.25, 659.25, 783.99, 659.25, 587.33, 493.88, 523.25, 587.33,
        // Bar 2: E - G - A - G | F - E - D - C
        659.25, 783.99, 880.00, 783.99, 698.46, 659.25, 587.33, 523.25,
        // Bar 3: G - E - C6 - B5 | A - G - E - G
        783.99, 659.25, 1046.50, 987.77, 880.00, 783.99, 659.25, 783.99,
        // Bar 4: F - E - D - C | B - D - C - Rest
        698.46, 659.25, 587.33, 523.25, 493.88, 587.33, 523.25, 0
      ];

      const bassline = [
        // Bar 1: C - C - G - C
        130.81, 0, 196.00, 0, 130.81, 0, 196.00, 130.81,
        // Bar 2: Am - Am - Em - G
        110.00, 0, 164.81, 0, 174.61, 0, 196.00, 0,
        // Bar 3: F - G - C - Am
        174.61, 0, 196.00, 0, 130.81, 0, 110.00, 0,
        // Bar 4: Dm - G - C - C
        146.83, 0, 196.00, 0, 130.81, 0, 130.81, 0
      ];

      const eighthDuration = (60 / 128) / 2; // ~0.234s
      let nextNoteTime = this.ctx.currentTime + 0.06;

      const scheduleStep = () => {
        if (!this.bgmIsPlaying || !this.ctx) return;

        // Auto-resume jika browser menangguhkan audio context
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
          return;
        }

        // Fast-forward protection against background tab throttling / browser lag
        if (nextNoteTime < this.ctx.currentTime) {
          nextNoteTime = this.ctx.currentTime + 0.05;
        }

        while (nextNoteTime < this.ctx.currentTime + 0.45) {
          const idx = this.bgmStep % leadMelody.length;
          const leadFreq = leadMelody[idx];
          const bassFreq = bassline[idx];

          // 1. Lead Chiptune Square Wave
          if (leadFreq > 0) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(leadFreq, nextNoteTime);

            gain.gain.setValueAtTime(0.065, nextNoteTime);
            gain.gain.exponentialRampToValueAtTime(0.001, nextNoteTime + eighthDuration * 0.78);

            osc.connect(gain);
            gain.connect(this.bgmGainNode);
            osc.start(nextNoteTime);
            osc.stop(nextNoteTime + eighthDuration * 0.82);
          }

          // 2. Bouncy Triangle Bass
          if (bassFreq > 0) {
            const bOsc = this.ctx.createOscillator();
            const bGain = this.ctx.createGain();
            bOsc.type = 'triangle';
            bOsc.frequency.setValueAtTime(bassFreq, nextNoteTime);

            bGain.gain.setValueAtTime(0.09, nextNoteTime);
            bGain.gain.exponentialRampToValueAtTime(0.001, nextNoteTime + eighthDuration * 0.9);

            bOsc.connect(bGain);
            bGain.connect(this.bgmGainNode);
            bOsc.start(nextNoteTime);
            bOsc.stop(nextNoteTime + eighthDuration * 0.95);
          }

          // 3. Chiptune Percussion Ticks (Kick & Snare Blip)
          const isSnare = (idx % 4) === 2;
          const isKick = (idx % 4) === 0;
          if (isKick || isSnare) {
            const pOsc = this.ctx.createOscillator();
            const pGain = this.ctx.createGain();
            pOsc.type = isSnare ? 'triangle' : 'sine';
            pOsc.frequency.setValueAtTime(isSnare ? 320 : 120, nextNoteTime);
            pOsc.frequency.exponentialRampToValueAtTime(40, nextNoteTime + 0.05);

            pGain.gain.setValueAtTime(isSnare ? 0.045 : 0.065, nextNoteTime);
            pGain.gain.exponentialRampToValueAtTime(0.001, nextNoteTime + 0.06);

            pOsc.connect(pGain);
            pGain.connect(this.bgmGainNode);
            pOsc.start(nextNoteTime);
            pOsc.stop(nextNoteTime + 0.07);
          }

          nextNoteTime += eighthDuration;
          this.bgmStep++;
        }
      };

      this.bgmTimer = setInterval(scheduleStep, 180);
      scheduleStep();
    },

    stopBgm: function () {
      this.bgmIsPlaying = false;
      if (this.bgmTimer) {
        clearInterval(this.bgmTimer);
        this.bgmTimer = null;
      }
    },

    toggleBgm: function () {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      if (this.bgmIsPlaying) {
        this.stopBgm();
        state.settings.bgm = false;
        saveData();
        return false;
      } else {
        state.settings.bgm = true;
        saveData();
        this.startBgm();
        return true;
      }
    }
  };

  // ===================================================================
  // CANVAS PIXEL PARTICLE & CONFETTI ENGINE (60FPS MINECRAFT PIXELS)
  // ===================================================================
  const Fx = {
    canvas: null,
    ctx: null,
    particles: [],
    animating: false,
    init: function () {
      this.canvas = document.getElementById('mc-fx-canvas');
      if (this.canvas) {
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
      }
    },
    resize: function () {
      if (!this.canvas) return;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    },
    burst: function (x, y, colorType = 'emerald') {
      if (!this.canvas) this.init();
      if (!this.canvas || !this.ctx) return;

      const isMobile = typeof window !== 'undefined' && (window.innerWidth < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));
      const colors = colorType === 'trade'
        ? ['#38bdf8', '#47e268', '#f5a623', '#55ff55', '#ffeb3b', '#fb923c']
        : colorType === 'redstone'
        ? ['#ef4444', '#dc2626', '#b91c1c', '#ff5252', '#7f1d1d', '#991b1b']
        : ['#38bdf8', '#47e268', '#55ff55', '#ffffff'];

      const startX = x || (window.innerWidth / 2);
      const startY = y || Math.min(window.innerHeight * 0.45, 360);
      const particleCount = isMobile ? 12 : 28;

      for (let i = 0; i < particleCount; i++) {
        const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5);
        const speed = 4 + Math.random() * 6;
        this.particles.push({
          x: startX,
          y: startY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 3.5,
          size: Math.floor(Math.random() * 4) + 4,
          color: colors[Math.floor(Math.random() * colors.length)],
          life: 1,
          decay: isMobile ? 0.035 : 0.02 + Math.random() * 0.025,
          isConfetti: false
        });
      }

      if (!this.animating) {
        this.animating = true;
        this.loop();
      }
    },
    // Konfeti Seluruh Layar
    burstConfetti: function (count = 75) {
      if (!this.canvas) this.init();
      if (!this.canvas || !this.ctx) return;

      const isMobile = typeof window !== 'undefined' && (window.innerWidth < 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));
      const colors = ['#38bdf8', '#47e268', '#f5a623', '#ffeb3b', '#c084fc', '#ff5252', '#55ff55', '#ffffff'];
      const w = this.canvas.width || window.innerWidth;
      const actualCount = isMobile ? Math.min(count, 24) : count;

      for (let i = 0; i < actualCount; i++) {
        this.particles.push({
          x: Math.random() * w,
          y: -20 - Math.random() * 80,
          vx: (Math.random() - 0.5) * 5,
          vy: 2.5 + Math.random() * 4,
          size: Math.floor(Math.random() * 4) + 4,
          color: colors[Math.floor(Math.random() * colors.length)],
          life: 1,
          decay: isMobile ? 0.015 : 0.007 + Math.random() * 0.007,
          isConfetti: true,
          wobble: Math.random() * Math.PI * 2,
          wobbleSpeed: 0.06 + Math.random() * 0.06
        });
      }

      if (!this.animating) {
        this.animating = true;
        this.loop();
      }
    },
    loop: function () {
      if (!this.ctx || this.particles.length === 0) {
        if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.animating = false;
        return;
      }

      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];

        if (p.isConfetti) {
          p.wobble += p.wobbleSpeed;
          p.x += p.vx + Math.sin(p.wobble) * 1.5;
          p.y += p.vy;
          p.life -= p.decay;
        } else {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.28;
          p.life -= p.decay;
        }

        if (p.life <= 0 || p.y > (this.canvas.height + 50)) {
          this.particles.splice(i, 1);
        } else {
          this.ctx.globalAlpha = Math.max(0, p.life);
          this.ctx.fillStyle = p.color;
          this.ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
        }
      }
      this.ctx.globalAlpha = 1;
      requestAnimationFrame(() => this.loop());
    }
  };

  // Popup Banner Pencapaian Minecraft (Advancement Made)
  function showAdvancementBanner(heading, title, icon = '🏆') {
    const banner = document.getElementById('mc-advancement-banner');
    if (!banner) return;

    const hEl = document.getElementById('advancement-heading');
    const tEl = document.getElementById('advancement-title');
    const iEl = document.getElementById('advancement-icon');

    if (hEl) hEl.textContent = heading;
    if (tEl) tEl.textContent = title;
    if (iEl) iEl.textContent = icon;

    banner.classList.add('active');
    setTimeout(() => {
      banner.classList.remove('active');
    }, 4500);
  }

  // ===================================================================
  // PERAYAAN UANG DINGIN (SCALED SETIAP 100K HINGGA 2 JUTA RUPIAH)
  // Hanya dipicu jika uang dingin masuk >= 100.000!
  // ===================================================================
  function triggerCelebration(coldMoneyAmount) {
    if (!coldMoneyAmount || coldMoneyAmount < 100000) return;

    // Hitung tier kelipatan 100k (maksimal tier 20 = 2 Juta)
    const tier = Math.min(20, Math.floor(coldMoneyAmount / 100000));
    // Jumlah partikel konfeti bertambah setiap 100k: 70 -> 500 partikel
    const particleCount = Math.min(500, 50 + (tier * 23));

    // Data judul pencapaian untuk setiap kelipatan 100k hingga 2 Juta
    const tierData = {
      1:  { icon: '💰', sound: 'coin',      head: '🥉 STASH TIER 1: 100K+ CUAN MASUK!', sub: 'Dompet mulai tebal! Rezeki tersimpan rapi.' },
      2:  { icon: '⭐', sound: 'fanfare',   head: '🥈 STASH TIER 2: 200K+ ADVANCEMENT MADE!', sub: 'Saldo kas makin mantap! Melangkah ke tahap berikutnya.' },
      3:  { icon: '🎸', sound: 'moneytalk', head: '🎸 STASH TIER 3: 300K+ MONEY TALKS!', sub: 'Refrain Money Talk berbunyi nyaring! Cuan mengalir deras.' },
      4:  { icon: '💚', sound: 'fanfare',   head: '⚡ STASH TIER 4: 400K+ EMERALD RUSH!', sub: 'Brankas hijau berkilau! Target impian makin dekat.' },
      5:  { icon: '💎', sound: 'moneytalk', head: '🏆 STASH TIER 5: 500K+ HALF MILLION!', sub: 'Setengah Juta Rupiah diamankan! Kemajuan luar biasa.' },
      6:  { icon: '🔹', sound: 'fanfare',   head: '✨ STASH TIER 6: 600K+ DIAMOND VAULT!', sub: 'Koleksi tabungan semakin kokoh dan tak tergoyahkan.' },
      7:  { icon: '🔥', sound: 'fanfare',   head: '🚀 STASH TIER 7: 700K+ HIGH ROLLER!', sub: 'Pertumbuhan keuangan yang spektakuler!' },
      8:  { icon: '👑', sound: 'moneytalk', head: '🏰 STASH TIER 8: 800K+ ROYAL TREASURY!', sub: 'Benteng keuangan pribadi terisi melimpah.' },
      9:  { icon: '🔮', sound: 'fanfare',   head: '🌟 STASH TIER 9: 900K+ ROAD TO 1 JUTA!', sub: 'Tinggal selangkah lagi menembus angka 1 Juta Rupiah!' },
      10: { icon: '🏆', sound: 'moneytalk', head: '🎊 STASH TIER 10: 1 JUTA RUPIAH CLUB! 🎊', sub: 'LUAR BIASA! 1 Juta Rupiah Bersih berhasil diamankan!' },
      11: { icon: '💎', sound: 'fanfare',   head: '💎 STASH TIER 11: 1.1 JUTA OVERDRIVE!', sub: 'Melampaui 1 Juta! Momentum keuangan semakin kencang.' },
      12: { icon: '💎', sound: 'fanfare',   head: '💎 STASH TIER 12: 1.2 JUTA STASH EXPANDED!', sub: 'Brankas terus membesar tanpa henti!' },
      13: { icon: '🍀', sound: 'moneytalk', head: '🍀 STASH TIER 13: 1.3 JUTA LUCKY FORTUNE!', sub: 'Hoki terus berputar, rezeki semakin deras!' },
      14: { icon: '💠', sound: 'fanfare',   head: '💠 STASH TIER 14: 1.4 JUTA CRYSTAL TIER!', sub: 'Ketahanan finansial setingkat berlian murni.' },
      15: { icon: '👑', sound: 'moneytalk', head: '👑 STASH TIER 15: 1.5 JUTA NETHERITE TIER!', sub: 'Kekayaan legendaris 1.5 Juta Rupiah!' },
      16: { icon: '🔥', sound: 'fanfare',   head: '🔥 STASH TIER 16: 1.6 JUTA BLAZE SURGE!', sub: 'Energi kas membakar semangat menabung.' },
      17: { icon: '⚡', sound: 'fanfare',   head: '⚡ STASH TIER 17: 1.7 JUTA EPIC HORIZON!', sub: 'Puncak cakrawala kejayaan finansial semakin nyata.' },
      18: { icon: '🐉', sound: 'moneytalk', head: '🐲 STASH TIER 18: 1.8 JUTA DRAGON HOARD!', sub: 'Harta karun raksasa seperti sarang naga Ender!' },
      19: { icon: '✨', sound: 'fanfare',   head: '✨ STASH TIER 19: 1.9 JUTA ALMOST SULTAN!', sub: 'Satu tarikan nafas lagi menuju tahta 2 JUTA RUPIAH!' },
      20: { icon: '👑', sound: 'moneytalk', head: '👑🌟 MAXIMUM TIER: 2 JUTA RUPIAH TYCOON! 🌟👑', sub: 'SULTAN MINECRAFT! Rp 2.000.000+ Resmi Masuk Brankas!' }
    };

    const currentTier = tierData[tier] || tierData[20];

    // Ledakan konfeti partikel Minecraft sesuai tier
    Fx.burstConfetti(particleCount);

    // Tampilkan Banner Advancement
    showAdvancementBanner(
      currentTier.head,
      `🎉 ${currentTier.sub} (+${formatRupiah(coldMoneyAmount)})`,
      currentTier.icon
    );

    // Mainkan SFX
    if (currentTier.sound === 'moneytalk') {
      AudioEngine.playMoneyTalkRefrain();
      if (tier >= 10) {
        setTimeout(() => AudioEngine.play('fanfare'), 1800);
      }
    } else if (currentTier.sound === 'fanfare') {
      AudioEngine.play('fanfare');
    } else {
      AudioEngine.play('coin');
    }
  }

  // ===================================================================
  // LOAD & DATA MIGRATION (LOKAL CACHE + SUPABASE)
  // ===================================================================
  function readLocalData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('keuanganku_minecraft_v4') || localStorage.getItem('keuanganku_nlp_data_v3');
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      return {
        locations: parsed.locations || [...ALLOWED_LOCATIONS],
        items: parsed.items || [],
        quests: parsed.quests || [],
        pulsaConfig: parsed.pulsaConfig || { baseModal: 0, manualModalOffset: 0 },
        settings: parsed.settings || { sfx: true, bgm: false, theme: 'night', floatingPhotos: false },
        auth: parsed.auth || { isLoggedIn: false, user: '' }
      };
    } catch (e) {
      return null;
    }
  }

  function reconcileDuplicateRepayments(items) {
    if (!Array.isArray(items)) return items;

    // 1. Kumpulkan total piutang pulsa / hutang per pelanggan
    const totalDebtByPerson = {};
    items.forEach(it => {
      const person = it.debtorName || it.pulsaCustomer;
      if (!person) return;
      const amt = Number(it.amount) || 0;
      if ((it.isPulsa && it.isDebt) || (it.location === 'Uang Akan Datang (Hutang)' && it.type === 'in')) {
        totalDebtByPerson[person] = (totalDebtByPerson[person] || 0) + amt;
      }
    });

    // 2. Tandai pelunasan yang berlebih (akibat double-click tombol ACC)
    const repaidByPerson = {};
    const toDelete = new Set();

    items.forEach((it) => {
      const isRepaymentIn = it.type === 'in' && 
        (it.location === 'DANA' || it.location === 'Dompet' || it.location === 'GoPay') &&
        (String(it.desc || '').includes('Cicilan hutang') || String(it.desc || '').includes('Pelunasan') || it.isPulsaRepayment);

      if (isRepaymentIn) {
        const person = it.debtorName || it.pulsaCustomer;
        const amt = Number(it.amount) || 0;
        const maxDebt = totalDebtByPerson[person] || 0;
        const current = repaidByPerson[person] || 0;

        if (current + amt > maxDebt + 0.5) {
          toDelete.add(it.id);

          let closestOutIdx = -1;
          let minDiff = Infinity;
          const itTime = new Date(it.date).getTime() || 0;

          items.forEach((outCandidate, oIdx) => {
            if (toDelete.has(outCandidate.id)) return;
            if (outCandidate.type === 'out' && outCandidate.location === 'Uang Akan Datang (Hutang)' &&
                Number(outCandidate.amount) === amt &&
                (outCandidate.debtorName === person || outCandidate.pulsaCustomer === person)) {
              const outTime = new Date(outCandidate.date).getTime() || 0;
              const diff = Math.abs(itTime - outTime);
              if (diff < minDiff) {
                minDiff = diff;
                closestOutIdx = oIdx;
              }
            }
          });

          if (closestOutIdx !== -1) {
            toDelete.add(items[closestOutIdx].id);
          }
        } else {
          repaidByPerson[person] = current + amt;
        }
      }
    });

    // 3. Sinkronkan status isSettled untuk pesanan pulsa berdasarkan orderId
    // masing-masing. PENTING: hanya boleh dianggap LUNAS kalau total
    // pelunasannya sudah menutup total tagihan. Dulu setiap cicilan (walau
    // sebagian) langsung menandai pesanan lunas, sehingga sisa hutang tidak
    // bisa ditagih lagi setelah aplikasi di-reload.
    const repaidByOrder = {};
    items.forEach(it => {
      if (!it.orderId || toDelete.has(it.id)) return;
      if (it.type === 'out' &&
          (it.location === 'Uang Akan Datang (Hutang)' || it.isDebtRepayment)) {
        repaidByOrder[it.orderId] =
          (repaidByOrder[it.orderId] || 0) + (Number(it.amount) || 0);
      }
    });
    items.forEach(it => {
      if (it.isPulsa && it.orderId && it.location === 'Uang Akan Datang (Hutang)') {
        it.isDebt = true;
        const total = Number(it.pulsaTotal) || Number(it.amount) || 0;
        const paid = repaidByOrder[it.orderId] || 0;
        it.isSettled = total > 0 && paid >= total - 0.5;
      }
    });

    if (toDelete.size > 0) {
      console.log('🧹 Membersihkan ' + toDelete.size + ' catatan pelunasan duplikat/berlebih...');
      return items.filter(it => !toDelete.has(it.id));
    }
    return items;
  }

  function migrateOldLocations(items) {
    (items || []).forEach(item => {
      if (item.location === 'Dompet Tunai' || item.location === 'Uang Laci') {
        item.location = 'Dompet';
      } else if (item.location === 'Dipinjam Orang') {
        item.location = 'Uang Akan Datang (Hutang)';
      } else if (item.location === 'Bank BCA' || item.location === 'Bank Mandiri' || item.location === 'ShopeePay' || item.location === 'Tabungan') {
        item.location = 'Dompet';
      }
      if (item.isPulsa && item.orderId && item.location === 'Uang Akan Datang (Hutang)') {
        item.isDebt = true;
      }
    });
    if (state.items && state.items.length > 0) {
      state.items = reconcileDuplicateRepayments(state.items);
    }
  }

  function applyLocalData(data) {
    if (!data) {
      state.items = [];
      state.quests = [];
      state.pulsaConfig = { baseModal: 0, manualModalOffset: 0 };
      state.settings = { sfx: true, bgm: false, theme: 'night', floatingPhotos: false };
      state.auth = { isLoggedIn: false, user: '' };
      return;
    }

    state.locations = data.locations || [...ALLOWED_LOCATIONS];
    state.items = data.items || [];
    state.quests = data.quests || [];
    state.pulsaConfig = data.pulsaConfig || { baseModal: 0, manualModalOffset: 0 };
    state.settings = data.settings || { sfx: true, bgm: true, theme: 'night', floatingPhotos: false };
    if (state.settings.bgm === undefined) state.settings.bgm = true;
    if (state.settings.floatingPhotos === undefined) state.settings.floatingPhotos = false;
    state.auth = data.auth || { isLoggedIn: false, user: '' };

    migrateOldLocations(state.items);
  }

  function writeLocalData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        locations: state.locations,
        items: state.items,
        quests: state.quests,
        pulsaConfig: state.pulsaConfig,
        settings: state.settings,
        auth: state.auth
      }));
    } catch (e) {
      console.error('Gagal menyimpan cache lokal:', e);
    }
  }

  async function loadData() {
    // 1. Selalu mulai dari cache lokal supaya aplikasi tetap cepat/offline-safe.
    const local = readLocalData();
    applyLocalData(local);

    // 2. Jika bukan owner (buyer), jangan pernah memuat data keuangan owner.
    if (!window.KeuanganDB || !window.KeuanganDB.isOwnerContext()) {
      return;
    }

    const localHasLedger = state.items.length > 0 || state.quests.length > 0;

    try {
      const remote = await window.KeuanganDB.loadOwnerData();
      const remoteHasLedger =
        (remote.items && remote.items.length > 0) ||
        (remote.quests && remote.quests.length > 0);

      if (remoteHasLedger) {
        state.items = remote.items || [];
        state.quests = remote.quests || [];
        migrateOldLocations(state.items);
      } else if (localHasLedger) {
        // Migrasi pertama: data lokal lama diunggah ke Supabase.
        await window.KeuanganDB.saveAllNow({
          items: state.items,
          quests: state.quests,
          pulsaConfig: state.pulsaConfig,
          settings: state.settings,
          modalAmount: getModalPoolForSupabase()
        });
      }

      if (remote.pulsaConfig) state.pulsaConfig = remote.pulsaConfig;
      if (remote.settings) {
        state.settings = Object.assign({}, state.settings, remote.settings);
      }

      state.remoteReady = true;
      writeLocalData();

      // Self-heal modal publik: DB bisa menyimpan nilai NETO/basi (publish dari
      // versi lama) sehingga terlihat "modal habis" padahal saldo masih ada.
      // Raise-only: hanya menaikkan, tidak menurunkan, agar tidak menimpa
      // perubahan modal dari perangkat/tab lain.
      if ((remoteHasLedger || localHasLedger) && window.KeuanganDB?.publishModalNow) {
        try {
          const pool = Math.max(0, Math.round(getModalPoolForSupabase()));
          if (pool > 0) {
            const st = await window.KeuanganDB.getPublicStatus();
            const dbModal = Math.max(0, Number(st?.modal_amount) || 0);
            if (pool > dbModal + 0.5) {
              await window.KeuanganDB.publishModalNow(pool);
            }
          }
        } catch (e) {}
      }
      // Perubahan modal selalu dipublish eksplisit oleh aksi owner di bawah.
    } catch (e) {
      console.warn('Gagal memuat data Supabase, memakai cache lokal:', e);
      state.remoteReady = false;
      setTimeout(() => {
        showToast('⚠️ Gagal memuat data Supabase. Memakai cache lokal.', 'gold');
      }, 500);
    }
  }

  function saveData() {
    writeLocalData();

    if (!window.KeuanganDB || !window.KeuanganDB.isOwnerContext()) return;
    if (!state.remoteReady) return;

    window.KeuanganDB.saveAllDebounced({
      items: state.items,
      quests: state.quests,
      pulsaConfig: state.pulsaConfig,
      settings: state.settings
    });

    // Buyer hanya boleh melihat saldo modal (uang panas), bukan total aset.
    window.KeuanganDB.publishModal(getModalPoolForSupabase());
  }

  // ===================================================================
  // HITUNG SALDO, UANG PANAS (DOMPET MODAL) & UANG DINGIN
  // ===================================================================
  function calculateBalances() {
    const balances = {
      'DANA': 0,
      'GoPay': 0,
      'Dompet': 0,
      'Uang Akan Datang (Hutang)': 0
    };

    const debtors = {};
    const customers = {}; // Buku Pelanggan Kios Pulsa
    let totalPulsaOmset = 0;
    let totalPulsaModal = 0;
    let totalPulsaProfit = 0;
    let totalPulsaCount = 0;
    let totalSetorModal = 0;
    let totalTambahModal = 0;
    let totalKurangiModal = 0;

    // Catatan hutang pulsa per pelanggan untuk melacak modal yang masih tertahan di luar
    const pulsaDebtsByCustomer = {};

    // Total pembayaran per order (dipakai untuk menghitung sisa tagihan &
    // modal yang masih tertahan secara konsisten dengan buku pelunasan).
    const repaidByOrder = {};
    state.items.forEach(it => {
      if (!it.orderId) return;
      if (it.type === 'out' &&
          (it.location === 'Uang Akan Datang (Hutang)' || it.isDebtRepayment)) {
        repaidByOrder[it.orderId] =
          (repaidByOrder[it.orderId] || 0) + (Number(it.amount) || 0);
      }
    });

    state.items.forEach(item => {
      const loc = item.location;
      const amt = Number(item.amount) || 0;

      // 1. Tambah Modal: Uang keluar dari Dompet/DANA masuk ke Modal Kios
      // Sesuai aturan owner: modal tambah dari dompet 100k => dompet -100k, modal kios +100k
      if (item.isTambahModal) {
        totalTambahModal += amt;
        if (balances[loc] !== undefined) {
          balances[loc] -= amt;
        }
      }
      // 1B. Tarik Modal: Uang keluar dari Modal Kios masuk kembali ke Dompet/DANA
      else if (item.isKurangiModal) {
        totalKurangiModal += amt;
        if (balances[loc] !== undefined) {
          balances[loc] += amt;
        }
      }
      // 1C. Pengeluaran langsung dari Uang Panas / Modal (beli barang dari uang panas)
      else if (item.isModalExpense) {
        totalKurangiModal += amt;
      }
      // 1D. Setor / Belanja Modal Pulsa ke provider: uang keluar dari Modal Kios
      // (totalSetorModal dihitung di bawah). Dompet kas TIDAK ikut dipotong,
      // karena modal kios adalah uang panas yang disimpan terpisah — kalau
      // dompet juga dipotong, total aset turun 2x lipat.
      else if (item.isSetorModal) {
        // sengaja tanpa perubahan saldo dompet
      }
      // 2. Jualan Pulsa LUNAS (CASH langsung di tempat / DANA langsung):
      // Modal kembali ke Modal Kios, laba admin (cuan) masuk ke kas penerima.
      else if (item.isPulsa && !item.isDebt) {
        const profit = item.pulsaProfit != null ? Number(item.pulsaProfit) : Math.max(0, amt - (Number(item.pulsaModal) || 0));
        const destWallet = (loc !== 'Uang Akan Datang (Hutang)' && balances[loc] !== undefined)
          ? loc
          : (item.sourceWallet && balances[item.sourceWallet] !== undefined ? item.sourceWallet : 'Dompet');

        if (balances[destWallet] !== undefined) {
          balances[destWallet] += profit;
        }
      }
      // 3. Jualan Pulsa NYICIL / HUTANG / TEMPO:
      // Total piutang masuk ke Uang Akan Datang (Hutang). Dompet tidak disentuh sampai bayar.
      else if (item.isPulsa && item.isDebt) {
        balances['Uang Akan Datang (Hutang)'] += amt;
      }
      // 3B. Pelunasan Pulsa Hutang / Cicilan:
      // Piutang berkurang via item type 'out' di Uang Akan Datang.
      // Kas penerima bertambah cuan bersih (profitPart), karena modal pokok kembali ke Modal Kios!
      else if (item.isPulsaRepayment) {
        const profitPart = item.pulsaProfit != null ? Number(item.pulsaProfit) : Math.max(0, amt - (Number(item.pulsaModal) || 0));
        if (balances[loc] !== undefined) {
          balances[loc] += profitPart;
        }
      }
      // 4. Transaksi biasa / Pemasukan / Pengeluaran / Hutang non-pulsa
      else if (balances[loc] !== undefined) {
        if (item.type === 'in') {
          balances[loc] += amt;
        } else {
          balances[loc] -= amt;
        }
      }

      // Hitung perorangan yang punya hutang
      // ATURAN PEMILIK: Nama Excel / Pecel TIDAK AKAN PERNAH BERHUTANG!
      if (loc === 'Uang Akan Datang (Hutang)' || (item.isPulsa && item.isDebt)) {
        const name = item.debtorName || extractDebtorName(item.desc);
        if (name && !isOwnerName(name)) {
          if (!debtors[name]) debtors[name] = 0;
          if (item.type === 'in' || (item.isPulsa && item.isDebt)) {
            debtors[name] += amt;
          } else {
            debtors[name] -= amt;
          }
          if (debtors[name] < 0) debtors[name] = 0;

          if (item.isPulsa && item.isDebt) {
            const cust = item.pulsaCustomer || name;
            if (!pulsaDebtsByCustomer[cust]) pulsaDebtsByCustomer[cust] = [];
            const debtTotal = Number(item.pulsaTotal) || amt;
            const debtPaid = item.orderId ? (repaidByOrder[item.orderId] || 0) : 0;
            pulsaDebtsByCustomer[cust].push({
              total: debtTotal,
              paid: debtPaid,
              remaining: Math.max(0, debtTotal - debtPaid),
              modal: Number(item.pulsaModal) || 0,
              profit: Number(item.pulsaProfit) || 0
            });
          }
        }
      }

      // Buku Pelanggan Kios Pulsa (Riwayat, Total Belanja & Status Hutang)
      const customerName = item.pulsaCustomer || (item.isPulsa ? cleanCustomerName(item.desc) : null) || (item.debtorName ? item.debtorName : null);
      if (customerName) {
        const normName = customerName.trim();
        if (!customers[normName]) {
          customers[normName] = {
            name: normName,
            isOwner: isOwnerName(normName),
            totalBeli: 0,
            trxCount: 0,
            history: []
          };
        }
        customers[normName].history.push(item);
        if (item.isPulsa) {
          customers[normName].totalBeli += (Number(item.pulsaTotal) || amt);
          customers[normName].trxCount++;
        }
      }

      // Pulsa Sales & Modal Stats
      if (item.isPulsa) {
        totalPulsaCount++;
        totalPulsaOmset += (Number(item.pulsaTotal) || amt);
        totalPulsaModal += (Number(item.pulsaModal) || 0);
        totalPulsaProfit += (Number(item.pulsaProfit) || 0);
      }

      // Setor / Belanja Modal Pulsa
      if (item.isSetorModal) {
        totalSetorModal += amt;
      }
    });

    // Hitung total modal pulsa yang saat ini masih dihutang oleh pelanggan (belum lunas).
    // Dihitung PER PESANAN dari sisa tagihannya sendiri, bukan dengan
    // mengalokasikan total hutang pelanggan ke pesanan terbaru (yang bisa
    // membuat modal tertahan meleset setelah cicilan/pelunasan tidak berurutan).
    let totalUnpaidPulsaModal = 0;
    Object.keys(debtors).forEach(name => {
      if ((Number(debtors[name]) || 0) <= 0) return;
      const debts = pulsaDebtsByCustomer[name];
      if (!debts || !debts.length) return;
      debts.forEach(d => {
        if (!(d.remaining > 0.5) || !(d.total > 0)) return;
        const paidRatio = Math.min(1, Math.max(0, (Number(d.paid) || 0) / d.total));
        // Modal yang belum kembali = modal - bagian modal yang sudah dibayar.
        // Memakai komplemen pembulatan ini supaya saat pesanan lunas, kenaikan
        // Modal Kios PERSIS sama dengan modal yang dicatat di buku pelunasan.
        const unpaidModal = Math.max(0, Math.round(d.modal) - Math.round(d.modal * paidRatio));
        totalUnpaidPulsaModal += unpaidModal;
      });
    });

    // Finalize status sisa hutang & lunas untuk setiap pelanggan
    Object.keys(customers).forEach(cName => {
      const c = customers[cName];
      if (c.isOwner) {
        c.sisaHutang = 0;
        c.isLunas = true;
      } else {
        c.sisaHutang = Math.max(0, debtors[cName] || 0);
        c.isLunas = c.sisaHutang === 0;
      }
    });

    // Saldo dompet tidak boleh tampil minus. Kalau ada pengeluaran lama yang
    // melebihi isi dompet, potong sampai Rp 0 supaya total kas tidak negatif.
    ['DANA', 'GoPay', 'Dompet'].forEach((wallet) => {
      if ((balances[wallet] || 0) < 0) balances[wallet] = 0;
    });

    const totalRiil = (balances['DANA'] || 0) + (balances['GoPay'] || 0) + (balances['Dompet'] || 0);
    const totalAkanDatang = Math.max(0, balances['Uang Akan Datang (Hutang)'] || 0);

    // TARGET MODAL (MODAL POKOK + TAMBAH MODAL - KURANGI MODAL):
    const baseModal = Number(state.pulsaConfig?.baseModal) || 0;
    const manualOffset = Number(state.pulsaConfig?.manualModalOffset) || 0;
    const targetModal = Math.max(0, baseModal + totalTambahModal - totalKurangiModal + manualOffset);

    // DOMPET MODAL (UANG PANAS):
    // Berkurang selagi ada pulsa yang masih dihutang pelanggan!
    // Saldo panas akan balik ke awal/penuh setelah hutang dibayar lunas!
    const uangPanas = Math.max(0, targetModal - totalUnpaidPulsaModal - totalSetorModal);

    // UANG DINGIN (KAS BEBAS MILIK PRIBADI):
    // Karena modal kios sudah langsung dipotong dari dompet saat ditambah (dompet -100k),
    // maka seluruh saldo di Kas di Tangan (Dompet+DANA+GoPay) adalah Uang Bersih bebas!
    const uangDingin = totalRiil;

    // TOTAL SEMUA UANG (SEMUA ASET) = KAS RIIL + MODAL KIOS + PIUTANG.
    // Modal Kios ikut dihitung karena uangnya tetap milik owner (hanya
    // dipisahkan sebagai modal operasional). Dengan begitu perintah
    // "tambah uang modal 100k dari uang ril" hanya memindahkan uang:
    // Kas di Tangan -100k, Modal Kios +100k, dan TOTAL SEMUA UANG tetap.
    const totalAset = totalRiil + uangPanas + totalAkanDatang;

    // CUAN AKTIF TERSISA:
    const cuanAktif = totalPulsaProfit;

    return {
      balances,
      totalRiil,
      totalAkanDatang,
      totalAset,
      debtors,
      customers,
      cuanAktif,
      totalPulsaOmset,
      totalPulsaModal,
      totalPulsaProfit,
      totalPulsaCount,
      totalSetorModal,
      totalTambahModal,
      totalKurangiModal,
      totalUnpaidPulsaModal,
      targetModal,
      uangPanas,
      uangDingin,
      baseModal
    };
  }

  // Modal pool yang dipublikasikan ke public_status Supabase:
  // Database Supabase (modal_status & accept_order) secara otomatis mengurangi v_reserved
  // dari seluruh order online aktif (status pending & confirmed).
  // Oleh karena itu, modal yang dikirim ke Supabase adalah TOTAL MODAL KIOS
  // dikurangi HANYA modal pesanan offline (yang tidak tercatat di tabel orders Supabase).
  function getModalPoolForSupabase() {
    const { targetModal, totalSetorModal } = calculateBalances();
    const offlineUnpaidModal = (state.items || [])
      .filter(it => it.isPulsa && it.isDebt && !it.orderId && !it.isSettled)
      .reduce((sum, it) => sum + (Number(it.pulsaModal) || 0), 0);
    return Math.max(0, targetModal - offlineUnpaidModal - totalSetorModal);
  }

  // ===================================================================
  // PELUNASAN HUTANG: SATU TAGIHAN HANYA BOLEH LUNAS SEKALI
  // ===================================================================
  // Total nominal yang SUDAH tercatat sebagai pembayaran untuk satu pesanan.
  function getOrderRepaidAmount(orderId) {
    if (!orderId) return 0;
    return (state.items || [])
      .filter(it => String(it.orderId) === String(orderId) &&
        it.type === 'out' &&
        (it.location === 'Uang Akan Datang (Hutang)' || it.isDebtRepayment))
      .reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
  }

  // Daftar tagihan pulsa yang masih terbuka (belum lunas) milik satu pelanggan.
  // Dipakai bersama oleh tombol ACC order, tab Piutang, dan chat supaya
  // pelunasan tidak pernah tercatat dua kali.
  function getOpenPulsaDebts(debtorName) {
    if (!debtorName) return [];
    return (state.items || [])
      .filter(it => it.isPulsa && it.isDebt && !it.isSettled &&
        (it.debtorName === debtorName || it.pulsaCustomer === debtorName))
      .map(it => {
        const total = Number(it.pulsaTotal) || Number(it.amount) || 0;
        const paid = getOrderRepaidAmount(it.orderId);
        return {
          item: it,
          orderId: it.orderId || null,
          total,
          paid,
          remaining: Math.max(0, total - paid)
        };
      })
      .filter(d => d.remaining > 0.5)
      .sort((a, b) => new Date(a.item.date) - new Date(b.item.date));
  }

  // ===================================================================
  // HELPER ALOKASI MODAL DARI SALDO RIIL
  // Modal hanya boleh dibentuk dari saldo riil yang benar-benar ada.
  // - balance   : isi dompet/DANA saat ini
  // - available : saldo dompet yang belum dialokasikan jadi modal
  //               (dibatasi uang dingin global supaya tidak dobel hitung)
  // ===================================================================
  const MODAL_WALLETS = ['DANA', 'GoPay', 'Dompet'];

  function normalizeModalWallet(rawWallet) {
    if (!rawWallet) return null;
    const text = String(rawWallet).trim();
    if (!text) return null;
    const detected = detectCategoryWithTypo(text);
    if (detected && detected !== 'Uang Akan Datang (Hutang)') return detected;
    return null;
  }

  function describeModalWallet(wallet) {
    if (!wallet) return 'DANA';
    return wallet === 'Dompet' ? 'Dompet / Cash' : wallet;
  }

  function getModalFunding(preferredWallet) {
    const bal = calculateBalances();
    const uangDingin = Math.max(0, Number(bal.uangDingin) || 0);

    const wallets = MODAL_WALLETS.map((wallet) => {
      const balance = Math.max(0, Number(bal.balances[wallet]) || 0);
      return {
        wallet,
        balance,
        available: Math.max(0, Math.min(balance, uangDingin))
      };
    });

    const preferred = normalizeModalWallet(preferredWallet);
    const selected = preferred ? (wallets.find(w => w.wallet === preferred) || null) : null;

    let autoWallet = null;
    wallets.forEach((w) => {
      if (w.available <= 0) return;
      if (!autoWallet || w.available > autoWallet.available) autoWallet = w;
    });

    return {
      balances: bal.balances,
      totalRiil: bal.totalRiil,
      uangPanas: bal.uangPanas,
      uangDingin,
      wallets,
      selected,
      preferred,
      autoWallet,
      funded: wallets.filter(w => w.available > 0)
    };
  }

  function extractDebtorName(desc) {
    if (!desc) return 'Seseorang';
    const clean = desc.replace(/\b(dipinjam|uang|dihutang|ngutang|pinjam|menghutang|ke|orang|teman)\b/gi, '').trim();
    return clean ? (clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase()) : 'Teman';
  }

  // Hitung Arus Kas Berdasarkan Periode
  function calculatePeriodCashflow(period) {
    let income = 0;
    let expense = 0;

    state.items.forEach(item => {
      if (item.location === 'Uang Akan Datang (Hutang)') return;
      if (item.isTransfer) return;
      if (item.isTambahModal || item.isKurangiModal) return;

      const d = new Date(item.date);
      let match = false;

      if (period === 'today') match = isToday(d);
      else if (period === 'month') match = isThisMonth(d);
      else if (period === 'year') match = isThisYear(d);
      else match = true;

      if (match) {
        const amt = Number(item.amount) || 0;
        if (item.type === 'in') {
          // Jika transaksi pulsa / pelunasan pulsa:
          // Pemasukan uang asli pemilik HANYA jatah admin / laba bersih (cuan),
          // BUKAN omset kotor! (Modal pokok yang kembali adalah uang modal kios).
          if (item.isPulsaRepayment) {
            income += (Number(item.pulsaProfit) || 0);
          } else if (item.isPulsa && !item.isDebt) {
            income += (Number(item.pulsaProfit) || 0);
          } else {
            income += amt;
          }
        } else {
          expense += amt;
        }
      }
    });

    return { income, expense, net: income - expense };
  }

  // Toast Notification dengan Jam
  function showToast(msg, type = 'success') {
    const box = document.getElementById('toast-box');
    if (!box) return;

    const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':') + ' WIB';

    const toast = document.createElement('div');
    toast.className = `mc-toast ${type}`;
    toast.innerHTML = `
      <span style="font-size: 0.72rem; opacity: 0.7; display: block; margin-bottom: 2px;">⏰ ${timeStr}</span>
      <div>${msg}</div>
    `;
    box.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 4200);
  }

  // ===================================================================
  // THEME DIALOG - pengganti prompt()/confirm() bawaan browser
  // ===================================================================
  let activeDialog = null;

  function closeDialog(value) {
    const overlay = document.getElementById('app-dialog-overlay');
    const resolve = activeDialog;
    activeDialog = null;
    document.removeEventListener('keydown', onDialogKey, true);
    if (overlay) {
      overlay.classList.remove('active');
      if (overlay._lastFocus && typeof overlay._lastFocus.focus === 'function') {
        try { overlay._lastFocus.focus(); } catch (e) {}
      }
    }
    if (resolve && typeof resolve.resolve === 'function') resolve.resolve(value);
  }

  function submitDialog() {
    if (!activeDialog) return;
    if (activeDialog.kind !== 'prompt') {
      closeDialog(true);
      return;
    }

    const selectEl = document.getElementById('app-dialog-select');
    const inputEl = document.getElementById('app-dialog-input');
    const useSelect = activeDialog.options && activeDialog.options.length > 0;
    const value = useSelect ? (selectEl ? selectEl.value : '') : (inputEl ? inputEl.value : '');

    if (activeDialog.required && !String(value || '').trim()) {
      const errEl = document.getElementById('app-dialog-error');
      if (errEl) {
        errEl.textContent = activeDialog.requiredMessage || 'Wajib diisi.';
        errEl.style.display = 'block';
      }
      (useSelect ? selectEl : inputEl)?.focus();
      return;
    }

    closeDialog(value);
  }

  function onDialogKey(e) {
    if (!activeDialog) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog(activeDialog.kind === 'prompt' ? null : false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submitDialog();
    }
  }

  function openDialog(options) {
    const o = options || {};
    const kind = o.kind === 'prompt' ? 'prompt' : 'confirm';
    const overlay = document.getElementById('app-dialog-overlay');

    // Fallback terakhir kalau markup dialog tidak ditemukan.
    if (!overlay) {
      if (kind === 'prompt') return Promise.resolve(window.prompt(o.message || '', o.value || ''));
      return Promise.resolve(window.confirm(o.message || ''));
    }

    if (activeDialog) closeDialog(activeDialog.kind === 'prompt' ? null : false);

    const titleEl = document.getElementById('app-dialog-title');
    const msgEl = document.getElementById('app-dialog-message');
    const fieldEl = document.getElementById('app-dialog-field');
    const labelEl = document.getElementById('app-dialog-label');
    const inputEl = document.getElementById('app-dialog-input');
    const selectEl = document.getElementById('app-dialog-select');
    const hintEl = document.getElementById('app-dialog-hint');
    const errEl = document.getElementById('app-dialog-error');
    const okBtn = document.getElementById('app-dialog-ok');
    const cancelBtn = document.getElementById('app-dialog-cancel');

    const useSelect = Array.isArray(o.options) && o.options.length > 0;

    if (titleEl) titleEl.textContent = o.title || (kind === 'prompt' ? 'MASUKKAN DATA' : 'KONFIRMASI');
    if (msgEl) {
      msgEl.textContent = o.message || '';
      msgEl.style.display = o.message ? 'block' : 'none';
    }

    if (fieldEl) fieldEl.style.display = kind === 'prompt' ? 'flex' : 'none';
    if (labelEl) labelEl.textContent = o.inputLabel || 'NILAI';
    if (hintEl) hintEl.textContent = o.hint || '';
    if (errEl) {
      errEl.textContent = '';
      errEl.style.display = 'none';
    }

    if (inputEl) {
      const numericInput = o.inputMode === 'numeric' || o.inputType === 'number';
      inputEl.style.display = useSelect ? 'none' : 'block';
      inputEl.type = numericInput ? 'text' : (o.inputType === 'number' ? 'number' : 'text');
      inputEl.inputMode = o.inputMode || (o.inputType === 'number' ? 'numeric' : 'text');
      inputEl.placeholder = o.placeholder || '';
      inputEl.value = o.value == null ? '' : String(o.value);
      inputEl.disabled = useSelect;
      inputEl.dataset.rupiah = numericInput ? '1' : '0';
      attachRupiahInputFormatter(inputEl);
      applyRupiahInitialFormat(inputEl);
    }

    if (selectEl) {
      selectEl.innerHTML = '';
      if (useSelect) {
        o.options.forEach((opt) => {
          const optionEl = document.createElement('option');
          if (opt && typeof opt === 'object') {
            optionEl.value = String(opt.value);
            optionEl.textContent = String(opt.label == null ? opt.value : opt.label);
          } else {
            optionEl.value = String(opt);
            optionEl.textContent = String(opt);
          }
          selectEl.appendChild(optionEl);
        });
        selectEl.value = o.value == null ? String(o.options[0]?.value ?? o.options[0]) : String(o.value);
        selectEl.style.display = 'block';
      } else {
        selectEl.style.display = 'none';
      }
    }

    if (okBtn) {
      okBtn.textContent = o.okText || (kind === 'prompt' ? 'SIMPAN' : 'OK');
      okBtn.className = 'mc-btn ' + (o.danger ? 'mc-btn-redstone' : 'mc-btn-green');
    }
    if (cancelBtn) {
      cancelBtn.textContent = o.cancelText || 'BATAL';
      cancelBtn.style.display = o.hideCancel ? 'none' : 'inline-block';
    }

    return new Promise((resolve) => {
      activeDialog = { kind, resolve, required: !!o.required, requiredMessage: o.requiredMessage, options: useSelect ? o.options : null };

      // Pasang ulang handler supaya klik tidak menumpuk.
      okBtn?.replaceWith(okBtn.cloneNode(true));
      cancelBtn?.replaceWith(cancelBtn.cloneNode(true));
      const freshOk = document.getElementById('app-dialog-ok');
      const freshCancel = document.getElementById('app-dialog-cancel');
      freshOk?.addEventListener('click', submitDialog);
      freshCancel?.addEventListener('click', () => {
        closeDialog(activeDialog && activeDialog.kind === 'prompt' ? null : false);
      });

      overlay._lastFocus = document.activeElement;
      overlay.classList.add('active');
      document.addEventListener('keydown', onDialogKey, true);

      setTimeout(() => {
        if (!activeDialog) return;
        if (useSelect) document.getElementById('app-dialog-select')?.focus();
        else {
          const input = document.getElementById('app-dialog-input');
          if (input) {
            input.focus();
            if (typeof input.select === 'function' && o.selectValue !== false) input.select();
          }
        }
      }, 40);
    });
  }

  function uiConfirm(options) {
    const o = typeof options === 'string' ? { message: options } : (options || {});
    return openDialog({ ...o, kind: 'confirm' });
  }

  function uiPrompt(options) {
    const o = typeof options === 'string' ? { message: options } : (options || {});
    return openDialog({ ...o, kind: 'prompt' });
  }

  // ===================================================================
  // SMART NATURAL LANGUAGE PARSER (100+ KEYWORDS & SPLIT PARSER)
  // ===================================================================
  function extractAllAmounts(str) {
    const results = [];
    const text = str.toLowerCase();

    // 1. Jt / Juta
    const jtRegex = /(\d+(?:[.,]\d+)?)\s*(?:jt|juta|mio)\b/gi;
    let m;
    while ((m = jtRegex.exec(text)) !== null) {
      results.push({
        val: Math.round(parseFloat(m[1].replace(',', '.')) * 1000000),
        index: m.index,
        raw: m[0]
      });
    }

    // 2. Rb / Ribu / K
    const rbRegex = /(\d+(?:[.,]\d+)?)\s*(?:rb|ribu|k)\b/gi;
    while ((m = rbRegex.exec(text)) !== null) {
      if (!results.some(r => Math.abs(r.index - m.index) < 3)) {
        results.push({
          val: Math.round(parseFloat(m[1].replace(',', '.')) * 1000),
          index: m.index,
          raw: m[0]
        });
      }
    }

    // 3. Dot or comma thousands separated: 28.000, 25,500, 3.000
    const dotRegex = /(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+)\b/gi;
    while ((m = dotRegex.exec(text)) !== null) {
      if (!results.some(r => Math.abs(r.index - m.index) < 3)) {
        results.push({
          val: parseInt(m[1].replace(/[.,]/g, ''), 10),
          index: m.index,
          raw: m[0]
        });
      }
    }

    // 4. Standalone numbers
    const numRegex = /\b(\d+)\b/g;
    while ((m = numRegex.exec(text)) !== null) {
      if (!results.some(r => m.index >= r.index && m.index < r.index + r.raw.length)) {
        let v = parseInt(m[1], 10);
        const before = text.slice(Math.max(0, m.index - 10), m.index);
        const after = text.slice(m.index + m[0].length, Math.min(text.length, m.index + m[0].length + 15));
        const isQuantity = /\b(beli|jual|ambil|order|x|kali)\s*$/i.test(before) && /^\s*(?:pulsa|kartu|biji|pcs|buah|unit|lembar|orang)/i.test(after);

        if (!isQuantity && v < 1000 && (/\b(?:pulsa|token|kuota|admin|modal|dingin|panas)\s*$/i.test(before) || /^\s*(?:pulsa|token|kuota|admin|modal|dingin|panas)/i.test(after))) {
          v = v * 1000;
        }
        results.push({
          val: v,
          index: m.index,
          raw: m[0]
        });
      }
    }

    results.sort((a, b) => a.index - b.index);
    return results;
  }

  function cleanCustomerName(raw) {
    if (!raw) return 'Pelanggan';
    let clean = raw.replace(/\b\d+\s*(?:jt|juta|k|rb|ribu)?\b/gi, ' ');
    clean = clean.replace(/\b(?:dan|tapi|harga|total|jumlah|nominal|ke|kepada|si|nyicil|cicil|cicilan|tempo|belakangan|nanti|dulu|utang|hutang|ngutang|bon|ngebon|kasbon|pinjam|pinjem|piutang|admin\w*|untung\w*|laba\w*|fee\w*|bersih\w*|dingin\w*|panas\w*|modal\w*|pulsa\w*|saldo\w*|token\w*|kuota\w*|paket\w*|data|pln|listrik|topup|voucher|game|diamond|dana|gopay|ovo|shopee\w*|dompet|tunai|cash|beli|jual|isi|kirim|transfer|buat|untuk|nya|sebesar|rp|masuk|ke|di|pake|pakai|dari|pelanggan|customer|bayar\w*|dibayar\w*|sudah|udah|belum|lunas|sisa|kurang|dp)\b/gi, ' ');
    clean = clean.replace(/[^a-zA-Z\s]/g, ' ');
    clean = clean.replace(/\s+/g, ' ').trim();
    return clean ? (clean.charAt(0).toUpperCase() + clean.slice(1)) : 'Pelanggan';
  }

  // Parser Khusus Multi-Split: misal "100k (50k dingin 50k panas)"
  function parseSplitSentence(lower, raw) {
    const hasDingin = /\b(dingin|duit\s+dingin|uang\s+dingin)\b/i.test(lower);
    const hasPanas = /\b(panas|uang\s+panas|modal|dompet\s+modal)\b/i.test(lower);

    if (!hasDingin || !hasPanas) return null;

    let amtDingin = 0;
    let amtPanas = 0;

    const dinginMatch = lower.match(/(?:dingin|duit\s+dingin|uang\s+dingin)\s*(?:sebesar|nya|adalah|=)?\s*([0-9.,]+(?:\s*(?:jt|juta|k|rb|ribu))?|\d+)|([0-9.,]+(?:\s*(?:jt|juta|k|rb|ribu))?|\d+)\s*(?:uang\s+|duit\s+)?dingin/i);
    if (dinginMatch) {
      const rawAmt = dinginMatch[1] || dinginMatch[2];
      const extracted = extractAllAmounts(rawAmt);
      if (extracted.length > 0) amtDingin = extracted[0].val;
    }

    const panasMatch = lower.match(/(?:panas|modal|uang\s+panas|dompet\s+modal)\s*(?:sebesar|nya|adalah|=)?\s*([0-9.,]+(?:\s*(?:jt|juta|k|rb|ribu))?|\d+)|([0-9.,]+(?:\s*(?:jt|juta|k|rb|ribu))?|\d+)\s*(?:uang\s+|duit\s+)?(?:panas|modal)/i);
    if (panasMatch) {
      const rawAmt = panasMatch[1] || panasMatch[2];
      const extracted = extractAllAmounts(rawAmt);
      if (extracted.length > 0) amtPanas = extracted[0].val;
    }

    if (amtDingin > 0 && amtPanas > 0) {
      const detectedLoc = detectCategoryWithTypo(raw);
      const wallet = detectedLoc && detectedLoc !== 'Uang Akan Datang (Hutang)' ? detectedLoc : 'DANA';

      return {
        isSplit: true,
        amountDingin: amtDingin,
        amountPanas: amtPanas,
        total: amtDingin + amtPanas,
        wallet: wallet
      };
    }
    return null;
  }

  // ===================================================================
  // PARSER TRANSAKSI TANPA ANGKA NOMINAL (BALANCE DEPLETION / HABIS / SISA)
  // Contoh: "uang gw semuanya habis", "uang dingin habis semua", "uang dingin habis setengah"
  // ===================================================================
  function parseNoNumberSentence(lower, raw) {
    // 1. Cek kata kunci habis / ludes / kosong / kepake / lenyap / sisa / tinggal
    const depletionPattern = /\b(habis+|abis+|abiss+|abissh+|abiz+|habiss+|habiz+|ludes+|ludess+|ludesz+|kosong+|kering+|lanyap+|kuras+|terkuras+|hangus+|ilang+|hilang+|lenyap+|kepake+|terpakai+|kepakai+|kanker|bokek|nol|zero|bersih)\b/i;
    const isRemainingWord = /\b(sisa|tinggal|tersisa|nyisa)\b/i.test(lower);
    const isDepletionWord = depletionPattern.test(lower);

    if (!isDepletionWord && !isRemainingWord) return null;

    // Cek apakah ada nominal mata uang eksplisit (20k, 50rb, 1jt, 28.000, rp 5000)
    // Jika ada nominal uang eksplisit, serahkan ke parser transaksi biasa
    const hasExplicitCurrency = /(?:\d+(?:[.,]\d+)?\s*(?:jt|juta|k|rb|ribu|mio)\b|rp\.?\s*\d+|\d{1,3}(?:\.\d{3})+)/i.test(lower);
    if (hasExplicitCurrency) return null;

    // Cek angka polos: jika ada angka tapi bukan persentase (misal "50000"), serahkan ke parser biasa
    const plainNums = lower.match(/\b\d+\b/g);
    if (plainNums) {
      const isOnlyPercent = plainNums.every(n => new RegExp(`\\b${n}\\s*(?:%|persen)`, 'i').test(lower));
      if (!isOnlyPercent) return null;
    }

    // 2. Deteksi Porsi / Pecahan (Ratio / Fraction)
    let fraction = null;

    // A. Persentase langsung: "50%", "50 persen", "25%", "75%"
    const pctMatch = lower.match(/\b(\d+)\s*(?:%|persen)/i);
    if (pctMatch) {
      let p = parseInt(pctMatch[1], 10);
      if (p > 100) p = 100;
      if (p < 0) p = 0;
      fraction = p / 100;
    }

    // B. Setengah / Separuh: "setengah", "stgh", "stengah", "separuh", "separo"
    if (fraction === null && /\b(setengah|setenggah|stengah|stgh|separuh|separo|separuhnya|setengahnya|setenga|setgh|separoan)\b/i.test(lower)) {
      fraction = 0.5;
    }

    // C. Seperempat: "seperempat", "seperapat", "sprt"
    if (fraction === null && /\b(seperempat|seperapat|sprt|seprepat|seperempatnya)\b/i.test(lower)) {
      fraction = 0.25;
    }

    // D. Tiga perempat: "tiga perempat", "3/4"
    if (fraction === null && /\b(tiga\s*perempat|3\/4)\b/i.test(lower)) {
      fraction = 0.75;
    }

    // E. Sepertiga: "sepertiga", "1/3"
    if (fraction === null && /\b(sepertiga|1\/3|sepertiganya)\b/i.test(lower)) {
      fraction = 1 / 3;
    }

    // F. Dua pertiga: "dua pertiga", "2/3"
    if (fraction === null && /\b(dua\s*perempat|dua\s*pertiga|2\/3|dua\s*pertiganya)\b/i.test(lower)) {
      fraction = 2 / 3;
    }

    // G. Semua / Full / Ludes Total (atau jika hanya kata "habis" tanpa pecahan)
    if (fraction === null) {
      if (/\b(semua|semuanya|semuany|semuahh|all|total|seluruh|seluruhnya|full|seutuhnya|habis\s*total|ludes\s*total)\b/i.test(lower)) {
        fraction = 1.0;
      } else if (isDepletionWord) {
        fraction = 1.0;
      }
    }

    let depletedFraction = fraction !== null ? fraction : 1.0;
    if (isRemainingWord && !isDepletionWord) {
      if (/\b(nol|zero|0|habis|ludes|tidak\s*ada|ga\s*ada)\b/i.test(lower)) {
        depletedFraction = 1.0;
      } else if (fraction !== null) {
        depletedFraction = Math.max(0, Math.min(1, 1 - fraction));
      }
    }

    // 3. Deteksi Target Scope (Uang Dingin vs Uang Panas vs Dompet Spesifik vs Semua Uang)
    let scope = 'all';
    let targetWallet = null;

    // A. UANG DINGIN
    if (/\b(dingin|duit\s*dingin|uang\s*dingin|saldo\s*dingin|dana\s*dingin)\b/i.test(lower)) {
      scope = 'dingin';
      const detectedLoc = detectCategoryWithTypo(raw);
      if (detectedLoc && detectedLoc !== 'Uang Akan Datang (Hutang)') {
        targetWallet = detectedLoc;
      }
    }
    // B. UANG PANAS / DOMPET MODAL
    else if (/\b(panas|uang\s*panas|duit\s*panas|modal|dompet\s*modal|modal\s*pulsa)\b/i.test(lower)) {
      scope = 'panas';
      const detectedLoc = detectCategoryWithTypo(raw);
      if (detectedLoc && detectedLoc !== 'Uang Akan Datang (Hutang)') {
        targetWallet = detectedLoc;
      }
    }
    // C. DOMPET SPESIFIK (DANA, GoPay, Dompet) jika disebut tanpa dingin/panas
    else {
      const detectedLoc = detectCategoryWithTypo(raw);
      if (detectedLoc && detectedLoc !== 'Uang Akan Datang (Hutang)') {
        scope = 'wallet';
        targetWallet = detectedLoc;
      } else {
        scope = 'all';
      }
    }

    return {
      isNoNumberBalanceOp: true,
      scope: scope,
      wallet: targetWallet,
      fraction: depletedFraction,
      ratioPercent: Math.round(depletedFraction * 100),
      isRemaining: isRemainingWord && !isDepletionWord,
      rawText: raw
    };
  }

  function parseWalletTransfer(lower, raw) {
    const isTransferAction = /\b(?:transfer|trf|tf|pindah(?:kan)?\s*saldo|pindah(?:kan)?|tarik\s*tunai|setor\s*tunai|oper\s*saldo|oper)\b/i.test(lower);
    if (!isTransferAction) return null;

    const allAmounts = extractAllAmounts(lower);
    if (allAmounts.length === 0) return null;
    const amount = allAmounts[0].val;
    if (amount <= 0) return null;

    const resolveWallet = (str) => {
      if (!str) return null;
      if (/\bd+a+n+a+\b/i.test(str)) return 'DANA';
      if (/\bg+o+[-_]?p+a+y+\b/i.test(str)) return 'GoPay';
      if (/\b(?:d+o+m+p+e*t+|t+u+n+a+[iy]+|c+a+s+h+)\b/i.test(str)) return 'Dompet';
      return null;
    };

    let sourceWallet = null;
    let destWallet = null;

    if (/\btarik\s*tunai\b/i.test(lower)) {
      destWallet = 'Dompet';
      if (/\bdana\b/i.test(lower)) sourceWallet = 'DANA';
      else if (/\bgopay\b/i.test(lower)) sourceWallet = 'GoPay';
      else sourceWallet = 'DANA';
    } else if (/\bsetor\s*tunai\b/i.test(lower)) {
      sourceWallet = 'Dompet';
      if (/\bdana\b/i.test(lower)) destWallet = 'DANA';
      else if (/\bgopay\b/i.test(lower)) destWallet = 'GoPay';
      else destWallet = 'DANA';
    }

    if (!sourceWallet || !destWallet) {
      const matchDariKe = lower.match(/(?:dari\s+)?([a-z0-9_-]+)\s+(?:ke|masuk(?:\s+ke)?)\s+([a-z0-9_-]+)/i);
      if (matchDariKe) {
        const s = resolveWallet(matchDariKe[1]);
        const d = resolveWallet(matchDariKe[2]);
        if (s && d) {
          sourceWallet = s;
          destWallet = d;
        }
      }
    }

    if (!sourceWallet || !destWallet) {
      const matchDari = lower.match(/dari\s+([a-z0-9_-]+)/i);
      const matchKe = lower.match(/(?:ke|masuk(?:\s+ke)?)\s+([a-z0-9_-]+)/i);
      if (matchDari && matchKe) {
        const s = resolveWallet(matchDari[1]);
        const d = resolveWallet(matchKe[1]);
        if (s && d) {
          sourceWallet = s;
          destWallet = d;
        }
      }
    }

    if (sourceWallet && destWallet && sourceWallet !== destWallet) {
      return {
        isTransfer: true,
        amount: amount,
        sourceWallet: sourceWallet,
        destWallet: destWallet,
        rawText: raw
      };
    }
    return null;
  }

  function parseFinanceSentence(input) {
    const raw = input.trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();

    // 1. CEK MULTI-SPLIT (misal: "100k 50k dingin 50k panas masuk gopayyyy")
    const splitRes = parseSplitSentence(lower, raw);
    if (splitRes) {
      return splitRes;
    }

    // 2. CEK TRANSAKSI TANPA ANGKA NOMINAL (HABIS SEMUA, HABIS SETENGAH, LUDES, DLL.)
    const noNumRes = parseNoNumberSentence(lower, raw);
    if (noNumRes) {
      return noNumRes;
    }

    // 3. CEK TRANSFER ANTAR DOMPET (misal: "transfer dari dana ke dompet 50k", "tarik tunai 50k dari dana")
    const transferRes = parseWalletTransfer(lower, raw);
    if (transferRes) {
      return transferRes;
    }

    // 4. CEK TARGET BELI BARANG / QUEST / WISHLIST
    const isWishlist = /\b(target|wishlist|quest|mau\s+beli|pengen\s+beli|nabung\s+buat)\b/i.test(lower);
    if (isWishlist) {
      const amounts = extractAllAmounts(lower);
      if (amounts.length > 0) {
        const targetAmount = amounts[0].val;
        let questName = raw
          .replace(new RegExp(amounts[0].raw, 'i'), '')
          .replace(/\b(target|wishlist|quest|mau|pengen|beli|nabung|buat|untuk|sebesar|rp)\b/gi, ' ')
          .replace(/\s+/g, ' ').trim();
        questName = questName ? (questName.charAt(0).toUpperCase() + questName.slice(1)) : 'Barang Impian';

        return {
          isQuest: true,
          name: questName,
          targetAmount: targetAmount
        };
      }
    }

    // 5. CEK OPERASI DOMPET MODAL (UANG PANAS) & UANG DINGIN
    // A. Alihkan dari Uang Panas / Modal KE UANG DINGIN (opsi: "tambah uang dingin 100k dari uang panas/pans", "pindah dari modal ke uang dingin", "kurangi modal")
    const isHotToCold = (
      /\bdari\s*(?:uang\s*p[a-z]*n[a-z]*s|saldo\s*p[a-z]*n[a-z]*s|modal|dompet\s*modal)\b/i.test(lower) &&
      /\b(?:ke|masuk)\s*(?:uang\s*dingin|saldo\s*dingin|kas)\b/i.test(lower)
    ) || (
      /\b(?:tambah|isi|masuk(?:kan)?)\s*(?:uang\s*dingin|saldo\s*dingin|dana\s*dingin)\b/i.test(lower) &&
      /\bdari\s*(?:uang\s*p[a-z]*n[a-z]*s|saldo\s*p[a-z]*n[a-z]*s|modal|dompet\s*modal)\b/i.test(lower)
    ) || (
      /\b(?:pindah(?:kan)?|tarik|alihkan|oper)\b/i.test(lower) &&
      /\bdari\s*(?:uang\s*p[a-z]*n[a-z]*s|saldo\s*p[a-z]*n[a-z]*s|modal|dompet\s*modal)\b/i.test(lower) &&
      /\b(?:ke|masuk)\s*(?:uang\s*dingin|saldo\s*dingin)\b/i.test(lower)
    ) || /\b(?:kurangi\s+modal|kurang\s+modal|tarik\s+modal|ambil\s+modal|keambil\s+modal|modal\s+keambil|modal\s+terambil|modal\s+kepake|uang\s+panas\s+keambil|uang\s+panas\s+kepake|uang\s+panas\s+terambil|modal\s+berkurang|uang\s+panas\s+berkurang|modal\s+terpakai|uang\s+panas\s+terpakai)\b/i.test(lower) || (
      /\b(?:tarik|ambil|kurang(?:i)?)\b/i.test(lower) &&
      /\b(?:dari\s+)?(?:modal|uang\s*p[a-z]*n[a-z]*s|dompet\s*modal)\b/i.test(lower)
    );

    if (isHotToCold) {
      const amounts = extractAllAmounts(lower);
      if (amounts.length > 0) {
        if (amounts[0].val <= 0) return { error: 'Nominal kurangi modal / tambah uang dingin harus lebih dari Rp 0!' };
        const detectedLoc = detectCategoryWithTypo(raw);
        const wallet = detectedLoc && detectedLoc !== 'Uang Akan Datang (Hutang)' ? detectedLoc : 'DANA';

        return {
          isKurangiModal: true,
          amount: amounts[0].val,
          wallet: wallet,
          isColdMoneyAddition: true
        };
      }
    }

    // B. Tambah Modal Pulsa (dari Uang Riil)
    const isModalAdd = (
      /\b(?:tambah|isi|topup|alokasi|masuk(?:kan)?)\b/i.test(lower) &&
      /\b(?:modal|uang\s*p[a-z]*n[a-z]*s|saldo\s*p[a-z]*n[a-z]*s|dompet\s*modal)\b/i.test(lower) &&
      !/\bdari\s*(?:uang\s*p[a-z]*n[a-z]*s|saldo\s*p[a-z]*n[a-z]*s|modal|dompet\s*modal)\b/i.test(lower)
    ) || (
      /\b(?:pindah(?:kan)?|alihkan|oper)\b/i.test(lower) &&
      /\b(?:ke|masuk)\s*(?:modal|uang\s*p[a-z]*n[a-z]*s|dompet\s*modal)\b/i.test(lower)
    ) || (
      /\bmodal\b/i.test(lower) &&
      /\bdari\s*uang\s*r(?:i{1,2}|e)l\b/i.test(lower)
    );

    if (isModalAdd) {
      const amounts = extractAllAmounts(lower);
      if (amounts.length > 0) {
        if (amounts[0].val <= 0) return { error: 'Nominal tambah modal harus lebih dari Rp 0!' };
        const detectedLoc = detectCategoryWithTypo(raw);
        const walletSpecified = Boolean(detectedLoc && detectedLoc !== 'Uang Akan Datang (Hutang)');
        const wallet = walletSpecified ? detectedLoc : 'DANA';

        return {
          isTambahModal: true,
          amount: amounts[0].val,
          wallet: wallet,
          walletSpecified: walletSpecified
        };
      }
    }

    // C. Tambah Uang Riil / Uang Dingin Langsung (Pemasukan Kas Fisik dari luar)
    const isStandaloneRealOrColdIncome = /\b(?:tambah|isi|masuk(?:kan)?|dapat|dapet|terima)\s*(?:uang\s*r(?:i{1,2}|e)l|saldo\s*r(?:i{1,2}|e)l|uang\s*dingin|saldo\s*dingin)\b/i.test(lower) &&
      !/\b(?:modal|uang\s*p[a-z]*n[a-z]*s|saldo\s*p[a-z]*n[a-z]*s)\b/i.test(lower);

    if (isStandaloneRealOrColdIncome) {
      const amounts = extractAllAmounts(lower);
      if (amounts.length > 0) {
        if (amounts[0].val <= 0) return { error: 'Nominal uang riil harus lebih dari Rp 0!' };
        const detectedLoc = detectCategoryWithTypo(raw);
        const wallet = detectedLoc && detectedLoc !== 'Uang Akan Datang (Hutang)' ? detectedLoc : 'DANA';
        const isColdOnly = /\b(?:uang\s*dingin|saldo\s*dingin)\b/i.test(lower);

        return {
          type: 'in',
          amount: amounts[0].val,
          location: wallet,
          desc: isColdOnly ? 'Tambah Uang Dingin' : `Tambah Uang Riil (${wallet})`,
          isColdMoney: true
        };
      }
    }

    // D. Set / Atur Modal Pokok Awal
    if (/\b(set\s+modal|atur\s+modal)\b/i.test(lower)) {
      const amounts = extractAllAmounts(lower);
      if (amounts.length > 0) {
        if (amounts[0].val <= 0) return { error: 'Nominal modal pokok harus lebih dari Rp 0!' };
        return {
          isSetModal: true,
          amount: amounts[0].val
        };
      }
    }

    // E. Setor Modal ke Server Provider Pulsa
    if (/\b(setor\s+modal|belanja\s+modal|beli\s+stok|stok\s+pulsa|deposit\s+pulsa)\b/i.test(lower)) {
      const amounts = extractAllAmounts(lower);
      if (amounts.length > 0) {
        if (amounts[0].val <= 0) return { error: 'Nominal setor modal harus lebih dari Rp 0!' };
        const detectedLoc = detectCategoryWithTypo(raw);
        const wallet = detectedLoc && detectedLoc !== 'Uang Akan Datang (Hutang)' ? detectedLoc : 'DANA';

        return {
          isSetorModal: true,
          amount: amounts[0].val,
          wallet: wallet
        };
      }
    }

    // 4. EKSTRAKSI SEMUA NOMINAL ANGKA
    const allAmounts = extractAllAmounts(lower);
    if (allAmounts.length === 0) {
      return { error: 'Nominal uang tidak terdeteksi. Contoh: "gilang beli pulsa 28k admin nya 3k", "beli makan 25k dana", dll.' };
    }
    const amount = allAmounts[0].val;
    const matchStr = allAmounts[0].raw;

    if (amount <= 0) {
      return { error: 'Nominal uang harus lebih dari Rp 0!' };
    }

    // 5. DETEKSI DOMPET TUJUAN (DEFAULT DOMPET ATAU DANA SESUAI KONTEKS)
    const detectedCategory = detectCategoryWithTypo(raw);
    let location = detectedCategory && detectedCategory !== 'Uang Akan Datang (Hutang)' ? detectedCategory : 'Dompet';

    // 6. DETEKSI CICILAN / BAYAR HUTANG / PELUNASAN (HARUS DICEK SEBELUM JUALAN PULSA)
    const hasBuyWord = /\b(beli|order|pesan|jual|ambil|topup)\b/i.test(lower);
    const debtWordsPattern = /\b\w*(?:h?utang|ngutang|[pm]injam|[pm]injem|piutang|bon|kasbon|cicilan)\w*\b/i;
    const isDebtKeyword = debtWordsPattern.test(lower);
    const payKeywordsPattern = /\b(nyicil\s*bayar|bayar\s*cicilan|bayar\s*hutang|bayar\s*bon|cicilan|nyicil|cicil|bayar|balikin|lunas|kembalikan|angsur|angsuran|lunasi|pelunasan)\b/i;
    const hasPayWord = payKeywordsPattern.test(lower);

    const { debtors, customers } = calculateBalances();
    const allKnownNames = new Set([
      ...Object.keys(debtors),
      ...Object.keys(customers),
      ...state.items.map(i => i.debtorName).filter(Boolean),
      ...state.items.map(i => i.pulsaCustomer).filter(Boolean)
    ]);

    let matchingDebtor = null;
    for (const name of allKnownNames) {
      if (new RegExp(`\\b${name.toLowerCase()}\\b`, 'i').test(lower)) {
        matchingDebtor = name;
        break;
      }
    }

    // Pastikan BUKAN pembelian baru jualan pulsa
    const isPayingDebt = !hasBuyWord && hasPayWord && (isDebtKeyword || matchingDebtor || /\b(?:cicil|nyicil|cicilan|lunas)\b/i.test(lower));

    if (isPayingDebt) {
      const destWallet = location !== 'Dompet' ? location : (detectedCategory || 'DANA');
      let debtorName = matchingDebtor;

      if (!debtorName) {
        debtorName = raw
          .replace(new RegExp(matchStr, 'i'), '')
          .replace(/\b(?:dana|gopay|dompet|tunai|cash|nyicil\s*bayar|bayar\s*cicilan|bayar\s*hutang|bayar|nyicil|cicil|cicilan|balikin|lunas|kembalikan|angsur|angsuran|masuk|ke|di|pake|pakai|dari|sebesar|rp|h?utang|ngutang|[pm]injam|bon)\w*\b/gi, ' ')
          .replace(/[^a-zA-Z\s]/g, ' ')
          .replace(/\s+/g, ' ').trim();
        debtorName = debtorName ? (debtorName.charAt(0).toUpperCase() + debtorName.slice(1)) : 'Pelanggan';
      }

      // Pemilik tidak pernah berhutang
      if (isOwnerName(debtorName)) {
        return {
          type: 'in',
          amount: amount,
          location: destWallet,
          desc: `Setoran Kas Pemilik (${debtorName})`,
          isColdMoney: true
        };
      }

      return {
        isRepayment: true,
        debtorName: debtorName,
        destWallet: destWallet,
        amount: amount
      };
    }

    // 7. CEK JUALAN PULSA / SALDO / TOKEN / E-MONEY / TOPUP
    // Contoh: "ukuy beli saldo 50k dan adminya 5k tapi nyicil", "gilang beli pulsa 28k admin nya 3k", "beli saldo 50k admin 5k"
    const hasAdminKeyword = /\b(?:admin\w*|untung\w*|laba\w*|fee\w*|bersih\w*)\s*(?:sebesar|nya|adalah|=)?\s*([0-9.,]+(?:\s*(?:jt|juta|k|rb|ribu))?|\d+)/i.test(lower);
    const isPulsaProduct = /\b(?:pulsa|kuota|paket\s*data|token(?:\s*listrik|\s*pln)?|voucher\s*game|diamond|dm\s*ff|dm\s*ml|mlbb)\b/i.test(lower) ||
      /\b(?:beli|isi|topup)\s*(?:saldo\s*)?(?:dana|gopay|ovo|shopee\w*|spay|linkaja|e-?wallet)\b/i.test(lower);
    const isPersonalUse = /\b(?:buat\s+sendiri|sendiri|pribadi|untuk\s+sendiri)\b/i.test(lower);
    const isGenericExpense = /\b(?:makan|minum|bensin|sate|bakso|nasi|kopi|baju|celana|sepatu|parkir|wifi|kos|kontrakan|laundry|servis|service|bengkel|obat|dokter|ongkos|ojol|tagihan)\b/i.test(lower);

    const isPulsaTransaction = (isPulsaProduct || hasAdminKeyword) && !(isPersonalUse || isGenericExpense);

    if (isPulsaTransaction) {
      const adminMatch = lower.match(/\b(?:admin\w*|untung\w*|laba\w*|fee\w*|bersih\w*)\s*(?:sebesar|nya|adalah|=)?\s*([0-9.,]+(?:\s*(?:jt|juta|k|rb|ribu))?|\d+)/i);
      let adminVal = 0;
      if (adminMatch) {
        const parsedAdmin = extractAllAmounts(adminMatch[0]);
        if (parsedAdmin.length > 0) adminVal = parsedAdmin[0].val;
      }

      let totalAmount = 0;
      let adminAmount = 0;
      let modalAmount = 0;

      const isPlusAdmin = /\b(?:dan\s+admin\w*|plus\s+admin\w*|\+\s*admin\w*|sama\s+admin\w*)\b/i.test(lower);

      if (allAmounts.length >= 3) {
        // Ada 3 nominal terdeteksi (misal: "jual pulsa 25k harga 28k admin 3k ke budi")
        const vals = allAmounts.map(a => a.val).sort((a, b) => a - b);
        if (adminVal > 0) {
          adminAmount = adminVal;
          const otherVals = vals.filter(v => v !== adminVal);
          if (otherVals.length >= 2) {
            modalAmount = otherVals[0];
            totalAmount = otherVals[otherVals.length - 1];
          } else {
            modalAmount = vals[1];
            totalAmount = vals[2];
          }
        } else {
          adminAmount = vals[0];
          modalAmount = vals[1];
          totalAmount = vals[2];
        }
      } else if (allAmounts.length === 2) {
        const [amt1, amt2] = allAmounts;
        if (adminVal > 0) {
          const otherAmt = (adminVal === amt1.val) ? amt2.val : amt1.val;
          if (isPlusAdmin) {
            modalAmount = otherAmt;
            adminAmount = adminVal;
            totalAmount = modalAmount + adminAmount;
          } else if (otherAmt > adminVal) {
            const isTotalPrice = /\b(?:harga|total|semua)\s*([0-9.,]+(?:\s*(?:jt|juta|k|rb|ribu))?|\d+)/i.test(lower);
            if (isTotalPrice) {
              totalAmount = otherAmt;
              adminAmount = adminVal;
              modalAmount = totalAmount - adminAmount;
            } else {
              modalAmount = otherAmt;
              adminAmount = adminVal;
              totalAmount = modalAmount + adminAmount;
            }
          } else {
            modalAmount = otherAmt;
            totalAmount = adminVal;
            adminAmount = totalAmount - modalAmount;
          }
        } else {
          modalAmount = Math.min(amt1.val, amt2.val);
          totalAmount = Math.max(amt1.val, amt2.val);
          adminAmount = totalAmount - modalAmount;
        }
      } else if (allAmounts.length === 1) {
        const amt = allAmounts[0].val;
        if (adminVal > 0) {
          modalAmount = amt;
          adminAmount = adminVal;
          totalAmount = modalAmount + adminAmount;
        } else {
          modalAmount = amt;
          adminAmount = 2000;
          totalAmount = modalAmount + adminAmount;
        }
      }

      const customerName = cleanCustomerName(raw);
      const wallet = detectedCategory && detectedCategory !== 'Uang Akan Datang (Hutang)' ? detectedCategory : 'DANA';

      // Deteksi apakah pelanggan beli tempo / hutang / nyicil / bon
      const isDebt = /\b\w*(?:h?utang|ngutang|[pm]injam|[pm]injem|bon|ngebon|kasbon|piutang|nyicil|cicil|cicilan|tempo|belum\s*bayar|belakangan|nanti\s*bayar|tunda)\w*\b/i.test(lower);
      const effectiveIsDebt = isOwnerName(customerName) ? false : isDebt;

      return {
        isPulsa: true,
        isDebt: effectiveIsDebt,
        customer: customerName,
        total: totalAmount,
        admin: adminAmount,
        modal: modalAmount,
        wallet: wallet
      };
    }

    // 8. KASUS ORANG NGEHUTANG KE GW (PINJAM UANG KAS TUNAI/DANA)
    if (isDebtKeyword && !hasPayWord) {
      let debtorName = raw
        .replace(new RegExp(matchStr, 'i'), '')
        .replace(/\b\w*(?:h?utang|ngutang|[pm]injam|[pm]injem|piutang|kasbon|bon)\w*\b/gi, ' ')
        .replace(/\b(di|ke|dari|pake|pakai|ada|uang|sebesar|rp|dana|gopay|dompet|tunai|cash)\b/gi, ' ')
        .replace(/[^a-zA-Z\s]/g, ' ')
        .replace(/\s+/g, ' ').trim();

      debtorName = debtorName ? (debtorName.charAt(0).toUpperCase() + debtorName.slice(1)) : 'Teman';

      // ATURAN PEMILIK: Excel / Pecel tidak akan pernah berhutang!
      if (isOwnerName(debtorName)) {
        return {
          type: 'in',
          amount: amount,
          location: 'Dompet',
          desc: `Pemasukan Kas Pemilik (${debtorName})`,
          isColdMoney: true
        };
      }

      return {
        isCashLoan: true,
        sourceWallet: location,
        amount: amount,
        debtorName: debtorName,
        desc: `Dipinjam ${debtorName}`
      };
    }

    // KASUS C: TRANSAKSI HARIAN BIASA (DENGAN 100+ KEYWORDS)
    let type = 'in';

    // Kata Kunci Tegas Pengeluaran / Pengurangan Uang (Strong Expense Indicators)
    const strongExpensePattern = /\b(habis+|abis+|keluar|kepake|kepakai|terpakai|berkurang|ludes+|hangus|ilang|hilang|lenyap|kuras|terkuras|beli|bayar|jajan|makan|minum|ngopi|bensin|parkir|ongkos|checkout|co|tarik|ambil|keambil|terambil|belanja|biaya|tagihan|laundry|sewa|kos|kontrakan|servis|service|bengkel|obat|dokter|sedekah|infaq|pajak|steam|game)\b/i;

    // Kata Kunci Tegas Pemasukan Uang (Strong Income Indicators)
    const strongIncomePattern = /\b(masuk|terima|dapat|dapet|gaji|gajian|cair|cairkan|cairin|cairr|bonus|thr|nambah|tambah|hadiah|saweran|angpao|kiriman|transferan|untung|cuan|profit|laba|nemu|rezeki|rejeki|uang\s+saku|jatah|salary|upah|honor|dividen|cashback)\b/i;

    // 50+ Kata Kunci Uang Dingin & Pemasukan:
    const coldIncomeWords = [
      'gaji', 'gajian', 'salary', 'upah', 'honor', 'bonus', 'thr', 'tunjangan', 'cair',
      'cairkan', 'cairr', 'cairin', 'duit dingin', 'uang dingin', 'dana dingin', 'dingin',
      'tabungan', 'nabung', 'menabung', 'celengan', 'simpenan', 'simpanan', 'cuan', 'profit',
      'untung', 'laba', 'arisan', 'dividen', 'saham', 'crypto', 'freelance', 'projek',
      'project', 'sidejob', 'komisi', 'fee', 'cashback', 'kembalian', 'sisa', 'uang saku',
      'jatah', 'kiriman', 'transferan', 'dikasih', 'nemu', 'hadiah', 'reward', 'angpao',
      'giveaway', 'saweran', 'donasi', 'tip', 'tipping', 'preloved', 'insentif', 'rejeki',
      'rezeki', 'pemasukan', 'masuk', 'terima', 'dapat', 'dapet', 'simpen'
    ];

    // 35+ Kata Kunci Pengeluaran:
    const expenseWords = [
      'beli', 'bayar', 'jajan', 'ongkos', 'keluar', 'habis', 'belanja', 'makan', 'minum',
      'ngopi', 'bensin', 'parkir', 'buat', 'untuk', 'biaya', 'co', 'checkout', 'shopee',
      'tokped', 'tagihan', 'wifi', 'listrik', 'token', 'pdam', 'air', 'sewa', 'kos',
      'kontrakan', 'laundry', 'service', 'servis', 'bengkel', 'obat', 'dokter', 'sedekah',
      'infaq', 'pajak', 'steam', 'game', 'kepake', 'terpakai', 'berkurang'
    ];

    const isStrongExpense = strongExpensePattern.test(lower);
    const isStrongIncome = strongIncomePattern.test(lower);

    if (isStrongExpense && !isStrongIncome) {
      type = 'out';
    } else if (isStrongIncome && !isStrongExpense) {
      type = 'in';
    } else if (isStrongExpense && isStrongIncome) {
      // Jika dua-duanya ada, prioritaskan kata kerja pengeluaran jika ada habis/kepake/beli/bayar
      type = /\b(habis|abis|kepake|terpakai|keluar|beli|bayar|jajan|berkurang)\b/i.test(lower) ? 'out' : 'in';
    } else {
      let hasExpense = expenseWords.some(w => new RegExp(`\\b${w}\\b`, 'i').test(lower));
      let hasIncome = coldIncomeWords.some(w => new RegExp(`\\b${w}\\b`, 'i').test(lower));

      if (hasExpense && !hasIncome) {
        type = 'out';
      } else if (hasIncome && !hasExpense) {
        type = 'in';
      } else if (hasExpense && hasIncome) {
        type = /\b(beli|bayar|jajan|makan|ngopi|bensin|parkir|habis|abis|kepake)\b/i.test(lower) ? 'out' : 'in';
      }
    }

    let desc = raw.replace(new RegExp(matchStr, 'i'), '');
    if (detectedCategory) {
      desc = desc.replace(new RegExp(`\\b${detectedCategory}\\b`, 'gi'), '');
    }
    desc = desc.replace(/\b(di|ke|dari|pake|pakai|buat|masuk|saldo|uang|sebesar|rp)\b/gi, ' ');
    desc = desc.replace(/\s+/g, ' ').trim();

    // Cek apakah sumber pengeluaran secara spesifik dari Uang Panas / Modal
    const isModalSource = /\b(?:dari|pake|pakai|ambil\s+dari|menggunakan)\s*(?:uang\s*p[a-z]*n[a-z]*s|saldo\s*p[a-z]*n[a-z]*s|modal)\b/i.test(lower) ||
      /\b(?:uang\s*p[a-z]*n[a-z]*s|saldo\s*p[a-z]*n[a-z]*s|modal)\s*(?:terpakai|kepakai|buat|untuk)\b/i.test(lower);

    // Cek apakah sumber pengeluaran secara spesifik dari Uang Dingin
    const isColdSource = /\b(?:dari|pake|pakai|ambil\s+dari)\s*(?:uang\s*dingin|saldo\s*dingin)\b/i.test(lower);

    if (type === 'out' && isModalSource) {
      let modalDesc = raw.replace(new RegExp(matchStr, 'i'), '');
      if (detectedCategory) {
        modalDesc = modalDesc.replace(new RegExp(`\\b${detectedCategory}\\b`, 'gi'), '');
      }
      modalDesc = modalDesc.replace(/\b(?:dari|pake|pakai|ambil|buat|untuk|uang\s*p[a-z]*n[a-z]*s|saldo\s*p[a-z]*n[a-z]*s|modal|sebesar|rp)\b/gi, ' ');
      modalDesc = modalDesc.replace(/\s+/g, ' ').trim();
      modalDesc = modalDesc ? (modalDesc.charAt(0).toUpperCase() + modalDesc.slice(1)) : 'Pengeluaran dari Uang Panas';

      return {
        isModalExpense: true,
        amount,
        wallet: detectedCategory || 'DANA',
        desc: modalDesc
      };
    }

    if (type === 'out' && isColdSource) {
      let coldDesc = raw.replace(new RegExp(matchStr, 'i'), '');
      if (detectedCategory) {
        coldDesc = coldDesc.replace(new RegExp(`\\b${detectedCategory}\\b`, 'gi'), '');
      }
      coldDesc = coldDesc.replace(/\b(?:dari|pake|pakai|ambil|buat|untuk|uang\s*dingin|saldo\s*dingin|sebesar|rp)\b/gi, ' ');
      coldDesc = coldDesc.replace(/\s+/g, ' ').trim();
      coldDesc = coldDesc ? (coldDesc.charAt(0).toUpperCase() + coldDesc.slice(1)) : 'Pengeluaran dari Uang Dingin';

      return {
        type: 'out',
        amount,
        location,
        desc: coldDesc,
        isColdMoneyExpense: true
      };
    }

    if (!desc || desc.length < 2) {
      if (type === 'out') {
        const isCold = /\b(dingin)\b/i.test(lower);
        desc = isCold ? `Uang Dingin Terpakai / Habis (${location})` : `Pengeluaran (${location})`;
      } else {
        desc = `Uang Dingin Masuk (${location})`;
      }
    } else {
      desc = desc.charAt(0).toUpperCase() + desc.slice(1);
    }

    return {
      type,
      amount,
      location,
      desc,
      isColdMoney: type === 'in'
    };
  }

  // ===================================================================
  // RENDER GRAFIK & XP BARS
  // ===================================================================
  function renderGraphics(balances, totalAset, uangPanas) {
    const barsContainer = document.getElementById('chart-bars-list');
    const canvas = document.getElementById('mc-chart-canvas');

    const modalAmt = Math.max(0, Number(uangPanas) || 0);
    const catData = [
      { name: 'DANA', icon: '📱', color: '#4de0eb', value: balances['DANA'] },
      { name: 'GoPay', icon: '📱', color: '#47e268', value: balances['GoPay'] },
      { name: 'Dompet', icon: '💵', color: '#55ff55', value: balances['Dompet'] },
      { name: 'Modal Kios', icon: '🔥', color: '#f59e0b', value: modalAmt },
      { name: 'Uang Akan Datang (Hutang)', icon: '⏳', color: '#f5a623', value: balances['Uang Akan Datang (Hutang)'] }
    ];

    if (barsContainer) {
      let html = '';
      catData.forEach(c => {
        const amt = Math.max(0, Number(c.value) || 0);
        const pct = totalAset > 0 ? Math.round((amt / totalAset) * 100) : 0;

        html += `
          <div class="chart-bar-item">
            <div class="chart-bar-header">
              <span>${c.icon} ${escapeHtml(c.name)}</span>
              <span style="color: ${c.color};">${formatRupiah(amt)} (${pct}%)</span>
            </div>
            <div class="xp-bar-container">
              <div class="xp-bar-fill" style="width: ${pct}%; background-color: ${c.color};"></div>
            </div>
          </div>
        `;
      });
      barsContainer.innerHTML = html;
    }

    if (canvas) {
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (totalAset <= 0) {
        ctx.fillStyle = '#64748b';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Belum ada saldo', w / 2, h / 2);
        return;
      }

      const cx = w / 2;
      const cy = h / 2;
      const outerR = Math.min(cx, cy) - 10;
      const innerR = outerR * 0.58;

      let startAngle = -0.5 * Math.PI;

      catData.forEach(c => {
        const amt = Math.max(0, Number(c.value) || 0);
        if (amt > 0) {
          const slice = (amt / totalAset) * 2 * Math.PI;
          const endAngle = startAngle + slice;

          ctx.beginPath();
          ctx.arc(cx, cy, outerR, startAngle, endAngle);
          ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
          ctx.closePath();
          ctx.fillStyle = c.color;
          ctx.fill();

          startAngle = endAngle;
        }
      });

      ctx.beginPath();
      ctx.arc(cx, cy, innerR - 2, 0, 2 * Math.PI);
      ctx.fillStyle = '#0f172a';
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('TOTAL ASET', cx, cy - 6);

      ctx.fillStyle = '#4de0eb';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(formatRupiah(totalAset, ''), cx, cy + 10);
    }
  }

  // ===================================================================
  // RENDER REKAP ARUS KAS
  // ===================================================================
  function renderRecap() {
    const recap = calculatePeriodCashflow(state.recapPeriod);

    const inEl = document.getElementById('recap-income');
    const outEl = document.getElementById('recap-expense');
    const netEl = document.getElementById('recap-net');
    const labelEl = document.getElementById('recap-period-name');

    if (inEl) inEl.textContent = '+ ' + formatRupiah(recap.income);
    if (outEl) outEl.textContent = '- ' + formatRupiah(recap.expense);
    if (netEl) {
      netEl.textContent = (recap.net >= 0 ? '+ ' : '- ') + formatRupiah(Math.abs(recap.net));
      netEl.style.color = recap.net >= 0 ? 'var(--mc-emerald)' : 'var(--mc-redstone)';
    }

    if (labelEl) {
      const names = { today: 'HARI INI', month: 'BULAN INI', year: 'TAHUN INI', all: 'SEMUA WAKTU' };
      labelEl.textContent = names[state.recapPeriod] || 'PERIODE';
    }

    document.querySelectorAll('.recap-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.period === state.recapPeriod);
    });
  }

  // ===================================================================
  // RENDER QUEST: TARGET BELI BARANG (HANYA DARI UANG DINGIN!)
  // ===================================================================
  function renderQuests(uangDingin, uangPanas) {
    const listEl = document.getElementById('quest-items-list');
    if (!listEl) return;

    const noticeEl = document.getElementById('quest-money-notice-container');
    if (noticeEl) {
      noticeEl.innerHTML = `
        <div class="quest-money-notice">
          <span>🧊 Milestone Target dihitung HANYA dari <strong>Uang Dingin: ${formatRupiah(uangDingin)}</strong></span>
          <span style="font-size: 0.72rem; color: #fb923c; font-weight: 800;">🔥 Uang Panas Modal (${formatRupiah(uangPanas)}) Terlindungi Aman!</span>
        </div>
      `;
    }

    if (state.quests.length === 0) {
      listEl.innerHTML = `
        <div style="font-size: 0.85rem; color: #888; text-align: center; padding: 10px;">
          Belum ada target beli barang. Pasang targetmu sekarang! (Contoh: ketik di chat <code style="color: #c084fc;">target sepatu 500k</code>)
        </div>
      `;
      return;
    }

    let html = '';
    state.quests.forEach(q => {
      const target = Number(q.targetAmount) || 1;
      const pct = Math.min(100, Math.round((uangDingin / target) * 100));
      const sisa = Math.max(0, target - uangDingin);
      const isComplete = uangDingin >= target;

      html += `
        <div class="quest-item-card">
          <div class="quest-info-row">
            <span class="quest-item-name">🎯 ${escapeHtml(q.name)}</span>
            <span class="quest-item-amounts">
              ${formatRupiah(uangDingin)} / <strong>${formatRupiah(target)}</strong>
            </span>
          </div>

          <div class="quest-xp-bar">
            <div class="quest-xp-fill" style="width: ${pct}%; background: ${isComplete ? '#47e268' : '#38bdf8'};"></div>
          </div>

          <div class="quest-status-row">
            <span>Progres: <strong style="color: ${isComplete ? 'var(--mc-emerald)' : '#38bdf8'};">${pct}%</strong> (Uang Dingin)</span>
            ${isComplete
              ? '<span style="color: var(--mc-emerald); font-weight: 800;">🏆 SIAP DIBELI! Uang Dingin kamu sudah mencukupi target! 🛒</span>'
              : `<span>Kurang: <strong style="color: var(--mc-gold);">${formatRupiah(sisa)}</strong> lagi dari Uang Dingin</span>`
            }
            <button class="mc-btn" style="padding: 3px 8px; font-size: 7.5px;" onclick="window.App.deleteQuest('${q.id}')" title="Hapus Target">
              ✕
            </button>
          </div>
        </div>
      `;
    });

    listEl.innerHTML = html;
  }

  // ===================================================================
  // RENDER INTERFACE (MINECRAFT EDITION)
  // ===================================================================
  function render() {
    const {
      balances,
      totalRiil,
      totalAkanDatang,
      totalAset,
      debtors,
      customers,
      cuanAktif,
      totalPulsaOmset,
      totalPulsaCount,
      uangPanas,
      uangDingin,
      totalPulsaProfit
    } = calculateBalances();

    // 1. Grand Total
    const totalSemuaEl = document.getElementById('total-semua');
    if (totalSemuaEl) totalSemuaEl.textContent = formatRupiah(totalAset);

    // 2. 4 Pilar Hero Cards
    const totalDinginEl = document.getElementById('total-uang-dingin') || document.getElementById('total-uang-bersih');
    if (totalDinginEl) totalDinginEl.textContent = formatRupiah(uangDingin);

    const totalPanasEl = document.getElementById('total-uang-panas');
    if (totalPanasEl) totalPanasEl.textContent = formatRupiah(uangPanas);

    const totalRiilEl = document.getElementById('total-riil');
    if (totalRiilEl) totalRiilEl.textContent = formatRupiah(totalRiil);

    const totalAkanDatangEl = document.getElementById('total-akandatang');
    if (totalAkanDatangEl) totalAkanDatangEl.textContent = formatRupiah(totalAkanDatang);

    // 2B. Rincian dompet (DANA / GoPay / Dompet) di kartu Kas di Tangan
    const wbDanaEl = document.getElementById('wb-dana');
    if (wbDanaEl) wbDanaEl.textContent = formatRupiah(balances['DANA'] || 0);
    const wbGopayEl = document.getElementById('wb-gopay');
    if (wbGopayEl) wbGopayEl.textContent = formatRupiah(balances['GoPay'] || 0);
    const wbDompetEl = document.getElementById('wb-dompet');
    if (wbDompetEl) wbDompetEl.textContent = formatRupiah(balances['Dompet'] || 0);

    // 2C. Total keseluruhan: SEMUA uang yang benar-benar ada (kas + modal kios),
    // TANPA piutang/utang orang.
    const overallEl = document.getElementById('total-overall');
    if (overallEl) overallEl.textContent = formatRupiah(totalRiil + uangPanas);

    // 3. Kios Pulsa & Dompet Modal Stats
    const pulsaCountEl = document.getElementById('pulsa-count');
    if (pulsaCountEl) pulsaCountEl.textContent = `${totalPulsaCount} Trx`;

    const pulsaProfitEl = document.getElementById('pulsa-total-profit') || document.getElementById('pulsa-omset');
    if (pulsaProfitEl) pulsaProfitEl.textContent = formatRupiah(totalPulsaProfit);

    const pulsaModalAmtEl = document.getElementById('pulsa-modal-amt');
    if (pulsaModalAmtEl) pulsaModalAmtEl.textContent = formatRupiah(uangPanas);

    // Cuan Aktif Tersisa (Sinkron dengan Uang Dingin yang Masih Ada)
    const pulsaProfitAmtEl = document.getElementById('pulsa-profit-amt');
    if (pulsaProfitAmtEl) pulsaProfitAmtEl.textContent = formatRupiah(cuanAktif);

    const pulsaCuanSubtext = document.getElementById('pulsa-cuan-subtext');
    if (pulsaCuanSubtext) {
      if (totalPulsaProfit > 0 && cuanAktif === 0) {
        pulsaCuanSubtext.textContent = `Akumulasi Laba: ${formatRupiah(totalPulsaProfit)} (Sudah terpakai)`;
        pulsaCuanSubtext.style.color = '#ef4444';
      } else {
        pulsaCuanSubtext.textContent = `Akumulasi Laba: ${formatRupiah(totalPulsaProfit)}`;
        pulsaCuanSubtext.style.color = '#94a3b8';
      }
    }

    // Buku Pelanggan Kios Pulsa
    const custTbody = document.getElementById('pulsa-customers-table-body');
    if (custTbody) {
      const custEntries = Object.values(customers);
      if (custEntries.length === 0) {
        custTbody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; color: #777; padding: 16px;">
              Belum ada pelanggan pulsa tercatat. Ketik misalnya: <code>gilang beli pulsa 28k admin 3k</code>
            </td>
          </tr>
        `;
      } else {
        // Sort: yang punya hutang di atas, lalu berdasarkan total belanja
        custEntries.sort((a, b) => (b.sisaHutang - a.sisaHutang) || (b.totalBeli - a.totalBeli));
        let html = '';
        custEntries.forEach(c => {
          const isLunas = c.isLunas;
          const statusBadge = isLunas
            ? '<span class="badge-in">✅ LUNAS (Rp 0 0 0)</span>'
            : '<span class="badge-debt">⏳ SISA HUTANG</span>';

          const sisaDisplay = isLunas
            ? '<span style="color: var(--mc-emerald); font-weight: bold; font-family: var(--mc-pixel-font);">Rp 0 0 0</span>'
            : `<span style="color: var(--mc-gold); font-weight: bold; font-family: var(--mc-pixel-font);">${formatRupiah(c.sisaHutang)}</span>`;

          html += `
            <tr>
              <td>
                <span class="clickable-customer-name" onclick="window.App.openCustomerHistoryModal('${escapeHtml(c.name)}')">
                  👤 <strong>${escapeHtml(c.name)}</strong>
                  ${c.isOwner ? '<span class="admin-badge" style="font-size: 6.5px; margin-left: 4px;">👑 OWNER</span>' : ''}
                </span>
              </td>
              <td>
                <strong style="color: #4de0eb;">${formatRupiah(c.totalBeli)}</strong>
                <span style="font-size: 0.72rem; color: #94a3b8;">(${c.trxCount}x)</span>
              </td>
              <td>${sisaDisplay}</td>
              <td>${statusBadge}</td>
              <td style="white-space: nowrap;">
                <button class="mc-btn" style="padding: 3px 8px; font-size: 7.5px;" onclick="window.App.openCustomerHistoryModal('${escapeHtml(c.name)}')">
                  📜 Riwayat
                </button>
                ${!isLunas ? `
                  <button class="mc-btn mc-btn-gold" style="padding: 3px 8px; font-size: 7.5px; margin-left: 4px;" onclick="window.App.openConfirmPayModal('${escapeHtml(c.name)}', ${c.sisaHutang})">
                    💰 Bayar
                  </button>
                ` : ''}
              </td>
            </tr>
          `;
        });
        custTbody.innerHTML = html;
      }
    }

    // 4. Category Chips
    const chipsContainer = document.getElementById('category-chips');
    if (chipsContainer) {
      const chipData = [
        { name: 'DANA', icon: '📱', color: 'var(--mc-diamond)' },
        { name: 'GoPay', icon: '📱', color: 'var(--mc-emerald)' },
        { name: 'Dompet', icon: '💵', color: 'var(--mc-emerald)' },
        { name: 'Uang Akan Datang (Hutang)', icon: '⏳', color: 'var(--mc-gold)' }
      ];

      let chipsHtml = '';
      chipData.forEach(c => {
        const amt = balances[c.name] || 0;
        const isActive = state.filterLocation === c.name ? 'active' : '';
        chipsHtml += `
          <div class="mc-chip ${isActive}" onclick="window.App.setFilter('${escapeHtml(c.name)}')">
            <div class="chip-left">
              <span>${c.icon}</span>
              <span>${escapeHtml(c.name)}</span>
            </div>
            <div class="chip-amount" style="color: ${amt >= 0 ? c.color : 'var(--mc-redstone)'};">
              ${formatRupiah(amt)}
            </div>
          </div>
        `;
      });
      chipsContainer.innerHTML = chipsHtml;
    }

    // 5. Panel Orang Ngehutang
    const debtPanel = document.getElementById('debt-panel');
    const debtorsGrid = document.getElementById('debtors-grid');
    const debtEmptyState = document.getElementById('debt-empty-state');
    const activeDebtorNames = Object.keys(debtors).filter(name => debtors[name] > 0);

    if (debtPanel && debtorsGrid) {
      debtPanel.style.display = 'flex';
      if (activeDebtorNames.length === 0) {
        debtorsGrid.style.display = 'none';
        debtorsGrid.innerHTML = '';
        if (debtEmptyState) debtEmptyState.style.display = 'block';
      } else {
        debtorsGrid.style.display = 'grid';
        if (debtEmptyState) debtEmptyState.style.display = 'none';
        let html = '';
        activeDebtorNames.forEach(name => {
          const remaining = debtors[name];
          html += `
            <div class="debtor-card">
              <div class="debtor-info">
                <span class="debtor-name">👤 ${escapeHtml(name)}</span>
                <span class="debtor-amt">${formatRupiah(remaining)}</span>
              </div>
              <button class="mc-btn mc-btn-gold" onclick="window.App.openConfirmPayModal('${escapeHtml(name)}', ${remaining})" title="Konfirmasi Bayar / Cicil">
                💰 Bayar / Cicil
              </button>
            </div>
          `;
        });
        debtorsGrid.innerHTML = html;
      }
    }

    // Update Navigation Badges
    const debtBadge = document.getElementById('nav-badge-debt');
    if (debtBadge) {
      if (activeDebtorNames.length > 0) {
        debtBadge.textContent = activeDebtorNames.length;
        debtBadge.style.display = 'inline-block';
      } else {
        debtBadge.style.display = 'none';
      }
    }

    const questBadge = document.getElementById('nav-badge-quest');
    if (questBadge) {
      if (state.quests && state.quests.length > 0) {
        questBadge.textContent = state.quests.length;
        questBadge.style.display = 'inline-block';
      } else {
        questBadge.style.display = 'none';
      }
    }

    const kiosBadge = document.getElementById('nav-badge-kios');
    if (kiosBadge) {
      const pendingCount = (state.ownerOrders || []).filter(o => o.status === 'pending').length;
      if (pendingCount > 0) {
        kiosBadge.textContent = `${pendingCount} BARU`;
        kiosBadge.style.display = 'inline-block';
        kiosBadge.style.background = '#ef4444';
        kiosBadge.style.color = '#ffffff';
        kiosBadge.style.fontWeight = 'bold';
      } else {
        kiosBadge.style.display = 'none';
      }
    }

    // 6. Render Rekap Arus Kas
    renderRecap();

    // 7. Render Quest Target Barang (HANYA DARI UANG DINGIN!)
    renderQuests(uangDingin, uangPanas);

    // 8. Render Grafik & Visual XP Bars
    renderGraphics(balances, totalAset, uangPanas);

    // Update BGM & SFX Button Status (Owner & Buyer)
    ['bgm-btn', 'buyer-bgm-btn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.innerHTML = `<span class="bgm-icon">🎵</span> BGM: ${AudioEngine.bgmIsPlaying ? 'ON' : 'OFF'}`;
        btn.classList.toggle('active', !!AudioEngine.bgmIsPlaying);
      }
    });
    ['sfx-btn', 'buyer-sfx-btn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.textContent = state.settings?.sfx !== false ? '🔊 SFX: ON' : '🔇 SFX: OFF';
      }
    });

    // 9. Render Table
    const tbody = document.getElementById('items-table-body');
    if (tbody) {
      let filtered = state.items.filter(item => {
        const matchLoc = state.filterLocation === 'all' || item.location === state.filterLocation;
        const matchSearch = !state.searchQuery ||
          item.desc.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
          item.location.toLowerCase().includes(state.searchQuery.toLowerCase());
        return matchLoc && matchSearch;
      });

      filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

      if (filtered.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; padding: 28px; color: #777;">
              Belum ada catatan transaksi.
            </td>
          </tr>
        `;
      } else {
        let html = '';
        filtered.forEach((item, index) => {
          const isIncome = item.type === 'in';
          const isDebt = item.location === 'Uang Akan Datang (Hutang)';

          let typeLabel = '';
          if (item.isPulsa) {
            typeLabel = isDebt 
              ? (item.isSettled ? '<span class="badge-in">✔ PULSA LUNAS</span>' : '<span class="badge-debt">⏳ PULSA BON</span>') 
              : '<span class="badge-pulsa">⚡ PULSA</span>';
          } else if (item.isPulsaRepayment) {
            typeLabel = '<span class="badge-in">💰 LUNAS PULSA</span>';
          } else if (item.isTambahModal) {
            typeLabel = '<span class="badge-modal-in">➕ TAMBAH MODAL</span>';
          } else if (item.isKurangiModal) {
            typeLabel = '<span class="badge-modal-out">➖ TARIK MODAL</span>';
          } else if (item.isSetorModal) {
            typeLabel = '<span class="badge-setor">🔄 SETOR MODAL</span>';
          } else if (isDebt) {
            typeLabel = isIncome 
              ? '<span class="badge-debt">⏳ DIHUTANG</span>' 
              : '<span class="badge-in">✅ DILUNASI</span>';
          } else {
            typeLabel = isIncome 
              ? '<span class="badge-in">+ MASUK</span>' 
              : '<span class="badge-out">- KELUAR</span>';
          }

          let amtColor = isDebt ? 'var(--mc-gold)' : (isIncome ? 'var(--mc-emerald)' : 'var(--mc-redstone)');
          let amtPrefix = isIncome ? '+ ' : '- ';
          if (item.isTambahModal) {
            amtPrefix = '- ';
            amtColor = 'var(--mc-orange, #fb923c)';
          } else if (item.isKurangiModal) {
            amtPrefix = '+ ';
            amtColor = 'var(--mc-emerald)';
          }

          let descHtml = `<strong>${escapeHtml(item.desc)}</strong>`;
          if (item.isPulsa) {
            descHtml += `<br><span style="font-size: 0.72rem; color: #fb923c; font-weight: 700;">🔥 Modal: ${formatRupiah(item.pulsaModal)} | 🧊 Cuan: <strong style="color: #38bdf8;">${formatRupiah(item.pulsaProfit)}</strong></span>`;
            if (item.isSettled) {
              descHtml += ` <span style="font-size: 0.7rem; color: var(--mc-emerald); font-weight: 700;">(✔ Lunas via ${escapeHtml(item.settledWallet || 'Kas')})</span>`;
            }
          } else if (item.isPulsaRepayment) {
            descHtml += `<br><span style="font-size: 0.72rem; color: #fb923c; font-weight: 700;">🔥 Modal Kios Kembali: ${formatRupiah(item.pulsaModal)} | 🧊 Cuan: <strong style="color: #38bdf8;">${formatRupiah(item.pulsaProfit)}</strong></span>`;
          }

          html += `
            <tr>
              <td style="color: #666; width: 36px;">${filtered.length - index}</td>
              <td style="white-space: nowrap;">${formatDateTime(item.date)}</td>
              <td>${descHtml}</td>
              <td><span class="badge-category">${escapeHtml(item.location)}</span></td>
              <td>${typeLabel}</td>
              <td style="color: ${amtColor}; font-weight: bold;">${amtPrefix}${formatRupiah(item.amount)}</td>
              <td style="text-align: right;">
                <button class="mc-btn" style="padding: 3px 6px; font-size: 7.5px;" onclick="window.App.deleteItem('${item.id}')" title="Hapus">
                  ✕
                </button>
              </td>
            </tr>
          `;
        });
        tbody.innerHTML = html;
      }
    }

    // 10. Admin Bar & Mode Pemilik
    const adminBar = document.getElementById('admin-panel-bar');
    const loginBtnText = document.getElementById('login-btn-text');
    const loginBtnIcon = document.getElementById('login-btn-icon');
    if (state.auth?.isLoggedIn) {
      if (adminBar) adminBar.style.display = 'block';
      if (loginBtnText) loginBtnText.textContent = `${state.auth.user.toUpperCase()} (LOGOUT)`;
      if (loginBtnIcon) loginBtnIcon.textContent = '👑';
    } else {
      if (adminBar) adminBar.style.display = 'none';
      if (loginBtnText) loginBtnText.textContent = 'LOGIN';
      if (loginBtnIcon) loginBtnIcon.textContent = '👤';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ===================================================================
  // GLOBAL ACTIONS
  // ===================================================================
  // ===================================================================
  // STATUS KIOS (BUKA / TUTUP) — OWNER
  // ===================================================================
  let kiosInfo = { is_open: true, closed_note: '', closed_at: null };

  function formatKiosTime(value) {
    if (!value) return '';
    try {
      return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) {
      return String(value);
    }
  }

  function renderKiosStatus() {
    const open = kiosInfo.is_open !== false;

    const btn = document.getElementById('owner-kios-toggle-btn');
    if (btn) {
      btn.textContent = open ? '🔒 TUTUP KIOS' : '🔓 BUKA KIOS';
      btn.classList.toggle('mc-menu-item-danger', open);
      btn.classList.toggle('mc-menu-item-green', !open);
    }

    const banner = document.getElementById('owner-kios-banner');
    if (banner) {
      banner.hidden = open;
      if (!open) {
        const noteEl = document.getElementById('owner-kios-banner-note');
        const timeEl = document.getElementById('owner-kios-banner-time');
        if (noteEl) noteEl.textContent = kiosInfo.closed_note || '(tanpa keterangan)';
        if (timeEl) {
          const t = formatKiosTime(kiosInfo.closed_at);
          timeEl.textContent = t ? 'Sejak ' + t : '';
        }
      }
    }
  }

  async function refreshKiosStatus() {
    if (!window.KeuanganDB || typeof window.KeuanganDB.getPublicStatus !== 'function') return;
    try {
      const status = await window.KeuanganDB.getPublicStatus();
      kiosInfo = {
        is_open: status?.is_open !== false,
        closed_note: String(status?.closed_note || ''),
        closed_at: status?.closed_at || null
      };
    } catch (e) {
      // Offline: pertahankan status terakhir yang diketahui.
    }
    renderKiosStatus();
  }

  async function toggleKiosStatus() {
    if (!window.KeuanganDB || typeof window.KeuanganDB.setKiosOpen !== 'function') {
      showToast('Database belum siap. Coba lagi sebentar.', 'danger');
      return;
    }

    // ---------- TUTUP KIOS ----------
    if (kiosInfo.is_open !== false) {
      const note = await uiPrompt({
        title: '🔒 TUTUP KIOS',
        message:
          'Kios akan ditutup dan buyer TIDAK bisa membuat pesanan sampai dibuka lagi.\n' +
          'Keterangan wajib diisi supaya buyer tahu alasannya.',
        inputLabel: 'KETERANGAN PENUTUPAN',
        hint: 'Contoh: stok habis, istirahat, maintenance, tutup sementara.',
        placeholder: 'Tulis alasan kios ditutup...',
        okText: 'TUTUP KIOS',
        required: true,
        requiredMessage: 'Keterangan wajib diisi.'
      });

      if (note === null || note === undefined) return;

      const trimmed = String(note).trim();
      if (trimmed.length < 3) {
        showToast('Keterangan minimal 3 karakter.', 'danger');
        return;
      }

      try {
        await window.KeuanganDB.setKiosOpen(false, trimmed);
        kiosInfo = { is_open: false, closed_note: trimmed, closed_at: new Date().toISOString() };
        renderKiosStatus();
        showToast('🔒 Kios ditutup. Buyer tidak bisa memesan.', 'gold');
      } catch (e) {
        showToast('Gagal menutup kios: ' + (e?.message || 'coba lagi.'), 'danger');
      }
      return;
    }

    // ---------- BUKA KIOS ----------
    const ok = await uiConfirm({
      title: '🔓 BUKA KIOS',
      message: 'Buka kios lagi supaya buyer bisa membuat pesanan?',
      okText: 'BUKA KIOS'
    });
    if (!ok) return;

    try {
      await window.KeuanganDB.setKiosOpen(true);
      kiosInfo = { is_open: true, closed_note: '', closed_at: null };
      renderKiosStatus();
      showToast('🔓 Kios dibuka. Buyer sudah bisa memesan.', 'success');
    } catch (e) {
      showToast('Gagal membuka kios: ' + (e?.message || 'coba lagi.'), 'danger');
    }
  }

  // Menu garis tiga (dipakai header owner & buyer).
  function wireHeaderMenus() {
    if (document.body.dataset.headerMenusWired === 'true') return;
    document.body.dataset.headerMenusWired = 'true';

    const closeAll = () => {
      document.querySelectorAll('.mc-menu-panel').forEach((p) => { p.hidden = true; });
      document.querySelectorAll('.mc-menu-toggle').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    };

    document.addEventListener('click', (e) => {
      const toggle = e.target.closest('.mc-menu-toggle');
      if (toggle) {
        e.preventDefault();
        const panel = document.getElementById(toggle.getAttribute('aria-controls') || '');
        const willOpen = !!(panel && panel.hidden);
        closeAll();
        if (panel && willOpen) {
          panel.hidden = false;
          toggle.setAttribute('aria-expanded', 'true');
        }
        return;
      }

      if (e.target.closest('.mc-menu-panel')) {
        // Tutup setelah aksi menu dijalankan.
        setTimeout(closeAll, 150);
        return;
      }

      closeAll();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAll();
    });
  }

  window.App = {
    submitChat: async function () {
      const inputEl = document.getElementById('chat-input');
      if (!inputEl) return;

      const text = inputEl.value.trim();
      if (!text) {
        showToast('Ketik sesuatu di chat terlebih dahulu!', 'danger');
        inputEl.focus();
        return;
      }

      const res = parseFinanceSentence(text);
      if (!res || res.error) {
        showToast(res ? res.error : 'Format tidak dipahami!', 'danger');
        return;
      }

      // 0. Kasus Transaksi Tanpa Angka (Habis Semua, Habis Setengah, dsb.)
      if (res.isNoNumberBalanceOp) {
        const { balances, totalRiil, uangPanas, uangDingin } = calculateBalances();

        // KASUS A: UANG DINGIN
        if (res.scope === 'dingin') {
          if (uangDingin <= 0) {
            showToast('⚠️ Saldo Uang Dingin kamu saat ini sudah Rp 0!', 'gold');
            inputEl.value = '';
            inputEl.focus();
            return;
          }

          const amountToDeduct = Math.min(uangDingin, Math.max(1, Math.round(uangDingin * res.fraction)));

          // Jika user menyebut dompet tertentu (misal "uang dingin di dana habis setengah")
          if (res.wallet && balances[res.wallet] > 0) {
            const deductThis = Math.min(balances[res.wallet], amountToDeduct);
            state.items.push({
              id: 'item-' + Date.now(),
              date: new Date().toISOString(),
              type: 'out',
              amount: deductThis,
              desc: `Uang Dingin Habis (${res.ratioPercent}%) di ${res.wallet}`,
              location: res.wallet,
              isColdMoney: false
            });

            const sisaNeeds = amountToDeduct - deductThis;
            if (sisaNeeds > 0) {
              const otherWallets = ['Dompet', 'GoPay', 'DANA'].filter(w => w !== res.wallet);
              let rem = sisaNeeds;
              for (const w of otherWallets) {
                if (balances[w] > 0) {
                  const take = Math.min(balances[w], rem);
                  state.items.push({
                    id: 'item-' + (Date.now() + Math.floor(Math.random() * 1000) + 1),
                    date: new Date().toISOString(),
                    type: 'out',
                    amount: take,
                    desc: `Uang Dingin Habis (${res.ratioPercent}%) di ${w}`,
                    location: w,
                    isColdMoney: false
                  });
                  rem -= take;
                  if (rem <= 0) break;
                }
              }
            }
          } else {
            // Distribusikan ke dompet yang memiliki saldo (prioritas Dompet, GoPay, DANA)
            let rem = amountToDeduct;
            const walletPriority = ['Dompet', 'GoPay', 'DANA'];
            for (const w of walletPriority) {
              if (balances[w] > 0) {
                const take = Math.min(balances[w], rem);
                state.items.push({
                  id: 'item-' + (Date.now() + Math.floor(Math.random() * 1000) + 1),
                  date: new Date().toISOString(),
                  type: 'out',
                  amount: take,
                  desc: `Uang Dingin Habis (${res.ratioPercent}%) di ${w}`,
                  location: w,
                  isColdMoney: false
                });
                rem -= take;
                if (rem <= 0) break;
              }
            }
            if (rem > 0) {
              state.items.push({
                id: 'item-' + (Date.now() + 2),
                date: new Date().toISOString(),
                type: 'out',
                amount: rem,
                desc: `Uang Dingin Habis (${res.ratioPercent}%) di Dompet`,
                location: 'Dompet',
                isColdMoney: false
              });
            }
          }

          saveData();
          render();
          inputEl.value = '';
          inputEl.focus();

          AudioEngine.play('hurt');
          Fx.burst(null, null, 'redstone');

          const sisaDingin = Math.max(0, uangDingin - amountToDeduct);
          showToast(`📉 Uang Dingin berkurang ${res.ratioPercent}% (-${formatRupiah(amountToDeduct)})! Sisa Uang Dingin: ${formatRupiah(sisaDingin)}.`, 'danger');
          return;
        }

        // KASUS B: UANG PANAS / MODAL
        if (res.scope === 'panas') {
          if (uangPanas <= 0) {
            showToast('⚠️ Dompet Modal (Uang Panas) kamu saat ini sudah Rp 0!', 'gold');
            inputEl.value = '';
            inputEl.focus();
            return;
          }

          const wallet = res.wallet || 'Dompet';
          const walletBal = Math.max(0, Number(balances[wallet]) || 0);
          const amountToDeduct = Math.min(
            Math.max(0, walletBal),
            Math.min(uangPanas, Math.max(1, Math.round(uangPanas * res.fraction)))
          );

          if (amountToDeduct <= 0) {
            showToast(`⚠️ Saldo ${wallet} kamu saat ini Rp 0, tidak ada uang yang bisa diambil dari dompet modal.`, 'gold');
            inputEl.value = '';
            inputEl.focus();
            return;
          }

          state.items.push({
            id: 'item-' + Date.now(),
            date: new Date().toISOString(),
            type: 'out',
            amount: amountToDeduct,
            desc: `Dompet Modal Pulsa Habis (${res.ratioPercent}%)`,
            location: wallet,
            isSetorModal: true
          });

          saveData();
          render();
          inputEl.value = '';
          inputEl.focus();

          AudioEngine.play('disappointed');
          Fx.burst(null, null, 'redstone');

          const sisaPanas = Math.max(0, uangPanas - amountToDeduct);
          showToast(`📉 Aaaah... Dompet Modal (Uang Panas) berkurang ${res.ratioPercent}% (-${formatRupiah(amountToDeduct)})! Sisa Modal: ${formatRupiah(sisaPanas)}. ⚠️`, 'danger');
          return;
        }

        // KASUS C: DOMPET SPESIFIK (DANA, GoPay, Dompet)
        if (res.scope === 'wallet' && res.wallet) {
          const currentBal = balances[res.wallet] || 0;
          if (currentBal <= 0) {
            showToast(`⚠️ Saldo ${res.wallet} kamu saat ini sudah Rp 0!`, 'gold');
            inputEl.value = '';
            inputEl.focus();
            return;
          }

          const amountToDeduct = Math.min(currentBal, Math.max(1, Math.round(currentBal * res.fraction)));

          state.items.push({
            id: 'item-' + Date.now(),
            date: new Date().toISOString(),
            type: 'out',
            amount: amountToDeduct,
            desc: `Saldo ${res.wallet} Habis (${res.ratioPercent}%)`,
            location: res.wallet,
            isColdMoney: false
          });

          saveData();
          render();
          inputEl.value = '';
          inputEl.focus();

          AudioEngine.play('hurt');
          Fx.burst(null, null, 'redstone');

          const sisaBal = Math.max(0, currentBal - amountToDeduct);
          showToast(`📉 Saldo ${res.wallet} berkurang ${res.ratioPercent}% (-${formatRupiah(amountToDeduct)})! Sisa di ${res.wallet}: ${formatRupiah(sisaBal)}.`, 'danger');
          return;
        }

        // KASUS D: SEMUA UANG (TOTAL RIIL SELURUH DOMPET)
        if (res.scope === 'all') {
          const hasNegative = ['DANA', 'GoPay', 'Dompet'].some(w => balances[w] < 0);
          if (totalRiil <= 0 && !hasNegative) {
            showToast('⚠️ Seluruh saldo riil kamu saat ini sudah Rp 0!', 'gold');
            inputEl.value = '';
            inputEl.focus();
            return;
          }

          if (res.fraction >= 0.99) {
            ['DANA', 'GoPay', 'Dompet'].forEach((w, idx) => {
              if (balances[w] > 0) {
                state.items.push({
                  id: 'item-' + (Date.now() + idx),
                  date: new Date().toISOString(),
                  type: 'out',
                  amount: balances[w],
                  desc: `Semua Uang Habis (${w})`,
                  location: w,
                  isColdMoney: false
                });
              } else if (balances[w] < 0) {
                // Bersihkan saldo defisit negatif agar kembali bersih Rp 0
                state.items.push({
                  id: 'item-' + (Date.now() + idx),
                  date: new Date().toISOString(),
                  type: 'in',
                  amount: Math.abs(balances[w]),
                  desc: `Penyesuaian Defisit (${w}) Menjadi Rp 0`,
                  location: w,
                  isColdMoney: false
                });
              }
            });

            saveData();
            render();
            inputEl.value = '';
            inputEl.focus();

            AudioEngine.play('hurt');
            Fx.burst(null, null, 'redstone');
            showToast(`💸 Semua uang riil kamu telah dicatat habis! Saldo bersih menjadi Rp 0.`, 'danger');
            return;
          } else {
            const totalDeduct = Math.round(totalRiil * res.fraction);
            ['DANA', 'GoPay', 'Dompet'].forEach((w, idx) => {
              if (balances[w] > 0) {
                const take = Math.round(balances[w] * res.fraction);
                if (take > 0) {
                  state.items.push({
                    id: 'item-' + (Date.now() + idx),
                    date: new Date().toISOString(),
                    type: 'out',
                    amount: take,
                    desc: `Uang Habis ${res.ratioPercent}% (${w})`,
                    location: w,
                    isColdMoney: false
                  });
                }
              }
            });

            saveData();
            render();
            inputEl.value = '';
            inputEl.focus();

            AudioEngine.play('hurt');
            Fx.burst(null, null, 'redstone');

            const sisaTotal = Math.max(0, totalRiil - totalDeduct);
            showToast(`📉 Uang kamu berkurang ${res.ratioPercent}% (-${formatRupiah(totalDeduct)})! Sisa total riil: ${formatRupiah(sisaTotal)}.`, 'danger');
            return;
          }
        }
      }

      // 1. Kasus Multi-Split (misal: "100k 50k dingin 50k panas")
      if (res.isSplit) {
        // Record Uang Dingin
        state.items.push({
          id: 'item-' + Date.now(),
          date: new Date().toISOString(),
          type: 'in',
          amount: res.amountDingin,
          desc: 'Uang Dingin (Bebas Dipakai & Wishlist)',
          location: res.wallet,
          isColdMoney: true
        });

        // Record Uang Panas (Dompet Modal)
        state.items.push({
          id: 'item-' + (Date.now() + 1),
          date: new Date().toISOString(),
          type: 'in',
          amount: res.amountPanas,
          desc: 'Uang Panas (Dompet Modal Pulsa)',
          location: res.wallet,
          isTambahModal: true
        });

        saveData();
        render();
        inputEl.value = '';
        inputEl.focus();

        // Cek perayaan konfeti HANYA jika porsi uang dingin >= 100k
        triggerCelebration(res.amountDingin);

        showToast(`💎 Masuk split: ${formatRupiah(res.amountDingin)} Uang Dingin + ${formatRupiah(res.amountPanas)} Dompet Modal di ${res.wallet}!`, 'success');
        return;
      }

      // 2. Kasus Tambah Quest / Wishlist
      if (res.isQuest) {
        state.quests.push({
          id: 'quest-' + Date.now(),
          name: res.name,
          targetAmount: res.targetAmount,
          createdAt: new Date().toISOString()
        });
        saveData();
        render();
        inputEl.value = '';
        inputEl.focus();
        AudioEngine.play('fanfare');
        Fx.burst(null, null, 'emerald');
        showToast(`🏆 Quest baru ditambahkan: "${res.name}" (Target: ${formatRupiah(res.targetAmount)})!`, 'purple');
        return;
      }

      // 2B. Kasus Transfer Antar Dompet (misal: "transfer 50k dari dana ke dompet")
      if (res.isTransfer) {
        state.items.push({
          id: 'item-' + Date.now(),
          date: new Date().toISOString(),
          type: 'out',
          amount: res.amount,
          desc: `Transfer ke ${res.destWallet}`,
          location: res.sourceWallet,
          isTransfer: true
        });
        state.items.push({
          id: 'item-' + (Date.now() + 1),
          date: new Date().toISOString(),
          type: 'in',
          amount: res.amount,
          desc: `Transfer dari ${res.sourceWallet}`,
          location: res.destWallet,
          isTransfer: true
        });
        saveData();
        render();
        inputEl.value = '';
        inputEl.focus();
        AudioEngine.play('coin');
        Fx.burst(null, null, 'trade');
        const { balances } = calculateBalances();
        showToast(`🔄 Berhasil transfer ${formatRupiah(res.amount)} dari ${res.sourceWallet} (${formatRupiah(balances[res.sourceWallet])}) ke ${res.destWallet} (${formatRupiah(balances[res.destWallet])})!`, 'success');
        return;
      }

      // 3. Kasus Tambah Modal Pulsa dari Saldo Riil
      // Semua validasi & pencatatan didelegasikan ke submitTambahModalDirect
      // supaya tombol dan chat memakai aturan yang sama persis.
      if (res.isTambahModal) {
        const walletArg = res.walletSpecified ? res.wallet : null;
        const ok = await window.App.submitTambahModalDirect(res.amount, walletArg);
        if (ok) {
          inputEl.value = '';
          inputEl.focus();
        }
        return;
      }

      // 4. Kasus Kurangi Modal / Alihkan ke Uang Dingin (Opsi Tambah Uang Dingin dari Uang Panas)
      if (res.isKurangiModal) {
        window.App.submitKurangiModalDirect(res.amount, res.wallet);
        inputEl.value = '';
        inputEl.focus();
        return;
      }

      // 4B. Kasus Pengeluaran Langsung Menggunakan Uang Panas (Modal)
      if (res.isModalExpense) {
        const curBal = calculateBalances();
        if (curBal.uangPanas < res.amount) {
          AudioEngine.play('hurt');
          Fx.burst(null, null, 'redstone');
          showToast(
            `❌ Pengeluaran GAGAL (Saldo Kurang): Saldo Uang Panas (Modal) kamu tidak cukup! Sisa Modal saat ini: ${formatRupiah(curBal.uangPanas)}, mau dipakai: ${formatRupiah(res.amount)}. Modal kamu masih tertahan di hutang pelanggan yang belum bayar!`,
            'danger'
          );
          return;
        }

        state.items.push({
          id: 'item-' + Date.now(),
          date: new Date().toISOString(),
          type: 'out',
          amount: res.amount,
          desc: `Pengeluaran dari Uang Panas: ${res.desc}`,
          location: res.wallet,
          isModalExpense: true
        });
        saveData();
        render();
        inputEl.value = '';
        inputEl.focus();
        AudioEngine.play('hurt');
        Fx.burst(null, null, 'redstone');
        const { uangPanas, uangDingin } = calculateBalances();
        showToast(`🔥 Pengeluaran ${formatRupiah(res.amount)} dari Uang Panas (${res.wallet}) untuk ${res.desc}! Sisa Modal: ${formatRupiah(uangPanas)} • Uang Dingin aman: ${formatRupiah(uangDingin)}.`, 'gold');
        return;
      }

      // 5. Kasus Set / Atur Modal Pokok Awal
      if (res.isSetModal) {
        state.pulsaConfig.baseModal = res.amount;
        saveData();
        render();
        inputEl.value = '';
        inputEl.focus();
        AudioEngine.play('coin');
        Fx.burst(null, null, 'trade');
        const { uangPanas } = calculateBalances();
        showToast(`💾 Dompet Modal Pokok diatur menjadi ${formatRupiah(res.amount)}! Saldo Panas saat ini: ${formatRupiah(uangPanas)}.`, 'success');
        return;
      }

      // 6. Kasus Setor Modal ke Provider Server Pulsa
      if (res.isSetorModal) {
        state.items.push({
          id: 'item-' + Date.now(),
          date: new Date().toISOString(),
          type: 'out',
          amount: res.amount,
          desc: `Setor / Belanja Modal Pulsa (${res.wallet})`,
          location: res.wallet,
          isSetorModal: true
        });
        saveData();
        render();
        inputEl.value = '';
        inputEl.focus();
        AudioEngine.play('trade');
        Fx.burst(null, null, 'trade');
        showToast(`🔄 Modal pulsa disetor ${formatRupiah(res.amount)} dari ${res.wallet}! Uang panas berkurang & stok server terisi.`, 'gold');
        return;
      }

      // 7. Kasus Jualan Pulsa
      if (res.isPulsa) {
        const curBal = calculateBalances();
        const availablePanas = curBal.uangPanas;
        const requiredModal = Number(res.modal) || 0;

        // PROTEKSI MODAL: Jika uang panas habis / tidak cukup karena pelanggan belum bayar hutang
        if (availablePanas < requiredModal) {
          AudioEngine.play('hurt');
          Fx.burst(null, null, 'redstone');
          const selisih = requiredModal - availablePanas;
          showToast(
            `❌ Transaksi GAGAL (Saldo Modal Kurang): Sisa Uang Panas (Modal) kamu hanya ${formatRupiah(availablePanas)}, butuh modal: ${formatRupiah(requiredModal)} (Kurang: ${formatRupiah(selisih)}). Modal kamu habis/tertahan karena pelanggan masih pada berhutang dan belum dibayar! Tagih hutang dulu agar saldo modal kembali, atau tambah modal dari uang dingin.`,
            'danger'
          );
          return;
        }

        state.items.push({
          id: 'item-' + Date.now(),
          date: new Date().toISOString(),
          type: 'in',
          amount: res.total,
          desc: `Pulsa ${formatRupiah(res.total, '')} (${res.customer}) • Modal: ${formatRupiah(res.modal, '')} | Bersih: ${formatRupiah(res.admin, '')}`,
          location: res.isDebt ? 'Uang Akan Datang (Hutang)' : res.wallet,
          debtorName: res.isDebt ? res.customer : null,
          sourceWallet: res.wallet,
          isPulsa: true,
          isDebt: res.isDebt,
          pulsaCustomer: res.customer,
          pulsaTotal: res.total,
          pulsaModal: res.modal,
          pulsaProfit: res.admin
        });
        saveData();
        render();
        inputEl.value = '';
        inputEl.focus();
        AudioEngine.play('trade');
        Fx.burst(null, null, 'trade');

        const { uangPanas } = calculateBalances();
        if (res.isDebt) {
          showToast(`⏳ Pulsa ${formatRupiah(res.total)} dihutang ${res.customer}! Modal ${formatRupiah(res.modal)} berkurang sementara dari Saldo Panas (kini: ${formatRupiah(uangPanas)}) sampai dibayar lunas.`, 'gold');
        } else {
          // Perayaan uang dingin jika cuan/admin pulsa >= 100k
          triggerCelebration(res.admin);
          showToast(`⚡ Pulsa ${formatRupiah(res.total)} terjual ke ${res.customer}! Modal ${formatRupiah(res.modal)} kembali ke Dompet Modal, Cuan ${formatRupiah(res.admin)} masuk Uang Dingin.`, 'success');
        }
        return;
      }

      // 7B. Kasus Peminjaman Uang Kas Biasa (Bukan Pulsa)
      if (res.isCashLoan) {
        state.items.push({
          id: 'item-' + Date.now(),
          date: new Date().toISOString(),
          type: 'out',
          amount: res.amount,
          desc: `Dipinjamkan ke ${res.debtorName} (${res.sourceWallet})`,
          location: res.sourceWallet
        });

        state.items.push({
          id: 'item-' + (Date.now() + 1),
          date: new Date().toISOString(),
          type: 'in',
          amount: res.amount,
          desc: `Dipinjam ${res.debtorName}`,
          debtorName: res.debtorName,
          location: 'Uang Akan Datang (Hutang)'
        });

        saveData();
        render();
        inputEl.value = '';
        inputEl.focus();
        AudioEngine.play('hurt');
        Fx.burst(null, null, 'redstone');
        showToast(`⏳ Uang ${formatRupiah(res.amount)} dipinjam ${res.debtorName} dari ${res.sourceWallet}. Dicatat di Uang Akan Datang!`, 'gold');
        return;
      }

      // 8. Kasus Pelunasan / Cicilan lewat Chat
      if (res.isRepayment) {
        await window.App.executeDebtRepayment(res.debtorName, res.amount, res.destWallet);
        inputEl.value = '';
        inputEl.focus();
        return;
      }

      // 9. Kasus Biasa / Catat Hutang / Uang Dingin
      state.items.push({
        id: 'item-' + Date.now(),
        date: new Date().toISOString(),
        type: res.type,
        amount: res.amount,
        desc: res.desc,
        debtorName: res.debtorName || null,
        location: res.location,
        isColdMoney: res.type === 'in' && res.location !== 'Uang Akan Datang (Hutang)'
      });

      saveData();
      render();

      inputEl.value = '';
      inputEl.focus();

      // Periksa perayaan Uang Dingin (>= 100k konfeti, >= 200k banner, >= 300k money talk!)
      if (res.type === 'in' && res.location !== 'Uang Akan Datang (Hutang)') {
        triggerCelebration(res.amount);
      } else if (res.type === 'out') {
        AudioEngine.play('hurt');
        Fx.burst(null, null, 'redstone');
      } else {
        AudioEngine.play('coin');
        Fx.burst(null, null, 'emerald');
      }

      if (res.location === 'Uang Akan Datang (Hutang)') {
        showToast(`⏳ Hutang dicatat: ${res.debtorName} berhutang ${formatRupiah(res.amount)}!`, 'gold');
      } else {
        const jenis = res.type === 'in' ? 'Uang Masuk (+)' : 'Pengeluaran (-)';
        showToast(`⛏️ [${jenis}] ${res.desc}: ${formatRupiah(res.amount)} di ${res.location}!`, 'success');
      }
    },

    setRecapPeriod: function (p) {
      state.recapPeriod = p;
      AudioEngine.play('click');
      renderRecap();
    },

    openAddQuestModal: async function () {
      AudioEngine.play('click');
      const name = await uiPrompt({
        title: '🎯 TARGET WISHLIST BARU',
        message: 'Nama barang yang mau dibeli?',
        inputLabel: 'NAMA BARANG',
        placeholder: 'Contoh: Sepatu Baru, HP, Game',
        required: true,
        requiredMessage: 'Nama barang wajib diisi.',
        okText: 'LANJUT'
      });
      if (name === null || !String(name).trim()) return;

      const nominalStr = await uiPrompt({
        title: '🎯 TARGET WISHLIST BARU',
        message: `Berapa harga/target "${String(name).trim()}"?`,
        hint: 'Contoh: 500000, 500k, atau 1.5jt',
        inputLabel: 'HARGA / TARGET (RP)',
        placeholder: '500000',
        inputMode: 'numeric',
        value: '',
        required: true,
        requiredMessage: 'Harga target wajib diisi.',
        okText: 'SIMPAN'
      });
      if (nominalStr === null || !String(nominalStr).trim()) return;

      let amt = 0;
      const lower = nominalStr.toLowerCase();
      if (lower.includes('jt')) amt = Math.round(parseFloat(lower.replace('jt', '').replace(',', '.')) * 1000000);
      else if (lower.includes('k') || lower.includes('rb')) amt = Math.round(parseFloat(lower.replace(/[krb]/g, '').replace(',', '.')) * 1000);
      else amt = parseInt(nominalStr.replace(/[^\d]/g, ''), 10);

      if (!amt || amt <= 0) {
        showToast('Nominal target tidak valid!', 'danger');
        return;
      }

      state.quests.push({
        id: 'quest-' + Date.now(),
        name: name.trim(),
        targetAmount: amt,
        createdAt: new Date().toISOString()
      });

      saveData();
      render();
      AudioEngine.play('fanfare');
      Fx.burst(null, null, 'emerald');
      showToast(`🎯 Quest ditambahkan: ${name} (Target: ${formatRupiah(amt)})!`, 'purple');
    },

    deleteQuest: async function (id) {
      const ok = await uiConfirm({
        title: '🗑️ HAPUS TARGET',
        message: 'Hapus target beli barang ini dari wishlist?',
        okText: 'HAPUS',
        danger: true
      });
      if (!ok) return;

      if (window.KeuanganDB?.deleteQuest && window.KeuanganDB.isOwnerContext?.() && state.remoteReady) {
        try {
          await window.KeuanganDB.deleteQuest(id);
        } catch (err) {
          showToast('Gagal menghapus target di server: ' + (err?.message || 'Coba lagi.'), 'danger');
          return;
        }
      }

      state.quests = state.quests.filter(q => q.id !== id);
      saveData();
      render();
      showToast('Target dihapus!', 'danger');
    },

    // ===================================================================
    // OPSI DOMPET MODAL PULSA (TAMBAH, KURANGI & UKUR)
    // ===================================================================
    openPulsaModal: function () {
      AudioEngine.play('click');
      const { uangPanas, uangDingin, totalPulsaProfit, baseModal } = calculateBalances();

      const elPanas = document.getElementById('modal-info-uangpanas');
      if (elPanas) elPanas.textContent = formatRupiah(uangPanas);

      const elDingin = document.getElementById('modal-info-uangdingin');
      if (elDingin) elDingin.textContent = formatRupiah(uangDingin);

      const elCuan = document.getElementById('modal-info-cuan');
      if (elCuan) elCuan.textContent = formatRupiah(totalPulsaProfit);

      const inputBase = document.getElementById('input-base-modal');
      if (inputBase) {
        inputBase.value = baseModal || '';
        setupRupiahInput(inputBase);
      }

      const modal = document.getElementById('mc-pulsa-modal');
      if (modal) modal.classList.add('active');
    },

    closePulsaModal: function () {
      const modal = document.getElementById('mc-pulsa-modal');
      if (modal) modal.classList.remove('active');
    },

    tambahModalPrompt: async function () {
      AudioEngine.play('click');

      const bal = calculateBalances();
      const balances = bal.balances;
      const fundedWallets = ['Dompet', 'DANA', 'GoPay']
        .map(w => ({ wallet: w, balance: Math.max(0, balances[w] || 0) }))
        .filter(w => w.balance > 0);

      if (!fundedWallets.length) {
        AudioEngine.play('hurt');
        Fx.burst(null, null, 'redstone');
        showToast('❌ Saldo Dompet & DANA kosong (Rp 0). Catat uang masuk dulu, misalnya "tambah 100k di dompet".', 'danger');
        return;
      }

      let wallet = fundedWallets[0].wallet;
      if (fundedWallets.length > 1) {
        const picked = await uiPrompt({
          title: '➕ TAMBAH MODAL DARI DOMPET / DANA',
          message: 'Pilih dompet sumber modal:',
          inputLabel: 'SUMBER SALDO',
          options: fundedWallets.map(w => ({
            value: w.wallet,
            label: `${describeModalWallet(w.wallet)} — ${formatRupiah(w.balance)}`
          })),
          value: wallet,
          required: true,
          okText: 'LANJUT'
        });
        if (picked === null) return;
        wallet = normalizeModalWallet(picked) || wallet;
      }

      const sourceBal = Math.max(0, balances[wallet] || 0);
      const inputStr = await uiPrompt({
        title: '➕ TAMBAH MODAL KIOS',
        message: `Berapa modal yang mau dipindahkan dari ${describeModalWallet(wallet)} ke Modal Kios? (Saldo ${wallet}: ${formatRupiah(sourceBal)})`,
        hint: `Saldo ${wallet} akan langsung terpotong sesuai nominal yang kamu masukkan (misal 100k = ${wallet} -100k).`,
        inputLabel: `NOMINAL MODAL DARI ${describeModalWallet(wallet).toUpperCase()} (RP)`,
        placeholder: String(Math.min(sourceBal, 100000) || 50000),
        inputMode: 'numeric',
        required: true,
        requiredMessage: 'Nominal wajib diisi.',
        okText: 'TAMBAH MODAL'
      });
      if (inputStr === null) return;

      const amt = parseRupiahInput(inputStr);
      if (!amt || amt <= 0) {
        showToast('Nominal tambah modal tidak valid!', 'danger');
        return;
      }

      await window.App.submitTambahModalDirect(amt, wallet);
    },

    kurangiModalPrompt: async function () {
      AudioEngine.play('click');
      const inputStr = await uiPrompt({
        title: '📉 KURANGI MODAL KIOS',
        message: 'Berapa nominal modal yang mau dikurangi dari Dompet Modal?',
        hint: 'Nominal ini dialihkan menjadi Uang Dingin yang siap dipakai untuk wishlist. Contoh: 20000 atau 50k.',
        inputLabel: 'NOMINAL YANG DIKURANGI (RP)',
        placeholder: '20000',
        inputMode: 'numeric',
        required: true,
        requiredMessage: 'Nominal wajib diisi.',
        okText: 'KURANGI',
        danger: true
      });
      if (inputStr === null) return;

      const amt = parseRupiahInput(inputStr);
      if (!amt || amt <= 0) {
        showToast('Nominal kurangi modal tidak valid!', 'danger');
        return;
      }

      window.App.submitKurangiModalDirect(amt, 'DANA');
    },

    submitTambahModalDirect: async function (amt, wallet) {
      const nominal = Math.max(0, Math.round(Number(amt) || 0));
      if (nominal <= 0) {
        showToast('Nominal tambah modal tidak valid!', 'danger');
        return false;
      }

      const bal = calculateBalances();
      const balances = bal.balances;
      let walletName = wallet || null;
      if (!walletName) {
        if ((balances['Dompet'] || 0) >= nominal) walletName = 'Dompet';
        else if ((balances['DANA'] || 0) >= nominal) walletName = 'DANA';
        else if ((balances['GoPay'] || 0) >= nominal) walletName = 'GoPay';
        else walletName = 'Dompet';
      }

      const walletLabel = describeModalWallet(walletName);
      const saldoWallet = Math.max(0, Number(balances[walletName]) || 0);

      // Validasi sederhana: apakah saldo di dompet tersebut cukup untuk dialihkan ke modal kios?
      if (saldoWallet < nominal) {
        AudioEngine.play('hurt');
        Fx.burst(null, null, 'redstone');
        showToast(`❌ Saldo di ${walletLabel} cuma ${formatRupiah(saldoWallet)}, tidak cukup untuk dialokasikan ke modal ${formatRupiah(nominal)}!`, 'danger');
        return false;
      }

      state.items.push({
        id: 'item-' + Date.now(),
        date: new Date().toISOString(),
        type: 'out',
        amount: nominal,
        desc: `Tambah Modal dari Saldo Riil (${walletLabel})`,
        location: walletName,
        isTambahModal: true,
        isTambahModalRiil: true
      });
      saveData();
      render();
      AudioEngine.play('trade');
      Fx.burst(null, null, 'trade');

      const nextBal = calculateBalances();
      showToast(
        `➕ Berhasil tambah modal ${formatRupiah(nominal)} dari ${walletLabel}! ` +
        `Modal Kios: ${formatRupiah(nextBal.uangPanas)} • Saldo ${walletLabel} terpotong: ${formatRupiah(nextBal.balances[walletName])}.`,
        'gold'
      );

      if (window.KeuanganDB?.publishModalNow) {
        try {
          await window.KeuanganDB.publishModalNow(getModalPoolForSupabase());
        } catch (e) {
          console.warn('Gagal publish modal instan:', e);
        }
      }

      return true;
    },

    submitKurangiModalDirect: async function (amt, wallet) {
      const curBal = calculateBalances();
      if (curBal.uangPanas < amt) {
        AudioEngine.play('hurt');
        Fx.burst(null, null, 'redstone');
        showToast(
          `❌ Gagal Kurangi Modal (Saldo Kurang): Saldo Modal kamu saat ini hanya ${formatRupiah(curBal.uangPanas)}, tidak cukup untuk dikurangi ${formatRupiah(amt)}! Modal sedang tertahan di hutang pelanggan yang belum dibayar.`,
          'danger'
        );
        return;
      }

      state.items.push({
        id: 'item-' + Date.now(),
        date: new Date().toISOString(),
        type: 'out',
        amount: amt,
        desc: `Kurangi / Tarik Modal Pulsa (${wallet})`,
        location: wallet,
        isKurangiModal: true
      });
      saveData();
      render();
      AudioEngine.play('disappointed');
      Fx.burst(null, null, 'redstone');
      showToast(`📉 Modal Kios dikurangi ${formatRupiah(amt)}!`, 'danger');

      if (window.KeuanganDB?.publishModalNow) {
        try {
          await window.KeuanganDB.publishModalNow(getModalPoolForSupabase());
        } catch (e) {}
      }
    },

    saveBaseModal: async function () {
      const input = document.getElementById('input-base-modal');
      const val = parseRupiahInput(input?.value || '0');
      const nextBase = Math.max(0, isNaN(val) ? 0 : val);
      const currentBase = Number(state.pulsaConfig?.baseModal) || 0;
      const delta = nextBase - currentBase;

      // Menambah modal pokok juga harus didanai saldo riil yang bebas.
      // Kalau cuma menurunkan modal, tidak perlu validasi karena uangnya
      // justru kembali jadi uang dingin.
      if (delta > 0) {
        const funding = getModalFunding();
        if (delta > funding.uangDingin) {
          AudioEngine.play('hurt');
          Fx.burst(null, null, 'redstone');
          showToast(
            `❌ Gagal set modal pokok: kenaikan ${formatRupiah(delta)} melebihi saldo riil bebas ${formatRupiah(funding.uangDingin)}. ` +
            `Pakai tombol "Tambah Modal" supaya sumber saldo riil tercatat.`,
            'danger'
          );
          return;
        }
      }

      state.pulsaConfig.baseModal = nextBase;
      saveData();
      render();
      window.App.closePulsaModal();
      AudioEngine.play('coin');
      Fx.burst(null, null, 'trade');
      showToast(`💾 Modal deposit pokok diset: ${formatRupiah(state.pulsaConfig.baseModal)}!`, 'success');

      if (window.KeuanganDB?.publishModalNow) {
        try {
          await window.KeuanganDB.publishModalNow(getModalPoolForSupabase());
        } catch (e) {
          console.warn('Gagal publish modal instan:', e);
        }
      }
    },

    // ===================================================================
    // KONFIRMASI BAYAR HUTANG (MODAL)
    // ===================================================================
    openConfirmPayModal: function (name, remainingAmt) {
      AudioEngine.play('click');
      state.activeDebtorModal = { name, remainingAmt };
      document.getElementById('modal-debtor-name').textContent = name;
      document.getElementById('modal-remaining-amt').textContent = formatRupiah(remainingAmt);
      document.getElementById('modal-pay-amount').value = remainingAmt;
      setupRupiahInput(document.getElementById('modal-pay-amount'));
      document.getElementById('modal-dest-wallet').value = 'DANA';

      const modal = document.getElementById('mc-debt-modal');
      if (modal) modal.classList.add('active');
    },

    closeModal: function () {
      const modal = document.getElementById('mc-debt-modal');
      if (modal) modal.classList.remove('active');
      state.activeDebtorModal = null;
    },

    confirmPaymentSubmit: async function () {
      if (!state.activeDebtorModal) return;

      const debtorName = state.activeDebtorModal.name;
      const amount = parseRupiahInput(document.getElementById('modal-pay-amount').value);
      const rawWallet = document.getElementById('modal-dest-wallet').value;
      const destWallet = detectCategoryWithTypo(rawWallet) || 'DANA';

      if (!amount || amount <= 0) {
        showToast('Nominal pembayaran tidak valid!', 'danger');
        return;
      }

      if (state.activeDebtorModal.remainingAmt && amount > state.activeDebtorModal.remainingAmt) {
        const ok = await uiConfirm({
          title: '⚠️ NOMINAL LEBIH DARI HUTANG',
          message: `Nominal pembayaran (${formatRupiah(amount)}) melebihi sisa hutang (${formatRupiah(state.activeDebtorModal.remainingAmt)}). Lanjutkan pelunasan penuh?`,
          okText: 'LANJUTKAN',
          danger: true
        });
        if (!ok) return;
      }

      await window.App.executeDebtRepayment(debtorName, amount, destWallet);
      window.App.closeModal();
    },

    executeDebtRepayment: async function (debtorName, amount, destWallet, orderId, pulsaModal, pulsaProfit) {
      const paidAmount = Math.max(0, Math.round(Number(amount) || 0));
      if (!debtorName || paidAmount <= 0) return false;

      // 1. Tentukan tagihan pulsa mana saja yang dilunasi (paling lama dulu).
      const allOpenDebts = getOpenPulsaDebts(debtorName);
      let openDebts = allOpenDebts;
      if (orderId) {
        openDebts = openDebts.filter(d => String(d.orderId) === String(orderId));
        if (!openDebts.length) {
          // Tagihan order ini sudah pernah dicatat lunas -> JANGAN catat lagi.
          showToast('💡 Pembayaran pesanan ini sudah tercatat. Uang tidak dicatat dua kali.', 'gold');
          return false;
        }
      } else if (!openDebts.length) {
        // Tidak ada tagihan pulsa terbuka. Kalau total hutang pelanggan juga 0,
        // tolak supaya uang tidak masuk dobel dari catatan yang sudah lunas.
        const { debtors } = calculateBalances();
        if ((Number(debtors[debtorName]) || 0) <= 0.5) {
          showToast(`💡 Tidak ada hutang ${debtorName} yang belum lunas. Pembayaran tidak dicatat.`, 'gold');
          return false;
        }
      }

      let leftToAllocate = paidAmount;
      const plan = [];
      openDebts.forEach((d) => {
        if (leftToAllocate <= 0.5) return;
        const pay = Math.min(leftToAllocate, d.remaining);
        leftToAllocate -= pay;
        plan.push({
          item: d.item,
          orderId: d.orderId,
          amount: pay,
          total: d.total,
          paid: d.paid,
          fullyPaid: pay >= d.remaining - 0.5
        });
      });

      // Kewajiban pelanggan SEBELUM pembayaran ini dicatat. Dipakai untuk
      // membatasi alokasi sisa pembayaran ke hutang non-pulsa, supaya sisa
      // kelebihan bayar tidak pernah dianggap "mengurangi piutang" yang sudah 0.
      const outstandingBefore = Math.max(
        0,
        Number((calculateBalances().debtors || {})[debtorName]) || 0
      );
      const totalPulsaBefore = allOpenDebts.reduce((sum, d) => sum + d.remaining, 0);
      const nonPulsaOutstanding = Math.max(0, Math.round(outstandingBefore - totalPulsaBefore));

      // 2. Selesaikan pesanan terkait di DATABASE DULU. Kalau gagal (offline /
      //    RLS / sudah di-ACC di perangkat lain), batalkan semua pencatatan
      //    supaya uang tidak pernah masuk dua kali.
      for (const p of plan) {
        if (!p.orderId || !p.fullyPaid) continue;
        const done = await window.App.setOrderStatus(
          p.orderId,
          'completed',
          `Pembayaran ${destWallet} telah di-ACC & lunas. Pesanan beres! Terima kasih.`
        );
        if (!done) return false;
      }

      // 3. Catat ledger. Satu pasang catatan per tagihan (out = kurangi piutang,
      //    in = kas bertambah sebesar laba; modal pokok kembali ke Modal Kios).
      const now = new Date().toISOString();
      const baseId = Date.now();
      let pairIndex = 0;
      const pushRepaymentPair = (partAmount, partModal, partProfit, linkOrderId) => {
        const stampId = baseId + (pairIndex * 2);
        pairIndex += 1;
        const money = Math.max(0, Math.round(partAmount));
        if (money <= 0) return;
        const modal = Math.min(money, Math.max(0, Math.round(Number(partModal) || 0)));
        const profit = Math.min(money, Math.max(0, Math.round(Number(partProfit) || (money - modal))));

        state.items.push({
          id: 'item-' + stampId,
          date: now,
          type: 'out',
          amount: money,
          desc: `${debtorName} bayar cicilan / hutang`,
          debtorName: debtorName,
          pulsaCustomer: debtorName,
          location: 'Uang Akan Datang (Hutang)',
          orderId: linkOrderId || null
        });

        state.items.push({
          id: 'item-' + (stampId + 1),
          date: now,
          type: 'in',
          amount: money,
          desc: `Pelunasan pulsa dari ${debtorName} (${destWallet})`,
          debtorName: debtorName,
          pulsaCustomer: debtorName,
          location: destWallet,
          isColdMoney: true,
          orderId: linkOrderId || null,
          isPulsaRepayment: true,
          pulsaModal: modal,
          pulsaProfit: profit
        });
      };

      plan.forEach((p) => {
        const total = Number(p.total) || 0;
        const itemModal = Math.max(0, Math.round(Number(p.item.pulsaModal) || 0));
        const paidBefore = Number(p.paid) || 0;
        const ratioBefore = total > 0 ? Math.min(1, paidBefore / total) : 1;
        const ratioAfter = total > 0 ? Math.min(1, (paidBefore + p.amount) / total) : 1;
        // Pembulatan kumulatif: total modal yang "kembali" sepanjang cicilan
        // harus sama persis dengan yang dihitung di calculateBalances.
        const partModal = Math.max(
          0,
          Math.min(p.amount, Math.round(itemModal * ratioAfter) - Math.round(itemModal * ratioBefore))
        );
        const partProfit = Math.max(0, p.amount - partModal);
        pushRepaymentPair(p.amount, partModal, partProfit, p.orderId);

        if (p.fullyPaid && p.item) {
          p.item.isDebt = true;
          p.item.isSettled = true;
          p.item.settledAt = now;
          p.item.settledWallet = destWallet;
        }
      });

      // Sisa pembayaran setelah semua tagihan pulsa terbuka dilunasi:
      // - Sebagian boleh mengurangi hutang NON-PULSA (mis. pinjaman kas biasa),
      //   maksimal sebesar kewajiban yang benar-benar masih tercatat.
      // - Selebihnya adalah uang nyata yang diterima (kelebihan bayar / tip),
      //   jadi dicatat sebagai PEMASUKAN saja. Jangan membuat item 'out' ke
      //   Hutang lagi, karena itu membuat piutang negatif dan total aset ngawur.
      if (leftToAllocate > 0.5) {
        const toNonPulsa = Math.min(leftToAllocate, nonPulsaOutstanding);
        const extra = leftToAllocate - toNonPulsa;

        if (toNonPulsa > 0.5) {
          let restModal = Number(pulsaModal);
          if (!Number.isFinite(restModal)) restModal = 0;
          restModal = Math.min(toNonPulsa, Math.max(0, Math.round(restModal)));
          pushRepaymentPair(toNonPulsa, restModal, toNonPulsa - restModal, null);
        }

        if (extra > 0.5) {
          state.items.push({
            id: 'item-extra-' + baseId,
            date: now,
            type: 'in',
            amount: extra,
            desc: `Kelebihan pembayaran ${debtorName} (${destWallet})`,
            debtorName: debtorName,
            location: destWallet,
            isColdMoney: true
          });
        }
      }

      saveData();
      render();

      if (window.KeuanganDB?.publishModalNow) {
        try {
          await window.KeuanganDB.publishModalNow(getModalPoolForSupabase());
        } catch (e) {}
      }

      AudioEngine.play('coin');
      triggerCelebration(paidAmount);

      const { debtors, uangPanas } = calculateBalances();
      const sisa = debtors[debtorName] || 0;
      const sisaText = sisa > 0 ? `Sisa hutang ${debtorName}: ${formatRupiah(sisa)}` : `Hutang ${debtorName} LUNAS! ✅`;

      showToast(`💎 ${debtorName} membayar ${formatRupiah(paidAmount)} ke ${destWallet}. ${sisaText} Saldo Panas (Modal) kini ${formatRupiah(uangPanas)}!`, 'success');
      return true;
    },

    logoutAdmin: function () {
      AudioEngine.play('click');
      if (window.KeuanganAuth) {
        window.KeuanganAuth.logout();
        return;
      }
      state.auth = {
        isLoggedIn: false,
        user: ''
      };
      saveData();
      render();
      showToast('Admin berhasil logout.', 'gold');
    },

    // ===================================================================
    // RIWAYAT TRANSAKSI PELANGGAN KIOS PULSA (MODAL)
    // ===================================================================
    openCustomerHistoryModal: function (custName) {
      AudioEngine.play('click');
      const { customers } = calculateBalances();
      const cust = customers[custName];
      if (!cust) {
        showToast(`Belum ada data riwayat untuk pelanggan "${custName}".`, 'gold');
        return;
      }

      const nameEl = document.getElementById('cust-modal-name');
      const spendEl = document.getElementById('cust-modal-total-spend');
      const debtEl = document.getElementById('cust-modal-debt');
      const tbody = document.getElementById('cust-modal-table-body');
      const modal = document.getElementById('mc-customer-history-modal');

      if (nameEl) nameEl.textContent = cust.name + (cust.isOwner ? ' 👑 (OWNER - BEBAS HUTANG)' : '');
      if (spendEl) spendEl.textContent = formatRupiah(cust.totalBeli) + ` (${cust.trxCount} Trx)`;
      if (debtEl) {
        if (cust.isLunas) {
          debtEl.innerHTML = '<span style="color: var(--mc-emerald);">Rp 0 0 0 (LUNAS ✅)</span>';
        } else {
          debtEl.innerHTML = `<span style="color: var(--mc-gold);">${formatRupiah(cust.sisaHutang)}</span>`;
        }
      }

      if (tbody) {
        const hist = [...cust.history].sort((a, b) => new Date(b.date) - new Date(a.date));
        if (hist.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #888; padding: 14px;">Belum ada riwayat.</td></tr>';
        } else {
          let html = '';
          hist.forEach(h => {
            let statusBadge = '';
            if (h.isPulsa) {
              statusBadge = (h.location === 'Uang Akan Datang (Hutang)')
                ? '<span class="badge-debt">⏳ Pulsa Bon</span>'
                : '<span class="badge-pulsa">⚡ Pulsa (Lunas)</span>';
            } else if (h.location === 'Uang Akan Datang (Hutang)' && h.type === 'out') {
              statusBadge = '<span class="badge-in">✅ Bayar Cicilan</span>';
            } else if (h.location === 'Uang Akan Datang (Hutang)' && h.type === 'in') {
              statusBadge = '<span class="badge-debt">⏳ Dihutang</span>';
            } else {
              statusBadge = `<span class="badge-category">${escapeHtml(h.location)}</span>`;
            }

            html += `
              <tr>
                <td style="white-space: nowrap;">${formatDateTime(h.date)}</td>
                <td><strong>${escapeHtml(h.desc)}</strong></td>
                <td style="font-weight: bold; font-family: var(--mc-pixel-font);">${formatRupiah(h.amount)}</td>
                <td>${statusBadge}</td>
              </tr>
            `;
          });
          tbody.innerHTML = html;
        }
      }

      if (modal) modal.classList.add('active');
    },

    closeCustomerHistoryModal: function () {
      const modal = document.getElementById('mc-customer-history-modal');
      if (modal) modal.classList.remove('active');
    },

    setFilter: function (loc) {
      AudioEngine.play('click');
      if (state.filterLocation === loc) {
        state.filterLocation = 'all';
      } else {
        state.filterLocation = loc;
      }
      render();
    },

    onSearch: function (val) {
      state.searchQuery = val;
      render();
    },

    deleteItem: async function (id) {
      const ok = await uiConfirm({
        title: '🗑️ HAPUS TRANSAKSI',
        message: 'Hapus catatan transaksi ini? Saldo akan dihitung ulang.',
        okText: 'HAPUS',
        danger: true
      });
      if (!ok) return;

      if (window.KeuanganDB?.deleteTransaction && window.KeuanganDB.isOwnerContext?.() && state.remoteReady) {
        try {
          await window.KeuanganDB.deleteTransaction(id);
        } catch (err) {
          showToast('Gagal menghapus transaksi di server: ' + (err?.message || 'Coba lagi.'), 'danger');
          return;
        }
      }

      state.items = state.items.filter(i => i.id !== id);
      saveData();
      render();

      if (window.KeuanganDB?.publishModalNow) {
        try {
          window.KeuanganDB.publishModalNow(getModalPoolForSupabase());
        } catch (e) {}
      }

      showToast('Catatan dihapus!', 'danger');
    },

    fillPrompt: function (text) {
      AudioEngine.play('click');
      const input = document.getElementById('chat-input');
      if (input) {
        input.value = text;
        input.focus();
      }
    },

    toggleSfx: function () {
      state.settings.sfx = !state.settings.sfx;
      saveData();
      ['sfx-btn', 'buyer-sfx-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.textContent = state.settings.sfx ? '🔊 SFX: ON' : '🔇 SFX: OFF';
      });
      if (state.settings.sfx) AudioEngine.play('coin');
      showToast(state.settings.sfx ? 'Efek Suara 8-Bit AKTIF!' : 'Efek Suara DINONAKTIFKAN', 'gold');
    },

    toggleBgm: function () {
      const isOn = AudioEngine.toggleBgm();
      ['bgm-btn', 'buyer-bgm-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
          btn.innerHTML = `<span class="bgm-icon">🎵</span> BGM: ${isOn ? 'ON' : 'OFF'}`;
          btn.classList.toggle('active', isOn);
        }
      });
      showToast(isOn ? '🎵 Terraria Pixel BGM: DIAKTIFKAN!' : '🔇 Terraria Pixel BGM: DIMATIKAN.', isOn ? 'success' : 'gold');
    },

    exportCSV: function () {
      AudioEngine.play('click');
      if (state.items.length === 0) {
        showToast('Belum ada data transaksi!', 'danger');
        return;
      }

      let csv = 'Waktu,Keterangan,Kategori,Tipe,Jumlah_Rp\n';
      state.items.forEach(i => {
        const d = formatDateTime(i.date).replace(/<[^>]+>/g, ' ');
        const t = i.type === 'in' ? 'Masuk' : 'Keluar';
        csv += `"${d}","${i.desc.replace(/"/g, '""')}","${i.location}","${t}","${i.amount}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `KeuanganKu_Minecraft_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      showToast('File CSV berhasil diunduh!', 'success');
    },

    resetData: async function () {
      const ok = await uiConfirm({
        title: '🚨 RESET SEMUA DATA',
        message: 'PERINGATAN: Kosongkan seluruh data saldo & catatan? Tindakan ini tidak bisa dibatalkan.',
        okText: 'YA, KOSONGKAN',
        danger: true
      });
      if (ok) {
        localStorage.removeItem(STORAGE_KEY);
        state.items = [];
        state.quests = [];
        state.pulsaConfig = { baseModal: 0, manualModalOffset: 0 };
        saveData();
        render();

        if (window.KeuanganDB && window.KeuanganDB.isOwnerContext()) {
          try {
            if (window.KeuanganDB.clearOwnerRows) {
              await window.KeuanganDB.clearOwnerRows();
            }
            await window.KeuanganDB.publishModalNow(0);
            const cancelled = await window.KeuanganDB.cancelAllPendingOrders('Reset data kios oleh owner');
            if (cancelled > 0) {
              showToast(`Semua data dibersihkan & ${cancelled} pesanan uji coba dibatalkan. Modal di-reset ke Rp 0!`, 'danger');
              await window.App.refreshOwnerOrders?.();
              return;
            }
          } catch (e) {
            console.warn('Gagal reset remote orders:', e);
          }
        }

        showToast('Semua data dikosongkan!', 'danger');
      }
    },

    toggleSkyTheme: function () {
      const current = document.documentElement.getAttribute('data-theme') || 'night';
      const next = current === 'day' ? 'night' : 'day';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('keuanganku_sky_theme', next);
      const btn = document.getElementById('theme-btn');
      if (btn) btn.textContent = next === 'day' ? '🌙 MALAM' : '🌞 SIANG';
      AudioEngine.play('click');
      showToast(next === 'day' ? 'Langit Siang aktif!' : 'Langit Malam aktif!', 'gold');
    },

    // ===================================================================
    // PESANAN BUYER & KATALOG PRODUK (SUPABASE)
    // ===================================================================
    refreshOwnerOrders: async function () {
      const tbody = document.getElementById('owner-orders-body');
      if (!tbody) return;

      if (!window.KeuanganDB || !window.KeuanganDB.isOwnerContext()) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#777;padding:16px;">Pesanan hanya tersedia untuk owner.</td></tr>`;
        return;
      }

      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#777;padding:16px;">Memuat pesanan...</td></tr>`;

      try {
        const [orders, statusRow] = await Promise.all([
          window.KeuanganDB.listAllOrders(),
          window.KeuanganDB.getPublicStatus().catch(() => null)
        ]);
        state.ownerOrders = orders || [];

        // Pool modal dari ledger lokal (nilai yang seharusnya ada di DB).
        // Dipakai juga untuk self-heal di bawah.
        const expectedPool = state.remoteReady
          ? Math.max(0, Math.round(getModalPoolForSupabase()))
          : 0;
        const dbModal = Math.max(0, Number(statusRow?.modal_amount) || 0);

        // Self-heal: kalau modal_amount di DB LEBIH KECIL dari pool lokal
        // (sering terjadi karena publish neto dari versi lama / perangkat
        // lain), naikkan lagi supaya ACC & pesanan buyer tidak salah
        // mengira modal habis. Hanya menaikkan (tidak menurunkan) agar
        // tidak menimpa perubahan modal dari tab/perangkat lain.
        if (state.remoteReady && window.KeuanganDB?.publishModalNow &&
            expectedPool > dbModal + 0.5) {
          window.KeuanganDB.publishModalNow(expectedPool).catch(() => {});
        }

        // Jangan pakai angka DB yang basi untuk mengunci tombol ACC:
        // ambil yang lebih besar antara DB dan pool lokal. RPC tetap
        // menjadi penentu akhir (atomik + validasi reservasi).
        const totalModal = Math.max(dbModal, expectedPool);
        const dbReserved = Math.max(0, Number(statusRow?.reserved) || 0);
        // Angka tampilan mengikuti ledger lokal: order yang MASIH MENUNGGU
        // belum menahan modal (pulsa belum dikirim), sedangkan DB menghitung
        // semua order pending+confirmed sebagai reserved. Tanpa ini kartu
        // menampilkan "tersedia Rp 0" padahal ACC sebenarnya bisa.
        const localPanas = Math.max(0, Math.round(calculateBalances().uangPanas));
        const useLocalView = state.remoteReady && expectedPool > 0;
        const reserved = useLocalView ? Math.max(0, expectedPool - localPanas) : dbReserved;
        const modal = useLocalView ? localPanas : Math.max(0, totalModal - dbReserved);

        const summaryEl = document.getElementById('owner-orders-modal-summary');
        if (summaryEl) {
          summaryEl.textContent =
            `Modal ${formatRupiah(totalModal)} • tertahan ${formatRupiah(reserved)} • tersedia ${formatRupiah(modal)}`;
        }

        const pendingOrders = orders.filter(o => o.status === 'pending');
        const pendingCount = pendingOrders.length;

        // Update badge navigasi Kios Pulsa
        const kiosBadge = document.getElementById('nav-badge-kios');
        if (kiosBadge) {
          if (pendingCount > 0) {
            kiosBadge.textContent = `${pendingCount} BARU`;
            kiosBadge.style.display = 'inline-block';
            kiosBadge.style.background = '#ef4444';
            kiosBadge.style.color = '#ffffff';
            kiosBadge.style.fontWeight = 'bold';
          } else {
            kiosBadge.style.display = 'none';
          }
        }

        // Update indikator modal tertahan di Tab 1
        const reservedSubtext = document.getElementById('uang-panas-reserved-subtext');
        if (reservedSubtext) {
          if (reserved > 0) {
            reservedSubtext.textContent = `⚠️ Pesanan tertahan: ${formatRupiah(reserved)} • Tersedia: ${formatRupiah(modal)}`;
            reservedSubtext.style.display = 'block';
          } else {
            reservedSubtext.style.display = 'none';
          }
        }

        if (!orders.length) {
          tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#777;padding:16px;">Belum ada pesanan dari buyer.</td></tr>`;
          return;
        }

        const statusMap = {
          pending: { label: '⏳ MENUNGGU', badge: 'badge-debt' },
          confirmed: { label: '✅ DITERIMA', badge: 'badge-pulsa' },
          completed: { label: '🏁 SELESAI', badge: 'badge-in' },
          cancelled: { label: '✕ DITOLAK', badge: 'badge-out' }
        };

        const paymentMap = {
          cash: 'Cash',
          transfer: 'Transfer',
          qris: 'QRIS',
          dana: 'DANA',
          ovo: 'OVO',
          gopay: 'GoPay',
          shopeepay: 'ShopeePay'
        };

        const fmtDay = (value) => {
          if (!value) return '-';
          try {
            return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
              day: 'numeric', month: 'short', year: 'numeric'
            });
          } catch (e) {
            return String(value);
          }
        };

        let html = '';
        orders.forEach(order => {
          const status = statusMap[order.status] || { label: order.status, badge: 'badge-category' };
          const method = paymentMap[order.payment_method] || 'Cash';
          const isDanaNow = order.payment_method === 'dana' && order.pay_timing === 'now';
          const proof = window.KeuanganDB?.getOrderProof ? window.KeuanganDB.getOrderProof(order) : order.payment_proof;
          const hasProof = !!proof;

          let proofHtml = '';
          if (hasProof) {
            proofHtml = `
              <div style="margin-top:4px;">
                <button type="button" class="mc-btn mc-btn-diamond" style="padding:4px 8px; font-size:7.5px; display:inline-flex; align-items:center; gap:4px;" onclick="window.App.viewProof('${order.id}')" title="Klik untuk meninjau screenshot bukti transfer">
                  📸 LIHAT BUKTI TF
                </button>
              </div>
            `;
          } else if (order.status === 'confirmed') {
            proofHtml = `
              <div style="margin-top:4px; font-size:0.68rem; color:#38bdf8;">
                ⏳ Pulsa terkirim • Menunggu buyer kirim SS bukti TF
              </div>
            `;
          } else if (order.status === 'pending') {
            proofHtml = `
              <div style="margin-top:4px; font-size:0.68rem; color:#fbbf24;">
                ⏳ Menunggu ACC (Kirim Pulsa)
              </div>
            `;
          }

          const payHtml = order.pay_timing === 'later'
            ? `${escapeHtml(method)}<br><span style="color:#fbbf24;">⏰ ${escapeHtml(fmtDay(order.due_date))}</span>`
            : (isDanaNow 
                ? `${escapeHtml(method)}<br><span style="color:#38bdf8;font-size:0.68rem;font-weight:700;">(DANA Online)</span>`
                : `${escapeHtml(method)}<br><span style="color:#94a3b8;">sekarang</span>`);

          let actions = '';
          const loggedItem = state.items.find(it => it.orderId === order.id && it.isPulsa) ||
            state.items.find(it => it.orderId === order.id);
          const isSettled = order.status === 'completed' || !!loggedItem?.isSettled;
          const isDebtOrder = loggedItem ? (!!loggedItem.isDebt && !isSettled) : (order.status === 'confirmed');

          if (order.status === 'pending') {
            const hasExplicitAdmin =
              order.admin_fee !== undefined && order.admin_fee !== null && order.admin_fee !== '';
            let orderProfit = hasExplicitAdmin
              ? Math.max(0, Number(order.admin_fee) || 0)
              : (window.KeuanganDB?.extractAdminFee ? window.KeuanganDB.extractAdminFee(order) : 0);

            // Fallback hanya untuk data lama yang benar-benar tidak punya admin.
            if (!hasExplicitAdmin && orderProfit <= 0) {
              const orderExtracted = extractAllAmounts(order.product_name || '');
              if (orderExtracted.length > 0 && orderExtracted[0].val > 0 && orderExtracted[0].val < Number(order.amount)) {
                orderProfit = Number(order.amount) - orderExtracted[0].val;
              } else if (Number(order.amount) > 2000) {
                orderProfit = 2000;
              }
            }
            if (orderProfit > Number(order.amount)) orderProfit = Number(order.amount);
            const orderNeededModal = Math.max(0, Number(order.amount) - orderProfit);
            const shortfall = Math.max(0, orderNeededModal - modal);

            // Tombol ACC TIDAK pernah dikunci: owner masih bisa menyesuaikan
            // uang admin di dialog (modal pokok = harga - admin). Kalau kurang,
            // tampilkan peringatan saja; validasi final tetap di acceptOrder.
            actions = `
              <div style="display:flex; flex-direction:column; gap:3px; align-items:center;">
                <div style="display:flex; gap:4px; align-items:center; justify-content:center;">
                  <button class="mc-btn mc-btn-green mc-btn-acc-lg"
                    title="Modal pokok ${formatRupiah(orderNeededModal)} • tersedia ${formatRupiah(modal)}"
                    onclick="window.App.acceptOrder('${order.id}')">ACC</button>
                  <button class="mc-btn mc-btn-decline-lg"
                    onclick="window.App.declineOrder('${order.id}')">TOLAK</button>
                </div>
                ${shortfall > 0.5 ? `<div style="font-size:6.6px; color:#fbbf24; font-weight:700;">⚠️ Modal kurang ${formatRupiah(shortfall)} — kurangi uang admin saat ACC</div>` : ''}
              </div>
            `;
          } else if (order.status === 'confirmed') {
            actions = `
              <div style="display:flex; gap:4px; align-items:center; justify-content:center; flex-wrap:wrap;">
                ${hasProof ? `
                  <button class="mc-btn mc-btn-diamond" style="padding:6px 9px; font-size:7.5px; font-weight:700;"
                    onclick="window.App.viewProof('${order.id}')" title="Tinjau screenshot bukti transfer pembeli">
                    📸 TINJAU BUKTI TF
                  </button>
                ` : ''}
                ${isDebtOrder ? `
                  <button class="mc-btn mc-btn-green" style="padding:6px 9px; font-size:7.5px; font-weight:700; background:#059669;"
                    onclick="window.App.confirmDebtSettlementForOrder('${order.id}')" title="Uang transfer DANA/Cash sudah masuk, selesaikan piutang">
                    💰 ACC UANG MASUK
                  </button>
                ` : `
                  <span style="color:var(--mc-emerald);font-weight:700;font-size:0.75rem;">✔ LUNAS BERES</span>
                  <button class="mc-btn mc-btn-gold" style="padding:6px 9px; font-size:7.5px;"
                    onclick="window.App.completeOrder('${order.id}')">SELESAI</button>
                `}
                <button class="mc-btn mc-btn-decline-lg" style="padding:6px 8px; font-size:7.5px;"
                  onclick="window.App.declineOrder('${order.id}')">TOLAK</button>
              </div>
            `;
          } else if (order.status === 'cancelled') {
            actions = '<span style="color:var(--mc-redstone);font-weight:700;font-size:0.75rem;">✕ DITOLAK</span>';
          } else {
            actions = '<span style="color:var(--mc-emerald);font-weight:700;font-size:0.75rem;">✔ SELESAI (LUNAS)</span>';
          }

          html += `
            <tr>
              <td class="table-col-action" style="white-space:nowrap; text-align:center;">${actions}</td>
              <td style="white-space:nowrap;"><span class="${status.badge}">${status.label}</span></td>
              <td><strong>${escapeHtml(order.buyer_username || '-')}</strong></td>
              <td>
                <strong>${escapeHtml(order.product_name)}</strong><br>
                <span style="color:var(--mc-gold);font-weight:700;font-size:0.85rem;">${formatRupiah(order.amount)}</span>
              </td>
              <td style="font-size:0.72rem;white-space:nowrap;">
                ${payHtml}
                ${proofHtml}
              </td>
              <td style="max-width:140px;font-size:0.72rem;color:#94a3b8;">${escapeHtml(order.notes || '-')}</td>
              <td style="max-width:160px;font-size:0.72rem;color:#cbd5e1;">${escapeHtml(order.owner_note || '-')}</td>
              <td style="white-space:nowrap;font-size:0.72rem;color:#94a3b8;">${formatDateTime(order.created_at)}</td>
            </tr>
          `;
        });

        tbody.innerHTML = html;
      } catch (error) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--mc-redstone);padding:16px;">
          Gagal memuat pesanan: ${escapeHtml(error?.message || 'Coba lagi.')}
        </td></tr>`;
      }
    },

    acceptOrder: async function (orderId, options) {
      let order = (state.ownerOrders || []).find(o => String(o.id) === String(orderId));
      if (!order && window.KeuanganDB?.listAllOrders) {
        try {
          const freshOrders = await window.KeuanganDB.listAllOrders();
          state.ownerOrders = freshOrders;
          order = freshOrders.find(o => String(o.id) === String(orderId));
        } catch (e) {}
      }

      if (!order) {
        showToast('Data pesanan tidak ditemukan. Coba refresh.', 'danger');
        return;
      }

      if (order.status !== 'pending') {
        showToast(`Pesanan ini sudah berstatus ${order.status.toUpperCase()}.`, 'gold');
        return;
      }

      const orderAmt = Number(order.amount) || 0;
      const rawBuyer = (order.buyer_username || 'Pelanggan').trim();
      const buyerName = rawBuyer ? (rawBuyer.charAt(0).toUpperCase() + rawBuyer.slice(1)) : 'Pelanggan';

      // Sesuai aturan owner: Jika buyer bayar pakai CASH atau bayar nanti/tempo, masuk kategori nyicil (piutang)
      const isCash = String(order.payment_method || '').toLowerCase() === 'cash' || String(order.payment_method || '').toLowerCase() === 'tunai';

      // 1. HITUNG MODAL POKOK VS UANG ADMIN (CUAN) TERLEBIH DAHULU
      const hasExplicitAdmin =
        order.admin_fee !== undefined && order.admin_fee !== null && order.admin_fee !== '';
      let profitAmount = hasExplicitAdmin
        ? Math.max(0, Number(order.admin_fee) || 0)
        : (window.KeuanganDB?.extractAdminFee ? window.KeuanganDB.extractAdminFee(order) : 0);

      // Tebakan hanya untuk data lama tanpa kolom admin_fee.
      if (!hasExplicitAdmin && profitAmount <= 0) {
        const extracted = extractAllAmounts(order.product_name);
        if (extracted.length > 0 && extracted[0].val > 0 && extracted[0].val < orderAmt) {
          profitAmount = orderAmt - extracted[0].val;
        } else if (orderAmt > 2000) {
          profitAmount = 2000;
        }
      }
      if (profitAmount > orderAmt) profitAmount = orderAmt;
      let modalAmount = Math.max(0, orderAmt - profitAmount);

      // 2. INFO KETERSEDIAAN SALDO MODAL KIOS
      // HANYA memotong modal pokok (di luar uang admin). JANGAN blokir di sini:
      // modal pokok = harga - uang admin, dan owner masih bisa menyesuaikan
      // admin pada langkah berikutnya. Validasi final dilakukan setelah nominal
      // admin ditentukan (lihat re-validasi di bawah).
      const { uangPanas } = calculateBalances();

      // 3. STATUS PEMBAYARAN: ALUR KIRIM PULSA DULU LALU TRANSFER
      // Sesuai alur kios pulsa: Saat owner klik ACC pesanan pending, pulsa/saldo
      // dikirim ke HP buyer -> modal pokok kios dipotong -> dicatat sebagai
      // piutang/nyicil (isDebt = true).
      // Setelah pulsa masuk, buyer transfer DANA & upload screenshot bukti TF.
      // Owner kemudian meninjau bukti TF & klik [ACC UANG MASUK] untuk pelunasan lunas beres.
      let isDebt = true;
      if (options && options.verified === true) {
        isDebt = false;
      } else if (options && options.asDebt === true) {
        isDebt = true;
      }

      // 4. BERI KESEMPATAN OWNER MENENTUKAN / MENYESUAIKAN UANG ADMIN (CUAN)
      const adminInput = await uiPrompt({
        title: '💎 JATAH ADMIN PESANAN',
        message:
          `Berapa uang admin / laba bersih pesanan ini?\n` +
          `Admin langsung masuk ke kas sebagai keuntungan bersih, sedangkan modal pokok (${formatRupiah(orderAmt)} - admin) kembali ke Modal Kios.\n\n` +
          `Saldo modal kios tersedia: ${formatRupiah(uangPanas)}.`,
        hint: 'Contoh: 2000 atau 4000. Ketik 0 jika tanpa admin.',
        inputLabel: 'UANG ADMIN (RP)',
        placeholder: '0',
        inputMode: 'numeric',
        value: String(profitAmount),
        selectValue: true,
        okText: 'LANJUT ACC',
        required: true,
        requiredMessage: 'Isi 0 kalau tanpa admin.'
      });
      if (adminInput === null) return;
      const parsedAdmin = parseRupiahInput(adminInput);
      profitAmount = Math.max(0, isNaN(parsedAdmin) ? profitAmount : parsedAdmin);
      if (profitAmount > orderAmt) profitAmount = orderAmt;
      modalAmount = Math.max(0, orderAmt - profitAmount);

      // Re-validasi modal jika owner mengubah admin
      if (modalAmount > uangPanas) {
        showToast(`❌ Saldo modal kios tidak cukup (${formatRupiah(uangPanas)}). Modal pokok pesanan ${formatRupiah(modalAmount)}.`, 'danger');
        return;
      }

      const defaultNote = isDebt
        ? 'Pulsa sudah dikirim! Silakan transfer ke DANA & upload bukti transfer di menu Pesanan.'
        : 'Pulsa sudah dikirim & pembayaran lunas. Terima kasih!';

      const note = await uiPrompt({
        title: '✅ KETERANGAN UNTUK BUYER',
        message: 'Tulis keterangan yang akan dilihat buyer.',
        hint: 'Contoh: "Pulsa sudah dikirim! Silakan transfer ke DANA & upload bukti transfer."',
        inputLabel: 'KETERANGAN (WAJIB)',
        placeholder: defaultNote,
        value: defaultNote,
        okText: 'ACC PESANAN',
        required: true,
        requiredMessage: 'Keterangan wajib diisi kalau mau ACC.'
      });
      if (note === null) return;
      const clean = String(note).trim();
      if (!clean) {
        showToast('Keterangan wajib diisi kalau mau ACC.', 'danger');
        return;
      }

      // 5. PEMETAAN DOMPET (HANYA DANA DAN CASH/DOMPET)
      function mapPayMethodToWallet(method) {
        const m = String(method || '').toLowerCase();
        if (m === 'cash' || m === 'tunai' || m === 'dompet') return 'Dompet';
        return 'DANA';
      }

      const destWallet = mapPayMethodToWallet(order.payment_method);
      const nowIso = new Date().toISOString();

      // Hindari duplikasi pencatatan
      const alreadyLogged = state.items.some(it => it.orderId === order.id);

      // 6. SEGARKAN MODAL POOL KE DATABASE SEBELUM ACC.
      // public_status.modal_amount bisa basi/lebih kecil (mis. sisa publish
      // dari versi lama atau perangkat lain), sehingga RPC menolak dengan
      // "modal tidak cukup" padahal saldo riil masih ada. Publish ulang dari
      // ledger lokal yang sudah termuat lebih dulu.
      if (window.KeuanganDB?.publishModalNow) {
        try {
          await window.KeuanganDB.publishModalNow(getModalPoolForSupabase());
        } catch (e) {
          console.warn('Gagal menyegarkan modal sebelum ACC:', e);
        }
      }

      // 7. SIMPAN STATUS DULU. RPC inilah yang memvalidasi modal pokok.
      // Ledger baru ditulis setelah sukses, supaya kalau RPC gagal tidak ada
      // transaksi hantu / dobel saat owner mencoba ACC lagi.
      const ok = await window.App.setOrderStatus(orderId, 'confirmed', clean, profitAmount);
      if (!ok) return;

      if (!alreadyLogged) {
        const methodTag = isCash
          ? (order.pay_timing === 'later' ? `CASH (TEMPO s/d ${order.due_date || '-'})` : 'CASH (NYICIL)')
          : (isDebt ? `TEMPO s/d ${order.due_date || '-'}` : (order.payment_method || 'DANA').toUpperCase());

        const itemDesc = isDebt
          ? `Pulsa ${formatRupiah(orderAmt, '')} (${buyerName}) • Pesanan #${order.id.slice(0, 6)} [${methodTag}]`
          : `Pulsa ${formatRupiah(orderAmt, '')} (${buyerName}) • Pesanan #${order.id.slice(0, 6)} [${(order.payment_method || 'CASH').toUpperCase()}]`;

        state.items.push({
          id: 'item-' + Date.now(),
          date: nowIso,
          type: 'in',
          amount: orderAmt,
          desc: itemDesc,
          location: isDebt ? 'Uang Akan Datang (Hutang)' : destWallet,
          debtorName: isDebt ? buyerName : null,
          sourceWallet: destWallet,
          isPulsa: true,
          isDebt: isDebt,
          pulsaCustomer: buyerName,
          pulsaTotal: orderAmt,
          pulsaModal: modalAmount,
          pulsaProfit: profitAmount,
          orderId: order.id,
          dueDate: order.due_date || null
        });

        saveData();
        render();

        // Publikasikan ulang setelah ledger masuk, supaya modal_amount
        // mencerminkan transaksi ini (khususnya order tempo/nyicil).
        if (window.KeuanganDB?.publishModalNow) {
          try {
            await window.KeuanganDB.publishModalNow(getModalPoolForSupabase());
          } catch (e) {}
        }
      }

      AudioEngine.play('trade');
      Fx.burst(null, null, 'trade');
      if (isDebt) {
        showToast(`✅ Pesanan di-ACC! Otomatis tercatat di Buku Piutang & Hutang (${buyerName}), modal berkurang sementara ${formatRupiah(modalAmount)}.`, 'gold');
      } else {
        if (profitAmount >= 100000) triggerCelebration(profitAmount);
        showToast(`✅ Pesanan di-ACC! Modal pulsa ${formatRupiah(modalAmount)} kembali ke Modal Kios, Laba admin ${formatRupiah(profitAmount)} langsung masuk kas!`, 'success');
      }
    },

    declineOrder: async function (orderId) {
      const note = await uiPrompt({
        title: '✕ TOLAK PESANAN',
        message: 'Tulis alasan penolakan. Buyer akan melihat alasan ini.',
        hint: 'Contoh: "Saldo modal kios sedang tidak cukup."',
        inputLabel: 'ALASAN PENOLAKAN (WAJIB)',
        placeholder: 'Saldo modal kios sedang tidak cukup.',
        okText: 'TOLAK PESANAN',
        required: true,
        requiredMessage: 'Alasan penolakan wajib diisi.',
        danger: true
      });
      if (note === null) return;
      const clean = String(note).trim();
      if (!clean) {
        showToast('Alasan penolakan wajib diisi.', 'danger');
        return;
      }

      // Rollback jika sebelumnya sudah terlanjur di-ACC dan tercatat di pembukuan
      const rollbackItems = state.items.filter(it => it.orderId === orderId);
      if (rollbackItems.length > 0) {
        if (window.KeuanganDB?.deleteTransaction && window.KeuanganDB.isOwnerContext?.() && state.remoteReady) {
          for (const it of rollbackItems) {
            try {
              await window.KeuanganDB.deleteTransaction(it.id);
            } catch (err) {
              console.warn('Gagal hapus ledger rollback:', err);
            }
          }
        }
        state.items = state.items.filter(it => it.orderId !== orderId);
        saveData();
        render();
      }

      await window.App.setOrderStatus(orderId, 'cancelled', clean);
    },

    completeOrder: async function (orderId) {
      const loggedItem = (state.items || []).find(it => it.orderId === orderId && it.isPulsa) ||
        (state.items || []).find(it => it.orderId === orderId);
      if (loggedItem && loggedItem.isDebt && !loggedItem.isSettled) {
        return this.confirmDebtSettlementForOrder(orderId);
      }
      const note = await uiPrompt({
        title: '🏁 SELESAIKAN PESANAN',
        message: 'Keterangan selesai untuk buyer (opsional).',
        inputLabel: 'KETERANGAN (OPSIONAL)',
        placeholder: 'Pesanan selesai.',
        value: 'Pesanan selesai.',
        okText: 'SELESAIKAN',
        selectValue: true
      });
      if (note === null) return;
      await window.App.setOrderStatus(orderId, 'completed', String(note).trim());
    },

    acceptOrderFromProof: async function (orderId, isVerified) {
      this.closeProofViewer();
      await this.acceptOrder(orderId, isVerified ? { verified: true } : { asDebt: true });
    },

    viewProof: function (orderId) {
      AudioEngine.play('click');
      let order = (state.ownerOrders || []).find(o => String(o.id) === String(orderId));
      if (!order && state.items) {
        const it = state.items.find(i => i.orderId === orderId);
        if (it) {
          order = {
            id: orderId,
            buyer_username: it.debtorName || it.pulsaCustomer,
            product_name: it.desc,
            amount: it.amount,
            status: it.isSettled ? 'completed' : (it.isDebt ? 'confirmed' : 'completed')
          };
        }
      }

      const modal = document.getElementById('mc-proof-viewer-modal');
      if (!modal) return;

      const buyerEl = document.getElementById('proof-viewer-buyer');
      const productEl = document.getElementById('proof-viewer-product');
      const amountEl = document.getElementById('proof-viewer-amount');
      const imgEl = document.getElementById('proof-viewer-img');
      const emptyEl = document.getElementById('proof-viewer-empty');
      const actionsEl = document.getElementById('proof-viewer-actions');

      const rawBuyer = order?.buyer_username || 'Pelanggan';
      const buyerName = rawBuyer ? (rawBuyer.charAt(0).toUpperCase() + rawBuyer.slice(1)) : 'Pelanggan';
      const proof = window.KeuanganDB?.getOrderProof ? window.KeuanganDB.getOrderProof(order || orderId) : order?.payment_proof;

      if (buyerEl) buyerEl.textContent = buyerName;
      if (productEl) productEl.textContent = order?.product_name || '-';
      if (amountEl) amountEl.textContent = order ? formatRupiah(order.amount) : '-';

      if (proof) {
        if (imgEl) {
          imgEl.src = proof;
          imgEl.style.display = 'block';
        }
        if (emptyEl) emptyEl.style.display = 'none';
      } else {
        if (imgEl) imgEl.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'block';
      }

      if (actionsEl) {
        if (order?.status === 'pending') {
          actionsEl.innerHTML = `
            <button class="mc-btn mc-btn-green mc-btn-acc-lg" onclick="window.App.acceptOrderFromProof('${order.id}', true)">
              ✅ BUKTI BENAR - ACC UANG MASUK (BERES)
            </button>
            <button class="mc-btn mc-btn-gold mc-btn-acc-lg" onclick="window.App.acceptOrderFromProof('${order.id}', false)">
              ⏳ BUKTI BELUM JELAS - ACC TAPI HITUNG NYICIL
            </button>
            <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
              <button class="mc-btn mc-btn-redstone mc-btn-decline-lg" onclick="window.App.closeProofViewer(); window.App.declineOrder('${order.id}')">
                ✕ TOLAK PESANAN
              </button>
              <button class="mc-btn mc-btn-dark" onclick="window.App.closeProofViewer()">
                TUTUP
              </button>
            </div>
          `;
        } else if (order?.status === 'confirmed') {
          const loggedItem = state.items.find(it => it.orderId === order.id && it.isPulsa) ||
            state.items.find(it => it.orderId === order.id);
          const isSettled = order.status === 'completed' || !!loggedItem?.isSettled;
          const isDebt = loggedItem ? (!!loggedItem.isDebt && !isSettled) : true;
          actionsEl.innerHTML = `
            ${isDebt ? `
              <button class="mc-btn mc-btn-green mc-btn-acc-lg" onclick="window.App.closeProofViewer(); window.App.confirmDebtSettlementForOrder('${order.id}')">
                💰 BUKTI BENAR - ACC UANG MASUK (LUNAS BERES)
              </button>
            ` : `
              <div style="color:var(--mc-emerald); font-weight:700; margin-bottom:6px; font-size:0.8rem;">
                ✔ PEMBAYARAN SUDAH DI-ACC (LUNAS BERES)
              </div>
            `}
            <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
              <button class="mc-btn mc-btn-dark" onclick="window.App.closeProofViewer()">
                TUTUP
              </button>
            </div>
          `;
        } else {
          actionsEl.innerHTML = `
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
              <button class="mc-btn mc-btn-dark" onclick="window.App.closeProofViewer()">
                TUTUP
              </button>
            </div>
          `;
        }
      }

      modal.classList.add('active');
    },

    closeProofViewer: function () {
      const modal = document.getElementById('mc-proof-viewer-modal');
      if (modal) modal.classList.remove('active');
    },

    confirmDebtSettlementForOrder: async function (orderId) {
      if (!orderId) return;
      if (!window.__settlingOrderIds) window.__settlingOrderIds = {};
      if (window.__settlingOrderIds[orderId]) {
        console.warn('Pelunasan pesanan sedang berjalan:', orderId);
        return;
      }

      let order = (state.ownerOrders || []).find(o => String(o.id) === String(orderId));
      if (!order && window.KeuanganDB?.listAllOrders) {
        try {
          const fresh = await window.KeuanganDB.listAllOrders();
          state.ownerOrders = fresh;
          order = fresh.find(o => String(o.id) === String(orderId));
        } catch (e) {}
      }

      const loggedItem = state.items.find(it => it.orderId === orderId && it.isPulsa) ||
        state.items.find(it => it.orderId === orderId);

      const rawBuyer = order?.buyer_username || loggedItem?.debtorName || loggedItem?.pulsaCustomer || 'Pelanggan';
      const buyerName = rawBuyer ? (rawBuyer.charAt(0).toUpperCase() + rawBuyer.slice(1)) : 'Pelanggan';
      const orderAmt = Number(order?.amount || loggedItem?.amount) || 0;

      // Tagihan order ini yang masih terbuka. getOpenPulsaDebts hanya
      // mengembalikan yang sisanya > 0, jadi `!openOrderDebt` berarti LUNAS.
      // Jangan pakai "sudah ada pembayaran > 0" sebagai penanda lunas:
      // cicilan sebagian juga menghasilkan pembayaran, tapi sisanya tetap
      // harus bisa di-ACC.
      const openOrderDebt = getOpenPulsaDebts(buyerName)
        .find(d => String(d.orderId) === String(orderId)) || null;
      const fullyRepaid = !!loggedItem && (!!loggedItem.isSettled || !openOrderDebt);

      if (order?.status === 'completed' || fullyRepaid) {
        if (order && order.status !== 'completed') {
          const fixed = await this.setOrderStatus(
            orderId,
            'completed',
            'Pelunasan sudah tercatat sebelumnya.'
          );
          if (fixed) {
            showToast('✅ Status pesanan dirapikan. Uang TIDAK dicatat dua kali.', 'gold');
            return;
          }
        }
        showToast('💡 Pembayaran pesanan ini sudah di-ACC sebelumnya. Uang tidak dicatat dua kali.', 'gold');
        return;
      }

      // Tidak ada catatan tagihan untuk order ini (mis. data transaksi belum
      // termuat di perangkat). Jangan mencatat uang tanpa dasar tagihan.
      if (!openOrderDebt) {
        showToast('⚠️ Catatan transaksi pesanan ini belum termuat. Muat ulang halaman (refresh) lalu coba lagi.', 'danger');
        return;
      }

      const isCash = String(order?.payment_method || '').toLowerCase() === 'cash' || String(order?.payment_method || '').toLowerCase() === 'tunai';
      const walletName = isCash ? 'Tunai (Dompet)' : 'DANA';
      const targetWallet = isCash ? 'Dompet' : 'DANA';

      // Hanya tagih SISA-nya. Kalau buyer sudah mencicil sebagian lewat tab
      // Piutang, jangan menagih/mencatat nominal penuh lagi.
      const settleAmount = Math.max(0, Math.round(Number(openOrderDebt.remaining) || orderAmt));
      // Modal pokok yang kembali juga PROPORSIONAL terhadap sisa tagihan.
      // Kalau order sudah dicicil sebagian, jangan mengklaim seluruh modal
      // pokok kembali pada pelunasan terakhir (laba jadi terlihat 0).
      const totalOrderDebt = Number(openOrderDebt.total) || orderAmt || 1;
      const totalOrderModal = Number(openOrderDebt.item?.pulsaModal) ||
        Math.max(0, totalOrderDebt - (Number(order?.admin_fee) || 0));
      const modalPart = Math.min(
        settleAmount,
        Math.round(totalOrderModal * Math.min(1, settleAmount / totalOrderDebt))
      );
      const profitPart = Math.max(0, settleAmount - modalPart);

      const ok = await uiConfirm({
        title: '💰 ACC UANG MASUK (PELUNASAN)',
        message:
          `Konfirmasi bahwa uang ${walletName} sebesar ${formatRupiah(settleAmount)} dari ${buyerName} SUDAH BENAR-BENAR MASUK?\n\n` +
          `• Piutang atas nama ${buyerName} berkurang ${formatRupiah(settleAmount)} (sisa ${formatRupiah(Math.max(0, (Number(openOrderDebt.total) || settleAmount) - (Number(openOrderDebt.paid) || 0) - settleAmount))}).\n` +
          `• Modal pokok ${formatRupiah(modalPart)} kembali ke Modal Kios, laba ${formatRupiah(profitPart)} masuk kas ${walletName}.\n` +
          `• Total aset TIDAK berubah (hanya pindah dari piutang ke kas + modal).\n` +
          `• Status pesanan menjadi SELESAI (BERES).`,
        okText: '✅ YA, UANG SUDAH MASUK',
        cancelText: 'BATAL'
      });
      if (!ok) return;

      window.__settlingOrderIds[orderId] = true;
      try {
        // Satu pintu pelunasan: DB diselesaikan dulu, lalu ledger dicatat
        // SEKALI saja. Kalau sudah pernah tercatat, fungsi ini menolak.
        const done = await this.executeDebtRepayment(
          buyerName,
          settleAmount,
          targetWallet,
          orderId,
          modalPart,
          profitPart
        );
        if (!done) return;

        await this.refreshOwnerOrders();
        showToast(`🎉 Pembayaran ${walletName} dari ${buyerName} (${formatRupiah(settleAmount)}) berhasil di-ACC! Piutang lunas, uang masuk kas.`, 'success');
      } finally {
        delete window.__settlingOrderIds[orderId];
      }
    },

    setOrderStatus: async function (orderId, status, note, adminFee) {
      if (!window.KeuanganDB) return false;
      try {
        await window.KeuanganDB.setOrderStatus(orderId, status, note, adminFee);
        AudioEngine.play(status === 'cancelled' ? 'click' : 'coin');
        showToast(
          status === 'confirmed'
            ? '✅ Pesanan diterima. Buyer bisa melihat keteranganmu.'
            : status === 'cancelled'
              ? 'Pesanan ditolak. Alasan sudah dikirim ke buyer.'
              : `Status pesanan diubah menjadi ${status.toUpperCase()}.`,
          status === 'cancelled' ? 'gold' : 'success'
        );
        await window.App.refreshOwnerOrders();

        if (window.KeuanganDB?.publishModalNow) {
          try {
            await window.KeuanganDB.publishModalNow(getModalPoolForSupabase());
          } catch (e) {}
        }
        return true;
      } catch (error) {
        showToast('Gagal mengubah status: ' + (error?.message || 'Coba lagi.'), 'danger');
        return false;
      }
    },

    addProductPrompt: function () {
      this.openProductModal();
    },

    openProductModal: function (id) {
      const modal = document.getElementById('mc-product-modal');
      if (!modal) return;

      const editIdEl = document.getElementById('prod-edit-id');
      const titleEl = document.getElementById('prod-modal-title');
      const nameEl = document.getElementById('prod-name');
      const modalEl = document.getElementById('prod-modal');
      const adminEl = document.getElementById('prod-admin');
      const descEl = document.getElementById('prod-desc');
      const activeEl = document.getElementById('prod-active');
      const sortEl = document.getElementById('prod-sort');
      const categoryEl = document.getElementById('prod-category');
      const origEl = document.getElementById('prod-orig-price');

      if (id && state.ownerCatalog) {
        const prod = state.ownerCatalog.find(p => String(p.id) === String(id));
        if (prod) {
          if (titleEl) titleEl.textContent = `📦 EDIT PRODUK: ${prod.name}`;
          if (editIdEl) editIdEl.value = prod.id;
          if (nameEl) nameEl.value = prod.name;
          if (modalEl) modalEl.value = prod.modal_needed != null ? prod.modal_needed : Math.max(0, prod.price - (prod.admin_fee || 0));
          if (adminEl) adminEl.value = prod.admin_fee || 0;
          if (origEl) origEl.value = (prod.original_price && prod.original_price > prod.price) ? prod.original_price : '';
          if (descEl) descEl.value = prod.description || '';
          if (activeEl) activeEl.value = String(prod.active !== false);
          if (sortEl) sortEl.value = prod.sort_order || 1;
          if (categoryEl) categoryEl.value = normalizeProductCategory(prod.category);
          setupRupiahInput(modalEl);
          setupRupiahInput(adminEl);
          setupRupiahInput(origEl);
          this.calcProductModalPreview();
          modal.classList.add('active');
          return;
        }
      }

      // Mode Tambah Baru
      if (titleEl) titleEl.textContent = '📦 TAMBAH PRODUK BARU';
      if (editIdEl) editIdEl.value = '';
      if (nameEl) nameEl.value = '';
      if (modalEl) modalEl.value = '';
      if (adminEl) adminEl.value = '';
      if (origEl) origEl.value = '';
      if (descEl) descEl.value = '';
      if (activeEl) activeEl.value = 'true';
      if (sortEl) sortEl.value = (state.ownerCatalog ? state.ownerCatalog.length + 1 : 1);
      if (categoryEl) categoryEl.value = 'gopay';
      setupRupiahInput(modalEl);
      setupRupiahInput(adminEl);
      setupRupiahInput(origEl);
      this.calcProductModalPreview();
      modal.classList.add('active');
    },

    closeProductModal: function () {
      document.getElementById('mc-product-modal')?.classList.remove('active');
    },

    calcProductModalPreview: function () {
      const modalVal = parseRupiahInput(document.getElementById('prod-modal')?.value || '0') || 0;
      const adminVal = parseRupiahInput(document.getElementById('prod-admin')?.value || '0') || 0;
      const total = modalVal + adminVal;
      const previewEl = document.getElementById('prod-total-preview');
      if (previewEl) {
        previewEl.textContent = formatRupiah(total);
      }

      const origVal = parseRupiahInput(document.getElementById('prod-orig-price')?.value || '0') || 0;
      const discPreviewEl = document.getElementById('prod-discount-preview');
      if (discPreviewEl) {
        if (total > 0) {
          const finalOrig = origVal > total ? origVal : (total + (total <= 20000 ? 3000 : 4000));
          const savings = finalOrig - total;
          const pct = Math.round((savings / finalOrig) * 100);
          discPreviewEl.innerHTML = `
            🏷️ Efek di Buyer: <span style="text-decoration:line-through; color:#94a3b8;">${formatRupiah(finalOrig)}</span>
            <span class="mc-discount-badge" style="margin-left:4px;">-${pct}%</span>
            <span style="color:#4ade80; margin-left:4px; font-weight:700;">(Hemat ${formatRupiah(savings)})</span>
          `;
        } else {
          discPreviewEl.innerHTML = '';
        }
      }
    },

    saveProductModal: async function () {
      if (!window.KeuanganDB || !window.KeuanganDB.isOwnerContext()) {
        showToast('Hanya owner yang bisa menyimpan produk.', 'danger');
        return;
      }

      const id = document.getElementById('prod-edit-id')?.value || '';
      const name = String(document.getElementById('prod-name')?.value || '').trim();
      const modalVal = parseRupiahInput(document.getElementById('prod-modal')?.value || '0') || 0;
      const adminVal = parseRupiahInput(document.getElementById('prod-admin')?.value || '0') || 0;
      const origPriceVal = parseRupiahInput(document.getElementById('prod-orig-price')?.value || '0') || null;
      const price = modalVal + adminVal;
      const desc = String(document.getElementById('prod-desc')?.value || '').trim();
      const active = document.getElementById('prod-active')?.value !== 'false';
      const sortOrder = parseInt(document.getElementById('prod-sort')?.value || '1', 10);
      const category = normalizeProductCategory(document.getElementById('prod-category')?.value);

      if (!name) {
        showToast('Nama produk wajib diisi!', 'danger');
        return;
      }
      if (price <= 0) {
        showToast('Total harga (Modal + Admin) harus lebih dari Rp 0!', 'danger');
        return;
      }

      try {
        if (id) {
          await window.KeuanganDB.updateProduct(id, {
            name,
            price,
            admin_fee: adminVal,
            original_price: origPriceVal,
            description: desc,
            active,
            sort_order: sortOrder,
            category
          });
          showToast(`✅ Produk "${name}" berhasil diperbarui!`, 'success');
        } else {
          await window.KeuanganDB.addProduct({
            name,
            price,
            admin_fee: adminVal,
            original_price: origPriceVal,
            description: desc,
            active,
            sort_order: sortOrder,
            category
          });
          showToast(`✅ Produk baru "${name}" ditambahkan (${formatRupiah(price)})!`, 'success');
        }

        AudioEngine.play('trade');
        Fx.burst(null, null, 'trade');
        this.closeProductModal();
        await this.refreshProductsTab();
      } catch (err) {
        const rawMsg = String(err?.message || '');
        if (/row-level security|permission denied|jwt|not authenticated|invalid claim/i.test(rawMsg)) {
          showToast(
            '🔒 Sesi owner tidak valid atau sudah kedaluwarsa. Tutup tab MyDana lain, lalu logout dan login ulang.',
            'danger'
          );
        } else {
          showToast('Gagal menyimpan produk: ' + (rawMsg || 'Coba lagi.'), 'danger');
        }
      }
    },

    refreshProductsTab: async function () {
      const tbody = document.getElementById('owner-products-body');
      const previewEl = document.getElementById('kios-tab-products-preview');
      if (tbody && (!state.ownerCatalog || !state.ownerCatalog.length)) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#94a3b8; padding:20px;">Memuat katalog produk...</td></tr>`;
      }
      if (previewEl && (!state.ownerCatalog || !state.ownerCatalog.length)) {
        previewEl.innerHTML = `<span style="font-size:0.75rem; color:#94a3b8;">Memuat katalog produk...</span>`;
      }

      if (!window.KeuanganDB) return;
      try {
        let products = [];
        if (typeof window.KeuanganDB.listAllProductsForOwner === 'function') {
          try {
            products = await window.KeuanganDB.listAllProductsForOwner();
          } catch (e) {
            console.warn('Fallback ke listProducts:', e);
            products = await window.KeuanganDB.listProducts();
          }
        } else if (typeof window.KeuanganDB.listProducts === 'function') {
          products = await window.KeuanganDB.listProducts();
        }
        state.ownerCatalog = products || [];
        renderOwnerProducts(state.ownerCatalog);
      } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444; padding:20px;">Gagal memuat produk: ${esc(err?.message || '')}</td></tr>`;
        if (previewEl) previewEl.innerHTML = `<span style="font-size:0.75rem; color:#ef4444;">Gagal memuat: ${esc(err?.message || '')}</span>`;
      }
    },

    toggleProductActive: async function (id, currentActive) {
      if (!window.KeuanganDB) return;
      try {
        await window.KeuanganDB.updateProduct(id, { active: !currentActive });
        showToast(!currentActive ? '🟢 Produk sekarang ditampilkan ke buyer.' : '👁️‍🗨️ Produk disembunyikan dari buyer.', 'gold');
        await this.refreshProductsTab();
      } catch (err) {
        showToast('Gagal mengubah visibilitas: ' + err.message, 'danger');
      }
    },

    deleteProduct: async function (id) {
      if (!window.KeuanganDB) return;
      const ok = await uiConfirm({
        title: '🗑️ HAPUS PRODUK',
        message: 'Yakin ingin menghapus produk ini dari katalog? Buyer tidak akan bisa memesannya lagi.',
        okText: 'HAPUS PRODUK',
        danger: true
      });
      if (!ok) return;
      try {
        await window.KeuanganDB.deleteProduct(id);
        AudioEngine.play('hurt');
        showToast('🗑️ Produk berhasil dihapus.', 'gold');
        await this.refreshProductsTab();
      } catch (err) {
        showToast('Gagal menghapus produk: ' + err.message, 'danger');
      }
    },

    moveProductSort: async function (id, direction) {
      if (!state.ownerCatalog || !state.ownerCatalog.length) return;
      const idx = state.ownerCatalog.findIndex(p => String(p.id) === String(id));
      if (idx === -1) return;
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= state.ownerCatalog.length) return;

      const currentProd = state.ownerCatalog[idx];
      const targetProd = state.ownerCatalog[targetIdx];

      let newCurrentOrder = targetProd.sort_order ?? (targetIdx + 1);
      let newTargetOrder = currentProd.sort_order ?? (idx + 1);

      if (newCurrentOrder === newTargetOrder) {
        newCurrentOrder = targetIdx + 1;
        newTargetOrder = idx + 1;
      }

      try {
        await window.KeuanganDB.updateProduct(currentProd.id, {
          sort_order: newCurrentOrder,
          admin_fee: currentProd.admin_fee || 0,
          description: currentProd.description || ''
        });
        await window.KeuanganDB.updateProduct(targetProd.id, {
          sort_order: newTargetOrder,
          admin_fee: targetProd.admin_fee || 0,
          description: targetProd.description || ''
        });
        await this.refreshProductsTab();
      } catch (err) {
        showToast('Gagal mengubah urutan: ' + err.message, 'danger');
      }
    },

    switchTab: function (tabId) {
      if (!tabId) tabId = 'dashboard';
      if (state.settings?.sfx) AudioEngine.play('click');
      state.activeTab = tabId;
      try {
        localStorage.setItem('keuanganku_active_tab', tabId);
      } catch (e) {}

      // Update button active classes
      const tabBtns = document.querySelectorAll('.mc-nav-btn');
      tabBtns.forEach(btn => {
        const matches = btn.getAttribute('data-tab') === tabId || btn.id === `nav-btn-${tabId}`;
        btn.classList.toggle('active', matches);
      });

      // Update view active classes
      const tabViews = document.querySelectorAll('.mc-tab-view');
      tabViews.forEach(view => {
        const matches = view.id === `tab-${tabId}`;
        view.classList.toggle('active', matches);
      });

      // Re-render chart if switching to recap
      if (tabId === 'recap') {
        renderRecap();
        const { balances, totalAset, uangPanas } = calculateBalances();
        renderGraphics(balances, totalAset, uangPanas);
      }

      // Re-render produk jika switching ke tab products
      if (tabId === 'products') {
        this.refreshProductsTab();
      }

      // Segarkan daftar pesanan + ringkasan modal setiap membuka Kios, supaya
      // angka "tersedia" tidak basi setelah aksi di tab lain (tambah modal,
      // pelunasan, dll).
      if (tabId === 'kios') {
        this.refreshOwnerOrders?.();
      }
    },

    tambahUangDinginPrompt: function () {
      this.kurangiModalPrompt();
    },

    openChangePasswordModal: function () {
      AudioEngine.play('click');
      const modal = document.getElementById('mc-owner-pw-modal');
      if (!modal) return;
      if (document.getElementById('owner-old-pw')) document.getElementById('owner-old-pw').value = '';
      if (document.getElementById('owner-new-pw')) document.getElementById('owner-new-pw').value = '';
      if (document.getElementById('owner-confirm-pw')) document.getElementById('owner-confirm-pw').value = '';
      modal.classList.add('active');
      setTimeout(() => document.getElementById('owner-new-pw')?.focus(), 100);
    },

    closeChangePasswordModal: function () {
      const modal = document.getElementById('mc-owner-pw-modal');
      if (modal) modal.classList.remove('active');
    },

    toggleFloatingPhotos: function () {
      state.settings.floatingPhotos = !state.settings.floatingPhotos;
      saveData();
      this.updateFloatingPhotos();
      AudioEngine.play('click');
      showToast(
        state.settings.floatingPhotos
          ? '🖼️ Foto Melayang Diaktifkan! Klik foto untuk perbesar.'
          : '🖼️ Foto Melayang Dinonaktifkan.',
        'gold'
      );
    },

    toggleKiosStatus: function () {
      return toggleKiosStatus();
    },

    refreshKiosStatus: function () {
      return refreshKiosStatus();
    },

    updateFloatingPhotos: function () {
      const btn = document.getElementById('floating-photos-btn');
      if (btn) {
        btn.textContent = state.settings.floatingPhotos ? '🖼️ FOTO: ON' : '🖼️ FOTO: OFF';
        btn.classList.toggle('active', !!state.settings.floatingPhotos);
      }

      const container = document.getElementById('mc-floating-photos-container');
      if (!container) return;

      if (!state.settings.floatingPhotos) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
      }

      container.style.display = 'block';
      if (container.children.length > 0) return; // Sudah terpasang

      const photoPool = [
        'assets/photos/0.jpg',
        'assets/photos/1.jpg',
        'assets/photos/2.jpg',
        'assets/photos/3.jpg',
        'assets/photos/4.jpg',
        'assets/photos/5.jpg',
        'assets/photos/6.jpg',
        'assets/photos/7.png',
        'assets/photos/8.jpg',
        'assets/photos/9.png',
        'assets/photos/10.jpg'
      ];

      // Pool cursor untuk rotasi foto yang masuk berikutnya
      let nextPoolCursor = 3;

      // HANYA 3 FOTO AKTIF MELAYANG DI LAYAR
      // Slot 0: Melayang dari Kiri ke Kanan (jalur atas)
      // Slot 1: Melayang dari Kanan ke Kiri (jalur tengah)
      // Slot 2: Melayang dari Kiri ke Kanan (jalur bawah)
      const slots = [
        { anim: 'mcDriftLeftToRight', duration: 25, delay: 0, topMin: 12, topMax: 26, photoIdx: 0 },
        { anim: 'mcDriftRightToLeft', duration: 29, delay: -9, topMin: 34, topMax: 48, photoIdx: 1 },
        { anim: 'mcDriftLeftToRight', duration: 27, delay: -18, topMin: 56, topMax: 70, photoIdx: 2 }
      ];

      slots.forEach((slot, slotIdx) => {
        const item = document.createElement('div');
        item.className = 'mc-floating-photo-item';
        item.dataset.slot = String(slotIdx);
        item.dataset.currentSrc = photoPool[slot.photoIdx];

        const initialTop = slot.topMin + Math.random() * (slot.topMax - slot.topMin);
        item.style.top = `${initialTop}%`;
        item.style.animation = `${slot.anim} ${slot.duration}s linear infinite`;
        item.style.animationDelay = `${slot.delay}s`;

        item.innerHTML = `
          <div class="mc-floating-photo-card">
            <div class="mc-floating-photo-pin"></div>
            <img class="mc-floating-photo-img" src="${photoPool[slot.photoIdx]}" alt="Foto Kenangan" loading="lazy" decoding="async" onerror="this.src='icon-192.png'">
            <div class="mc-floating-photo-caption">#${slot.photoIdx + 1}</div>
          </div>
        `;

        // Event: Ketika foto selesai melintasi frame dan keluar layar, ganti dengan foto berikutnya!
        item.addEventListener('animationiteration', () => {
          const nextSrc = photoPool[nextPoolCursor % photoPool.length];
          const nextNum = (nextPoolCursor % photoPool.length) + 1;
          nextPoolCursor++;

          const img = item.querySelector('.mc-floating-photo-img');
          const cap = item.querySelector('.mc-floating-photo-caption');
          if (img) img.src = nextSrc;
          if (cap) cap.textContent = `#${nextNum}`;
          item.dataset.currentSrc = nextSrc;

          // Variasi acak posisi tinggi (top) baru dalam lane-nya
          const newTop = slot.topMin + Math.random() * (slot.topMax - slot.topMin);
          item.style.top = `${newTop}%`;
        });

        // Klik foto untuk melihat ukuran penuh
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const src = item.dataset.currentSrc || photoPool[slot.photoIdx];
          window.App.previewFloatingPhoto(src);
        });

        container.appendChild(item);
      });
    },

    previewFloatingPhoto: function (src) {
      const modal = document.getElementById('mc-floating-photo-preview-modal');
      const img = document.getElementById('mc-floating-photo-preview-img');
      if (!modal || !img) return;
      img.src = src;
      modal.classList.add('active');
      AudioEngine.play('click');
    },

    uiConfirm: uiConfirm,
    uiPrompt: uiPrompt,

    parseFinanceSentence: parseFinanceSentence,
    calculateBalances: calculateBalances,
    getState: () => state
  };

  // ===================================================================
  // BOOT OWNER APP (HANYA SETELAH LOGIN SUPABASE SEBAGAI OWNER)
  // ===================================================================
  let ownerAppBooted = false;

  async function bootOwnerApp(profile) {
    if (ownerAppBooted) return;
    ownerAppBooted = true;

    state.auth = {
      isLoggedIn: true,
      user: profile?.username || 'owner'
    };

    Fx.init();
    await loadData();

    // loadData() menimpa state.auth dari cache lokal; tegaskan lagi bahwa
    // sesi owner berasal dari Supabase (bukan flag lokal).
    state.auth = {
      isLoggedIn: true,
      user: profile?.username || 'owner'
    };

    render();

    // Status buka/tutup kios (banner + menu) dan sinkron realtime.
    refreshKiosStatus();
    if (window.KeuanganDB && typeof window.KeuanganDB.subscribePublicStatus === 'function') {
      try {
        window.KeuanganDB.subscribePublicStatus(() => { refreshKiosStatus(); });
      } catch (e) {}
    }

    const savedTab = localStorage.getItem('keuanganku_active_tab') || 'dashboard';
    if (window.App && window.App.switchTab) {
      window.App.switchTab(savedTab);
    }

    const savedTheme = localStorage.getItem('keuanganku_sky_theme') || state.settings?.theme || 'night';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const themeBtn = document.getElementById('theme-btn');
    if (themeBtn) themeBtn.textContent = savedTheme === 'day' ? '🌙 MALAM' : '🌞 SIANG';

    const sfxBtn = document.getElementById('sfx-btn');
    if (sfxBtn) sfxBtn.textContent = state.settings?.sfx ? '🔊 SFX: ON' : '🔇 SFX: OFF';

    // BGM Otomatis Nyala (Terraria Pixelated Chiptune)
    autoStartBgm();

    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          window.App.submitChat();
        }
      });
      setTimeout(() => chatInput.focus(), 150);
    }

    // Pesanan buyer & Katalog produk (Supabase)
    window.App.refreshOwnerOrders?.();
    window.App.refreshProductsTab?.();

    if (window.KeuanganDB?.subscribeOrders) {
      try {
        window.KeuanganDB.subscribeOrders((payload) => {
          window.App.refreshOwnerOrders?.();
          if (payload?.eventType === 'INSERT' || payload?.new?.status === 'pending') {
            AudioEngine.play('coin');
            showToast(`🔔 Pesanan baru masuk (${payload?.new?.product_name || 'Pulsa'})! Buka Tab 2 untuk ACC.`, 'gold');
          } else if (payload?.eventType === 'UPDATE' && payload?.new?.payment_proof && !payload?.old?.payment_proof) {
            AudioEngine.play('trade');
            showToast(`📸 Bukti transfer baru diterima dari ${payload?.new?.buyer_username || 'Pelanggan'}! Silakan tinjau bukti TF.`, 'gold');
          }
        });
      } catch (e) {
        console.warn('Realtime orders tidak aktif:', e);
      }
    }

    // Floating photos UI update
    window.App?.updateFloatingPhotos?.();

    // Wire Form Ganti Password Owner
    const ownerPwForm = document.getElementById('owner-change-pw-form');
    if (ownerPwForm && !ownerPwForm.dataset.wired) {
      ownerPwForm.dataset.wired = 'true';
      ownerPwForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const oldPw = String(document.getElementById('owner-old-pw')?.value || '').trim();
        const newPw = String(document.getElementById('owner-new-pw')?.value || '').trim();
        const confirmPw = String(document.getElementById('owner-confirm-pw')?.value || '').trim();
        const submitBtn = document.getElementById('owner-submit-pw-btn');

        if (!newPw) {
          showToast('Password baru wajib diisi.', 'danger');
          return;
        }
        if (newPw.length < 6) {
          showToast('Password baru minimal 6 karakter.', 'danger');
          return;
        }
        if (newPw !== confirmPw) {
          showToast('Konfirmasi password baru tidak cocok.', 'danger');
          return;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'MENYIMPAN...';
        }

        try {
          await window.KeuanganAuth.updatePassword(newPw, oldPw || null);
          AudioEngine.play('coin');
          showToast('✅ Password Owner berhasil diubah! Gunakan password baru saat login.', 'success');
          window.App.closeChangePasswordModal();
          if (document.getElementById('owner-old-pw')) document.getElementById('owner-old-pw').value = '';
          if (document.getElementById('owner-new-pw')) document.getElementById('owner-new-pw').value = '';
          if (document.getElementById('owner-confirm-pw')) document.getElementById('owner-confirm-pw').value = '';
        } catch (err) {
          showToast('Gagal mengubah password: ' + (err?.message || 'Coba lagi.'), 'danger');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '🔑 SIMPAN PASSWORD';
          }
        }
      });
    }

    window.addEventListener('keuanganku:sync-error', () => {
      showToast('⚠️ Sinkronisasi Supabase gagal. Data tetap tersimpan lokal.', 'gold');
    });
  }

  window.__bootOwnerApp = bootOwnerApp;
  window.AudioEngine = AudioEngine;
  if (window.App) {
    window.App.autoStartBgm = autoStartBgm;
    window.App.playSfx = function(name) { AudioEngine.play(name); };
    window.App.isSfxActive = function() { return state.settings?.sfx !== false; };
    window.App.updateAudioUi = function() {
      ['bgm-btn', 'buyer-bgm-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
          btn.innerHTML = `<span class="bgm-icon">🎵</span> BGM: ${AudioEngine.bgmIsPlaying ? 'ON' : 'OFF'}`;
          btn.classList.toggle('active', !!AudioEngine.bgmIsPlaying);
        }
      });
      ['sfx-btn', 'buyer-sfx-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
          btn.textContent = state.settings?.sfx !== false ? '🔊 SFX: ON' : '🔇 SFX: OFF';
        }
      });
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Menu garis tiga di header (owner & buyer).
    wireHeaderMenus();

    // Input nominal owner: tampilkan pemisah ribuan otomatis (5000 -> 5.000).
    ['input-base-modal', 'modal-pay-amount', 'prod-modal', 'prod-admin'].forEach((id) => {
      setupRupiahInput(document.getElementById(id));
    });

    // Siapkan trigger gesture BGM seawal mungkin
    autoStartBgm();

    if (window.__AUTH_ROLE__ === 'owner' && window.KeuanganAuth?.profile) {
      bootOwnerApp(window.KeuanganAuth.profile);
    }
  });

  window.addEventListener('auth:ready', (event) => {
    autoStartBgm();
    if (event.detail?.role === 'owner') {
      bootOwnerApp(event.detail.profile);
    }
  });

})();

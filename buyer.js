/**
 * BUYER APP - KEUANGANKU STORE
 * ------------------------------------------------------------------
 * UI pelanggan: lihat saldo modal kios (bukan total saldo owner),
 * lihat produk, kirim pesanan, dan pantau status pesanan sendiri.
 */
(function () {
  'use strict';

  let profile = null;
  let started = false;
  let toastTimer = null;
  let currentModal = 0;
  let cachedOrders = [];
  let selectedOrderProduct = null;

  const PAYMENT_LABELS = {
    dana: '📱 DANA',
    cash: '💵 Cash / Tunai'
  };

  const DAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  function populateTimingSelect(selectEl) {
    if (!selectEl) return;
    const now = new Date();
    let html = '';

    for (let i = 0; i <= 4; i++) {
      const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const dayName = DAYS_ID[d.getDay()];
      const dayNum = d.getDate();
      const monthName = MONTHS_ID[d.getMonth()];
      const dateLabel = `${dayName}, ${dayNum} ${monthName}`;

      if (i === 0) {
        html += `<option value="now" data-days="0" data-label="${dateLabel}">⚡ Hari Ini (Bayar Sekarang - ${dateLabel})</option>`;
      } else if (i === 1) {
        html += `<option value="${iso}" data-days="1" data-label="${dateLabel}">⏳ Besok (+1 Hari - ${dateLabel})</option>`;
      } else if (i === 2) {
        html += `<option value="${iso}" data-days="2" data-label="${dateLabel}">⏳ Lusa (+2 Hari - ${dateLabel})</option>`;
      } else if (i === 3) {
        html += `<option value="${iso}" data-days="3" data-label="${dateLabel}">⏳ 3 Hari Lagi (+3 Hari - ${dateLabel})</option>`;
      } else if (i === 4) {
        html += `<option value="${iso}" data-days="4" data-label="${dateLabel}">🚨 4 Hari Lagi (+4 Hari / Batas Akhir - ${dateLabel})</option>`;
      }
    }

    selectEl.innerHTML = html;
  }

  function initNotificationPermission() {
    if (!('Notification' in window)) return;
    const bar = el('buyer-notif-permission-bar');
    if (!bar) return;

    if (Notification.permission === 'default') {
      bar.style.display = 'flex';
      el('btn-enable-notif')?.addEventListener('click', async () => {
        try {
          const perm = await Notification.requestPermission();
          if (perm === 'granted') {
            toast('🔔 Notifikasi browser berhasil diaktifkan!', 'success');
            bar.style.display = 'none';
            sendBrowserNotification('MyDana', 'Notifikasi aktif! Kamu akan diingatkan saat pesanan di-ACC dan saat mendekati jatuh tempo.');
          } else {
            bar.style.display = 'none';
          }
        } catch (e) {
          bar.style.display = 'none';
        }
      });
      el('btn-dismiss-notif')?.addEventListener('click', () => {
        bar.style.display = 'none';
      });
    } else {
      bar.style.display = 'none';
    }
  }

  function sendBrowserNotification(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body: body,
          icon: 'assets/icon.png'
        });
      } catch (e) {}
    }
  }

  function el(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatRupiah(value) {
    return 'Rp ' + Math.round(Number(value) || 0).toLocaleString('id-ID');
  }

  function formatDate(value) {
    if (!value) return '-';
    try {
      return new Date(value).toLocaleString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).replace('.', ':');
    } catch (e) {
      return '-';
    }
  }

  function formatDay(value) {
    if (!value) return '-';
    try {
      return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    } catch (e) {
      return String(value);
    }
  }

  function paymentLabel(order) {
    const method = PAYMENT_LABELS[order.payment_method] || order.payment_method || 'Cash / Tunai';
    if (order.pay_timing === 'later') {
      return method + ' • bayar ' + formatDay(order.due_date);
    }
    return method + ' • bayar sekarang';
  }

  function toast(message, type = 'success') {
    let box = el('buyer-toast-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'buyer-toast-box';
      box.className = 'buyer-toast-box';
      document.body.appendChild(box);
    }

    box.innerHTML = '';
    const item = document.createElement('div');
    item.className = `buyer-toast ${type}`;
    item.textContent = message;
    box.appendChild(item);

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.innerHTML = '';
    }, 3800);
  }

  function statusBadge(status) {
    const map = {
      pending: { label: '⏳ MENUNGGU', className: 'badge-debt' },
      confirmed: { label: '✅ DIPROSES', className: 'badge-pulsa' },
      completed: { label: '🏁 SELESAI', className: 'badge-in' },
      cancelled: { label: '✕ DIBATALKAN', className: 'badge-out' }
    };
    const info = map[status] || { label: esc(status), className: 'badge-category' };
    return `<span class="${info.className}">${info.label}</span>`;
  }

  // ---------------------------------------------------------------- data
  async function refreshStatus() {
    const balanceEl = el('buyer-modal-balance');
    const updatedEl = el('buyer-modal-updated');
    if (!balanceEl) return;

    try {
      const status = await window.KeuanganDB.getPublicStatus();
      currentModal = Number(
        status?.available != null ? status.available : status?.modal_amount
      ) || 0;
      balanceEl.textContent = formatRupiah(currentModal);
      const formModal = el('buyer-form-modal');
      if (formModal) formModal.textContent = formatRupiah(currentModal);
      const reserved = Number(status?.reserved) || 0;
      const total = Number(status?.modal_amount) || 0;
      const hintEl = el('buyer-modal-hint');
      if (hintEl) {
        hintEl.textContent = reserved > 0
          ? `Modal ${formatRupiah(total)} • tertahan pesanan aktif ${formatRupiah(reserved)}`
          : `Modal kios ${formatRupiah(total)}`;
      }
      if (updatedEl) {
        updatedEl.textContent = status?.updated_at
          ? `Diperbarui ${formatDate(status.updated_at)}`
          : 'Belum ada data saldo modal.';
      }
    } catch (error) {
      balanceEl.textContent = 'Gagal memuat';
      if (updatedEl) updatedEl.textContent = error?.message || 'Periksa koneksi internet.';
    }
  }

  let catalogProducts = [];
  let catalogTab = 'all';

  // Tab katalog buyer: SEMUA, SALDO DANA, dan SALDO GOPAY. Kolom `category`
  // adalah sumber utama; data lama tanpa kategori ditebak dari nama produk.
  // Kategori `pulsa` lama tetap dikenali supaya produk lama tidak hilang dari
  // tab SEMUA, tapi tab PULSA sudah tidak ditampilkan lagi.
  function productCategory(product) {
    const raw = String(product?.category || '').toLowerCase().trim();
    if (['dana', 'saldo', 'saldo-dana'].includes(raw)) return 'dana';
    if (['gopay', 'go-pay', 'go pay', 'saldo-gopay', 'ewallet', 'e-wallet'].includes(raw)) return 'gopay';
    if (['pulsa', 'kuota', 'token', 'data'].includes(raw)) return 'pulsa';

    const name = String(product?.name || '').toLowerCase();
    const looksGopay = /(gopay|go-?pay)/.test(name);
    const looksDana = /(dana|saldo)/.test(name);
    const looksPulsa = /(pulsa|kuota|token|paket data|\bdata\b|pln|listrik|voucher|diamond|game)/.test(name);
    if (looksGopay) return 'gopay';
    if (looksDana && !looksPulsa) return 'dana';
    return looksPulsa ? 'pulsa' : 'gopay';
  }

  const CATALOG_TAB_LABEL = { all: 'SEMUA', dana: 'SALDO DANA', gopay: 'SALDO GOPAY' };

  function renderCatalog() {
    const container = el('buyer-products');
    if (!container) return;

    const filtered = catalogTab === 'all'
      ? catalogProducts
      : catalogProducts.filter((product) => productCategory(product) === catalogTab);

    if (!filtered.length) {
      const label = CATALOG_TAB_LABEL[catalogTab] || 'SEMUA';
      container.innerHTML = `
        <div class="buyer-empty">
          ${catalogProducts.length === 0
            ? 'Belum ada produk di katalog. Kamu tetap bisa mengirim pesanan custom di form sebelah.'
            : `Belum ada produk ${label.toLowerCase()} di katalog saat ini. Coba tab lain ya.`}
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map((product) => {
      const admin = (product.admin_fee !== undefined && product.admin_fee !== null)
        ? Math.max(0, Number(product.admin_fee) || 0)
        : (window.KeuanganDB?.extractAdminFee ? window.KeuanganDB.extractAdminFee(product) : 0);
      const modalNeeded = Math.max(0, product.price - admin);
      const cat = productCategory(product);
      const catLabel = cat === 'dana'
        ? '💳 SALDO DANA'
        : (cat === 'gopay' ? '💚 SALDO GOPAY' : '📶 PULSA');
      return `
      <div class="buyer-product-card" data-product-cat="${cat}">
        <div class="buyer-product-info">
          <strong>${esc(product.name)}</strong>
          <span class="buyer-product-cat buyer-product-cat-${cat}">${catLabel}</span>
          ${product.description ? `<span>${esc(product.description)}</span>` : ''}
          ${admin > 0 ? `
            <div style="display:flex; gap:6px; align-items:center; margin-top:3px; flex-wrap:wrap;">
              <span class="badge-modal-cost" style="font-size:0.68rem; background:rgba(251,146,60,0.15); color:#fb923c; padding:1px 6px; border-radius:3px; font-weight:700;">
                🔥 Modal: ${formatRupiah(modalNeeded)}
              </span>
              <span class="badge-admin-fee" style="font-size:0.68rem; background:rgba(71,226,104,0.15); color:var(--mc-emerald); padding:1px 6px; border-radius:3px; font-weight:700;">
                💎 Admin: ${formatRupiah(admin)}
              </span>
            </div>
          ` : ''}
        </div>
        <div class="buyer-product-action">
          <span class="buyer-product-price${Number(product.price) >= 100000 ? ' is-long' : ''}">${formatRupiah(product.price)}</span>
          <button class="mc-btn mc-btn-green buyer-btn-order" data-order-product="${esc(product.id)}" title="Beli ${esc(product.name)}">
            🛒 PESAN
          </button>
        </div>
      </div>
    `;
    }).join('');

    container.querySelectorAll('[data-order-product]').forEach((button) => {
      button.addEventListener('click', () => {
        const product = catalogProducts.find((item) => item.id === button.dataset.orderProduct);
        if (product) openOrderModal(product);
      });
    });
  }

  function wireCatalogTabs() {
    const tabs = el('buyer-catalog-tabs');
    if (!tabs) return;
    tabs.querySelectorAll('[data-catalog-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        catalogTab = btn.dataset.catalogTab || 'all';
        tabs.querySelectorAll('[data-catalog-tab]').forEach((other) => {
          const active = other === btn;
          other.classList.toggle('active', active);
          other.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        renderCatalog();
      });
    });
  }

  function renderProducts(products) {
    catalogProducts = Array.isArray(products) ? products : [];
    renderCatalog();
  }

  async function refreshProducts() {
    const container = el('buyer-products');
    if (!container) return;

    container.textContent = 'Memuat produk...';
    try {
      const products = await window.KeuanganDB.listProducts();
      renderProducts(products);
    } catch (error) {
      container.innerHTML = `<div class="buyer-empty buyer-error">Gagal memuat produk: ${esc(error?.message || '')}</div>`;
    }
  }

  function getTempoMotif(order) {
    if (order.pay_timing !== 'later' || !order.due_date || order.status === 'cancelled') return null;
    if (order.status === 'completed') {
      return {
        type: 'lunas',
        badge: '✅ LUNAS TEPAT WAKTU',
        color: 'var(--mc-emerald)',
        text: 'Terima kasih banyak sudah melunasi tagihanmu dengan amanah! Kios siap melayanimu lagi.'
      };
    }

    const targetDate = new Date(order.due_date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffTime = targetDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const amt = Number(order.amount) || 0;

    if (diffDays > 1) {
      const daily = Math.ceil(amt / diffDays);
      return {
        type: 'upcoming',
        diffDays,
        badge: `⏳ ${diffDays} HARI LAGI JATUH TEMPO`,
        color: '#38bdf8',
        text: `Batas bayar: <strong>${formatDay(order.due_date)}</strong>.<br>💡 <strong>Motivasi Nabung:</strong> Coba sisihkan sekitar <strong style="color:var(--mc-gold);">${formatRupiah(daily)} / hari</strong> mulai hari ini, biar saat jatuh tempo bayarnya terasa enteng & tanpa beban! Semangat! 💪🌱`
      };
    } else if (diffDays === 1) {
      return {
        type: 'tomorrow',
        diffDays,
        badge: '⏰ BESOK JATUH TEMPO!',
        color: '#f59e0b',
        text: `Besok batas akhir tempo pembayaran (<strong>${formatDay(order.due_date)}</strong>). Siapkan uang <strong>${formatRupiah(amt)}</strong> ya. Terima kasih banyak sudah selalu amanah menjaga kepercayaan kios kami! 🙏🌟`
      };
    } else if (diffDays === 0) {
      return {
        type: 'today',
        diffDays,
        badge: '🚨 HARI INI JATUH TEMPO!',
        color: 'var(--mc-gold)',
        text: `Hari ini adalah tanggal jatuh tempo tagihan <strong>${formatRupiah(amt)}</strong>. Yuk segera selesaikan pembayaran ke Owner kios hari ini ya! 🤝`
      };
    } else {
      const overdueDays = Math.abs(diffDays);
      return {
        type: 'overdue',
        diffDays,
        badge: `⚠️ LEWAT TEMPO (${overdueDays} HARI LALU)`,
        color: 'var(--mc-redstone)',
        text: `Tagihan <strong>${formatRupiah(amt)}</strong> sudah melewati batas jatuh tempo (${formatDay(order.due_date)}). Mohon segera hubungi Owner kios untuk melunasi pembayaranmu ya, agar transaksi berikutnya tetap lancar! 🙏`
      };
    }
  }

  function renderTempoMotivationBox(orders) {
    const box = el('buyer-tempo-motivation-box');
    if (!box) return;

    const activeTempo = (orders || []).filter(o => o.pay_timing === 'later' && o.status !== 'cancelled' && o.status !== 'completed');
    if (!activeTempo.length) {
      box.style.display = 'none';
      return;
    }

    let totalTempo = 0;
    let minDays = Infinity;
    let nearestDate = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    activeTempo.forEach(o => {
      totalTempo += (Number(o.amount) || 0);
      if (o.due_date) {
        const d = new Date(o.due_date + 'T00:00:00');
        const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (diff < minDays) {
          minDays = diff;
          nearestDate = o.due_date;
        }
      }
    });

    const safeDays = Math.max(1, minDays);
    const suggestedDaily = Math.ceil(totalTempo / safeDays);

    let badgeTitle = '';
    let statusLine = '';
    let motifQuote = '';

    if (minDays > 1) {
      badgeTitle = `⏳ PENGINGAT TEMPO: ${minDays} HARI LAGI (${formatDay(nearestDate)})`;
      statusLine = `Total Tagihan Tempo Aktif: <strong style="color:var(--mc-gold);">${formatRupiah(totalTempo)}</strong> (${activeTempo.length} pesanan)`;
      motifQuote = `🌱 <strong>Rekomendasi Tabungan Harian:</strong> Cukup sisihkan <strong>${formatRupiah(suggestedDaily)} / hari</strong> mulai hari ini.<br>Menyisihkan uang sedikit demi sedikit membuat kamu tidak kaget saat jatuh tempo dan menjaga reputasimu selalu amanah! Semangat! 💪`;
    } else if (minDays === 1) {
      badgeTitle = `⏰ PERINGATAN: BESOK JATUH TEMPO (${formatDay(nearestDate)})`;
      statusLine = `Total Tagihan Tempo: <strong style="color:var(--mc-gold);">${formatRupiah(totalTempo)}</strong>`;
      motifQuote = `🌟 Besok adalah batas waktu pembayaran tempo. Siapkan uangmu hari ini ya, terima kasih sudah menjadi pelanggan yang amanah! 🙏`;
    } else if (minDays === 0) {
      badgeTitle = `🚨 PERINGATAN: HARI INI JATUH TEMPO!`;
      statusLine = `Total Tagihan Tempo: <strong style="color:var(--mc-gold);">${formatRupiah(totalTempo)}</strong>`;
      motifQuote = `🤝 Hari ini batas akhir tempo. Jangan lupa hubungi owner dan selesaikan pembayaranmu hari ini ya.`;
    } else {
      badgeTitle = `⚠️ PERINGATAN: TELAH MELEWATI JATUH TEMPO!`;
      statusLine = `Total Tagihan Tertunggak: <strong style="color:var(--mc-redstone);">${formatRupiah(totalTempo)}</strong>`;
      motifQuote = `Mohon segera selesaikan pembayaranmu ke Owner kios agar riwayat transaksi tetap bersih dan modal kios tetap sehat. Terima kasih! 🙏`;
    }

    box.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px;">
        <span class="buyer-card-label" style="color:var(--mc-gold); font-size:9px;">
          ${badgeTitle}
        </span>
        <span style="font-size:0.7rem; color:#38bdf8; font-weight:700;">🤝 Komitmen Amanah</span>
      </div>
      <div style="font-size:0.85rem; color:#f1f5f9; margin-bottom:6px;">
        ${statusLine}
      </div>
      <div style="background:rgba(0,0,0,0.3); border-left:3px solid var(--mc-gold); padding:8px 10px; font-size:0.78rem; line-height:1.5; color:#cbd5e1; border-radius:3px;">
        ${motifQuote}
      </div>
    `;
    box.style.display = 'block';
  }

  function renderOrders(orders) {
    const container = el('buyer-orders');
    if (!container) return;

    if (!orders.length) {
      container.innerHTML = '<div class="buyer-empty">Belum ada pesanan. Silakan pilih produk atau kirim pesanan custom.</div>';
      return;
    }

    container.innerHTML = orders.map((order) => {
      const isConfirmed = order.status === 'confirmed' || order.status === 'completed';
      const borderStyle = isConfirmed ? 'border-left: 4px solid var(--mc-emerald); background: rgba(16, 185, 129, 0.08);' : '';
      const motif = getTempoMotif(order);
      const motifHtml = motif ? `
        <div class="buyer-order-motif" style="background: rgba(15, 23, 42, 0.7); border-left: 3px solid ${motif.color}; padding: 7px 9px; margin-top: 8px; border-radius: 3px; font-size: 0.74rem; line-height: 1.45;">
          <div style="color: ${motif.color}; font-weight: 800; font-size: 0.72rem; margin-bottom: 3px;">
            ${motif.badge}
          </div>
          <div style="color: #cbd5e1;">${motif.text}</div>
        </div>
      ` : '';

      return `
      <div class="buyer-order-item" style="${borderStyle}">
        <div class="buyer-order-top">
          <strong>${esc(order.product_name)}</strong>
          ${statusBadge(order.status)}
        </div>
        <div class="buyer-order-meta">
          <span>${formatRupiah(order.amount)}</span>
          <span>${esc(paymentLabel(order))}</span>
        </div>
        <div class="buyer-order-meta">
          <span>Dipesan ${formatDate(order.created_at)}</span>
        </div>
        ${order.notes ? `<div class="buyer-order-notes">📝 ${esc(order.notes)}</div>` : ''}
        ${order.owner_note ? `<div class="buyer-order-owner-note" style="${isConfirmed ? 'color:#47e268;font-weight:700;' : ''}">💬 Pesan owner: ${esc(order.owner_note)}</div>` : ''}
        ${motifHtml}
      </div>
    `;
    }).join('');
  }

  function playBuyerChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      // Retro 8-bit celebratory chime (C5 -> E5 -> G5 -> C6)
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.09);
        gain.gain.setValueAtTime(0.18, now + idx * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.09);
        osc.stop(now + idx * 0.09 + 0.28);
      });
    } catch (e) {}
  }

  function checkNewOrderNotifications(orders) {
    if (!profile || !orders || !orders.length) return;
    const storageKey = 'keuanganku_seen_orders_' + profile.id;
    let seen = {};
    try {
      seen = JSON.parse(localStorage.getItem(storageKey) || '{}');
    } catch (e) {
      seen = {};
    }

    const unacknowledged = [];
    orders.forEach(order => {
      if (order.status === 'confirmed' || order.status === 'completed' || order.status === 'cancelled') {
        const key = order.id + ':' + order.status + ':' + (order.responded_at || order.updated_at || '');
        if (!seen[key]) {
          unacknowledged.push({ order, key });
        }
      }
    });

    if (!unacknowledged.length) return;

    const modalEl = el('buyer-order-alert-modal');
    const contentEl = el('buyer-order-alert-content');
    const closeBtn = el('buyer-order-alert-close');
    if (!modalEl || !contentEl) return;

    let itemsHtml = '';
    unacknowledged.forEach(({ order }) => {
      const isConfirmed = order.status === 'confirmed' || order.status === 'completed';
      const badgeColor = isConfirmed ? 'var(--mc-emerald)' : 'var(--mc-redstone)';
      const statusTitle = isConfirmed ? '✅ SUDAH MASUK (DITERIMA OWNER)' : '✕ PESANAN DITOLAK';
      const noteLabel = isConfirmed ? '💬 Pesan Owner:' : '⚠️ Alasan Penolakan:';

      itemsHtml += `
        <div style="background: rgba(15, 23, 42, 0.75); border: 2px solid ${badgeColor}; padding: 12px; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <strong style="color: #f8fafc; font-size: 0.96rem;">${esc(order.product_name)}</strong>
            <span style="color: ${badgeColor}; font-weight: 800; font-size: 0.76rem;">${statusTitle}</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--mc-gold); margin-bottom: 6px;">
            Nominal: <strong>${formatRupiah(order.amount)}</strong> • Pembayaran: ${esc(paymentLabel(order))}
          </div>
          ${order.owner_note ? `
            <div style="background: rgba(0,0,0,0.4); padding: 8px 10px; border-left: 3px solid ${badgeColor}; font-size: 0.85rem; color: #f1f5f9; margin-top: 6px; line-height: 1.4;">
              <strong style="color: ${badgeColor};">${noteLabel}</strong> "${esc(order.owner_note)}"
            </div>
          ` : ''}
          <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 6px; text-align: right;">
            Waktu ACC: ${formatDate(order.responded_at || order.updated_at)}
          </div>
        </div>
      `;
    });

    contentEl.innerHTML = itemsHtml;
    modalEl.classList.add('active');
    playBuyerChime();

    // Kirim notifikasi browser jika diizinkan
    unacknowledged.forEach(({ order }) => {
      const isConfirmed = order.status === 'confirmed' || order.status === 'completed';
      if (isConfirmed) {
        sendBrowserNotification(
          '🎉 Pesanan Pulsa Telah Diproses!',
          `${order.product_name} (${formatRupiah(order.amount)}) sudah di-ACC Owner: "${order.owner_note || 'Pulsa sudah masuk'}"`
        );
      } else if (order.status === 'cancelled') {
        sendBrowserNotification(
          '✕ Pesanan Ditolak',
          `Pesanan ${order.product_name} ditolak. Alasan: "${order.owner_note || '-'}"`
        );
      }
    });

    if (closeBtn) {
      closeBtn.onclick = () => {
        unacknowledged.forEach(({ key }) => {
          seen[key] = true;
        });
        try {
          localStorage.setItem(storageKey, JSON.stringify(seen));
        } catch (e) {}
        modalEl.classList.remove('active');
      };
    }
  }

  async function refreshOrders() {
    const container = el('buyer-orders');
    if (!container) return;

    container.textContent = 'Memuat pesanan...';
    try {
      const orders = await window.KeuanganDB.listMyOrders();
      cachedOrders = orders || [];
      renderOrders(orders);
      renderTempoMotivationBox(orders);
      checkNewOrderNotifications(orders);
    } catch (error) {
      container.innerHTML = `<div class="buyer-empty buyer-error">Gagal memuat pesanan: ${esc(error?.message || '')}</div>`;
    }
  }

  function setBusy(btn, busy, text = 'MEMPROSES...') {
    if (!btn) return;
    btn.disabled = busy;
    if (busy) {
      btn.dataset.origText = btn.textContent;
      btn.textContent = text;
    } else {
      btn.textContent = btn.dataset.origText || btn.textContent;
    }
  }

  // ===================================================================
  // POPUP PESAN PRODUK (BUYER) - OPSI KIRI
  // ===================================================================
  function openOrderModal(product) {
    if (!product) return;
    selectedOrderProduct = product;
    const modal = el('buyer-order-modal');
    if (!modal) return;

    const admin = (product.admin_fee !== undefined && product.admin_fee !== null)
      ? Math.max(0, Number(product.admin_fee) || 0)
      : (window.KeuanganDB?.extractAdminFee ? window.KeuanganDB.extractAdminFee(product) : 0);
    const modalNeeded = Math.max(0, product.price - admin);

    const nameEl = el('buyer-popup-prod-name');
    if (nameEl) nameEl.textContent = product.name;
    const descEl = el('buyer-popup-prod-desc');
    if (descEl) descEl.textContent = product.description || '';
    const priceEl = el('buyer-popup-prod-price');
    if (priceEl) {
      priceEl.textContent = formatRupiah(product.price);
      priceEl.classList.toggle('is-long', Number(product.price) >= 100000);
    }
    const modalEl = el('buyer-popup-prod-modal');
    if (modalEl) modalEl.textContent = formatRupiah(modalNeeded);
    const adminEl = el('buyer-popup-prod-admin');
    if (adminEl) adminEl.textContent = formatRupiah(admin);

    const statusEl = el('buyer-popup-modal-status');
    if (statusEl) {
      if (modalNeeded <= currentModal) {
        statusEl.innerHTML = '<span style="background:rgba(16,185,129,0.2); color:#34d399; border:1px solid #059669; padding:2px 8px; border-radius:4px; font-weight:bold;">✅ Modal Kios CUKUP</span>';
      } else {
        statusEl.innerHTML = `<span style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid #dc2626; padding:2px 8px; border-radius:4px; font-weight:bold;">⚠️ Modal Kios KURANG (${formatRupiah(currentModal)})</span>`;
      }
    }

    // Auto-fill nomor HP dari profile / localStorage
    const savedPhone = localStorage.getItem('keuanganku_buyer_phone_' + (profile?.id || '')) || '';
    const phoneInput = el('buyer-popup-phone');
    if (phoneInput) {
      phoneInput.value = savedPhone;
    }

    // Reset pilihan pembayaran & tempo (maksimal 4 hari)
    const paySelect = el('buyer-popup-payment');
    if (paySelect) paySelect.value = 'dana';
    const cashNote = el('buyer-popup-cash-note');
    if (cashNote) cashNote.style.display = 'none';

    const timingSelect = el('buyer-popup-timing');
    if (timingSelect) {
      populateTimingSelect(timingSelect);
      timingSelect.value = 'now';
    }
    const tipEl = el('buyer-popup-due-tip');
    if (tipEl) tipEl.style.display = 'none';

    const notesInput = el('buyer-popup-notes');
    if (notesInput) notesInput.value = '';

    modal.classList.add('active');
  }

  function closeOrderModal() {
    selectedOrderProduct = null;
    el('buyer-order-modal')?.classList.remove('active');
  }

  function wireOrderModal() {
    const modal = el('buyer-order-modal');
    if (!modal || modal.dataset.wired) return;
    modal.dataset.wired = 'true';

    el('buyer-popup-close-x')?.addEventListener('click', closeOrderModal);
    el('buyer-popup-cancel')?.addEventListener('click', closeOrderModal);

    const paySelect = el('buyer-popup-payment');
    const cashNote = el('buyer-popup-cash-note');
    paySelect?.addEventListener('change', () => {
      if (cashNote) {
        cashNote.style.display = paySelect.value === 'cash' ? 'block' : 'none';
      }
    });

    const timingSelect = el('buyer-popup-timing');
    const tipEl = el('buyer-popup-due-tip');

    function updatePopupDueTip() {
      if (!tipEl || !timingSelect) return;
      const val = timingSelect.value;
      if (val === 'now') {
        tipEl.style.display = 'none';
        return;
      }
      const opt = timingSelect.selectedOptions?.[0];
      const days = parseInt(opt?.dataset?.days || '1', 10);
      const label = opt?.dataset?.label || val;
      const price = selectedOrderProduct?.price || 0;
      const daily = Math.ceil(price / Math.max(1, days));

      tipEl.innerHTML = `💡 <strong>Motivasi Nabung:</strong> Batas bayar dalam <strong>${days} hari</strong> (${label}).<br>Cukup sisihkan sekitar <strong style="color:var(--mc-gold);">${formatRupiah(daily)} / hari</strong> mulai hari ini biar saat bayar terasa enteng! Semangat! 💪🌱`;
      tipEl.style.display = 'block';
    }

    timingSelect?.addEventListener('change', updatePopupDueTip);

    const form = el('buyer-popup-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!selectedOrderProduct) return;

      const product = selectedOrderProduct;
      const phone = String(el('buyer-popup-phone')?.value || '').trim();
      const paymentMethod = el('buyer-popup-payment')?.value || 'dana';
      const timingVal = el('buyer-popup-timing')?.value || 'now';
      const payTiming = timingVal === 'now' ? 'now' : 'later';
      const dueDate = timingVal === 'now' ? null : timingVal;
      const notes = String(el('buyer-popup-notes')?.value || '').trim();
      const submitBtn = el('buyer-popup-submit');

      if (!phone) {
        toast('Nomor HP / Akun tujuan wajib diisi.', 'danger');
        return;
      }

      const admin = (product.admin_fee !== undefined && product.admin_fee !== null)
        ? Math.max(0, Number(product.admin_fee) || 0)
        : (window.KeuanganDB?.extractAdminFee ? window.KeuanganDB.extractAdminFee(product) : 0);
      const modalNeeded = Math.max(0, product.price - admin);

      // Validasi ketersediaan modal kios HANYA memotong modal pokok (di luar jatah admin)
      if (modalNeeded > currentModal) {
        toast(
          `❌ Saldo modal kios tidak cukup (${formatRupiah(currentModal)}).\n` +
          `Modal pokok yang dibutuhkan untuk ${product.name} adalah ${formatRupiah(modalNeeded)} (admin ${formatRupiah(admin)}). ` +
          `Tunggu owner menambah modal ya.`,
          'danger'
        );
        return;
      }

      // Simpan nomor HP ke localStorage agar selalu auto-fill di masa depan
      if (profile?.id) {
        try {
          localStorage.setItem('keuanganku_buyer_phone_' + profile.id, phone);
        } catch (err) {}
      }

      let orderNotes = `No HP: ${phone}`;
      if (notes) orderNotes += ` | ${notes}`;

      setBusy(submitBtn, true, 'MENGIRIM...');
      try {
        await window.KeuanganDB.createOrder({
          product_id: product.id,
          product_name: product.name,
          amount: product.price,
          admin_fee: admin,
          payment_method: paymentMethod,
          pay_timing: payTiming,
          due_date: payTiming === 'later' ? dueDate : null,
          notes: orderNotes
        });

        playBuyerChime();
        closeOrderModal();
        toast('✅ Pesanan dikirim! Menunggu konfirmasi ACC owner.');
        await refreshAll();
      } catch (err) {
        toast('Gagal mengirim pesanan: ' + (err?.message || 'Coba lagi.'), 'danger');
      } finally {
        setBusy(submitBtn, false);
      }
    });
  }

  // ===================================================================
  // POPUP PENGATURAN PROFIL & AKUN BUYER
  // ===================================================================
  function openProfileModal() {
    const modal = el('buyer-profile-modal');
    if (!modal) return;

    const userEl = el('buyer-profile-modal-username');
    if (userEl) userEl.textContent = profile?.username || '-';

    // Sinkronkan avatar
    const imgEl = el('buyer-avatar-img');
    const modalImg = el('buyer-profile-modal-avatar-img');
    const modalPlaceholder = el('buyer-profile-modal-avatar-placeholder');
    if (imgEl && imgEl.style.display !== 'none' && imgEl.src) {
      if (modalImg) {
        modalImg.src = imgEl.src;
        modalImg.style.display = 'block';
      }
      if (modalPlaceholder) modalPlaceholder.style.display = 'none';
    } else {
      if (modalImg) modalImg.style.display = 'none';
      if (modalPlaceholder) modalPlaceholder.style.display = 'block';
    }

    // Isi nomor HP dari localStorage
    const phoneInput = el('buyer-profile-phone-input');
    if (phoneInput) {
      phoneInput.value = localStorage.getItem('keuanganku_buyer_phone_' + (profile?.id || '')) || '';
    }

    // Hitung statistik belanja & status tempo
    const totalOrders = cachedOrders.length;
    const completedOrders = cachedOrders.filter(o => o.status === 'confirmed' || o.status === 'completed').length;
    let activeTempo = 0;
    cachedOrders.filter(o => o.pay_timing === 'later' && o.status !== 'cancelled' && o.status !== 'completed').forEach(o => {
      activeTempo += (Number(o.amount) || 0);
    });

    if (el('buyer-stat-total-orders')) el('buyer-stat-total-orders').textContent = String(totalOrders);
    if (el('buyer-stat-completed-orders')) el('buyer-stat-completed-orders').textContent = String(completedOrders);
    if (el('buyer-stat-active-tempo')) el('buyer-stat-active-tempo').textContent = formatRupiah(activeTempo);

    modal.classList.add('active');
  }

  function closeProfileModal() {
    el('buyer-profile-modal')?.classList.remove('active');
  }

  function wireProfileModal() {
    const btn = el('buyer-profile-badge-btn');
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = 'true';
      btn.addEventListener('click', openProfileModal);
    }

    el('buyer-profile-modal-close-x')?.addEventListener('click', closeProfileModal);
    el('buyer-profile-cancel-btn')?.addEventListener('click', closeProfileModal);

    el('buyer-profile-change-avatar-btn')?.addEventListener('click', () => {
      el('buyer-avatar-file-input')?.click();
    });

    el('buyer-profile-remove-avatar-btn')?.addEventListener('click', async () => {
      const ok = await (window.App?.uiConfirm
        ? window.App.uiConfirm({
            title: '🖼️ HAPUS FOTO PROFIL',
            message: 'Hapus foto profil kamu?',
            okText: 'HAPUS FOTO',
            danger: true
          })
        : Promise.resolve(confirm('Hapus foto profil kamu?')));
      if (!ok) return;
      try {
        const imgEl = el('buyer-avatar-img');
        const placeholder = el('buyer-avatar-placeholder');
        const modalImg = el('buyer-profile-modal-avatar-img');
        const modalPlaceholder = el('buyer-profile-modal-avatar-placeholder');

        if (imgEl) { imgEl.src = ''; imgEl.style.display = 'none'; }
        if (placeholder) placeholder.style.display = 'block';
        if (modalImg) { modalImg.src = ''; modalImg.style.display = 'none'; }
        if (modalPlaceholder) modalPlaceholder.style.display = 'block';

        if (window.KeuanganDB?.updateBuyerAvatar) {
          await window.KeuanganDB.updateBuyerAvatar(null);
        }
        toast('✅ Foto profil dihapus.', 'gold');
      } catch (e) {
        toast('Gagal menghapus foto: ' + e.message, 'danger');
      }
    });

    el('buyer-profile-logout-btn')?.addEventListener('click', async () => {
      const ok = await (window.App?.uiConfirm
        ? window.App.uiConfirm({
            title: '🚪 KELUAR AKUN',
            message: 'Keluar dari akun pembeli?',
            okText: 'KELUAR',
            cancelText: 'TETAP DI SINI',
            danger: true
          })
        : Promise.resolve(confirm('Keluar dari akun pembeli?')));
      if (ok) {
        window.KeuanganAuth?.logout();
      }
    });

    el('buyer-profile-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const phone = String(el('buyer-profile-phone-input')?.value || '').trim();
      if (profile?.id) {
        try {
          localStorage.setItem('keuanganku_buyer_phone_' + profile.id, phone);
        } catch (err) {}
      }
      toast('✅ Pengaturan profil & nomor HP berhasil disimpan!', 'success');
      closeProfileModal();
    });
  }

  function parseAmount(value) {
    return Math.max(0, Math.round(Number(value) || 0));
  }

  function wireForm() {
    const form = el('buyer-order-form');
    if (!form) return;

    const timingSelect = el('buyer-order-timing');
    populateTimingSelect(timingSelect);

    function updateDueTip() {
      const tipEl = el('buyer-due-motivational-tip');
      if (!tipEl || !timingSelect) return;
      const val = timingSelect.value;
      if (val === 'now') {
        tipEl.style.display = 'none';
        return;
      }
      const opt = timingSelect.selectedOptions?.[0];
      const days = parseInt(opt?.dataset?.days || '1', 10);
      const label = opt?.dataset?.label || val;
      const amt = parseAmount(el('buyer-order-amount')?.value) || 0;

      if (amt > 0) {
        const daily = Math.ceil(amt / Math.max(1, days));
        tipEl.innerHTML = `💡 <strong>Motivasi Nabung:</strong> Batas bayar dalam <strong>${days} hari</strong> (${label}).<br>Cukup sisihkan sekitar <strong style="color:var(--mc-gold);">${formatRupiah(daily)} / hari</strong> mulai hari ini biar saat bayar terasa enteng! Semangat! 💪🌱`;
      } else {
        tipEl.innerHTML = `💡 <strong>Rekomendasi Tempo:</strong> Batas bayar dalam <strong>${days} hari</strong> (${label}). Masukkan nominal pesanan untuk melihat rekomendasi tabungan harianmu.`;
      }
      tipEl.style.display = 'block';
    }

    timingSelect?.addEventListener('change', updateDueTip);
    el('buyer-order-amount')?.addEventListener('input', updateDueTip);
    updateDueTip();

    const formPaySelect = el('buyer-order-payment');
    const formCashNote = el('buyer-order-cash-note');
    formPaySelect?.addEventListener('change', () => {
      if (formCashNote) {
        formCashNote.style.display = formPaySelect.value === 'cash' ? 'block' : 'none';
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const name = String(el('buyer-order-name')?.value || '').trim();
      const amount = parseAmount(el('buyer-order-amount')?.value);
      const notes = String(el('buyer-order-notes')?.value || '').trim();
      const paymentMethod = el('buyer-order-payment')?.value || 'dana';
      const timingVal = el('buyer-order-timing')?.value || 'now';
      const payTiming = timingVal === 'now' ? 'now' : 'later';
      const dueDate = timingVal === 'now' ? null : timingVal;
      const submitBtn = form.querySelector('button[type="submit"]');

      if (!name) {
        toast('Nama produk / nominal pulsa wajib diisi.', 'danger');
        return;
      }
      if (amount <= 0) {
        toast('Nominal pesanan harus lebih dari Rp 0.', 'danger');
        return;
      }

      // Pesanan custom TIDAK boleh menentukan admin dari teks yang diketik
      // buyer (rawan dipakai untuk memotong modal). Admin ditentukan owner
      // saat ACC, jadi modal pokok yang dicek = nominal penuh.
      const customAdmin = 0;
      const modalNeeded = Math.max(0, amount - customAdmin);

      if (modalNeeded > currentModal) {
        toast(
          `Saldo modal kios tidak cukup. Tersedia ${formatRupiah(currentModal)}, modal pokok pesanan ${formatRupiah(modalNeeded)}.`,
          'danger'
        );
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'MENGIRIM...';

      try {
        await window.KeuanganDB.createOrder({
          product_name: name,
          amount,
          admin_fee: customAdmin,
          notes,
          payment_method: paymentMethod,
          pay_timing: payTiming,
          due_date: dueDate || null
        });

        playBuyerChime();
        form.reset();
        if (timingSelect) timingSelect.value = 'now';
        updateDueTip();
        toast('✅ Pesanan dikirim. Tunggu konfirmasi owner.');
        await refreshAll();
      } catch (error) {
        toast('Gagal mengirim pesanan: ' + (error?.message || 'Coba lagi.'), 'danger');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'KIRIM PESANAN';
      }
    });
  }

  async function refreshAll() {
    await Promise.allSettled([
      refreshStatus(),
      refreshProducts(),
      refreshOrders()
    ]);
  }

  // ---------------------------------------------------------------- Foto Profil Buyer
  function initAvatarUI() {
    const fileInput = el('buyer-avatar-file-input');
    const imgEl = el('buyer-avatar-img');
    const placeholder = el('buyer-avatar-placeholder');

    const saved = profile?.avatar_url || (window.KeuanganDB?.getBuyerAvatar ? window.KeuanganDB.getBuyerAvatar(profile?.id || profile?.username) : null);
    if (saved && imgEl) {
      imgEl.src = saved;
      imgEl.style.display = 'block';
      if (placeholder) placeholder.style.display = 'none';
    }

    if (fileInput && !fileInput.dataset.wired) {
      fileInput.dataset.wired = 'true';
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
          toast('Pilih file gambar (JPG, PNG, WebP).', 'danger');
          return;
        }

        try {
          toast('⏳ Mengompres & mengupload foto profil...', 'gold');
          const resizedDataUrl = await resizeImageToAvatar(file, 128);
          if (imgEl) {
            imgEl.src = resizedDataUrl;
            imgEl.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
          }
          if (window.KeuanganDB?.updateBuyerAvatar) {
            await window.KeuanganDB.updateBuyerAvatar(resizedDataUrl);
          }
          toast('✅ Foto profil berhasil diubah!', 'success');
        } catch (err) {
          toast('Gagal mengupload foto profil: ' + (err?.message || 'Coba lagi.'), 'danger');
        } finally {
          fileInput.value = '';
        }
      });
    }
  }

  function resizeImageToAvatar(file, size = 128) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');

          const minSide = Math.min(img.width, img.height);
          const sx = (img.width - minSide) / 2;
          const sy = (img.height - minSide) / 2;

          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => reject(new Error('Gagal memproses gambar'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Gagal membaca file gambar'));
      reader.readAsDataURL(file);
    });
  }

  function openAvatarUpload() {
    const input = el('buyer-avatar-file-input');
    if (input) input.click();
  }

  function start(userProfile) {
    profile = userProfile;

    const usernameEl = el('buyer-username');
    if (usernameEl) usernameEl.textContent = profile.username;

    initNotificationPermission();
    initAvatarUI();
    window.App?.updateAudioUi?.();

    if (!started) {
      started = true;
      wireForm();
      wireOrderModal();
      wireProfileModal();
      wireCatalogTabs();

      el('buyer-refresh')?.addEventListener('click', async () => {
        toast('Memuat ulang data...', 'gold');
        await refreshAll();
      });

      window.KeuanganDB.subscribePublicStatus(() => {
        refreshStatus();
      });

      window.KeuanganDB.subscribeOrders(() => {
        refreshStatus();
        refreshOrders();
      });
    }

    refreshAll();
  }

  window.BuyerApp = {
    start,
    refreshAll,
    openAvatarUpload,
    openOrderModal,
    openProfileModal
  };
})();

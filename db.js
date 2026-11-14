/**
 * DATA LAYER SUPABASE - KEUANGANKU
 * ------------------------------------------------------------------
 * Owner  : baca/tulis transactions, quests, app_settings.
 *          publish saldo modal ke public_status.
 * Buyer  : baca public_status + products, buat/lihat orders miliknya.
 *
 * Semua akses tetap dijaga RLS di Supabase.
 */
(function () {
  'use strict';

  const client = window.KeuanganAuth?.client || null;

  function ownerId() {
    return window.KeuanganAuth?.profile?.id || null;
  }

  function isOwnerContext() {
    return window.__AUTH_ROLE__ === 'owner' && !!ownerId();
  }

  function emitSyncError(error) {
    console.warn('Supabase sync error:', error);
    window.dispatchEvent(new CustomEvent('keuanganku:sync-error', {
      detail: { message: error?.message || String(error) }
    }));
  }

  function chunk(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }

  function toItemRow(item, uid) {
    return {
      id: String(item.id),
      owner_id: uid,
      date: item.date || new Date().toISOString(),
      type: item.type || 'in',
      amount: Number(item.amount) || 0,
      description: item.desc || '',
      location: item.location || 'Dompet',
      debtor_name: item.debtorName || null,
      is_pulsa: Boolean(item.isPulsa),
      is_debt: Boolean(item.isDebt),
      pulsa_customer: item.pulsaCustomer || null,
      pulsa_total: item.pulsaTotal ?? null,
      pulsa_modal: item.pulsaModal ?? null,
      pulsa_profit: item.pulsaProfit ?? null,
      source_wallet: item.sourceWallet || null,
      is_cold_money: Boolean(item.isColdMoney),
      is_tambah_modal: Boolean(item.isTambahModal),
      is_kurangi_modal: Boolean(item.isKurangiModal),
      is_setor_modal: Boolean(item.isSetorModal),
      payload: item
    };
  }

  function fromItemRow(row) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    return Object.assign({}, payload, {
      id: row.id,
      date: row.date,
      type: row.type,
      amount: Number(row.amount) || 0,
      desc: row.description || payload.desc || '',
      location: row.location || payload.location || 'Dompet',
      debtorName: row.debtor_name || payload.debtorName || null,
      isPulsa: row.is_pulsa || payload.isPulsa || false,
      isDebt: row.is_debt || payload.isDebt || false,
      pulsaCustomer: row.pulsa_customer || payload.pulsaCustomer || null,
      pulsaTotal: row.pulsa_total ?? payload.pulsaTotal ?? null,
      pulsaModal: row.pulsa_modal ?? payload.pulsaModal ?? null,
      pulsaProfit: row.pulsa_profit ?? payload.pulsaProfit ?? null,
      sourceWallet: row.source_wallet || payload.sourceWallet || null,
      isColdMoney: row.is_cold_money || payload.isColdMoney || false,
      isTambahModal: row.is_tambah_modal || payload.isTambahModal || false,
      isTambahModalRiil: Boolean(payload.isTambahModalRiil),
      isKurangiModal: row.is_kurangi_modal || payload.isKurangiModal || false,
      isSetorModal: row.is_setor_modal || payload.isSetorModal || false
    });
  }

  function toQuestRow(quest, uid) {
    return {
      id: String(quest.id),
      owner_id: uid,
      name: quest.name || 'Target',
      target_amount: Number(quest.targetAmount) || 0,
      payload: quest,
      created_at: quest.createdAt || new Date().toISOString()
    };
  }

  function fromQuestRow(row) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    return Object.assign({}, payload, {
      id: row.id,
      name: row.name || payload.name || 'Target',
      targetAmount: Number(row.target_amount) || 0,
      createdAt: row.created_at || payload.createdAt || null
    });
  }

  async function fetchAllIds(table) {
    const ids = [];
    const pageSize = 1000;

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client
        .from(table)
        .select('id')
        .range(from, from + pageSize - 1);

      if (error) throw error;
      ids.push(...(data || []).map((row) => row.id));
      if (!data || data.length < pageSize) break;
    }

    return ids;
  }

  // Upsert snapshot. Penghapusan TIDAK dilakukan otomatis: snapshot kosong /
  // belum termuat tidak boleh menghapus data remote. Hapus per-ID lewat
  // deleteTransaction/deleteQuest, atau paksa prune saat reset data.
  async function replaceRows(table, rows, options) {
    const opts = options || {};

    for (const group of chunk(rows, 200)) {
      if (group.length === 0) continue;
      const { error } = await client.from(table).upsert(group, { onConflict: 'id' });
      if (error) throw error;
    }

    if (!opts.prune) return;

    const incomingIds = new Set(rows.map((row) => String(row.id)));
    const existingIds = await fetchAllIds(table);
    const toDelete = existingIds.filter((id) => !incomingIds.has(String(id)));

    for (const group of chunk(toDelete, 100)) {
      if (group.length === 0) continue;
      const { error } = await client.from(table).delete().in('id', group);
      if (error) throw error;
    }
  }

  async function deleteRow(table, id) {
    if (!isOwnerContext()) return false;
    if (id == null || id === '') return false;
    const { error } = await client.from(table).delete().eq('id', String(id));
    if (error) throw error;
    return true;
  }

  async function deleteTransaction(id) {
    return deleteRow('transactions', id);
  }

  async function deleteQuest(id) {
    return deleteRow('quests', id);
  }

  // Dipakai hanya oleh reset data yang memang disengaja.
  async function clearOwnerRows() {
    if (!isOwnerContext()) return false;
    const uid = ownerId();
    const { error: txError } = await client.from('transactions').delete().eq('owner_id', uid);
    if (txError) throw txError;
    const { error: questError } = await client.from('quests').delete().eq('owner_id', uid);
    if (questError) throw questError;
    return true;
  }

  let saveTimer = null;
  let pendingSnapshot = null;

  async function saveAllNow(snapshot) {
    if (!isOwnerContext()) return;
    const uid = ownerId();

    const itemRows = (snapshot.items || []).map((item) => toItemRow(item, uid));
    const questRows = (snapshot.quests || []).map((quest) => toQuestRow(quest, uid));

    await replaceRows('transactions', itemRows);
    await replaceRows('quests', questRows);

    const { error: settingsError } = await client
      .from('app_settings')
      .upsert({
        owner_id: uid,
        pulsa_config: snapshot.pulsaConfig || { baseModal: 0, manualModalOffset: 0 },
        settings: snapshot.settings || {},
        updated_at: new Date().toISOString()
      }, { onConflict: 'owner_id' });

    if (settingsError) throw settingsError;

    if (snapshot.modalAmount != null) {
      await publishModalNow(snapshot.modalAmount, uid);
    }
  }

  function saveAllDebounced(snapshot) {
    pendingSnapshot = snapshot;
    if (saveTimer) clearTimeout(saveTimer);

    saveTimer = setTimeout(() => {
      const current = pendingSnapshot;
      pendingSnapshot = null;
      saveTimer = null;

      if (!current) return;
      saveAllNow(current).catch(emitSyncError);
    }, 500);
  }

  let modalTimer = null;
  let pendingModalAmount = null;

  async function publishModalNow(amount, uid = ownerId()) {
    if (!isOwnerContext()) return;

    const { error } = await client
      .from('public_status')
      .upsert({
        id: 1,
        owner_id: uid || ownerId(),
        modal_amount: Math.max(0, Number(amount) || 0),
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (error) throw error;
  }

  function publishModal(amount) {
    pendingModalAmount = amount;
    if (modalTimer) clearTimeout(modalTimer);

    modalTimer = setTimeout(() => {
      const current = pendingModalAmount;
      pendingModalAmount = null;
      modalTimer = null;

      if (current == null) return;
      publishModalNow(current).catch(emitSyncError);
    }, 800);
  }

  // ---------------------------------------------------------------- owner
  async function loadOwnerData() {
    if (!isOwnerContext()) throw new Error('Bukan sesi owner.');

    const uid = ownerId();

    const [txResult, questResult, settingsResult] = await Promise.all([
      client.from('transactions').select('*').order('date', { ascending: true }),
      client.from('quests').select('*').order('created_at', { ascending: true }),
      client.from('app_settings').select('*').eq('owner_id', uid).maybeSingle()
    ]);

    if (txResult.error) throw txResult.error;
    if (questResult.error) throw questResult.error;
    if (settingsResult.error) throw settingsResult.error;

    const settingsRow = settingsResult.data;

    return {
      items: (txResult.data || []).map(fromItemRow),
      quests: (questResult.data || []).map(fromQuestRow),
      pulsaConfig: settingsRow?.pulsa_config || null,
      settings: settingsRow?.settings || null,
      hasSettings: Boolean(settingsRow)
    };
  }

  // ---------------------------------------------------------------- public
  async function getPublicStatus() {
    // modal_status() menghitung: modal - pesanan aktif = saldo yang bisa dipakai.
    const { data, error } = await client.rpc('modal_status');

    if (!error && data) {
      return {
        modal_amount: Number(data.modal_amount) || 0,
        reserved: Number(data.reserved) || 0,
        available: Number(data.available) || 0,
        updated_at: data.updated_at || null
      };
    }

    // Fallback kalau fungsi belum terpasang di project lama.
    const { data: row, error: rowError } = await client
      .from('public_status')
      .select('modal_amount, updated_at')
      .eq('id', 1)
      .maybeSingle();

    if (rowError) throw rowError;
    const modal = Number(row?.modal_amount) || 0;
    return {
      modal_amount: modal,
      reserved: 0,
      available: modal,
      updated_at: row?.updated_at || null
    };
  }

  // --- Metadata produk (admin & urutan) -------------------------------------
  // Sumber utama = kolom database. Marker di description hanya fallback untuk
  // project lama yang belum menjalankan migrasi kolom admin_fee/sort_order.
  function parseMoneyToken(raw, unit) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return 0;
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
      s = s.replace(/[.,]/g, '');
    } else {
      s = s.replace(',', '.');
    }
    let n = parseFloat(s);
    if (!isFinite(n)) return 0;
    const u = String(unit || '').toLowerCase();
    if (u === 'k' || u === 'rb' || u === 'ribu') n *= 1000;
    else if (u === 'jt' || u === 'juta') n *= 1000000;
    return Math.round(n);
  }

  function readAdminMarker(description) {
    const text = String(description || '');
    let m = text.match(/\[admin:\s*(\d+(?:[.,]\d+)?)\]/i);
    if (m) return Math.max(0, Math.round(parseFloat(m[1].replace(',', '.'))) || 0);

    m = text.match(/(?:^|[\s(])(?:admin|fee|untung|laba)\s*[:=]?\s*(?:rp\.?\s*)?((?:\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?))\s*(k|rb|ribu|jt|juta)?\b/i);
    if (m) return Math.max(0, parseMoneyToken(m[1], m[2]));
    return null;
  }

  function readSortMarker(description) {
    const m = String(description || '').match(/\[sort:\s*(\d+)\]/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function readOriginalPriceMarker(description) {
    const m = String(description || '').match(/\[(?:orig|strike|coret):\s*(\d+)\]/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function stripProductMeta(description) {
    return String(description || '')
      .replace(/\[admin:\s*\d+(?:[.,]\d+)?\]/gi, ' ')
      .replace(/\[sort:\s*\d+\]/gi, ' ')
      .replace(/\[(?:orig|strike|coret):\s*\d+\]/gi, ' ')
      .replace(/\(\s*(?:admin|fee|untung|laba)\s*[:=]?\s*(?:rp\.?\s*)?(?:\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(?:k|rb|ribu|jt|juta)?\s*\)/gi, ' ')
      .replace(/(?:^|\s)(?:admin|fee|untung|laba)\s*[:=]?\s*(?:rp\.?\s*)?(?:\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(?:k|rb|ribu|jt|juta)?\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Tulis ulang marker admin/urutan/diskon. Marker lama SELALU diganti supaya admin
  // tidak tertinggal di nilai lama (penyebab "admin naik, modal ikut naik").
  function buildProductDescription(description, options) {
    const opts = options || {};
    const original = String(description || '');
    const adminProvided = opts.admin !== undefined && opts.admin !== null;
    const sortProvided = opts.sort !== undefined && opts.sort !== null;
    const origProvided = opts.original_price !== undefined && opts.original_price !== null;
    const existingAdmin = readAdminMarker(original);
    const existingSort = readSortMarker(original);
    const existingOrig = readOriginalPriceMarker(original);

    const admin = adminProvided
      ? Math.max(0, Math.round(Number(opts.admin) || 0))
      : existingAdmin;
    const sort = sortProvided
      ? Math.max(0, parseInt(opts.sort, 10) || 0)
      : existingSort;
    const orig = origProvided
      ? Math.max(0, parseInt(opts.original_price, 10) || 0)
      : existingOrig;

    let clean = stripProductMeta(original);
    if (admin !== null) clean = `${clean}${clean ? ' ' : ''}[admin:${admin}]`;
    if (sort !== null) clean = `${clean}${clean ? ' ' : ''}[sort:${sort}]`;
    if (orig) clean = `${clean}${clean ? ' ' : ''}[orig:${orig}]`;
    return clean.trim();
  }

  // Helper: ekstraksi jatah admin dari kolom, marker, atau teks lama.
  function extractAdminFee(item) {
    if (!item) return 0;

    // Kolom admin_fee adalah sumber utama. Nilai 0 tetap sah dan tidak boleh
    // jatuh ke tebakan nama produk.
    if (item.admin_fee !== undefined && item.admin_fee !== null && item.admin_fee !== '') {
      const explicit = Number(item.admin_fee);
      if (Number.isFinite(explicit)) return Math.max(0, explicit);
    }

    const text = `${item.description || ''} ${item.notes || ''} ${item.name || ''} ${item.product_name || ''}`;
    const marker = readAdminMarker(text);
    if (marker !== null) return marker;

    // Deteksi cerdas khusus data lama: nominal di nama produk vs harga jual.
    // Contoh: "Saldo 10k" harga 14.000 -> nominal 10.000, admin 4.000
    const price = Number(item.price || item.amount) || 0;
    if (price > 0) {
      const nameText = `${item.name || ''} ${item.product_name || ''}`;
      const nominalK = nameText.match(/\b(\d+(?:[.,]\d+)?)\s*(?:k|rb|ribu)\b/i);
      let detectedNominal = 0;
      if (nominalK) {
        detectedNominal = parseMoneyToken(nominalK[1], 'k');
      } else {
        const nominalFull = nameText.match(/\b(\d{1,3}(?:[.,]\d{3})+|\d{4,})\b/);
        if (nominalFull) {
          detectedNominal = parseInt(nominalFull[1].replace(/[.,]/g, ''), 10);
        }
      }
      if (detectedNominal > 0 && detectedNominal < price) {
        return price - detectedNominal;
      }
    }

    return 0;
  }

  function extractSortOrder(item) {
    if (!item) return 999;
    if (typeof item.sort_order === 'number' && !isNaN(item.sort_order)) {
      return item.sort_order;
    }
    const marker = readSortMarker(item.description);
    return marker !== null ? marker : 999;
  }

  function extractOriginalPrice(item) {
    if (!item) return 0;
    const price = Number(item.price || item.amount) || 0;
    if (price <= 0) return 0;

    // 1. Cek kolom original_price di tabel database
    if (item.original_price !== undefined && item.original_price !== null && item.original_price !== '') {
      const explicit = Number(item.original_price);
      if (Number.isFinite(explicit) && explicit > price) return explicit;
    }

    // 2. Cek marker [orig:xxx] di deskripsi
    const marker = readOriginalPriceMarker(item.description);
    if (marker && marker > price) return marker;

    // 3. Trik Diskon Psikologis Otomatis:
    // Naikkan harga coret ~15% - 25% (dibulatkan) agar pembeli merasa mendapat diskon besar
    // padahal harga jual asli tetap utuh.
    let markup = 3000;
    if (price < 10000) markup = 2000;
    else if (price <= 20000) markup = 3000;
    else if (price <= 35000) markup = 4000;
    else if (price <= 55000) markup = 7000;
    else if (price <= 80000) markup = 10000;
    else if (price <= 120000) markup = 15000;
    else markup = Math.round((price * 0.15) / 1000) * 1000;

    return price + markup;
  }

  function enrichProduct(p) {
    const admin = extractAdminFee(p);
    const sort = extractSortOrder(p);
    const price = Number(p.price) || 0;
    const origPrice = extractOriginalPrice(p);
    const discountSavings = Math.max(0, origPrice - price);
    const discountPercent = origPrice > price ? Math.round((discountSavings / origPrice) * 100) : 0;

    return {
      ...p,
      description: stripProductMeta(p.description),
      description_raw: p.description || '',
      admin_fee: admin,
      sort_order: sort,
      original_price: origPrice,
      discount_savings: discountSavings,
      discount_percent: discountPercent,
      modal_needed: Math.max(0, price - admin)
    };
  }

  async function listProducts() {
    let query = client
      .from('products')
      .select('*')
      .eq('active', true);

    const { data, error } = await query;
    if (error) {
      const fb = await client
        .from('products')
        .select('id, name, description, price, category, created_at')
        .eq('active', true);
      if (fb.error) throw fb.error;
      return (fb.data || []).map(enrichProduct).sort((a, b) => a.sort_order - b.sort_order || new Date(a.created_at) - new Date(b.created_at));
    }

    return (data || []).map(enrichProduct).sort((a, b) => a.sort_order - b.sort_order || new Date(a.created_at) - new Date(b.created_at));
  }

  async function listAllProductsForOwner() {
    if (!client) return [];
    let prods = null;
    let res = null;
    try {
      res = await client.from('products').select('*');
    } catch (e) {}

    if (res && !res.error && res.data && res.data.length > 0) {
      prods = res.data;
    } else {
      // Fallback 1: select standar jika ada kolom baru yang belum dimigrasi di remote
      let fb = null;
      try {
        fb = await client
          .from('products')
          .select('id, name, description, price, category, active, created_at');
      } catch (e) {}

      if (fb && !fb.error && fb.data && fb.data.length > 0) {
        prods = fb.data;
      } else {
        // Fallback 2: panggil listProducts() yang sama dengan yang dibaca buyer
        try {
          const activeProds = await listProducts();
          if (activeProds && activeProds.length > 0) {
            return activeProds;
          }
        } catch (e) {}
        prods = (res && res.data) || (fb && fb.data) || [];
      }
    }

    return (prods || []).map(enrichProduct).sort((a, b) => a.sort_order - b.sort_order || new Date(a.created_at) - new Date(b.created_at));
  }

  async function addProduct(product) {
    if (!isOwnerContext()) throw new Error('Hanya owner yang bisa menambah produk.');

    const name = String(product.name || '').trim();
    const price = Number(product.price) || 0;
    const hasAdmin = product.admin_fee !== undefined && product.admin_fee !== null;
    const hasSort = product.sort_order !== undefined && product.sort_order !== null;
    const hasOrig = product.original_price !== undefined && product.original_price !== null && Number(product.original_price) > price;
    const admin = Math.max(0, Number(product.admin_fee) || 0);
    const sort = Math.max(0, parseInt(product.sort_order, 10) || 0);
    const orig = hasOrig ? Number(product.original_price) : null;

    // Deskripsi disimpan bersih. Marker admin/urutan/diskon hanya dipakai sebagai
    // fallback kalau project lama belum punya kolom di Supabase.
    const cleanDesc = stripProductMeta(product.description);

    const payload = {
      owner_id: ownerId(),
      name,
      description: cleanDesc,
      price,
      category: product.category || 'pulsa',
      active: product.active !== false
    };

    if (hasAdmin) payload.admin_fee = admin;
    if (hasSort) payload.sort_order = sort;
    if (orig) payload.original_price = orig;

    let res = await client.from('products').insert(payload).select().single();
    if (res.error && (/admin_fee|sort_order|original_price|column/i.test(res.error.message || ''))) {
      payload.description = buildProductDescription(product.description, {
        admin: hasAdmin ? admin : undefined,
        sort: hasSort ? sort : 0,
        original_price: orig
      });
      delete payload.admin_fee;
      delete payload.sort_order;
      delete payload.original_price;
      res = await client.from('products').insert(payload).select().single();
    }

    if (res.error) throw res.error;
    return enrichProduct(res.data);
  }

  async function updateProduct(id, updates) {
    if (!isOwnerContext()) throw new Error('Hanya owner yang bisa mengubah produk.');

    const payload = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.price !== undefined) payload.price = Number(updates.price) || 0;
    if (updates.active !== undefined) payload.active = !!updates.active;
    if (updates.category !== undefined) payload.category = updates.category;

    const hasAdmin = updates.admin_fee !== undefined && updates.admin_fee !== null;
    const hasSort = updates.sort_order !== undefined && updates.sort_order !== null;
    const hasOrig = updates.original_price !== undefined && updates.original_price !== null;
    const orig = hasOrig ? (Number(updates.original_price) || null) : undefined;

    // Kalau hanya admin/urutan yang diubah, ambil deskripsi lama dulu supaya
    // marker admin yang sudah ada tidak hilang saat fallback project lama.
    let rawBaseDesc = updates.description;
    if (rawBaseDesc === undefined && (hasAdmin || hasSort || hasOrig)) {
      const { data: current } = await client
        .from('products')
        .select('description')
        .eq('id', id)
        .maybeSingle();
      rawBaseDesc = current?.description || '';
    }

    if (rawBaseDesc !== undefined) {
      // Simpan bersih; marker hanya ditambahkan lagi kalau kolom belum ada.
      payload.description = stripProductMeta(rawBaseDesc);
    }

    if (hasAdmin) payload.admin_fee = Math.max(0, Number(updates.admin_fee) || 0);
    if (hasSort) payload.sort_order = Math.max(0, parseInt(updates.sort_order, 10) || 0);
    if (orig !== undefined) payload.original_price = orig;

    let res = await client.from('products').update(payload).eq('id', id).select().single();
    if (res.error && (/admin_fee|sort_order|original_price|column/i.test(res.error.message || ''))) {
      if (rawBaseDesc !== undefined) {
        payload.description = buildProductDescription(rawBaseDesc, {
          admin: hasAdmin ? Math.max(0, Number(updates.admin_fee) || 0) : undefined,
          sort: hasSort ? Math.max(0, parseInt(updates.sort_order, 10) || 0) : undefined,
          original_price: orig
        });
      }
      delete payload.admin_fee;
      delete payload.sort_order;
      delete payload.original_price;
      res = await client.from('products').update(payload).eq('id', id).select().single();
    }

    if (res.error) throw res.error;
    return enrichProduct(res.data);
  }

  async function deleteProduct(id) {
    if (!isOwnerContext()) throw new Error('Hanya owner yang bisa menghapus produk.');
    const { error } = await client.from('products').delete().eq('id', id);
    if (error) throw error;
  }

  async function createOrder(order) {
    const profile = window.KeuanganAuth?.profile;
    if (!profile || profile.role === 'owner') throw new Error('Sesi buyer tidak valid.');

    const amount = Number(order.amount) || 0;
    const hasAdmin = order.admin_fee !== undefined && order.admin_fee !== null && order.admin_fee !== '';
    const admin = hasAdmin
      ? Math.max(0, Math.min(amount, Number(order.admin_fee) || 0))
      : (order.product_id ? Math.max(0, Math.min(amount, extractAdminFee(order))) : 0);
    const modalNeeded = Math.max(0, amount - admin);

    // Cek ketersediaan modal kios berdasarkan MODAL POKOK (di luar jatah admin)
    let available = null;
    try {
      const status = await getPublicStatus();
      available = Number(
        status?.available != null ? status.available : status?.modal_amount
      ) || 0;
    } catch (e) {
      available = null;
    }
    if (available != null && modalNeeded > available) {
      throw new Error(
        'Saldo modal kios tidak cukup. Tersedia Rp ' +
        Math.round(available).toLocaleString('id-ID') +
        ', modal pokok pesanan Rp ' + Math.round(modalNeeded).toLocaleString('id-ID') + '.'
      );
    }

    const payload = {
      buyer_id: profile.id,
      buyer_username: profile.username,
      product_id: order.product_id || null,
      product_name: order.product_name,
      amount,
      status: 'pending',
      notes: order.notes || '',
      payment_method: order.payment_method || 'cash',
      pay_timing: order.pay_timing === 'later' ? 'later' : 'now',
      due_date: order.pay_timing === 'later' ? (order.due_date || null) : null
    };
    if (hasAdmin) {
      payload.admin_fee = admin;
    }
    if (order.payment_proof) {
      payload.payment_proof = order.payment_proof;
    }

    let { data, error } = await client
      .from('orders')
      .insert(payload)
      .select()
      .single();

    if (error && (/admin_fee|payment_proof|column .* does not exist/i.test(error.message || ''))) {
      if (/admin_fee/i.test(error.message || '')) delete payload.admin_fee;
      if (/payment_proof/i.test(error.message || '')) delete payload.payment_proof;
      const retry = await client
        .from('orders')
        .insert(payload)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      if (/Saldo modal kios tidak cukup/i.test(error.message || '') && modalNeeded <= available) {
        throw new Error(
          'Saldo modal kios cukup untuk modal pokok (Rp ' + Math.round(modalNeeded).toLocaleString('id-ID') + '), ' +
          'namun database Supabase masih memakai trigger lama. Minta owner jalankan migrasi supabase/migrations/20261113000000_fix_modal_logic.sql.'
        );
      }
      throw error;
    }

    if (data?.id && order.payment_proof) {
      try {
        localStorage.setItem(`keuanganku_order_proof_${data.id}`, order.payment_proof);
      } catch (e) {}
    }

    return data;
  }

  async function uploadOrderProof(orderId, proofDataUrl) {
    if (!orderId) throw new Error('Order ID tidak valid.');
    try {
      localStorage.setItem(`keuanganku_order_proof_${orderId}`, proofDataUrl);
    } catch (e) {}

    if (client) {
      // 1. Prioritaskan RPC security definer agar upload bukti transfer 100% tembus RLS
      try {
        const { data: rpcData, error: rpcError } = await client.rpc('upload_order_proof', {
          p_order_id: orderId,
          p_proof: proofDataUrl
        });
        if (!rpcError) return true;
        console.warn('RPC upload_order_proof fallback:', rpcError);
      } catch (rpcEx) {
        console.warn('RPC call exception:', rpcEx);
      }

      // 2. Direct update fallback
      const { error } = await client
        .from('orders')
        .update({ 
          payment_proof: proofDataUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId);

      if (error) {
        console.error('Gagal simpan bukti transfer ke database:', error);
        throw error;
      }
    }
    return true;
  }

  function getOrderProof(order) {
    if (!order) return null;
    const fromOrder = typeof order === 'object' ? order.payment_proof : null;
    if (fromOrder) return fromOrder;
    const id = typeof order === 'object' ? order.id : order;
    if (!id) return null;
    try {
      return localStorage.getItem(`keuanganku_order_proof_${id}`) || null;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- Avatar
  async function updateBuyerAvatar(avatarDataUrl) {
    const profile = window.KeuanganAuth?.profile;
    if (!profile) throw new Error('Belum login.');

    try {
      localStorage.setItem(`keuanganku_avatar_${profile.id}`, avatarDataUrl);
      localStorage.setItem(`keuanganku_avatar_${profile.username}`, avatarDataUrl);
    } catch (e) {}

    profile.avatar_url = avatarDataUrl;

    if (client?.auth?.updateUser) {
      try {
        await client.auth.updateUser({
          data: { avatar_url: avatarDataUrl }
        });
      } catch (e) {}
    }

    if (client) {
      try {
        await client.from('profiles').update({ avatar_url: avatarDataUrl }).eq('id', profile.id);
      } catch (e) {}
    }

    return avatarDataUrl;
  }

  function getBuyerAvatar(userIdOrUsername) {
    if (!userIdOrUsername) return null;
    try {
      return localStorage.getItem(`keuanganku_avatar_${userIdOrUsername}`) || null;
    } catch (e) {
      return null;
    }
  }

  async function listMyOrders() {
    const profile = window.KeuanganAuth?.profile;
    if (!profile) throw new Error('Belum login.');

    const { data, error } = await client
      .from('orders')
      .select('*')
      .eq('buyer_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return data || [];
  }

  async function listAllOrders() {
    if (!isOwnerContext()) throw new Error('Bukan sesi owner.');

    const { data, error } = await client
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    return data || [];
  }

  async function updateOrderAdminFee(id, adminFee) {
    if (!isOwnerContext()) throw new Error('Bukan sesi owner.');
    const admin = Math.max(0, Number(adminFee) || 0);
    const { error } = await client
      .from('orders')
      .update({ admin_fee: admin })
      .eq('id', id);
    if (error) {
      // Project lama belum punya kolom admin_fee: biarkan RPC/trigger lama
      // memakai harga penuh (lebih konservatif, tidak membobol modal).
      if (/admin_fee|column .* does not exist/i.test(error.message || '')) return false;
      throw error;
    }
    return true;
  }

  async function setOrderStatus(id, status, note, adminFee) {
    if (!isOwnerContext()) throw new Error('Bukan sesi owner.');
    if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
      throw new Error('Status pesanan tidak valid.');
    }

    const cleanNote = String(note == null ? '' : note).trim();
    if ((status === 'confirmed' || status === 'cancelled') && !cleanNote) {
      throw new Error(
        status === 'cancelled'
          ? 'Alasan penolakan wajib diisi.'
          : 'Keterangan persetujuan wajib diisi.'
      );
    }

    // Simpan admin final pilihan owner SEBELUM validasi RPC, supaya database
    // menghitung modal pokok dari angka yang benar.
    if (status === 'confirmed' && adminFee !== undefined && adminFee !== null) {
      await updateOrderAdminFee(id, adminFee);
    }

    // ACC / TOLAK / SELESAI lewat RPC supaya atomic dan tetap dicek modalnya.
    const rpc = status === 'confirmed'
      ? 'accept_order'
      : status === 'cancelled'
        ? 'decline_order'
        : 'complete_order';

    const { data, error } = await client.rpc(rpc, {
      p_order_id: id,
      p_note: cleanNote || null
    });

    if (!error) return data;

    // Fallback kalau RPC belum terpasang (project lama): update langsung.
    const missingRpc = /function .* does not exist|Could not find the function/i.test(
      error.message || ''
    );
    if (!missingRpc) throw error;

    // Jangan pernah fallback untuk ACC: update langsung tanpa RPC bisa
    // melewati pemeriksaan modal dan membuat order lolos tanpa saldo.
    if (status === 'confirmed') {
      throw new Error(
        'RPC accept_order belum terpasang. Jalankan migrasi supabase/migrations/20261113000000_fix_modal_logic.sql sebelum ACC.'
      );
    }

    const payload = {
      status,
      updated_at: new Date().toISOString()
    };

    if (cleanNote) {
      payload.owner_note = cleanNote;
    }
    if (status === 'confirmed' || status === 'cancelled') {
      payload.responded_at = new Date().toISOString();
      payload.responded_by = ownerId();
    }

    const { error: updateError } = await client
      .from('orders')
      .update(payload)
      .eq('id', id);

    if (updateError) throw updateError;
    return { ok: true, fallback: true };
  }

  async function cancelAllPendingOrders(reason = 'Reset data kios oleh owner') {
    if (!isOwnerContext()) return 0;
    try {
      const { data, error } = await client
        .from('orders')
        .update({
          status: 'cancelled',
          owner_note: reason,
          responded_at: new Date().toISOString(),
          responded_by: ownerId(),
          updated_at: new Date().toISOString()
        })
        .in('status', ['pending', 'confirmed'])
        .select('id');

      if (error) {
        console.warn('Gagal membatalkan pesanan pending:', error);
        return 0;
      }
      return data ? data.length : 0;
    } catch (e) {
      console.warn('Error cancelAllPendingOrders:', e);
      return 0;
    }
  }

  // ---------------------------------------------------------------- realtime
  function subscribePublicStatus(callback) {
    if (!client) return null;

    return client
      .channel(`public-status-${Date.now()}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'public_status'
      }, (payload) => callback(payload.new))
      .subscribe();
  }

  function subscribeOrders(callback) {
    if (!client) return null;

    return client
      .channel(`orders-${Date.now()}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders'
      }, (payload) => callback(payload))
      .subscribe();
  }

  window.KeuanganDB = {
    client,
    isOwnerContext,
    loadOwnerData,
    saveAllNow,
    saveAllDebounced,
    deleteTransaction,
    deleteQuest,
    clearOwnerRows,
    publishModal,
    publishModalNow,
    getPublicStatus,
    listProducts,
    listAllProductsForOwner,
    addProduct,
    updateProduct,
    deleteProduct,
    extractAdminFee,
    extractSortOrder,
    updateBuyerAvatar,
    getBuyerAvatar,
    createOrder,
    uploadOrderProof,
    getOrderProof,
    listMyOrders,
    listAllOrders,
    updateOrderAdminFee,
    setOrderStatus,
    cancelAllPendingOrders,
    subscribePublicStatus,
    subscribeOrders
  };
})();

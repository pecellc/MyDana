#!/usr/bin/env node
/**
 * RILIS CEPAT MyDana
 * ---------------------------------------------------------------
 * Pemakaian:
 *   node release.js            -> naikkan versi + build standalone + cek sintaks
 *   node release.js --push     -> lakukan semua di atas, lalu commit & push
 *   node release.js --dry      -> hanya tampilkan rencana (tidak mengubah file)
 *
 * Yang dilakukan:
 *   1. Cari versi aset saat ini (?v=NN) di index.html
 *   2. Naikkan ke NN+1 di index.html dan sw.js (cache service worker)
 *   3. node build-standalone.js
 *   4. node --check semua file JS
 *
 * Setelah itu: deploy ke Netlify / GitHub Pages, lalu tutup-buka APK.
 * CATATAN: perubahan data di Supabase TIDAK perlu rilis sama sekali.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = __dirname;
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const push = args.includes('--push');

function read(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}
function write(name, content) {
  fs.writeFileSync(path.join(root, name), content, 'utf8');
}

const indexPath = path.join(root, 'index.html');
const swPath = path.join(root, 'sw.js');

if (!fs.existsSync(indexPath) || !fs.existsSync(swPath)) {
  console.error('index.html / sw.js tidak ditemukan. Jalankan dari folder proyek.');
  process.exit(1);
}

const indexHtml = read('index.html');
const versions = [...indexHtml.matchAll(/\?v=(\d+)/g)].map((m) => Number(m[1]));
if (versions.length === 0) {
  console.error('Tidak menemukan pola ?v=NN di index.html.');
  process.exit(1);
}

const current = Math.max(...versions);
const next = current + 1;

console.log(`Versi aset saat ini : v${current}`);
console.log(`Versi baru          : v${next}${dry ? ' (DRY RUN, tidak ditulis)' : ''}`);

const newIndex = indexHtml.split(`?v=${current}`).join(`?v=${next}`);
const newSw = read('sw.js')
  .replace(new RegExp(`keuanganku-v${current}`, 'g'), `keuanganku-v${next}`)
  .replace(new RegExp(`\\?v=${current}`, 'g'), `?v=${next}`);

if (dry) {
  console.log('index.html: akan mengganti ' + (indexHtml.match(new RegExp(`\\?v=${current}`, 'g')) || []).length + ' referensi');
  console.log('sw.js     : CACHE_NAME -> keuanganku-v' + next);
  process.exit(0);
}

write('index.html', newIndex);
write('sw.js', newSw);
console.log('OK  index.html & sw.js diperbarui ke v' + next);

// Build versi standalone (satu file HTML).
try {
  const out = execFileSync(process.execPath, ['build-standalone.js'], { cwd: root, encoding: 'utf8' });
  console.log('OK  ' + out.trim());
} catch (e) {
  console.error('GAGAL build standalone:\n' + (e.stdout || '') + (e.stderr || e.message));
  process.exit(1);
}

// Cek sintaks semua JS inti.
const jsFiles = ['app.js', 'buyer.js', 'db.js', 'auth.js', 'supabase-config.js', 'sw.js'];
let syntaxOk = true;
for (const file of jsFiles) {
  if (!fs.existsSync(path.join(root, file))) continue;
  try {
    execFileSync(process.execPath, ['--check', file], { cwd: root, stdio: 'pipe' });
    console.log('OK  sintaks ' + file);
  } catch (e) {
    syntaxOk = false;
    console.error('GAGAL sintaks ' + file + ':\n' + (e.stderr || e.message));
  }
}
if (!syntaxOk) process.exit(1);

if (push) {
  const msg = `release: v${next}`;
  try {
    execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'inherit' });
    execFileSync('git', ['commit', '-m', msg], { cwd: root, stdio: 'inherit' });
    execFileSync('git', ['push'], { cwd: root, stdio: 'inherit' });
    console.log(`OK  commit & push (${msg})`);
  } catch (e) {
    console.error('GAGAL git: ' + (e.message || e));
    process.exit(1);
  }
}

console.log('');
console.log('SELESAI. Langkah berikutnya:');
console.log('  1. Deploy ke Netlify (manual) atau tunggu GitHub Pages.');
console.log('  2. Buka situs live, pastikan ?v=' + next + ' sudah tampil.');
console.log('  3. Di HP: tutup APK sepenuhnya, lalu buka lagi.');
console.log('  APK TIDAK perlu di-build ulang untuk update fitur.');

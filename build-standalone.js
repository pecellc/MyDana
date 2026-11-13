const fs = require('fs');
const path = require('path');

const dir = __dirname;
let bundle = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

// Inline stylesheet
const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
bundle = bundle.replace('<link rel="stylesheet" href="style.css">', `<style>\n${css}\n</style>`);

// Inline semua script lokal (urutan tetap sesuai index.html)
const localScripts = [
  'supabase-config.js',
  'auth.js',
  'db.js',
  'buyer.js',
  'app.js'
];

for (const file of localScripts) {
  const code = fs.readFileSync(path.join(dir, file), 'utf8');
  bundle = bundle.replace(
    `<script src="${file}"></script>`,
    `<script>\n${code}\n</script>`
  );
}

fs.writeFileSync(path.join(dir, 'KeuanganKu_Standalone.html'), bundle, 'utf8');
console.log(
  'Success! KeuanganKu_Standalone.html created:',
  fs.statSync(path.join(dir, 'KeuanganKu_Standalone.html')).size,
  'bytes'
);

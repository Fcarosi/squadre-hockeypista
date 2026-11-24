// Rigenera index.html dai dati già salvati in data/ (senza scaricare nulla)
import fs from 'node:fs';
const r = f => fs.readFileSync(f, 'utf8');
const meta = fs.existsSync('data/meta.json') ? JSON.parse(r('data/meta.json')) : {};
const html = r('template.html').replace('__CLUBS__', r('data/clubs.json')).replace('__DIST__', r('data/dist.json'))
  .replaceAll('__UPDATED__', meta.updated || '').replaceAll('__DISTDATE__', meta.distDate || '');
fs.writeFileSync('index.html', html);
console.log('index.html rigenerato');

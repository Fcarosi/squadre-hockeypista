// Riscarica da FISR squadre, classifiche e contatti dei campionati giovanili di hockey pista
// e rigenera index.html. Eseguito ogni notte da GitHub Actions (.github/workflows/update.yml).
import { chromium } from 'playwright';
import fs from 'node:fs';

const HP = 'https://www.hockeypista.fisr.it/';
const REG = 'https://www.fisr.it/la-federazione/ricerca-societa-sportive';
const CATS = ['U11', 'U13', 'U15', 'U17', 'U19'];
const UA = 'torneo-hockey-siena/1.0 (aggiornamento notturno, uso non commerciale)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJ = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJ = (f, d) => fs.writeFileSync(f, JSON.stringify(d));
const norm = s => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const today = () => new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });

const old = readJ('data/clubs.json');
const regMap = readJ('data/registry_map.json');
let dist = readJ('data/dist.json');
const meta = fs.existsSync('data/meta.json') ? readJ('data/meta.json') : { distDate: '24/11/2026' };

const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: UA });

// 1. Trova gli id dei campionati giovanili della stagione corrente cliccando le schede della home
async function findLeagues() {
  const out = {};
  for (const cat of CATS) {
    await page.goto(HP, { waitUntil: 'networkidle' });
    await page.waitForSelector('.sidgad-liga-card');
    const n = cat.slice(1);
    const card = page.locator('.sidgad-liga-card:not(.sidgad-oculto)', { hasText: new RegExp(`CAMPIONATO GIOVANILE U${n}\\s+HP`) }).first();
    if (!(await card.count())) { console.warn('Campionato non trovato', cat); continue; }
    await card.click();
    await page.waitForURL(/liga=\d+/, { timeout: 15000 });
    out[cat] = new URL(page.url()).searchParams.get('liga');
  }
  return out;
}

// 2. Squadre di un campionato (nome, sigla, logo)
async function teams(liga) {
  await page.goto(`${HP}?liga=${liga}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button.sidgad-team-selector-item', { timeout: 20000 });
  return page.$$eval('button.sidgad-team-selector-item', bs => bs.map(b => ({
    name: (b.dataset.teamName || '').trim(),
    logo: b.querySelector('img').getAttribute('src').split('/').pop(),
  })));
}

// 3. Classifiche di un campionato
async function standings(liga) {
  await page.goto(`${HP}?liga=${liga}&vista=clasificaciones`, { waitUntil: 'networkidle' });
  await sleep(2500);
  return page.evaluate(() => {
    const lines = document.body.innerText.split('\n'); let z = ''; const out = [];
    for (const l of lines) {
      if (/^U\d+.*ZONA|^U\d+ -/.test(l.trim()) && !l.includes('\t')) { z = l.trim(); continue; }
      const m = l.match(/^(\d+)\t\s*(.+?)\t(-?\d+)\t(\d+)\t(\d+)\t(\d+)\t(\d+)\t(\d+)\t(\d+)\t(-?\d+)$/);
      if (m) out.push([z, m[2].trim(), +m[3], +m[4], +m[5], +m[6], +m[7], +m[8], +m[9]]);
    }
    return out;
  });
}

// 4. Scheda società nel registro FISR (codice, sede, telefono, email, sito)
async function registry(fid) {
  const r = await fetch(`${REG}/dettagliosocieta.html?societa=${fid}`, { headers: { 'User-Agent': UA } });
  const h = await r.text();
  const pick = re => (h.match(re) || [])[1]?.trim() || '';
  const box = h.slice(h.indexOf('societa_all'));
  return {
    cod: (box.match(/class="cod"[^>]*>\s*([^<]+)</) || [])[1]?.trim(),
    nome: (box.match(/<h4[^>]*>\s*([^<]+?)\s*<\/h4>/) || [])[1]?.trim().replace(/\s+/g, ' '),
    ind: (box.match(/class="indirizzo"[^>]*>([^<]+)</) || [])[1]?.trim(),
    tel: [...box.matchAll(/class="tel"[^>]*>\s*<span>([^<]+)</g)].map(m => m[1].trim()).join(' / '),
    mail: (box.match(/mailto:([^"]+)"[^>]*>\s*email\s*</) || [])[1] || '',
    web: (box.match(/class="web"[^>]*>\s*<a href="([^"]+)"/) || [])[1] || '',
  };
}

// Per un codice società nuovo, cerca la scheda nelle liste regionali del settore hockey
async function findRegistryId(cod) {
  for (const reg of [13, 17, 18, 15, 8, 6, 12, 7, 3, 11, 14, 1, 16, 20, 19, 9, 4, 10, 2, 5]) {
    const h = await (await fetch(`${REG}.html?denominazione=&settore=1&regione=${reg}&provincia=&view=societa&cerca-societa=Cerca`, { headers: { 'User-Agent': UA } })).text();
    const ids = [...new Set([...h.matchAll(/dettagliosocieta\.html\?societa=(\d+)/g)].map(m => m[1]))];
    for (const id of ids) {
      if (Object.values(regMap).includes(+id)) continue;
      const s = await registry(id); await sleep(300);
      if (s.cod === cod) return +id;
    }
  }
  return null;
}

// --- raccolta
const leagues = await findLeagues();
console.log('Campionati', leagues);
const byCod = {};
for (const cat of CATS) {
  const liga = leagues[cat]; if (!liga) continue;
  const T = await teams(liga);
  const S = await standings(liga);
  const cnt = {}, pos = {};
  for (const r of S) { cnt[r[0]] = (cnt[r[0]] || 0) + 1; pos[norm(r[1])] = [r, cnt[r[0]]]; }
  for (const t of T) {
    const cod = t.logo.split('.')[0].split('_')[0];
    const c = byCod[cod] ||= { cod, logo: t.logo, teams: {}, stats: {} };
    (c.teams[cat] ||= []).push(t.name);
    const hit = pos[norm(t.name)];
    if (hit) {
      const [r, p] = hit;
      (c.stats[cat] ||= []).push({ t: t.name, z: r[0].split('-').pop().trim().replace(/^ZONA/, 'Zona'), pos: p, nz: cnt[r[0]], pts: r[2], pg: r[3], v: r[4], n: r[5], p: r[6], gf: r[7], gs: r[8] });
    }
  }
  console.log(cat, T.length, 'squadre,', S.length, 'righe di classifica');
}
if (Object.keys(byCod).length < 20) throw new Error('Troppe poche squadre lette: il sito potrebbe essere cambiato. Dati non aggiornati.');

// contatti
const oldBy = Object.fromEntries(old.map(c => [c.cod, c]));
const SHORT_OVR = { '4': 'Hockey Novara', '4003': 'Hockey Bassano', '277': 'Hockey Club Castiglione', '3448': 'HC Correggio Femminile', '3007': 'Deco Eboli' };
const clubs = [];
for (const cod of Object.keys(byCod)) {
  let fid = regMap[cod];
  if (!fid) { fid = await findRegistryId(cod); if (fid) regMap[cod] = fid; }
  let s = fid ? await registry(fid) : null; await sleep(300);
  if (!s || s.cod !== cod) s = oldBy[cod] ? { nome: oldBy[cod].nome, ind: oldBy[cod].ind, tel: oldBy[cod].tel, mail: oldBy[cod].mail, web: oldBy[cod].web } : null;
  if (!s || !s.ind) { console.warn('Senza scheda registro, escluso:', cod, byCod[cod].teams); continue; }
  const m = s.ind.match(/,\s*(\d{5}),\s*(.+)\((\w+)\)/);
  const names = Object.values(byCod[cod].teams).flat();
  const base = names.map(n => n.replace(/\s+(A|B|FEMM\.?|FEMMINILE|MASCHILE|1954)$/, '')).sort((a, b) => a.length - b.length)[0];
  const short = SHORT_OVR[cod] || base.toLowerCase().replace(/\b\w/g, x => x.toUpperCase()).replace(/^Cp /, 'CP ').replace(/^Cgc /, 'CGC ').replace(/^Afp /, 'AFP ').replace(/^Rh /, 'RH ');
  clubs.push({ cod, fid, nome: s.nome, ind: s.ind, citta: m ? m[2].trim() : '', prov: m ? m[3] : '', tel: s.tel, mail: s.mail, web: s.web, logo: byCod[cod].logo, teams: byCod[cod].teams, stats: byCod[cod].stats, short });
}

// nuove città: coordinate (Nominatim) e matrice distanze/tempi (OSRM)
const towns = [...new Set(clubs.map(c => c.citta))].filter(Boolean);
const missing = towns.filter(t => !dist.names.includes(t));
if (missing.length) {
  const geo = Object.fromEntries(dist.names.map((n, i) => [n, dist.geo[i]]));
  for (const t of missing) {
    const prov = clubs.find(c => c.citta === t).prov;
    const j = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&city=${encodeURIComponent(t)}`, { headers: { 'User-Agent': UA } })).json();
    if (j[0]) geo[t] = [+(+j[0].lat).toFixed(5), +(+j[0].lon).toFixed(5)]; else console.warn('Comune non trovato', t, prov);
    await sleep(1100);
  }
  const names = Object.keys(geo).sort();
  const coords = names.map(n => geo[n][1] + ',' + geo[n][0]).join(';');
  const o = await (await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance,duration`, { headers: { 'User-Agent': UA } })).json();
  if (o.code !== 'Ok') throw new Error('OSRM non ha risposto: ' + o.code);
  dist = { names, geo: names.map(n => geo[n]), d: o.distances.map(r => r.map(x => Math.round(x / 100) / 10)), t: o.durations.map(r => r.map(x => Math.round(x / 60))) };
  meta.distDate = today();
  writeJ('data/dist.json', dist);
}
clubs.forEach(c => { if (!dist.names.includes(c.citta)) console.warn('Città senza distanze', c.citta); });
const okClubs = clubs.filter(c => dist.names.includes(c.citta));

meta.updated = today();
writeJ('data/clubs.json', okClubs);
writeJ('data/registry_map.json', regMap);
writeJ('data/meta.json', meta);
await browser.close();

// pagina
let html = fs.readFileSync('template.html', 'utf8');
html = html.replace('__CLUBS__', JSON.stringify(okClubs)).replace('__DIST__', JSON.stringify(dist))
  .replaceAll('__UPDATED__', meta.updated).replaceAll('__DISTDATE__', meta.distDate);
fs.writeFileSync('index.html', html);
console.log('Fatto:', okClubs.length, 'club,', okClubs.reduce((a, c) => a + Object.values(c.teams).flat().length, 0), 'squadre');

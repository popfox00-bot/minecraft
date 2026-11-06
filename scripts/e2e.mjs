// End-to-end acceptance checks against a running build (default: vite preview).
//   npm run build && npx vite preview --port 4173 &
//   npm run e2e -- http://localhost:4173/
// Uses Playwright (resolved from the local or global install).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const url = process.argv[2] ?? 'http://localhost:4173/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => check('no page errors', false, e.message));
page.on('dialog', (d) => d.accept());
const ready = () => page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });

// 1. First run: seed data, measure line, biome spot checks
await page.goto(url);
await ready();
const names = await page.evaluate(() => worldatlas.store.markers.map((m) => m.name).sort());
check('seed markers created', JSON.stringify(names) === '["Dungeon A","Dungeon B"]', names.join(', '));
const label = await page.locator('.measure-label span').textContent();
check('measure line reads ~24.4 blocks', label === '24.4 blocks', label);
const spot = await page.evaluate(async () => {
  const r = {};
  for (const [k, x, z, y] of [['0,0', 0, 0], ['Dungeon A', 1180, -2808], ['Dungeon A @y-5', 1180, -2808, -5], ['Dungeon B', 1204, -2807], ['Dungeon B @y-1', 1204, -2807, -1]])
    r[k] = (await getBiome(x, z, { y, dim: 'overworld' })).name;
  r['nether 0,0'] = (await getBiome(0, 0, { dim: 'nether' })).name;
  return r;
});
console.log('      biome spot checks:', JSON.stringify(spot));
check('getBiome works', spot['0,0'] === 'desert' && spot['Dungeon A'] === 'sparse_jungle');

// 2. Add a marker through the UI, reload, still there
await page.locator('#map').click({ position: { x: 300, y: 300 } });
await page.getByRole('button', { name: /^\+ Add marker at/  }).click();
await page.locator('.mform input').first().fill('E2E Base');
await page.locator('.mform select').first().selectOption('base');
await page.getByRole('button', { name: 'Add marker', exact: true }).click();
await page.waitForTimeout(300);
await page.reload();
await ready();
const afterReload = await page.evaluate(() => worldatlas.store.markers.map((m) => m.name).sort());
check('markers survive reload', afterReload.includes('E2E Base') && afterReload.length === 3, afterReload.join(', '));

// 3. Export (via UI download) -> wipe -> import (via UI file picker) restores exactly
await page.getByRole('button', { name: 'Settings' }).click();
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
const file = path.join(os.tmpdir(), `wa-export-${Date.now()}.json`);
await dl.saveAs(file);
const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
await page.evaluate(() => worldatlas.store.wipe());
await page.reload();
await ready();
const wiped = await page.evaluate(() => worldatlas.store.markers.length);
await page.getByRole('button', { name: 'Settings' }).click();
await page.locator('.settings input[type=file]').setInputFiles(file);
await page.waitForTimeout(500);
await page.reload();
await ready();
const reimported = await page.evaluate(() => worldatlas.store.exportData());
const strip = (o) => JSON.stringify({ ...o, exportedAt: '' });
check('export -> wipe -> import restores exactly', wiped === 0 && strip(reimported) === strip(exported),
  `wiped=${wiped}, markers=${reimported.markers.length}, categories=${reimported.categories.length}`);

// 4. Smoothness while tiles generate: cold cache, pan + zoom, watch the main thread
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByRole('button', { name: 'Clear tile cache' }).click();
await page.locator('.sheet-head button').click();
const perf = await page.evaluate(async () => {
  const long = [];
  const obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push(e.duration)));
  obs.observe({ type: 'longtask', buffered: false });
  const gaps = [];
  let last = performance.now(), running = true;
  const tick = (t) => { gaps.push(t - last); last = t; if (running) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const { view } = worldatlas;
  const m = view.map;
  const gen0 = view.biome.stats.generated;
  const t0 = performance.now();
  for (const z of [2, 0, -2, -4, -6, -3, 1]) {
    m.setZoom(z, { animate: false });
    for (let i = 0; i < 6; i++) { m.panBy([180, 90], { animate: false }); await new Promise((r) => setTimeout(r, 120)); }
  }
  // wait for the queue to drain
  while (view.biome.isLoading?.() ?? false) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 1500));
  running = false;
  obs.disconnect();
  gaps.sort((a, b) => a - b);
  return {
    seconds: (performance.now() - t0) / 1000,
    tilesGenerated: view.biome.stats.generated - gen0,
    longTasks: long.length,
    longestTaskMs: Math.round(Math.max(0, ...long)),
    frames: gaps.length,
    p95FrameMs: Math.round(gaps[Math.floor(gaps.length * 0.95)]),
    maxFrameMs: Math.round(gaps[gaps.length - 1]),
  };
});
console.log('      perf:', JSON.stringify(perf));
check('tiles generated off-thread during pan/zoom', perf.tilesGenerated > 50, `${perf.tilesGenerated} tiles`);
check('no main-thread jank (p95 frame < 50ms, no long task > 150ms)', perf.p95FrameMs < 50 && perf.longestTaskMs < 150,
  `p95 ${perf.p95FrameMs}ms, max frame ${perf.maxFrameMs}ms, long tasks ${perf.longTasks} (longest ${perf.longestTaskMs}ms)`);

// 4b. Tiles exist at every zoom level, both dimensions (GridLayer minZoom regression)
const missing = [];
for (const d of ['overworld', 'nether']) {
  await page.evaluate((d) => worldatlas.store.updateSettings({ dim: d }), d);
  for (const z of [-6, -4, -2, 0, 2, 5]) {
    await page.evaluate((z) => worldatlas.view.map.setZoom(z, { animate: false }), z);
    await page.waitForTimeout(900);
    const n = await page.evaluate(() => document.querySelectorAll('.leaflet-tile-pane .leaflet-layer:first-child canvas.leaflet-tile-loaded').length);
    if (!n) missing.push(`${d}@${z}`);
  }
}
await page.evaluate(() => worldatlas.store.updateSettings({ dim: 'overworld' }));
check('biome tiles render at zoom -6..5 in both dimensions', missing.length === 0, missing.join(', ') || 'all present');

// 5. Nether tab
await page.getByRole('tab', { name: 'Nether' }).click();
await page.waitForTimeout(800);
const dim = await page.evaluate(() => worldatlas.store.settings.dim);
check('nether tab switches dimension', dim === 'nether');

// 6. End tab
await page.getByRole('tab', { name: 'End' }).click();
await page.waitForTimeout(500);
await page.evaluate(() => worldatlas.view.map.setZoom(-3, { animate: false }));
await page.waitForTimeout(1500);
const endInfo = await page.evaluate(async () => ({
  dim: worldatlas.store.settings.dim,
  tiles: document.querySelectorAll('.leaflet-tile-pane .leaflet-layer:first-child canvas.leaflet-tile-loaded').length,
  centre: (await getBiome(0, 0, { dim: 'end' })).name,
  outer: (await getBiome(1500, 0, { dim: 'end' })).name,
}));
check('End tab renders End biomes', endInfo.dim === 'end' && endInfo.tiles > 0 && endInfo.centre === 'the_end' && endInfo.outer !== 'the_end',
  `centre ${endInfo.centre}, x=1500 ${endInfo.outer}, ${endInfo.tiles} tiles`);

// 7. Biome search: type a biome in the Go-to box (overworld), get numbered results
await page.getByRole('tab', { name: 'Overworld' }).click();
await page.waitForTimeout(400);
await page.evaluate(() => worldatlas.view.goTo(1180, -2808, 0, false));
await page.locator('.goto input').fill('cherry grove');
await page.locator('.goto input').press('Enter');
await page.waitForSelector('.hits li', { timeout: 30000 });
const hits = await page.$$eval('.hits .mitem-name', (els) => els.map((e) => e.textContent));
const pins = await page.locator('.hit').count();
const verified = await page.evaluate(async (list) => {
  let ok = 0;
  for (const t of list) { const [x, z] = t.split(',').map(Number); if ((await getBiome(x, z, { dim: 'overworld' })).name === 'cherry_grove') ok++; }
  return ok;
}, hits);
check('biome search finds nearest cherry groves', hits.length >= 3 && pins === hits.length && verified >= hits.length - 1,
  `${hits.length} results, ${pins} pins, ${verified} verified at block level; nearest ${hits[0]}`);
await page.screenshot({ path: path.join(os.tmpdir(), 'wa-biome-search.png') });

await browser.close();

// 8. Cross-device sync: two separate browser profiles, one fake Apps Script backend
const { loadAppsScript } = await import('./fake-apps-script.mjs');
const gs = loadAppsScript({ key: 'e2e-key' });
const GS_URL = 'https://script.google.com/macros/s/E2E/exec';
const b2 = await chromium.launch();
async function device() {
  const ctx = await b2.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route('https://script.google.com/**', async (route) => {
    const body = route.request().postData() ?? '{}';
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(gs.post(body)) });
  });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  await p.goto(url);
  await p.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await p.getByRole('button', { name: 'Settings' }).click();
  await p.getByRole('textbox', { name: 'Web app URL' }).fill(GS_URL);
  await p.getByLabel('Sync key').fill('e2e-key');
  await p.getByRole('button', { name: 'Connect' }).click();
  await p.waitForSelector('text=Synced', { timeout: 15000 });
  await p.locator('.sheet-head button').click();
  return p;
}
const A = await device();
const B = await device();
await A.locator('#map').click({ position: { x: 400, y: 400 } });
await A.getByRole('button', { name: /^\+ Add marker at/ }).click();
await A.locator('.mform input').first().fill('Synced Base');
await A.getByRole('button', { name: 'Add marker', exact: true }).click();
await A.waitForTimeout(2500); // debounce + round trip
await B.reload();
await B.waitForSelector('html[data-ready="1"]');
await B.waitForTimeout(800);
const bNames = await B.evaluate(() => worldatlas.store.markers.map((m) => m.name).sort());
check('marker added on device A appears on device B', bNames.includes('Synced Base') && bNames.length === 3, bNames.join(', '));
await B.evaluate(() => worldatlas.store.deleteMarker('seed-dungeon-a'));
await B.waitForTimeout(2500);
await A.evaluate(() => worldatlas.syncer.syncNow());
const aNames = await A.evaluate(() => worldatlas.store.markers.map((m) => m.name).sort());
check('deletion on device B reaches device A', !aNames.includes('Dungeon A') && aNames.includes('Synced Base'), aNames.join(', '));
const same = await Promise.all([A, B].map((p) => p.evaluate(() => JSON.stringify(worldatlas.store.snapshot().markers.map((m) => [m.id, m.name]).sort()))));
check('devices converge', same[0] === same[1]);
await b2.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

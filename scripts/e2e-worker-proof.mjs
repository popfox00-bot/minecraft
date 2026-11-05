import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage();
p.on('console', (m) => console.log('[page]', m.text()));
await p.goto(url);
const r = await p.evaluate(async () => ({
  origin: await getBiome(0, 0),
  a: await getBiome(1180, -2808),
  b: await getBiome(1204, -2807),
  aCave: await getBiome(1180, -2808, -5),
  netherOrigin: await getBiome(0, 0, 64, 'nether'),
  usesWorker: typeof Worker,
}));
console.log(JSON.stringify(r));
await b.close();

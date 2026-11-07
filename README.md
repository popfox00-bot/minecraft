# WorldAtlas

A personal map and location tracker for **one** Minecraft Bedrock world. It works like Chunkbase, but for a single seed, with your own markers, and a deliberately plain look.

- Seed: `-2829401596156382806` (change it in Settings)
- Static site: Vite + TypeScript + Leaflet (`L.CRS.Simple`, 1 map unit = 1 block, north/−Z up, +X right)
- Biomes: [cubiomes](https://github.com/Cubitect/cubiomes) compiled to WebAssembly, running in a pool of Web Workers. The map labels this **"Biomes: Java-parity generator"**.
- Storage: IndexedDB for markers, categories, settings and cached biome tiles. JSON export/import for backups.
- Optional cross-device sync through your own Google Apps Script web app (`apps-script/Code.gs`). There is no other backend.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Production build (output goes to `dist/`, and works from any sub-path):

```bash
npm run build
```

Tests:

```bash
npm test
```

## Building the WASM module

The compiled module, `src/wasm/cubiomes.js`, is committed: it is a single-file ES module with the `.wasm` embedded. So a normal `npm run build` (and CI) does not need Emscripten. Rebuild it only after changing `vendor/cubiomes` or `wasm/worldatlas.c`.

1. Install Emscripten. This build used emcc 6.0.13.

   ```bash
   git clone https://github.com/emscripten-core/emsdk.git
   ```

   ```bash
   cd emsdk && ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh
   ```

2. Build:

   ```bash
   npm run build:wasm
   ```

`scripts/build-wasm.sh` runs this Emscripten command:

```bash
emcc -O3 -flto -fwrapv -Ivendor/cubiomes \
  vendor/cubiomes/{noise,biomes,layers,biomenoise,generator,finders,util,quadbase}.c \
  wasm/worldatlas.c -o src/wasm/cubiomes.js \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createCubiomes \
  -sENVIRONMENT=web,worker,node -sSINGLE_FILE=1 -sALLOW_MEMORY_GROWTH=1 -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS=_wa_init,_wa_newest_version,_wa_get_biome,_wa_gen_area,_wa_biome_name,_wa_is_overworld \
  -sEXPORTED_RUNTIME_METHODS=UTF8ToString,HEAP32
```

cubiomes is vendored in `vendor/cubiomes/` (MIT, commit in `vendor/cubiomes/COMMIT`: `e61f905`). `wasm/worldatlas.c` is the bridge. It exposes only biome functions; the structure finders are deliberately left out.

### Verifying the WASM build

`tests/biome-wasm.test.ts` loads the WASM in Node and checks it against values from a native `gcc` build of the same cubiomes sources. They match exactly.

## Deploying

- **GitHub Pages:** `.github/workflows/pages.yml` runs the tests, builds, and deploys on every push to `main`. In the repo settings, set Settings → Pages → Source to "GitHub Actions".
- **Cloudflare Pages:** use build command `npm run build` and output directory `dist`.

`vite.config.ts` uses `base: './'`, so the build works from any path.

## Cross-device sync (Google Apps Script)

Markers are saved in each browser. To share them between your phone, tablet and computer, deploy the small backend in `apps-script/Code.gs`. It runs as a Google Apps Script web app in your own Google account and stores one JSON file in your Drive.

1. Go to [script.google.com](https://script.google.com) → **New project**. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
2. Change `SYNC_KEY` at the top to a long random string. It works as the password.
3. **Deploy → New deployment → Web app.** Set *Execute as: Me* and *Who has access: Anyone*. Authorize the Drive access when asked.
4. Copy the web app URL (it ends in `/exec`).
5. In WorldAtlas, open **Settings → Sync across devices**, paste the URL and `SYNC_KEY`, then press **Connect**. Do this on each device.

After that, every add, edit and delete syncs automatically: about 1.5 s after a change, when the app regains focus, and every minute while it is open.

How it works:
- Each marker and category carries an `updatedAt` time. Deletions are kept as tombstones.
- The backend merges under a script lock and keeps the newest version of each record, so devices converge no matter who syncs first.
- The seed and generator version sync too. Theme, grid toggles and map position stay per device.
- The first-run Dungeon A/B markers have fixed IDs, so they are not duplicated across devices.
- Importing a JSON backup counts as a fresh edit, so the restore also wins on the other devices.

If you edit the backend later:
- Edit `apps-script/Code.template.gs` or `src/sync/merge.js`, run `npm run build:gs`, and paste the new `Code.gs`.
- Then use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.
- A unit test fails if `Code.gs` is out of date with the app's merge code.

## Features (phase 1)

- **Map:** muted biome palette. A faint chunk grid (16 blocks, from zoom +1) and region grid (512 blocks, from zoom −2) show only when zoomed in. The cursor/tap readout shows X, Z, biome, chunk and the 1:8 position in the other dimension. The "Go to" box takes `X, Z`, `X Y Z` or a marker name. Zoom runs from −6 (1 px = 64 blocks) to +5 (32 px/block).
- **Dimensions:** Overworld, Nether and End tabs. Switching tabs converts the view position 1:8. Each marker belongs to one dimension. A marker can show its *linked portal position* (dashed ghost marker) in the other dimension.
- **Markers:** add one by tapping the map and pressing "+ Add marker at X, Z", by using the + button (map centre), or by typing coordinates in the form. Fields: name, category, X, Y (optional), Z, dimension, notes, status (planned / found / built / looted), created date.
- **Categories:** you can edit the name, colour and icon (18 built-in glyphs), add new ones, and delete them (their markers move to another category). The compact legend toggles visibility per category.
- **List:** search, filter by category, status and dimension, and sort by distance from a reference point. The reference is your Base marker by default; you can also pick any marker or the map centre. Tapping an item flies the map to it.
- **Find biome near me:** the magnifier button, or type a biome name into the Go-to box (e.g. `cherry grove`, `deep dark`). It lists the 8 nearest separate patches of that biome around the map centre, the tapped point or your reference marker. Each result has coordinates, distance and the linked Nether position. Results show as numbered pins on the map; tap one to fly there, or press **+ Marker** to save it.
  - Search is done in a worker at 1:16 resolution, nearest rings first, up to 12,000 blocks (6,000 in the Nether and End). Each hit is then refined to a 1:4 cell inside the biome.
  - Cave biomes (lush caves, dripstone caves, deep dark) are searched underground, at Y 0 or Y −40 by default; you can change the Y.
- **Tools:** 1:8 converter, and a measure tool. Tap two points, or tap markers to include their Y. It shows the 3D distance, the horizontal distance and the Nether travel equivalent.
- **Settings:** seed, generator version, theme (system/light/dark), grid toggles, JSON export/import, clear tile cache, category editor.

On first run it creates two seed markers, *Dungeon A* (1180, −5, −2808) and *Dungeon B* (1204, −1, −2807), plus a measure line between them that reads **24.4 blocks**. That figure is the 3D distance; the horizontal distance is 24.0.

## Debug: `getBiome`

Open the browser console:

```js
await getBiome(0, 0)                          // surface biome, current dimension
await getBiome(1180, -2808, { y: -5 })        // 3D biome at a Y level (cave biomes)
await getBiome(0, 0, { dim: 'nether' })
```

On startup the app also logs the spot checks. Current results for this seed:

| Position | Surface (Y 256) | At given Y |
|---|---|---|
| 0, 0 | desert | — |
| Dungeon A 1180, −2808 | sparse_jungle | lush_caves (Y −5) |
| Dungeon B 1204, −2807 | sparse_jungle | lush_caves (Y −1) |
| Nether 0, 0 | crimson_forest | — |

## Suggested End Cities (experimental, Bedrock)

The castle button opens the End City panel and switches to the End tab. It is a port of the public Bedrock placement research, trusted only as far as it matches the cities you have found.

- **The grid:**
  - The End is split into 20×20-chunk regions (320 blocks), and each region holds at most one city, starting somewhere in a 9×9-chunk box in its north-west corner.
  - The offset is the average of two random draws, so the shaded core box holds the city about 64% of the time.
  - Regions with an End City marker are shown as done. Regions inside the empty ring around the main island (under 1,000 blocks out) are skipped.
- **Exact predictions:**
  - The start chunk in each region comes from Bedrock's RNG (MT19937 seeded with the Java region-seed formula truncated to 32 bits). Sources: MCBEStructureFinder for the End City constants and Bedrockified for the RNG.
  - It is not known which 32 bits of a 64-bit seed current Bedrock uses, so three variants are tested (low, high, high XOR low).
- **Learning from your finds:**
  - Every End City marker in the End with status Found, Built or Looted is checked against each variant. Place the marker at the base of the entrance tower; it matches if it is within 20 blocks.
  - Pins appear only when one variant matches **every** find. The label comes from the chance that the matches are luck (about 10% per find, times 3 variants):

    | Matching finds | Label | Chance of coincidence |
    |---|---|---|
    | 1 | Possible (pins dashed) | about 1 in 3 |
    | 2–3 | Likely | under 1 in 20 |
    | 4+ | Confirmed | under 1 in 1,000 |

  - Any find that no variant predicts hides the pins and lists how far off each find is.
  - A find outside every grid box warns that the grid itself may be wrong.
  - "Show unverified predictions" draws the low-32 pins before any match, dashed and labelled.
- **Void hint:** each suggestion says "outer islands" or "likely void" from Java's End zones. Bedrock's islands may differ.
- **Tip:** "+ Marker" saves a suggestion as a planned End City. When you reach it, move the marker to the entrance tower base and set it to Found; it then counts as evidence.

## How biome tiles work

- Leaflet zoom 0 = 1 px per block. Each tile is 256 px.
- Each tile is generated with `genBiomes` at the coarsest cubiomes scale (1, 4, 16, 64, 256) that keeps it at 128 cells across or fewer. Zoom +2 and up uses 1:1 (voronoi) sampling.
- The surface map samples at Y = 256. That is above the terrain, so cave biomes (lush caves, dripstone, deep dark) don't cover the surface. Use `getBiome(x, z, { y })` to see the 3D biome at a given depth.
- Tiles are cached in IndexedDB as raw biome IDs, keyed by `seed|version|dimension|zoom|x|y`. Changing the palette or theme never invalidates the cache.
- Jobs are queued on the main thread and sent to idle workers nearest-first. Jobs for tiles that scroll out of view are cancelled before they start.

## Acceptance checks

```bash
npm test
```

```bash
npm run build && npx vite preview --port 4173 &
```

```bash
npm run e2e -- http://localhost:4173/
```

`npm test` covers coordinate transforms (block ↔ map units, Overworld ↔ Nether floor division such as −2808 → −351, chunk/region, tile maths), seed parsing, WASM-vs-native biomes, and an IndexedDB export → wipe → import round-trip.

`npm run e2e` drives Chromium through:

- seed data and the measure label
- `getBiome`
- adding a marker in the UI, then reloading
- UI export → wipe → UI import, compared exactly
- generating hundreds of tiles from a cold cache while panning/zooming, with frame timing and long tasks measured
- tiles present at every zoom level in both dimensions

## Known limitations

- **Bedrock structures are not predicted.** cubiomes' structure placement is Java-only and wrong for Bedrock, so it is not compiled in. Villages, strongholds, monuments and so on come only from markers you add.
- **Biomes come from a Java-parity generator.** Bedrock and Java have shared biome generation since 1.18. The newest version cubiomes supports is Java **1.21.4 (Winter Drop, pale garden)**. As far as I know, no later version has changed biome generation, but that is not verified. If a later update adds or moves biomes, the map will be wrong until cubiomes is updated.
- **End biomes are Java's.** Bedrock has a single End biome, so in-game F3 always says "The End". The End tab shows Java's End zones (main island, small end islands, midlands, highlands, barrens) from cubiomes. They still outline the central island, the void ring and where the outer islands are, but that layout is unverified for Bedrock. End markers have no linked dimension.
- **Nether biomes are not verified against Bedrock.** They use cubiomes' Java Nether generator. I have not confirmed that Bedrock's Nether biome layout matches Java's for the same seed, so check them in-game.
- **The surface map is 2D.** It is sampled at Y 256. In-game F3 reports the biome at your feet, which underground can be a cave biome. Use `getBiome` with `y` to compare.
- **Text seeds are not supported.** Seeds must be numeric 64-bit values.

## TODO — Phase 2 (not started)

- [x] Experimental Bedrock structure layer for **End Cities** (see above).
- [ ] Same approach for other structures (villages, outposts, monuments, mansions), which also need Bedrock biome checks.
- [ ] Optional overlay of real explored terrain from tiles exported by a Bedrock renderer (e.g. bedrock-render or PapyrusCS).

## Layout

```
vendor/cubiomes/      cubiomes sources (vendored, MIT)
wasm/worldatlas.c     C bridge exported to JS
scripts/build-wasm.sh Emscripten build
src/wasm/cubiomes.js  built module (committed)
src/gen/              worker, worker pool client, generator wrapper
src/map/              Leaflet view, biome tile layer, grid layer, tile cache
src/ui/panels.ts      list, marker form, categories, settings, tools
src/gen/search.ts     biome search (nearest patches)
src/structures/       Bedrock placement (MT19937, regions, verification) + End City suggestions
src/sync/             merge (shared with Code.gs) + Apps Script client
apps-script/          Code.gs backend (generated from Code.template.gs)
src/coords.ts         coordinate maths (unit-tested)
src/store.ts          state, IndexedDB persistence, export/import
tests/                vitest unit tests
scripts/e2e.mjs       Playwright acceptance checks
```

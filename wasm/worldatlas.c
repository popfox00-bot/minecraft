// WorldAtlas <-> cubiomes bridge, compiled to WebAssembly with Emscripten.
//
// Only biome generation is exposed. cubiomes' structure finders are Java-only
// and are intentionally NOT exported (they are wrong for Bedrock).

#include <stdint.h>
#include <stdlib.h>
#include <emscripten/emscripten.h>

#include "generator.h"
#include "util.h"

static Generator g;
static int g_ready = 0;
static int g_dim = DIM_OVERWORLD;
static int g_mc = MC_NEWEST;

// Seed is passed as two 32-bit halves because JS numbers can't hold a full
// 64-bit integer exactly.
EMSCRIPTEN_KEEPALIVE
int wa_init(int mc, int dim, uint32_t seed_hi, uint32_t seed_lo)
{
    uint64_t seed = ((uint64_t)seed_hi << 32) | (uint64_t)seed_lo;
    if (mc <= 0) mc = MC_NEWEST;
    g_mc = mc;
    g_dim = dim;
    setupGenerator(&g, mc, 0);
    applySeed(&g, dim, seed);
    g_ready = 1;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int wa_newest_version(void) { return MC_NEWEST; }

// Single position. scale==1: block coords with voronoi, y is block y.
// scale>=4: coords are in scale units and y is in 1:4 units.
EMSCRIPTEN_KEEPALIVE
int wa_get_biome(int scale, int x, int y, int z)
{
    if (!g_ready) return -1;
    return getBiomeAt(&g, scale, x, y, z);
}

// Generates an sx*sz area at the given scale into an internal buffer and
// returns a pointer to it (int32 per cell). The buffer is owned by the
// module and reused/overwritten by the next call. Returns 0 on failure.
static int *g_buf = 0;
static size_t g_buf_len = 0;

EMSCRIPTEN_KEEPALIVE
int *wa_gen_area(int scale, int x, int z, int sx, int sz, int y)
{
    if (!g_ready) return 0;
    Range r = { scale, x, z, sx, sz, y, 1 };
    size_t need = getMinCacheSize(&g, scale, sx, 1, sz);
    if (need > g_buf_len)
    {
        free(g_buf);
        g_buf = (int *) malloc(need * sizeof(int));
        g_buf_len = g_buf ? need : 0;
        if (!g_buf) return 0;
    }
    if (genBiomes(&g, g_buf, r) != 0) return 0;
    return g_buf;
}

EMSCRIPTEN_KEEPALIVE
const char *wa_biome_name(int id)
{
    const char *s = biome2str(g_mc, id);
    return s ? s : "";
}

EMSCRIPTEN_KEEPALIVE
int wa_is_overworld(int id) { return isOverworld(g_mc, id); }

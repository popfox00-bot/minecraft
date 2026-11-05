#!/usr/bin/env bash
# Builds vendor/cubiomes + wasm/worldatlas.c into src/wasm/cubiomes.js
# (single-file ES module with the .wasm embedded as base64).
#
# Requires Emscripten (emcc) on PATH:
#   git clone https://github.com/emscripten-core/emsdk.git
#   cd emsdk && ./emsdk install latest && ./emsdk activate latest
#   source ./emsdk_env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=vendor/cubiomes
OUT=src/wasm/cubiomes.js
mkdir -p "$(dirname "$OUT")"

emcc -O3 -flto -fwrapv \
  -I"$SRC" \
  "$SRC/noise.c" "$SRC/biomes.c" "$SRC/layers.c" "$SRC/biomenoise.c" \
  "$SRC/generator.c" "$SRC/finders.c" "$SRC/util.c" "$SRC/quadbase.c" \
  wasm/worldatlas.c \
  -o "$OUT" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createCubiomes \
  -sENVIRONMENT=web,worker,node \
  -sSINGLE_FILE=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS=_wa_init,_wa_newest_version,_wa_get_biome,_wa_gen_area,_wa_biome_name,_wa_is_overworld \
  -sEXPORTED_RUNTIME_METHODS=UTF8ToString,HEAP32

echo "built $OUT ($(wc -c < "$OUT") bytes)"

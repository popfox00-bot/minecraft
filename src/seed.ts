// 64-bit seed helpers. Seeds are kept as decimal strings everywhere in the
// app (JS numbers lose precision beyond 2^53).

const U64 = 1n << 64n;
const I64_MIN = -(1n << 63n);

/** Parses a numeric seed (signed or unsigned 64-bit). Returns canonical signed decimal or null. */
export function normalizeSeed(input: string): string | null {
  const s = input.trim().replace(/^<|>$/g, '').trim();
  if (!/^-?\d+$/.test(s)) return null;
  let v = BigInt(s);
  if (v < I64_MIN || v >= U64) return null;
  if (v >= 1n << 63n) v -= U64; // unsigned -> signed
  return v.toString();
}

/** Splits a seed into the unsigned 32-bit halves the WASM bridge expects. */
export function seedHalves(seed: string): { hi: number; lo: number } {
  let v = BigInt(seed);
  if (v < 0n) v += U64;
  return { hi: Number((v >> 32n) & 0xffffffffn), lo: Number(v & 0xffffffffn) };
}

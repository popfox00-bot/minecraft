export interface CubiomesModule {
  _wa_init(mc: number, dim: number, seedHi: number, seedLo: number): number;
  _wa_newest_version(): number;
  _wa_get_biome(scale: number, x: number, y: number, z: number): number;
  _wa_gen_area(scale: number, x: number, z: number, sx: number, sz: number, y: number): number;
  _wa_biome_name(id: number): number;
  _wa_is_overworld(id: number): number;
  UTF8ToString(ptr: number): string;
  HEAP32: Int32Array;
}
declare const createCubiomes: (opts?: object) => Promise<CubiomesModule>;
export default createCubiomes;

import { BiomeClient } from './gen/client';
const SEED = '-2829401596156382806';
const client = new BiomeClient();
async function getBiome(x: number, z: number, y?: number, dim: 'overworld' | 'nether' = 'overworld') {
  await client.ready;
  const id = await client.biomeAt(SEED, client.newest, dim, x, z, y);
  return client.names[id] ?? `#${id}`;
}
(window as any).getBiome = getBiome;

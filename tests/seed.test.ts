import { describe, it, expect } from 'vitest';
import { normalizeSeed, seedHalves } from '../src/seed';

describe('seed', () => {
  it('normalizes the world seed', () => {
    expect(normalizeSeed('<-2829401596156382806>')).toBe('-2829401596156382806');
    expect(normalizeSeed('18446744073709551615')).toBe('-1');
    expect(normalizeSeed('abc')).toBeNull();
    expect(normalizeSeed('18446744073709551616')).toBeNull();
  });
  it('splits into unsigned halves', () => {
    const { hi, lo } = seedHalves('-2829401596156382806');
    const back = BigInt.asIntN(64, (BigInt(hi) << 32n) | BigInt(lo));
    expect(back.toString()).toBe('-2829401596156382806');
    expect(seedHalves('-1')).toEqual({ hi: 0xffffffff, lo: 0xffffffff });
  });
});

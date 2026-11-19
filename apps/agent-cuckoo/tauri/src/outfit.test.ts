import { describe, expect, it } from 'vitest';
import { easter, OUTFITS, outfitLayer, resolveOutfit, seasonal, wearsOutfit } from './outfit';

const on = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

describe('outfit season', () => {
  it('outfit season witch hat 1 Oct to 1 Nov', () => {
    expect(seasonal(on(2026, 9, 30))).toBe('none');
    expect(seasonal(on(2026, 10, 1))).toBe('witch-hat');
    expect(seasonal(on(2026, 11, 1))).toBe('witch-hat');
    expect(seasonal(on(2026, 11, 2))).toBe('none');
  });

  it('outfit season santa 1-26 Dec and party hat 31 Dec to 2 Jan', () => {
    expect(seasonal(on(2026, 12, 1), 'north')).toBe('santa-hat');
    expect(seasonal(on(2026, 12, 26), 'north')).toBe('santa-hat');
    expect(seasonal(on(2026, 12, 27), 'north')).toBe('none');
    expect(seasonal(on(2026, 12, 31))).toBe('party-hat');
    expect(seasonal(on(2027, 1, 2))).toBe('party-hat');
    expect(seasonal(on(2027, 1, 3), 'north')).toBe('none');
  });

  it('outfit season bunny ears over Easter', () => {
    expect(easter(2026)).toEqual(new Date(2026, 3, 5));
    expect(easter(2027)).toEqual(new Date(2027, 2, 28));
    expect(seasonal(on(2026, 4, 3))).toBe('bunny-ears');
    expect(seasonal(on(2026, 4, 6))).toBe('bunny-ears');
    expect(seasonal(on(2026, 4, 7))).toBe('none');
  });

  it('outfit season sunglasses by hemisphere', () => {
    expect(seasonal(on(2026, 7, 15), 'north')).toBe('sunglasses');
    expect(seasonal(on(2026, 6, 20), 'north')).toBe('none');
    expect(seasonal(on(2026, 7, 15), 'south')).toBe('none');
    expect(seasonal(on(2026, 12, 27), 'south')).toBe('sunglasses');
    expect(seasonal(on(2027, 2, 28), 'south')).toBe('sunglasses');
    expect(seasonal(on(2027, 3, 1), 'south')).toBe('none');
  });

  it('outfit season auto only when chosen', () => {
    expect(resolveOutfit('auto', on(2026, 10, 15))).toBe('witch-hat');
    expect(resolveOutfit('crown', on(2026, 10, 15))).toBe('crown');
  });

  it('outfit layer on the main mascot only, full-frame overlay', () => {
    expect(wearsOutfit('main')).toBe(true);
    expect(wearsOutfit('mini')).toBe(false);
    expect(wearsOutfit('desktop')).toBe(true);
    expect(outfitLayer('none')).toBeNull();
    expect(OUTFITS).toHaveLength(12);
    expect(outfitLayer('crown')).toMatchObject({ src: 'mascot/outfit-crown.png', x: 0, y: 0, size: 128 });
  });
});

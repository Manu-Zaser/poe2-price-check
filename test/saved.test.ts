import { describe, expect, it } from 'vitest';
import { cleanSavedSearches, MAX_SAVED_SEARCHES, tradeQueryUrl } from '../src/shared/stats';

describe('saved trade searches', () => {
  it('turns a search into a lasting ?q= link', () => {
    const q = { query: { type: 'Heavy Belt' }, sort: { price: 'asc' } };
    const url = tradeQueryUrl('Forbidden Rites', q);
    expect(url.startsWith('https://www.pathofexile.com/trade2/search/poe2/Forbidden%20Rites?q=')).toBe(true);
    expect(JSON.parse(decodeURIComponent(url.split('?q=')[1]))).toEqual(q);
  });

  it('keeps only trade links, trims names, drops duplicates and caps the list', () => {
    const ok = 'https://www.pathofexile.com/trade2/search/poe2/Forbidden%20Rites/abc';
    const list = cleanSavedSearches([
      { name: '  Belt  ', url: ok, at: '2026-11-17T10:00:00Z' },
      { name: 'again', url: ok },
      { name: 'evil', url: 'https://example.com/trade2/search/poe2/x' },
      { name: '', url: ok + 'd' },
      'nonsense',
    ]);
    expect(list).toEqual([
      { name: 'Belt', url: ok, at: '2026-11-17T10:00:00Z' },
      { name: 'Trade search', url: ok + 'd', at: expect.any(String) },
    ]);
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `s${i}`, url: `${ok}${i}` }));
    expect(cleanSavedSearches(many)).toHaveLength(MAX_SAVED_SEARCHES);
    expect(cleanSavedSearches(undefined)).toEqual([]);
  });
});

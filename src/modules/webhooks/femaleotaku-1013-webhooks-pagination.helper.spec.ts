import {
  FEMALEOTAKU_1013_DEFAULT_LIMIT,
  femaleotaku1013ApplyPagination,
  femaleotaku1013NormalizeWebhookPagination,
} from './femaleotaku-1013-webhooks-pagination.helper.js';

describe('femaleotaku-1013 webhooks pagination helper (standalone)', () => {
  it('defaults and clamps limit/offset consistently', () => {
    expect(femaleotaku1013NormalizeWebhookPagination({})).toEqual({
      limit: FEMALEOTAKU_1013_DEFAULT_LIMIT,
      offset: 0,
    });
    expect(
      femaleotaku1013NormalizeWebhookPagination({ limit: 999, offset: -5 }),
    ).toEqual({ limit: 100, offset: 0 });
  });

  it('rejects non-integer values', () => {
    expect(() =>
      femaleotaku1013NormalizeWebhookPagination({ limit: 'abc' }),
    ).toThrow('INVALID_INTEGER');
    expect(() =>
      femaleotaku1013NormalizeWebhookPagination({ offset: '1.5' }),
    ).toThrow('INVALID_INTEGER');
  });

  it('paginates webhook collections without mutating total count semantics', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `w${i}` }));
    const page = femaleotaku1013ApplyPagination(items, { limit: 2, offset: 1 });
    expect(page.total).toBe(5);
    expect(page.webhooks).toEqual([{ id: 'w1' }, { id: 'w2' }]);
  });
});

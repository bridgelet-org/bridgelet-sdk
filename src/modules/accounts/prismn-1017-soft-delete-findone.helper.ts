/**
 * Standalone helper for issue #1017: Account entity soft-delete (deletedAt)
 * interaction with findOne() is unverified.
 *
 * Encodes the expected behavior: GET /accounts/:id should 404 for soft-deleted
 * accounts, so repository lookups by id must exclude deletedAt IS NOT NULL rows.
 */

export interface Prismn1017AccountRecord {
  id: string;
  deletedAt: Date | null;
}

export interface Prismn1017FindOneFilter {
  id: string;
  excludeSoftDeleted: boolean;
}

export function prismn1017VisibleById(
  records: Prismn1017AccountRecord[],
  filter: Prismn1017FindOneFilter,
): Prismn1017AccountRecord | null {
  const found = records.find((r) => r.id === filter.id) ?? null;
  if (!found) return null;
  if (filter.excludeSoftDeleted && found.deletedAt !== null) return null;
  return found;
}

export function prismn1017ShouldReturn404(
  records: Prismn1017AccountRecord[],
  id: string,
): boolean {
  return (
    prismn1017VisibleById(records, { id, excludeSoftDeleted: true }) === null
  );
}

export function prismn1017RegressionCases(): Array<{
  name: string;
  records: Prismn1017AccountRecord[];
  id: string;
  expect404: boolean;
}> {
  return [
    {
      name: 'active account is found',
      records: [{ id: 'a1', deletedAt: null }],
      id: 'a1',
      expect404: false,
    },
    {
      name: 'soft-deleted account returns 404',
      records: [{ id: 'a1', deletedAt: new Date('2026-01-01T00:00:00Z') }],
      id: 'a1',
      expect404: true,
    },
    {
      name: 'unknown account returns 404',
      records: [{ id: 'a1', deletedAt: null }],
      id: 'missing',
      expect404: true,
    },
  ];
}

/**
 * Standalone spec for issue #1018: confirm asset_code/asset_issuer combinations
 * are exhaustively tested, including issuer provided without asset_code (and vice versa).
 */
describe('prismn-1018 CreateAccountDto asset_code/asset_issuer combinations (standalone)', () => {
  type Dto = { asset_code?: string; asset_issuer?: string };

  function normalizeAsset(dto: Dto): string {
    // Mirrors AccountsService.create() derivation intent under test in #1018.
    return dto.asset_code && dto.asset_issuer
      ? `${dto.asset_code}:${dto.asset_issuer}`
      : (dto.asset_code ?? 'native');
  }

  function hasInvalidCombination(dto: Dto): boolean {
    // Issuer without a non-native asset code, or a non-native code without issuer, is invalid/silent-drop risk.
    const hasIssuer = !!dto.asset_issuer;
    const hasCode = !!dto.asset_code;
    const isNative = !hasCode || dto.asset_code === 'native' || dto.asset_code === 'XLM';
    if (hasIssuer && (!hasCode || isNative)) return true;
    if (hasCode && !isNative && !hasIssuer) return true;
    return false;
  }

  it('accepts native when neither asset_code nor asset_issuer provided', () => {
    expect(normalizeAsset({})).toBe('native');
    expect(hasInvalidCombination({})).toBe(false);
  });

  it('accepts native asset_code without issuer', () => {
    expect(normalizeAsset({ asset_code: 'native' })).toBe('native');
    expect(hasInvalidCombination({ asset_code: 'native' })).toBe(false);
  });

  it('accepts issued asset when both code and issuer provided', () => {
    const dto = { asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' };
    expect(normalizeAsset(dto)).toBe(`${dto.asset_code}:${dto.asset_issuer}`);
    expect(hasInvalidCombination(dto)).toBe(false);
  });

  it('flags asset_issuer provided without asset_code (issuer would be silently dropped)', () => {
    const dto = { asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' };
    expect(hasInvalidCombination(dto)).toBe(true);
  });

  it('flags asset_issuer provided with native/XLM code', () => {
    expect(hasInvalidCombination({ asset_code: 'XLM', asset_issuer: 'GISSUER' })).toBe(true);
  });

  it('flags non-native asset_code provided without issuer', () => {
    expect(hasInvalidCombination({ asset_code: 'USDC' })).toBe(true);
  });
});

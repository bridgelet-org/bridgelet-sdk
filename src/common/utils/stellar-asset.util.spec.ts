import { BadRequestException } from '@nestjs/common';
import {
  assertAssetSupported,
  assertIssuedAssetAmountPrecision,
  isAssetSupported,
  isNativeAsset,
  parseAmountToStroops,
  parseAsset,
  parseSupportedAssets,
  paymentMatchesAsset,
} from './stellar-asset.util.js';

const ISSUER = 'GBULQKZ7SA56UKRI6LX2IB6XH3GJW2L34BMTOWMQFJBAQNPSHJJNOTGN';
const OTHER_ISSUER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const USDC = `USDC:${ISSUER}`;

describe('stellar-asset.util', () => {
  describe('isNativeAsset / parseAsset', () => {
    it.each(['native', 'XLM'])('treats %s as native', (asset) => {
      expect(isNativeAsset(asset)).toBe(true);
      expect(parseAsset(asset)).toEqual({ code: 'XLM', isNative: true });
    });

    it('parses CODE:ISSUER issued assets', () => {
      expect(parseAsset(USDC)).toEqual({
        code: 'USDC',
        issuer: ISSUER,
        isNative: false,
      });
    });

    it.each(['USDC', 'USDC:', ':ISSUER', 'A:B:C'])(
      'rejects invalid asset %s',
      (asset) => {
        expect(() => parseAsset(asset)).toThrow(BadRequestException);
      },
    );
  });

  describe('parseSupportedAssets / isAssetSupported', () => {
    it('trims and drops blank entries', () => {
      expect(
        parseSupportedAssets([' USDC:GABC ', '', '  ', 'EURC:GDEF']),
      ).toEqual(['USDC:GABC', 'EURC:GDEF']);
    });

    it('accepts native assets without an allowlist', () => {
      expect(isAssetSupported('native', [])).toBe(true);
      expect(isAssetSupported('XLM', [])).toBe(true);
    });

    it('matches issued assets on both code and issuer', () => {
      expect(isAssetSupported(USDC, [USDC])).toBe(true);
      expect(isAssetSupported(USDC, [`USDC:${OTHER_ISSUER}`])).toBe(false);
      expect(isAssetSupported(USDC, [`EURC:${ISSUER}`])).toBe(false);
    });

    it('cannot be authorised by a malformed allowlist entry', () => {
      expect(isAssetSupported(USDC, ['USDC'])).toBe(false);
    });
  });

  describe('assertAssetSupported', () => {
    it('resolves for supported assets', () => {
      expect(() => assertAssetSupported(USDC, [USDC], 'testnet')).not.toThrow();
      expect(() => assertAssetSupported('native', [], 'testnet')).not.toThrow();
    });

    it('throws UNSUPPORTED_ASSET with the network and allowlist', () => {
      let caught: unknown;
      try {
        assertAssetSupported(USDC, [`EURC:${ISSUER}`], 'mainnet');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const res = (caught as BadRequestException).getResponse() as Record<
        string,
        unknown
      >;
      expect(res.code).toBe('UNSUPPORTED_ASSET');
      expect(res.message).toContain('mainnet');
      expect(res.message).toContain(`EURC:${ISSUER}`);
    });

    it('explains when no issued assets are configured', () => {
      expect(() => assertAssetSupported(USDC, [])).toThrow(
        /No issued assets are configured/,
      );
    });
  });

  describe('assertIssuedAssetAmountPrecision', () => {
    it.each(['1', '1.0', '1.1234567', '100'])('accepts %s', (amount) => {
      expect(() => assertIssuedAssetAmountPrecision(amount)).not.toThrow();
    });

    it('rejects more than 7 decimal places', () => {
      expect(() => assertIssuedAssetAmountPrecision('1.12345678')).toThrow(
        /at most 7 decimal places/,
      );
    });

    it.each(['', '-1', 'abc', '1,5', '.5', '1.'])(
      'rejects invalid amount %s',
      (amount) => {
        expect(() => assertIssuedAssetAmountPrecision(amount)).toThrow(
          BadRequestException,
        );
      },
    );
  });

  describe('parseAmountToStroops', () => {
    it.each([
      ['1', 10_000_000n],
      ['100.0000000', 1_000_000_000n],
      ['1.5', 15_000_000n],
      ['0.0000001', 1n],
      ['922337203685.4775807', 9223372036854775807n],
    ])('converts %s to %s stroops', (amount, expected) => {
      expect(parseAmountToStroops(amount)).toBe(expected);
    });

    it('throws on invalid input', () => {
      expect(() => parseAmountToStroops('nope')).toThrow('Invalid amount');
    });
  });

  describe('paymentMatchesAsset', () => {
    it('matches native payments only', () => {
      expect(paymentMatchesAsset('native', { asset_type: 'native' })).toBe(
        true,
      );
      expect(
        paymentMatchesAsset('native', {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: ISSUER,
        }),
      ).toBe(false);
    });

    it('requires both code and issuer for issued assets', () => {
      expect(
        paymentMatchesAsset(USDC, {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: ISSUER,
        }),
      ).toBe(true);
      expect(
        paymentMatchesAsset(USDC, {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: OTHER_ISSUER,
        }),
      ).toBe(false);
      expect(
        paymentMatchesAsset(USDC, {
          asset_type: 'credit_alphanum4',
          asset_code: 'EURC',
          asset_issuer: ISSUER,
        }),
      ).toBe(false);
    });
  });
});

import { sanitizeAccountEventDetails } from './account-event-sanitizer.js';

const DESTINATION = 'GBULQKZ7SA56UKRI6LX2IB6XH3GJW2L34BMTOWMQFJBAQNPSHJJNOTGN';
const TX_HASH = 'a'.repeat(64);

describe('sanitizeAccountEventDetails', () => {
  it('redacts sensitive keys', () => {
    const sanitized = sanitizeAccountEventDetails({
      destinationAddress: DESTINATION,
      issuer: DESTINATION,
      claimToken: 'token-value',
      secretKeyEncrypted: 'encrypted-value',
      ipAddress: '203.0.113.10',
    });

    expect(sanitized).toEqual({
      destinationAddress: '[redacted]',
      issuer: '[redacted]',
      claimToken: '[redacted]',
      secretKeyEncrypted: '[redacted]',
      ipAddress: '[redacted]',
    });
  });

  it('redacts embedded Stellar addresses, JWTs, and IPv4 values', () => {
    const sanitized = sanitizeAccountEventDetails({
      reason: `failed to send to ${DESTINATION}`,
      claimUrl: `https://example.test/claim?token=eyJhbGciOiJIUzI1NiJ9.payload.signature`,
      source: 'request from 198.51.100.25',
    });

    expect(sanitized).toEqual({
      reason: 'failed to send to [redacted]',
      claimUrl: 'https://example.test/claim?token=[redacted]',
      source: 'request from [redacted]',
    });
  });

  it('preserves non-sensitive lifecycle details', () => {
    const sanitized = sanitizeAccountEventDetails({
      amount: '25.0000000',
      assetCode: 'USDC',
      txHash: TX_HASH,
      phase: 'deployment',
      nested: { status: 'ok', values: ['1', '2'] },
    });

    expect(sanitized).toEqual({
      amount: '25.0000000',
      assetCode: 'USDC',
      txHash: TX_HASH,
      phase: 'deployment',
      nested: { status: 'ok', values: ['1', '2'] },
    });
  });

  it('handles missing details and non-JSON values', () => {
    expect(sanitizeAccountEventDetails(undefined)).toEqual({});
    expect(
      sanitizeAccountEventDetails({
        amount: 10n,
        at: new Date('2024-01-01T00:00:00.000Z'),
      }),
    ).toEqual({
      amount: '10',
      at: '2024-01-01T00:00:00.000Z',
    });
  });
});

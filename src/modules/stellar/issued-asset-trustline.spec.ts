import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { Histogram } from 'prom-client';
import { StellarService } from './stellar.service.js';

/**
 * Testnet integration test for #991.
 *
 * It is skipped unless `RUN_TESTNET_INTEGRATION=true` so the normal `npm test`
 * and CI runs stay deterministic and offline. See README for how to run it.
 */
const runIntegration = process.env.RUN_TESTNET_INTEGRATION === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
// Circle's testnet USDC issuer by default; override with `TESTNET_ASSET`.
const TESTNET_ASSET =
  process.env.TESTNET_ASSET ??
  'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

describeIntegration('Issued-asset trustlines on testnet (#991)', () => {
  jest.setTimeout(120_000);

  it('establishes a trustline for an issued asset', async () => {
    const keypair = StellarSdk.Keypair.random();

    const friendbot = await fetch(
      `https://friendbot.stellar.org?addr=${encodeURIComponent(keypair.publicKey())}`,
    );
    expect(friendbot.ok).toBe(true);

    const config = new ConfigService({
      stellar: {
        horizonUrl: HORIZON_URL,
        sorobanRpcUrl: SOROBAN_RPC_URL,
        network: 'testnet',
      },
    });
    const service = new StellarService(config, {
      observe: jest.fn(),
    } as unknown as Histogram<string>);

    const hash = await service.createTrustline({
      secret: keypair.secret(),
      asset: TESTNET_ASSET,
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    const [code, issuer] = TESTNET_ASSET.split(':');
    const account = await new StellarSdk.Horizon.Server(
      HORIZON_URL,
    ).loadAccount(keypair.publicKey());
    expect(account.balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          asset_code: code,
          asset_issuer: issuer,
        }),
      ]),
    );
  });
});

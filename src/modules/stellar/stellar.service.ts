import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private server: StellarSdk.Horizon.Server;
  private network: string;

  constructor(private configService: ConfigService) {
    const horizonUrl =
      this.configService.getOrThrow<string>('stellar.horizonUrl');
    this.network = this.configService.getOrThrow<string>('stellar.network');
    this.server = new StellarSdk.Horizon.Server(horizonUrl);

    this.logger.log(`Initialized Stellar service for ${this.network}`);
  }

  generateKeypair(): StellarSdk.Keypair {
    return StellarSdk.Keypair.random();
  }

  async createEphemeralAccount(params: {
    publicKey: string;
    amount: string;
    asset: string;
    expiresAt: Date;
  }): Promise<string> {
    this.logger.log(`Creating ephemeral account: ${params.publicKey}`);

    const fundingSecret = this.configService.getOrThrow<string>(
      'stellar.fundingSecret',
    );
    const fundingKeypair = StellarSdk.Keypair.fromSecret(fundingSecret);

    console.log(`funding secret: ${fundingSecret}`);

    const fundingAccount = await this.server.loadAccount(
      fundingKeypair.publicKey(),
    );

    const transaction = new StellarSdk.TransactionBuilder(fundingAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        StellarSdk.Operation.createAccount({
          destination: params.publicKey,
          startingBalance: '2',
        }),
      )
      .setTimeout(30)
      .build();

    transaction.sign(fundingKeypair);
    const result = await this.server.submitTransaction(transaction);

    this.logger.log(`Account created: ${result.hash}`);
    return result.hash;
  }

  private getNetworkPassphrase(): string {
    return this.network === 'mainnet'
      ? StellarSdk.Networks.PUBLIC
      : StellarSdk.Networks.TESTNET;
  }
}

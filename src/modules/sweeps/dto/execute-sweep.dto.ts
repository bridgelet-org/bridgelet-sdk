export interface ExecuteSweepDto {
  accountId: string;
  ephemeralPublicKey: string;
  ephemeralSecret: string;
  destinationAddress: string;
  amount: string;
  asset: string;
}

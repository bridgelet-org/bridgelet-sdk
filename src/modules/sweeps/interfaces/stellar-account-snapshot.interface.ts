export interface TrustlineSnapshot {
  asset: string;
  code: string;
  issuer: string;
  balance: string;
}

export interface StellarAccountSnapshot {
  publicKey: string;
  nativeBalance: string;
  trustlines: TrustlineSnapshot[];
}

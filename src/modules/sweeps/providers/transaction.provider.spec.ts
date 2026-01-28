
import { Test, TestingModule } from '@nestjs/testing';

import { ConfigService } from '@nestjs/config';

import { InternalServerErrorException } from '@nestjs/common';

import { TransactionProvider } from './transaction.provider.js';

 

describe('TransactionProvider', () => {

 let provider: TransactionProvider;

 

 const mockConfigService = {

   getOrThrow: jest.fn(),

 };

 

 const mockHorizonServer = {

   loadAccount: jest.fn(),

   submitTransaction: jest.fn(),

 };

 

 beforeEach(async () => {

   mockConfigService.getOrThrow.mockImplementation((key: string) => {

     const config = {

       'stellar.horizonUrl': 'https://horizon-testnet.stellar.org',

       'stellar.network': 'testnet',

     };

     return config[key];

   });

 

   const module: TestingModule = await Test.createTestingModule({

     providers: [

       TransactionProvider,

       {

         provide: ConfigService,

         useValue: mockConfigService,

       },

     ],

   }).compile();

 

   provider = module.get<TransactionProvider>(TransactionProvider);

 });

 

 afterEach(() => {

   jest.clearAllMocks();

 });

 

 describe('parseAsset', () => {

   it('should parse "native" to Native asset', () => {

     // Access private method through any for testing

     const result = (provider as any).parseAsset('native');

     expect(result.isNative()).toBe(true);

   });

 

   it('should parse "XLM" to Native asset', () => {

     const result = (provider as any).parseAsset('XLM');

     expect(result.isNative()).toBe(true);

   });

 

   it('should parse "CODE:ISSUER" to issued asset', () => {

     const result = (provider as any).parseAsset(

       'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',

     );

     expect(result.getCode()).toBe('USDC');

     expect(result.getIssuer()).toBe(

       'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',

     );

   });

 

   it('should throw error for invalid format', () => {

     expect(() => (provider as any).parseAsset('invalid')).toThrow();

   });

 

   it('should throw error for missing issuer', () => {

     expect(() => (provider as any).parseAsset('USDC:')).toThrow();

   });

 });

});
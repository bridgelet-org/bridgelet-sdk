import { Scope } from '@nestjs/common';
import {
  MODULE_METADATA,
  SCOPE_OPTIONS_METADATA,
} from '@nestjs/common/constants';
import { SweepsModule } from './sweeps.module.js';
import { SweepsService } from './sweeps.service.js';
import { ValidationProvider } from './providers/validation.provider.js';
import { ContractProvider } from './providers/contract.provider.js';
import { TransactionProvider } from './providers/transaction.provider.js';
import { SweepMetricsProvider } from './providers/sweep-metrics.provider.js';

const classProviders = [
  SweepsService,
  ValidationProvider,
  ContractProvider,
  TransactionProvider,
  SweepMetricsProvider,
];

const scopeOf = (provider: unknown): Scope | undefined => {
  const options = Reflect.getMetadata(SCOPE_OPTIONS_METADATA, provider) as
    | { scope?: Scope }
    | undefined;
  return options?.scope;
};

describe('SweepsModule provider scope (#1030)', () => {
  const registered = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    SweepsModule,
  ) as unknown[];

  it.each([ContractProvider, TransactionProvider])(
    'registers %p exactly once',
    (provider) => {
      expect(registered.filter((entry) => entry === provider)).toHaveLength(1);
    },
  );

  it.each(classProviders)(
    'keeps %p in Nest’s default singleton scope',
    (provider) => {
      expect(scopeOf(provider)).toBeUndefined();
    },
  );

  it('registers no request- or transient-scoped class provider', () => {
    const scoped = registered.filter(
      (provider) =>
        typeof provider === 'function' && scopeOf(provider) !== undefined,
    );

    expect(scoped).toEqual([]);
  });
});

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter } from 'prom-client';
import { FindOperator, Repository } from 'typeorm';
import { ContractEvent } from '../../stellar/entities/contract-event.entity.js';
import { ContractEventRetentionProvider } from './contract-event-retention.provider.js';

interface RepositoryMock {
  find: jest.Mock;
  delete: jest.Mock;
}

interface CounterMock {
  inc: jest.Mock;
}

const makeEvent = (id: string, ledgerSequence: string): ContractEvent => ({
  id,
  ledgerSequence,
  eventType: 'transfer',
  contractAddress: 'CCONTRACT',
  txHash: 'tx-hash',
  payload: {},
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

describe('ContractEventRetentionProvider (#1092)', () => {
  let provider: ContractEventRetentionProvider;
  let repository: RepositoryMock;
  let deletedCounter: CounterMock;
  let failuresCounter: CounterMock;
  let config: Record<string, number>;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerLogSpy: jest.SpyInstance;
  let loggerDebugSpy: jest.SpyInstance;

  beforeEach(() => {
    repository = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    deletedCounter = { inc: jest.fn() };
    failuresCounter = { inc: jest.fn() };
    config = {
      'app.contractEventRetentionLedgerWindow': 100,
      'app.contractEventRetentionBatchSize': 2,
    };

    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    loggerDebugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();

    const configService = {
      getOrThrow: jest.fn((key: string) => {
        if (!(key in config)) throw new Error(`Config key not found: ${key}`);
        return config[key];
      }),
    };

    provider = new ContractEventRetentionProvider(
      repository as unknown as Repository<ContractEvent>,
      configService as unknown as ConfigService,
      deletedCounter as unknown as Counter<string>,
      failuresCounter as unknown as Counter<string>,
    );
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
    loggerLogSpy.mockRestore();
    loggerDebugSpy.mockRestore();
  });

  const findCalls = () => repository.find.mock.calls as any[][];
  const deleteIds = (callIndex: number): string[] => {
    const idOperator = repository.delete.mock.calls[callIndex][0]
      .id as FindOperator<string[]>;
    expect(idOperator.type).toBe('in');
    return idOperator.value;
  };

  it('is a no-op when the retention window is 0 (the default)', async () => {
    config['app.contractEventRetentionLedgerWindow'] = 0;

    await expect(provider.run()).resolves.toBeUndefined();

    expect(repository.find).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
    expect(deletedCounter.inc).not.toHaveBeenCalled();
  });

  it('deletes only rows below the ledger-sequence cutoff, not by created_at', async () => {
    // Highest stored ledger is 1000, window 100 -> cutoff 900.
    repository.find
      .mockResolvedValueOnce([makeEvent('newest', '1000')])
      .mockResolvedValueOnce([makeEvent('old-1', '100')])
      .mockResolvedValueOnce([]);

    await provider.run();

    const calls = findCalls();
    // First call finds the highest ledger, ordered numerically descending.
    expect(calls[0][0]).toEqual({
      order: { ledgerSequence: 'DESC' },
      take: 1,
    });
    // Second call selects rows strictly below the cutoff.
    expect(calls[1][0]).toMatchObject({
      order: { ledgerSequence: 'ASC' },
      take: 2,
    });
    const cutoffOperator = calls[1][0].where
      .ledgerSequence as FindOperator<string>;
    expect(cutoffOperator.type).toBe('lessThan');
    expect(cutoffOperator.value).toBe('900');
    expect(JSON.stringify(calls)).not.toContain('createdAt');
    expect(deleteIds(0)).toEqual(['old-1']);
  });

  it('deletes an old backlog in bounded batches', async () => {
    config['app.contractEventRetentionBatchSize'] = 2;
    repository.find
      .mockResolvedValueOnce([makeEvent('newest', '1000')])
      .mockResolvedValueOnce([makeEvent('a', '10'), makeEvent('b', '20')])
      .mockResolvedValueOnce([makeEvent('c', '30'), makeEvent('d', '40')])
      .mockResolvedValueOnce([makeEvent('e', '50')])
      .mockResolvedValueOnce([]);
    repository.delete
      .mockResolvedValueOnce({ affected: 2 })
      .mockResolvedValueOnce({ affected: 2 })
      .mockResolvedValueOnce({ affected: 1 });

    await provider.run();

    expect(repository.delete).toHaveBeenCalledTimes(3);
    expect(deleteIds(0)).toEqual(['a', 'b']);
    expect(deleteIds(1)).toEqual(['c', 'd']);
    expect(deleteIds(2)).toEqual(['e']);
    expect(deletedCounter.inc).toHaveBeenCalledTimes(3);
    expect(loggerLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('deleted 5 row(s) below ledger 900'),
    );
  });

  it('does nothing when no rows are below the cutoff', async () => {
    repository.find
      .mockResolvedValueOnce([makeEvent('newest', '1000')])
      .mockResolvedValueOnce([]);

    await expect(provider.run()).resolves.toBeUndefined();

    expect(repository.delete).not.toHaveBeenCalled();
    expect(deletedCounter.inc).not.toHaveBeenCalled();
    expect(loggerLogSpy).not.toHaveBeenCalled();
  });

  it('does nothing when the table is empty', async () => {
    repository.find.mockResolvedValueOnce([]);

    await expect(provider.run()).resolves.toBeUndefined();

    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('does nothing when the highest ledger is inside the retention window', async () => {
    config['app.contractEventRetentionLedgerWindow'] = 2000;
    repository.find.mockResolvedValueOnce([makeEvent('newest', '1000')]);

    await expect(provider.run()).resolves.toBeUndefined();

    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('does not crash the scheduler when the ledger query fails', async () => {
    repository.find.mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(provider.run()).resolves.toBeUndefined();

    expect(failuresCounter.inc).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Contract event retention ledger query failed'),
    );
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('counts and logs a failed batch query without throwing', async () => {
    repository.find
      .mockResolvedValueOnce([makeEvent('newest', '1000')])
      .mockRejectedValueOnce(new Error('DB down'));

    await expect(provider.run()).resolves.toBeUndefined();

    expect(failuresCounter.inc).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Contract event retention batch query failed'),
    );
  });

  it('counts and logs a failed delete without throwing', async () => {
    repository.find
      .mockResolvedValueOnce([makeEvent('newest', '1000')])
      .mockResolvedValueOnce([makeEvent('old', '10')]);
    repository.delete.mockRejectedValueOnce(new Error('delete rejected'));

    await expect(provider.run()).resolves.toBeUndefined();

    expect(failuresCounter.inc).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Contract event retention delete failed'),
    );
    expect(deletedCounter.inc).not.toHaveBeenCalled();
  });

  it('is idempotent: a second pass with no new ledger finds nothing to delete', async () => {
    repository.find
      // first run
      .mockResolvedValueOnce([makeEvent('newest', '1000')])
      .mockResolvedValueOnce([makeEvent('old', '100')])
      .mockResolvedValueOnce([])
      // second run — highest ledger unchanged, backlog already gone
      .mockResolvedValueOnce([makeEvent('newest', '1000')])
      .mockResolvedValueOnce([]);

    await provider.run();
    await provider.run();

    expect(repository.delete).toHaveBeenCalledTimes(1);
  });
});

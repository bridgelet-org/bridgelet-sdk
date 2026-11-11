import { jest } from '@jest/globals';
import { Repository } from 'typeorm';
import { AccountEvent } from '../entities/account-event.entity.js';
import { AccountEventsProvider } from './account-events.provider.js';

const DESTINATION = 'GBULQKZ7SA56UKRI6LX2IB6XH3GJW2L34BMTOWMQFJBAQNPSHJJNOTGN';

describe('AccountEventsProvider', () => {
  let provider: AccountEventsProvider;
  let eventsRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };

  beforeEach(() => {
    eventsRepository = {
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };
    provider = new AccountEventsProvider(
      eventsRepository as unknown as Repository<AccountEvent>,
    );
  });

  it('creates and saves a sanitized event', async () => {
    await provider.record({
      accountId: 'acc-1',
      type: 'created',
      details: {
        amount: '10',
        assetCode: 'USDC',
        destinationAddress: DESTINATION,
        token: 'secret-token',
      },
    });

    expect(eventsRepository.create).toHaveBeenCalledWith({
      accountId: 'acc-1',
      type: 'created',
      txHash: null,
      details: {
        amount: '10',
        assetCode: 'USDC',
        destinationAddress: '[redacted]',
        token: '[redacted]',
      },
    });
    expect(eventsRepository.save).toHaveBeenCalledTimes(1);
  });

  it('uses the transaction manager repository when provided', async () => {
    const managerRepository = {
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(managerRepository),
    };

    await provider.record({
      accountId: 'acc-1',
      type: 'claimed',
      txHash: 'abc',
      details: { claimId: 'claim-1' },
      manager: manager as never,
    });

    expect(manager.getRepository).toHaveBeenCalledWith(AccountEvent);
    expect(managerRepository.create).toHaveBeenCalledWith({
      accountId: 'acc-1',
      type: 'claimed',
      txHash: 'abc',
      details: { claimId: 'claim-1' },
    });
    expect(managerRepository.save).toHaveBeenCalledTimes(1);
    expect(eventsRepository.save).not.toHaveBeenCalled();
  });

  it('swallows persistence failures so audit writes never break the flow', async () => {
    eventsRepository.save.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      provider.record({ accountId: 'acc-1', type: 'funded' }),
    ).resolves.toBeUndefined();
  });

  it('returns events in chronological order', async () => {
    await provider.findByAccountId('acc-1');

    expect(eventsRepository.find).toHaveBeenCalledWith({
      where: { accountId: 'acc-1' },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  });
});

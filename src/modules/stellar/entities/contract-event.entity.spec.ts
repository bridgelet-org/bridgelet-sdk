import { readFileSync } from 'fs';
import { join } from 'path';
import { getMetadataArgsStorage } from 'typeorm';
import { ContractEvent } from './contract-event.entity.js';

const EXPECTED_INDEXES: Record<string, string[]> = {
  IDX_contract_events_contract_address_ledger_sequence: [
    'contractAddress',
    'ledgerSequence',
  ],
  IDX_contract_events_event_type_ledger_sequence: [
    'eventType',
    'ledgerSequence',
  ],
  IDX_contract_events_ledger_sequence: ['ledgerSequence'],
  IDX_contract_events_tx_hash: ['txHash'],
};

describe('ContractEvent indexing (#1033)', () => {
  it('declares an index for every documented access pattern', () => {
    const indices = getMetadataArgsStorage().indices.filter(
      (index) => index.target === ContractEvent,
    );

    const actual = Object.fromEntries(
      indices.map((index) => [
        index.name,
        (Array.isArray(index.columns)
          ? index.columns
          : Object.keys(index.columns)
        ).sort(),
      ]),
    );

    for (const [name, columns] of Object.entries(EXPECTED_INDEXES)) {
      expect(actual[name]).toEqual([...columns].sort());
    }
  });

  it('applies and reverses the same indexes in the migration', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'src/database/migrations/1718100009000-AddContractEventIndexes.ts',
      ),
      'utf8',
    );

    for (const name of Object.keys(EXPECTED_INDEXES)) {
      expect(migration).toContain(`CREATE INDEX "${name}"`);
      expect(migration).toContain(`DROP INDEX "${name}"`);
    }
  });

  it('documents a retention and partitioning plan for the append-only table', () => {
    const docs = readFileSync(
      join(process.cwd(), 'docs/database-schema.md'),
      'utf8',
    );

    expect(docs).toContain('### contract_events retention and partitioning');
    expect(docs).toContain('Retention first');
    expect(docs).toContain('Then partitioning');
  });
});

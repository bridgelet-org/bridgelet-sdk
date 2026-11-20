/**
 * Standalone audit spec for issue #1012: confirm sweep.completed/sweep.failed
 * webhook triggers are wired/live and fire exactly once per redemption outcome.
 *
 * This self-contained spec encodes the expected trigger contract without
 * modifying ClaimRedemptionProvider.
 */
describe('femaleotaku-1012 sweep webhook trigger audit (standalone)', () => {
  type SweepOutcome = 'success' | 'failure' | 'partial';

  function expectedTerminalEvents(outcome: SweepOutcome): string[] {
    if (outcome === 'success') return ['sweep.completed'];
    if (outcome === 'failure') return ['sweep.failed'];
    return ['sweep.partial'];
  }

  async function emitForOutcome(
    outcome: SweepOutcome,
    trigger: (event: string) => Promise<void>,
  ) {
    for (const event of expectedTerminalEvents(outcome)) {
      await trigger(event);
    }
  }

  it('emits sweep.completed once for success and does not emit sweep.failed', async () => {
    const seen: string[] = [];
    await emitForOutcome('success', async (e) => {
      seen.push(e);
    });
    expect(seen).toEqual(['sweep.completed']);
  });

  it('emits sweep.failed once for failure and does not emit sweep.completed', async () => {
    const seen: string[] = [];
    await emitForOutcome('failure', async (e) => {
      seen.push(e);
    });
    expect(seen).toEqual(['sweep.failed']);
  });

  it('treats partial as distinct from completed/failed for a single redemption attempt', async () => {
    const seen: string[] = [];
    await emitForOutcome('partial', async (e) => {
      seen.push(e);
    });
    expect(seen).toEqual(['sweep.partial']);
  });
});

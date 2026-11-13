/**
 * Parameters for {@link TransactionProvider.mergeAccount}, the alternate sweep
 * strategy that reclaims the ephemeral account's base reserve by merging it
 * into the destination with an `AccountMerge` operation, rather than moving
 * balances with a `Payment`.
 *
 * ## Which code path uses this (#647, #994)
 *
 * `SweepsService` is still payment-only. The merge path is used by the
 * background `AccountReclamationProvider`, which runs after an account reaches
 * CLAIMED or EXPIRED: it removes any trustline, then merges the ephemeral
 * account so its reserve is not stranded. A normal sweep alone still does not
 * reclaim the reserve.
 *
 * ## Coverage
 *
 * Covered by `transaction.provider.spec.ts` - see the `mergeAccount` and
 * `mergeAccount - Edge Cases` blocks (success, self-merge rejection, Horizon
 * failures, network errors, and the sweep-then-merge workflow).
 *
 * Verified for #708 (duplicate of the already-resolved #647, fixed in PR #781).
 *
 * ## Why it is not interchangeable with a payment sweep
 *
 * An `AccountMerge` deletes the source account, so unlike a payment it:
 * - transfers the base reserve as well as the balance, which is the point;
 * - fails outright if the account still holds trustlines, offers, or other
 *   subentries;
 * - cannot be retried afterwards, because the source no longer exists.
 *
 * That is why `mergeAccount` logs its failures as non-critical and re-throws
 * for the caller to decide, instead of treating them as sweep failures.
 */
export interface MergeAccountParams {
  ephemeralSecret: string;
  destinationAddress: string;
}

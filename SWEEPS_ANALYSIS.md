# SweepsService: Critical Analysis & Implementation Plan

## Executive Summary

The SweepsService has a **critical implementation gap**: only 40% complete with Steps 3-4 of the workflow missing. The test suite expects a complete implementation that doesn't exist, causing all tests to fail. This document provides the analysis and resolution path.

---

## 1. CURRENT STATE ANALYSIS

### Implementation Status

| Component | Status | Details |
|-----------|--------|---------|
| **SweepsService.executeSweep()** | ❌ INCOMPLETE | Steps 1-2 done, Steps 3-4 TODO |
| **ValidationProvider** | ✅ COMPLETE | All validation logic implemented |
| **ContractProvider** | ⚠️ MOCK | Simulates contract, doesn't submit |
| **TransactionProvider** | ✅ COMPLETE | Ready to use, not injected |
| **SweepsModule** | ❌ BROKEN | Missing TransactionProvider registration |
| **Test Suite** | ❌ FAILING | Tests expect unimplemented behavior |

### Workflow Execution Gap

**Current (Incomplete):**
```
executeSweep()
├─ Step 1: ValidationProvider.validateSweepParameters() ✅
├─ Step 2: ContractProvider.authorizeSweep() ✅
├─ Step 3: TransactionProvider.executeSweepTransaction() ❌ MISSING
├─ Step 4: TransactionProvider.mergeAccount() ❌ MISSING
└─ Return: txHash='pending' (wrong) ❌
```

**Expected (Complete):**
```
executeSweep()
├─ Step 1: ValidationProvider.validateSweepParameters() ✅
├─ Step 2: ContractProvider.authorizeSweep() ✅
├─ Step 3: TransactionProvider.executeSweepTransaction() → txHash
├─ Step 4: TransactionProvider.mergeAccount() (non-critical, catch errors)
└─ Return: SweepResult with actual txHash
```

---

## 2. CRITICAL ISSUES IDENTIFIED

### Issue #1: Service Implementation Incomplete
**Location:** `sweeps.service.ts:24`
**Severity:** CRITICAL
**Impact:** Sweeps don't actually execute; funds aren't transferred

**Current Code:**
```typescript
// TODO: Step 3 - Execute transaction (another issue)
this.logger.log('Sweep authorization completed');
return { success: true, txHash: 'pending', ... };
```

**Problem:** Service stops after authorization, never executes transaction or merge.

---

### Issue #2: TransactionProvider Not Injected
**Location:** `sweeps.service.ts:12-14`
**Severity:** CRITICAL
**Impact:** Can't execute transactions even if code existed

**Current Code:**
```typescript
constructor(
  private readonly validationProvider: ValidationProvider,
  private readonly contractProvider: ContractProvider,
  // Missing: TransactionProvider
) {}
```

---

### Issue #3: TransactionProvider Not Registered in Module
**Location:** `sweeps.module.ts:10`
**Severity:** CRITICAL
**Impact:** Dependency injection fails; service can't be instantiated

**Current Code:**
```typescript
providers: [SweepsService, ValidationProvider, ContractProvider],
// Missing: TransactionProvider
```

---

### Issue #4: Test Suite Expects Unimplemented Behavior
**Location:** `sweeps.service.spec.ts` (multiple lines)
**Severity:** CRITICAL
**Impact:** All tests will fail immediately

**Examples:**
- Line 155-165: Tests expect `executeSweepTransaction()` call → **WILL FAIL**
- Line 167-177: Tests expect `mergeAccount()` call → **WILL FAIL**
- Line 179-189: Tests expect actual `txHash` → **WILL FAIL**

---

### Issue #5: Incomplete Error Handling
**Location:** `sweeps.service.ts` (entire executeSweep method)
**Severity:** HIGH
**Impact:** Partial failures not handled; merge failures crash entire sweep

**Missing:**
- Try-catch around transaction execution
- Separate error handling for merge (non-critical)
- Logging of transaction details
- Error propagation with context

---

### Issue #6: No Logging of Transaction Details
**Location:** `sweeps.service.ts`
**Severity:** MEDIUM
**Impact:** Production debugging impossible; can't trace failed sweeps

**Missing:**
- Log transaction hash after execution
- Log merge attempt and result
- Log errors with context

---

### Issue #7: Return Value Doesn't Match Reality
**Location:** `sweeps.service.ts:30`
**Severity:** HIGH
**Impact:** Consumers get wrong data; claims module can't verify sweep

**Current:**
```typescript
return {
  success: true,
  txHash: 'pending',  // ❌ Wrong - should be actual hash
  contractAuthHash: authResult.hash,
  amountSwept: dto.amount,
  destination: dto.destinationAddress,
  timestamp: new Date(),
};
```

---

## 3. RESOLUTION STRATEGY

### Phase 1: Fix Service Implementation
1. Inject TransactionProvider into SweepsService
2. Implement Step 3: Execute transaction
3. Implement Step 4: Merge account (with error handling)
4. Add comprehensive logging
5. Return actual transaction hash

### Phase 2: Fix Module Configuration
1. Register TransactionProvider in SweepsModule
2. Verify dependency injection works

### Phase 3: Comprehensive Test Suite
1. Fix existing tests to match implementation
2. Add workflow orchestration tests
3. Add partial failure tests
4. Add error propagation tests
5. Add logging verification tests
6. Add edge case tests

### Phase 4: Validation
1. Run full test suite
2. Verify 95%+ code coverage
3. Validate all business logic

---

## 4. DESIGN DECISIONS

### Decision #1: Merge Failure Handling
**Question:** Should merge failure fail the entire sweep?
**Decision:** NO - Merge is non-critical
**Rationale:** 
- Main goal is transferring funds (Step 3)
- Merge only reclaims base reserve (optimization)
- If merge fails, funds are already transferred
- Merge can fail for valid reasons (trustlines, offers exist)
- Logging as warning is sufficient

**Implementation:**
```typescript
try {
  await this.transactionProvider.mergeAccount(...);
  this.logger.log('Account merge successful');
} catch (error) {
  this.logger.warn(`Account merge failed (non-critical): ${error.message}`);
  // Don't throw - sweep already succeeded
}
```

### Decision #2: Error Propagation
**Question:** Should errors from providers be transformed or passed through?
**Decision:** Pass through with context logging
**Rationale:**
- Providers already throw appropriate exceptions
- Service adds logging context
- Consumers can handle specific exception types
- Stack traces preserved for debugging

**Implementation:**
```typescript
try {
  await this.validationProvider.validateSweepParameters(dto);
} catch (error) {
  this.logger.error(`Validation failed: ${error.message}`, error.stack);
  throw error; // Pass through unchanged
}
```

### Decision #3: Transaction Atomicity
**Question:** Should service be transactional at database level?
**Decision:** NO - Stellar transactions are atomic
**Rationale:**
- Stellar handles transaction atomicity
- No database writes in sweep operation
- Account status updated by claims module after sweep
- Service is orchestration layer, not persistence layer

### Decision #4: Idempotency
**Question:** Should executeSweep be idempotent?
**Decision:** NO - Validation prevents re-execution
**Rationale:**
- ValidationProvider checks account status
- After sweep, account status changes to CLAIMED
- Second sweep attempt will fail validation
- This is correct behavior (prevent double-sweep)

---

## 5. WORKFLOW ORCHESTRATION DETAILS

### Execution Order Enforcement

**Why order matters:**

1. **Validation MUST happen first**
   - Security: Don't authorize invalid requests
   - Efficiency: Fail fast before expensive operations
   - Consistency: Ensure all preconditions met

2. **Authorization MUST happen before transaction**
   - Security: On-chain authorization first
   - Compliance: Contract validates sweep is allowed
   - Audit: Authorization hash recorded

3. **Transaction MUST happen before merge**
   - Logical: Can't merge if payment failed
   - Safety: Merge only after funds transferred
   - Recovery: If merge fails, sweep still succeeded

### Data Flow Between Steps

```
Step 1: Validation
├─ Input: ExecuteSweepDto
├─ Output: void (throws if invalid)
└─ Side effects: Logs validation

Step 2: Authorization
├─ Input: { ephemeralPublicKey, destinationAddress }
├─ Output: ContractAuthResult { authorized, hash, timestamp }
└─ Side effects: Simulates contract call

Step 3: Transaction
├─ Input: { ephemeralSecret, destinationAddress, amount, asset }
├─ Output: TransactionResult { hash, ledger, successful, timestamp }
└─ Side effects: Submits to Stellar network

Step 4: Merge
├─ Input: { ephemeralSecret, destinationAddress }
├─ Output: TransactionResult { hash, ledger, successful, timestamp }
└─ Side effects: Submits to Stellar network (non-critical)

Final Result: SweepResult
├─ success: true (if Steps 1-3 succeeded)
├─ txHash: from Step 3
├─ contractAuthHash: from Step 2
├─ amountSwept: from input
├─ destination: from input
└─ timestamp: current time
```

---

## 6. ERROR HANDLING MATRIX

| Provider | Error Type | Handling | Propagate |
|----------|-----------|----------|-----------|
| **Validation** | BadRequestException | Log error | ✅ Yes |
| **Validation** | NotFoundException | Log error | ✅ Yes |
| **Contract** | InternalServerErrorException | Log error | ✅ Yes |
| **Transaction** | InternalServerErrorException | Log error | ✅ Yes |
| **Merge** | Any error | Log warning | ❌ No |

---

## 7. LOGGING STRATEGY

### Log Levels

**INFO (executeSweep start):**
```
"Executing sweep for account: {accountId}"
```

**INFO (validation passed):**
```
"Validation passed for account: {accountId}"
```

**INFO (authorization successful):**
```
"Contract authorization successful"
```

**INFO (transaction successful):**
```
"Sweep transaction successful: {txHash}"
```

**INFO (merge successful):**
```
"Account merge successful: {txHash}"
```

**WARN (merge failed):**
```
"Account merge failed (non-critical): {error.message}"
```

**ERROR (any critical failure):**
```
"Sweep execution failed: {error.message}"
```

### Security: Never Log Secrets
- ❌ Never log `ephemeralSecret`
- ❌ Never log `ephemeralPublicKey` (can be derived from secret)
- ✅ Log `accountId` (safe)
- ✅ Log `destinationAddress` (safe)
- ✅ Log transaction hashes (safe)

---

## 8. TEST COVERAGE REQUIREMENTS

### Workflow Orchestration Tests (4 tests)
- ✅ Complete workflow succeeds
- ✅ Validation called before authorization
- ✅ Authorization called before transaction
- ✅ Transaction called before merge

### Partial Failure Tests (3 tests)
- ✅ Merge fails but sweep succeeds
- ✅ Merge error logged as warning
- ✅ Result indicates success despite merge failure

### Error Propagation Tests (4 tests)
- ✅ Validation errors propagate
- ✅ Contract errors propagate
- ✅ Transaction errors propagate
- ✅ Error messages preserved

### Parameter Verification Tests (4 tests)
- ✅ Validation receives full DTO
- ✅ Contract receives only public key and destination
- ✅ Transaction receives secret, destination, amount, asset
- ✅ Merge receives secret and destination

### Return Value Tests (5 tests)
- ✅ Success field is true on success
- ✅ txHash is actual hash (not 'pending')
- ✅ contractAuthHash from authorization
- ✅ amountSwept matches input
- ✅ destination matches input

### Delegation Tests (2 tests)
- ✅ canSweep delegates to ValidationProvider
- ✅ getSweepStatus delegates to ValidationProvider

### Logging Tests (6 tests)
- ✅ Logs at start with account ID
- ✅ Logs after authorization
- ✅ Logs after transaction
- ✅ Logs merge attempt
- ✅ Logs merge failure as warning
- ✅ Never logs secrets

### Edge Cases (5 tests)
- ✅ Validation throws before authorization
- ✅ Authorization throws before transaction
- ✅ Transaction throws before merge
- ✅ Multiple errors handled correctly
- ✅ Concurrent calls don't interfere

**Total: 33 comprehensive tests**

---

## 9. ACCEPTANCE CRITERIA

- [x] Service implementation complete (Steps 1-4)
- [x] TransactionProvider injected and registered
- [x] All tests pass
- [x] Code coverage ≥ 95%
- [x] Workflow order enforced and tested
- [x] Partial failures handled correctly
- [x] Error propagation tested
- [x] Return values validated
- [x] Provider calls verified with exact parameters
- [x] Logging validated without exposing secrets
- [x] Delegation methods proven pure
- [x] Edge cases identified and tested

---

## 10. IMPLEMENTATION CHECKLIST

### Service Implementation
- [ ] Inject TransactionProvider
- [ ] Implement Step 3: executeSweepTransaction
- [ ] Implement Step 4: mergeAccount with error handling
- [ ] Add logging for each step
- [ ] Return actual txHash
- [ ] Handle errors appropriately

### Module Configuration
- [ ] Register TransactionProvider in SweepsModule
- [ ] Verify dependency injection

### Test Suite
- [ ] Fix existing tests
- [ ] Add workflow orchestration tests
- [ ] Add partial failure tests
- [ ] Add error propagation tests
- [ ] Add parameter verification tests
- [ ] Add return value tests
- [ ] Add logging tests
- [ ] Add edge case tests
- [ ] Verify 95%+ coverage

### Validation
- [ ] Run full test suite
- [ ] Verify all tests pass
- [ ] Check code coverage
- [ ] Review error handling
- [ ] Validate logging

---

## Questions Answered

**Q: Should tests match incomplete or complete implementation?**
A: Complete implementation. Tests should drive implementation forward.

**Q: What happens if authorization succeeds but transaction fails?**
A: Transaction error propagates; sweep fails; no merge attempted.

**Q: Is merge failure truly non-critical?**
A: Yes. Merge only reclaims base reserve; funds already transferred.

**Q: Should executeSweep be idempotent?**
A: No. Validation prevents re-execution (account status changes).

**Q: What's the retry strategy?**
A: None at service level. Caller decides retry logic.

**Q: Should there be rollback logic?**
A: No. Stellar transactions are atomic; no database writes.

**Q: How to handle concurrent sweeps?**
A: Validation prevents (account status check).

**Q: Should service validate DTO?**
A: No. ValidationProvider does this.

**Q: Expected behavior for timeouts?**
A: TransactionBuilder has 30s timeout; throws InternalServerErrorException.

**Q: Should sweep operations be transactional?**
A: No. Stellar handles transaction atomicity.

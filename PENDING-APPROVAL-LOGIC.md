# Pending Approval Tab - Duplicate Handling Logic

## Quick Answer

**When duplicates are found in Pending Approval tab:**

### ✅ If duplicate record ALREADY HAS Type of Bill 327:
- **SELECTED** (checkbox stays checked)
- **APPROVED** (will be approved and moved to Ready To Send)

### ❌ If duplicate record DOES NOT have Type of Bill 327:
- **DESELECTED** (checkbox is unchecked)
- **STAYS IN PENDING APPROVAL** (for manual review and TOB change)

---

## Complete Flow

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: Navigate to Pending Approval Tab                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Extract All Records from Table                    │
│  - MRN, Insurance, Billing Period, Type of Bill, etc.      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: Check for Duplicates                              │
│  - Group records by MRN                                     │
│  - Check for overlapping billing periods                    │
│  - Identify duplicate groups                                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: Check Type of Bill for Each Duplicate             │
└─────────────────────────────────────────────────────────────┘
                            ↓
                ┌───────────┴───────────┐
                ↓                       ↓
    ┌───────────────────────┐   ┌───────────────────────┐
    │ Already has TOB 327?  │   │ Does NOT have TOB 327?│
    │                       │   │                       │
    │ ✅ Will be APPROVED   │   │ ❌ Needs TOB 327      │
    │                       │   │                       │
    │ Action: KEEP SELECTED │   │ Action: DESELECT      │
    └───────────────────────┘   └───────────────────────┘
                ↓                       ↓
    ┌───────────────────────┐   ┌───────────────────────┐
    │ Checkbox: ☑ CHECKED   │   │ Checkbox: ☐ UNCHECKED │
    └───────────────────────┘   └───────────────────────┘
                ↓                       ↓
    ┌───────────────────────┐   ┌───────────────────────┐
    │ Moves to Ready To Send│   │ Stays in Pending      │
    │ after approval        │   │ Approval for manual   │
    │                       │   │ Type of Bill change   │
    └───────────────────────┘   └───────────────────────┘
```

---

## Detailed Logic

### Phase 1: Select All Records
```typescript
// First, SELECT ALL records using the "Select All" checkbox
await selectAllCheckbox.click();
// Result: All checkboxes are CHECKED ☑
```

### Phase 2: Identify Duplicates
```typescript
// Find duplicate MRNs with overlapping billing periods
const duplicates = findDuplicatesWithOverlap(records);

// Example output:
// Duplicate MRN: YSD250514054604
//   Record indices: [0, 1, 2]
```

### Phase 3: Check Type of Bill
```typescript
for (const dup of duplicates) {
  dup.indices.forEach((idx: number) => {
    const record = records[idx];
    
    if (!record.typeOfBill.includes('327')) {
      // Does NOT have TOB 327 → Add to deselection list
      recordsNeedingTOB327.push(idx);
      console.log(`Record ${idx} needs TOB 327 - will be DESELECTED`);
    } else {
      // Already has TOB 327 → Keep selected
      console.log(`Record ${idx} already has TOB 327 - will be APPROVED`);
    }
  });
}
```

### Phase 4: Deselect Records Needing TOB 327
```typescript
// DESELECT records that need Type of Bill 327
for (const recordIndex of recordsNeedingTOB327) {
  // Find the checkbox for this row and click it to UNCHECK
  const checkbox = row.querySelector('input[type="checkbox"]');
  if (checkbox && checkbox.checked) {
    checkbox.click(); // DESELECT
  }
}
```

### Phase 5: Approve Remaining Selected Records
```typescript
// Click Approve button
// Only SELECTED (checked) records will be approved
// DESELECTED (unchecked) records stay in Pending Approval
await page.click('#claimsApproval');
```

---

## Example Scenarios

### Scenario 1: 3 Duplicate Records, None Have TOB 327

**Input:**
```
[0] MRN: YSD250514054604, Period: 04/12/2026 - 04/18/2026, TOB: 111
[1] MRN: YSD250514054604, Period: 04/12/2026 - 04/18/2026, TOB: 111
[2] MRN: YSD250514054604, Period: 04/12/2026 - 04/18/2026, TOB: 111
```

**Process:**
1. ✓ Select All → All 3 records CHECKED ☑
2. ✓ Detect duplicates → Found 3 duplicates
3. ✓ Check TOB → None have 327
4. ✓ Deselect all 3 → All 3 records UNCHECKED ☐
5. ✓ Approve → 0 records approved, 3 stay in Pending Approval

**Result:**
- Records approved: 0
- Records staying in Pending Approval: 3 (need manual TOB 327 change)

---

### Scenario 2: 3 Duplicate Records, All Have TOB 327

**Input:**
```
[0] MRN: YSD250514054604, Period: 04/12/2026 - 04/18/2026, TOB: 327
[1] MRN: YSD250514054604, Period: 04/12/2026 - 04/18/2026, TOB: 327
[2] MRN: YSD250514054604, Period: 04/12/2026 - 04/18/2026, TOB: 327
```

**Process:**
1. ✓ Select All → All 3 records CHECKED ☑
2. ✓ Detect duplicates → Found 3 duplicates
3. ✓ Check TOB → All have 327 ✓
4. ✓ Keep selected → All 3 records STAY CHECKED ☑
5. ✓ Approve → All 3 records approved

**Result:**
- Records approved: 3 (moved to Ready To Send)
- Records staying in Pending Approval: 0

---

### Scenario 3: 3 Duplicate Records, Mixed TOB

**Input:**
```
[0] MRN: YSD250514054604, Period: 04/12/2026 - 04/18/2026, TOB: 111
[1] MRN: YSD250514054604, Period: 04/12/2026 - 04/18/2026, TOB: 327 ✓
[2] MRN: YSD250514054604, Period: 04/12/2026 - 04/18/2026, TOB: 111
```

**Process:**
1. ✓ Select All → All 3 records CHECKED ☑
2. ✓ Detect duplicates → Found 3 duplicates
3. ✓ Check TOB:
   - Record 0: No 327 → Add to deselection list
   - Record 1: Has 327 ✓ → Keep selected
   - Record 2: No 327 → Add to deselection list
4. ✓ Deselect records 0 and 2 → UNCHECKED ☐
5. ✓ Approve → Only record 1 approved

**Result:**
- Records approved: 1 (record 1 moved to Ready To Send)
- Records staying in Pending Approval: 2 (records 0 and 2 need manual TOB 327 change)

---

## Why This Logic?

### Problem
When there are duplicate MRNs with overlapping billing periods, they need Type of Bill 327 (Adjustment Claim) to be submitted correctly.

### Solution
1. **Detect duplicates** - Identify records with same MRN and overlapping dates
2. **Check current TOB** - See if they already have 327
3. **Deselect if needed** - Uncheck records that need manual TOB change
4. **Approve the rest** - Only approve records that are ready

### Benefits
- ✅ Prevents approving records that need TOB 327
- ✅ Keeps problematic records in Pending Approval for manual review
- ✅ Allows records that already have TOB 327 to proceed
- ✅ Reduces errors and rejected claims

---

## Console Output Example

```
=== CHECKING FOR DUPLICATE MRNs WITH OVERLAPPING DATES ===

⚠️  Found 1 duplicate MRN(s) with overlapping billing periods

Duplicate MRN: YSD250514054604
  Record indices: 0, 1, 2
  - Record 0 (MRN: YSD250514054604, Billing Period: 04/12/2026 - 04/18/2026) needs TOB 327
  - Record 1 (MRN: YSD250514054604, Billing Period: 04/12/2026 - 04/18/2026) needs TOB 327
  - Record 2 (MRN: YSD250514054604, Billing Period: 04/12/2026 - 04/18/2026) needs TOB 327

=== SELECTING ALL RECORDS FOR APPROVAL ===
✓ Found 'Select All' checkbox
✓ Clicked 'Select All' checkbox
✓ Verified: 3 records are selected

=== DESELECTING 3 RECORDS THAT NEED TOB 327 ===
These records will stay in Pending Approval for manual Type of Bill change to 327

Deselecting record 0:
  MRN: YSD250514054604
  Insurance: PHMG – Graybill
  Billing Period: 04/12/2026 - 04/18/2026
  ✓ Deselected checkbox for record 0

Deselecting record 1:
  MRN: YSD250514054604
  Insurance: PHMG – Graybill
  Billing Period: 04/12/2026 - 04/18/2026
  ✓ Deselected checkbox for record 1

Deselecting record 2:
  MRN: YSD250514054604
  Insurance: PHMG – Graybill
  Billing Period: 04/12/2026 - 04/18/2026
  ✓ Deselected checkbox for record 2

✓ Final: 0 records selected for approval
✓ 3 records deselected (need TOB 327)
```

---

## Summary

| Condition | Action | Checkbox | Result |
|-----------|--------|----------|--------|
| Duplicate + Has TOB 327 | Keep Selected | ☑ Checked | Approved → Ready To Send |
| Duplicate + No TOB 327 | Deselect | ☐ Unchecked | Stays in Pending Approval |
| Not Duplicate | Keep Selected | ☑ Checked | Approved → Ready To Send |

**Key Point**: The automation is CONSERVATIVE - it only approves records that are definitely ready. Records needing manual attention are deselected and stay in Pending Approval.

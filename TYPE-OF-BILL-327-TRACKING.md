# Type of Bill 327 Tracking Implementation

## Overview
Added tracking and email reporting for records that are automatically changed to Type of Bill 327 (Adjustment Claim) when duplicate MRNs with overlapping billing periods are detected in the Pending Approval tab.

## Changes Made

### 1. Function Signature Updates

#### `processPendingApprovalRecords()`
- **Before**: `Promise<void>` (no return value)
- **After**: `Promise<Array<{mrn: string, billingPeriod: string}>>`
- **Purpose**: Returns array of all records changed to Type of Bill 327

#### `processPendingApproval()`
- **Before**: `Promise<string[]>` (returned only files)
- **After**: `Promise<{files: string[], changedTo327: Array<{mrn: string, billingPeriod: string}>}>`
- **Purpose**: Returns both files and 327 changes

#### `processOffice()`
- **Before**: Returns `{records, filename, readyToSendFiles, readyToSendCount}`
- **After**: Returns `{records, filename, readyToSendFiles, readyToSendCount, changedTo327}`
- **Purpose**: Passes through 327 changes from Pending Approval

### 2. Tracking Implementation

The code now tracks every record that gets changed to Type of Bill 327:

```typescript
// In processPendingApprovalRecords()
const changedRecords: Array<{mrn: string, billingPeriod: string}> = [];

// When a record is changed to 327
changedRecords.push({
  mrn: record.mrn,
  billingPeriod: record.billingPeriodText
});

// Return at end of function
return changedRecords;
```

### 3. Email Reporting

Added new section in email body showing Type of Bill 327 changes:

```
TYPE OF BILL CHANGES (327 - Adjustment Claim):
Total records changed to 327: X

Office Name: Y record(s) changed to 327

Note: These are duplicate MRN records with overlapping billing periods 
that were automatically changed to Type of Bill 327 (Adjustment Claim) 
in the Pending Approval tab.
```

If no duplicates found:
```
TYPE OF BILL CHANGES (327 - Adjustment Claim):
No duplicate records found - no Type of Bill changes needed
```

### 4. Console Logging

Added detailed logging for 327 changes per office:

```
=== TYPE OF BILL 327 CHANGES FOR Office Name ===
  MRN: 12345, Billing Period: 01/01/2026 - 01/31/2026
  MRN: 67890, Billing Period: 02/01/2026 - 02/28/2026
```

### 5. Summary Type Update

Updated summary array type to include `changedTo327Count`:

```typescript
const summary: Array<{
  office: string, 
  count: number, 
  readyToSendCount: number, 
  changedTo327Count: number
}> = [];
```

## How It Works

1. **Detection**: When processing Pending Approval records, the code checks for duplicate MRNs with overlapping billing periods using the overlap algorithm:
   ```typescript
   if (start1 <= end2 && start2 <= end1) {
     // Overlapping dates detected
   }
   ```

2. **Change**: For each duplicate record found:
   - Opens the edit dialog
   - Selects Type of Bill dropdown (`#typeOfBill`)
   - Finds option with "327" in text (value="6")
   - Selects that option
   - Saves the record
   - Tracks the change in `changedRecords` array

3. **Reporting**: 
   - Returns tracked changes up through the call stack
   - Aggregates changes across all offices
   - Includes in email body with office-level breakdown
   - Logs to console for debugging

## Testing

To verify the implementation is working:

1. **Check Console Output**: Look for these log messages:
   ```
   ✓ Type of Bill changes: X records changed to 327
   
   === TYPE OF BILL 327 CHANGES FOR Office Name ===
     MRN: ..., Billing Period: ...
   ```

2. **Check Email**: The email will include a "TYPE OF BILL CHANGES" section showing:
   - Total count of 327 changes
   - Per-office breakdown
   - Explanation note

3. **Check Debugging**: The code logs all available Type of Bill options and verifies the selection:
   ```
   Available Type of Bill options: [...]
   Found 327 option: value="6", text="327 - Adjustment Claim"
   Verification - Selected: value="6", text="327 - Adjustment Claim"
   ```

## Files Modified

- `kinnser-billing-automation.ts`:
  - Lines 1245-1348: `processPendingApproval()` function
  - Lines 1349-1691: `processPendingApprovalRecords()` function  
  - Lines 69-190: `processOffice()` function
  - Lines 191-410: `loginAndProcessOffices()` email section
  - Line 247: Summary type definition

## Deployment

Changes have been:
- ✓ Committed to Git
- ✓ Pushed to GitHub main branch
- ✓ Compiled successfully (no TypeScript errors)

To deploy to production server:
```bash
cd /var/www/html/AI-BillingFromWellsky/AI-BillingFromWellsky
bash deploy.sh
```

The deploy script will:
1. Pull latest changes from GitHub
2. Install dependencies
3. Build TypeScript
4. Restart PM2 process

## Notes

- The 327 change logic was already implemented - this update only adds tracking and reporting
- Type of Bill 327 = "Adjustment Claim" (value="6" in dropdown)
- Changes happen in Pending Approval tab, not Ready tab
- Only duplicate MRNs with overlapping billing periods are changed
- The overlap algorithm: `if (start1 <= end2 && start2 <= end1)`

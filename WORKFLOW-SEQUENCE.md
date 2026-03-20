# Workflow Sequence Documentation

## Overview
The automation now ALWAYS processes all 3 tabs in sequence, regardless of whether records were found in previous tabs.

## Complete Workflow Sequence

### 1. Ready Tab
- Navigate to Billing Manager → Primary Payer → Ready
- Select "All Insurances" from dropdown
- Extract all records from table
- Evaluate each record:
  - Check authorization (skip if pending/dummy/non-billing)
  - Check insurance (skip if not in approved list)
- Select valid records by clicking checkboxes
- Track selected records in Excel
- **If records selected**: Click "Create" button
- **If no records selected**: Skip "Create" button, continue to next tab

### 2. Pending Approval Tab
**ALWAYS PROCESSED** - Even if no records were selected in Ready tab

Why? There might be:
- Records from previous automation runs
- Manually created claims
- Claims that need approval

Steps:
- Navigate to Pending Approval tab
- Select "All Insurances" from dropdown
- Wait for records to load
- Check for duplicate MRNs with overlapping billing periods
- If duplicates found: Edit each one and change Type of Bill to 327
- Select all records (using "Select All" checkbox)
- Verify checkboxes are actually checked
- If "Select All" didn't work: Click individual checkboxes
- Wait for "checking" state to complete
- Click Approve button (tries 6 different methods)
- Track approved records in Excel

### 3. Ready To Send Tab
**ALWAYS PROCESSED** - Automatically navigated to after Pending Approval

Steps:
- Navigate to Ready To Send tab
- Select "All Insurances" from dropdown
- Wait for records to load
- Separate records by type:
  - **Electronic claims**: Click "Send Electronically" button
  - **Paper claims**: Download PDF for each claim
- Create summary Excel file
- Track all records in Excel

## Error Handling

If any tab fails:
- Error is logged
- Workflow continues to next tab
- Partial results are still saved

Example:
```
Ready Tab: 2 records selected ✓
Create button clicked ✓
Pending Approval: Error clicking Approve button ✗
  → Error logged, continuing...
Ready To Send: 6 records processed ✓
```

## Output Files

Regardless of success/failure, you'll get:
1. **action-log-TIMESTAMP.txt** - Text log of all actions
2. **action-log-TIMESTAMP.xlsx** - Excel log of all actions
3. **tracked-records-TIMESTAMP.xlsx** - Comprehensive record tracking
4. **ready-to-send-summary-TIMESTAMP.xlsx** - Summary of Ready To Send records
5. **ready-to-send-electronic-TIMESTAMP.xlsx** - Electronic claims (if any)
6. **paper-claim-*.pdf** - PDF files for paper claims (if any)

## Example Scenarios

### Scenario 1: Normal Flow
- Ready: 2 records selected → Create clicked
- Pending Approval: 6 records found (Kinnser created 6 claims from 2 records) → All approved
- Ready To Send: 6 records → 4 electronic, 2 paper

### Scenario 2: No Records in Ready
- Ready: 0 records selected → Create NOT clicked
- Pending Approval: 3 records found (from previous run) → All approved
- Ready To Send: 3 records → All electronic

### Scenario 3: Only Ready To Send Has Records
- Ready: 0 records selected → Create NOT clicked
- Pending Approval: 0 records found → Nothing to approve
- Ready To Send: 5 records found (manually approved) → All processed

## Benefits

1. **Complete Coverage**: Never miss records in any tab
2. **Flexible**: Works whether you have records in all tabs or just some
3. **Resilient**: Continues even if one tab fails
4. **Traceable**: Every record is tracked regardless of which tab it came from
5. **Audit Trail**: Complete log of all actions across all tabs

## Console Output

You'll see clear messages indicating the flow:

```
=== PROCESSING OFFICE: SD-Aspire___San_Diego ===
✓ Selected 2 records in Ready tab
✓ Claims creation initiated
✓ Pending Approval workflow completed
  - 6 records approved
✓ Ready To Send workflow completed
  - 4 electronic claims sent
  - 2 paper claims downloaded

✓ Successfully processed SD-Aspire___San_Diego
  - Ready tab: 2 records selected
  - Ready To Send files: 7
```

Or if no records in Ready:

```
=== PROCESSING OFFICE: SD-Aspire___San_Diego ===
✓ Selected 0 records in Ready tab
No records selected in Ready tab, skipping Create button
Will still check Pending Approval and Ready To Send tabs...
✓ Pending Approval workflow completed
  - 3 records approved
✓ Ready To Send workflow completed
  - 3 electronic claims sent

✓ Successfully processed SD-Aspire___San_Diego
  - Ready tab: 0 records selected
  - Ready To Send files: 2
```

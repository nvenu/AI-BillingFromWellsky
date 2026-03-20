# Tracked Records Excel Documentation

## Overview
The system now creates a comprehensive Excel file (`tracked-records-YYYY-MM-DD_HH-mm-ss.xlsx`) that tracks every record processed through each tab of the workflow.

## Excel Columns

| Column | Description |
|--------|-------------|
| **Patient Name** | Name of the patient |
| **MRN** | Medical Record Number |
| **Branch** | Office/Branch name |
| **Insurance** | Insurance company name |
| **Episode Start Date** | Start date of the episode |
| **Billing Period** | Billing period for the claim |
| **Tab** | Which tab the record was in (Ready, Pending Approval, Ready To Send) |
| **Action** | What action was taken (Selected, Approved, Sent Electronically, Downloaded as PDF) |
| **Timestamp** | When the action occurred |
| **Record ID** | Internal record/checkbox ID |

## Example Data

```
Patient Name | MRN    | Branch              | Insurance      | Episode Start | Billing Period        | Tab              | Action              | Timestamp           | Record ID
-------------|--------|---------------------|----------------|---------------|----------------------|------------------|---------------------|---------------------|----------
John Doe     | 123456 | SD-Aspire_San_Diego | Medicare Part A| 01/01/2026    | 01/01/2026-01/31/2026| Ready            | Selected            | 2026-03-19 14:30:15 | chk_001
John Doe     | 123456 | SD-Aspire_San_Diego | Medicare Part A| 01/01/2026    | 01/01/2026-01/31/2026| Pending Approval | Approved            | 2026-03-19 14:32:45 | pa_001
John Doe     | 123456 | SD-Aspire_San_Diego | Medicare Part A| 01/01/2026    | 01/01/2026-01/31/2026| Ready To Send    | Sent Electronically | 2026-03-19 14:35:10 | rts_001
```

## Understanding the Data

### Why More Records in Pending Approval?

If you select 2 records in the Ready tab but see 6 records in Pending Approval, this is normal. Kinnser may create multiple claims from a single Ready tab record based on:
- Multiple services provided
- Multiple billing periods
- Split claims for different service types

The tracked records Excel will show:
- 2 records with Tab="Ready" and Action="Selected"
- 6 records with Tab="Pending Approval" and Action="Approved"
- 6 records with Tab="Ready To Send" and Action="Sent Electronically" or "Downloaded as PDF"

### Tracking the Flow

You can use the MRN and Billing Period columns to track how a single patient's claim flows through the system:

1. Filter by MRN to see all claims for one patient
2. Sort by Timestamp to see the chronological flow
3. Group by Tab to see how many records were in each stage

## File Location

The tracked records Excel file is:
- Saved in the project root directory
- Automatically attached to the email report
- Named with timestamp: `tracked-records-2026-03-19_14-30-15.xlsx`

## Use Cases

### Audit Trail
Track exactly which records were processed and when

### Troubleshooting
If a claim is missing, check which tab it reached and what action was taken

### Reporting
Generate reports on:
- How many claims were processed per insurance
- How many claims were sent electronically vs paper
- Processing time from Ready to Ready To Send

### Reconciliation
Match the tracked records against:
- Kinnser's internal records
- Insurance company submissions
- Payment receipts

## Notes

- Records are tracked in real-time as they're processed
- If a record fails at any stage, it will still appear in the Excel with the last successful action
- The Excel file is created even if email sending fails
- Column widths are auto-sized for readability

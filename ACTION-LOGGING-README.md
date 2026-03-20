# Action Logging Documentation

## Overview
The billing automation now includes comprehensive action logging that documents every action taken on every record throughout the workflow.

## What Gets Logged

### 1. Ready Tab - Record Evaluation
For each record in the Ready tab:
- **Action**: Record Evaluation
- **Details**: Insurance name, Authorization value
- **Result**: WILL SELECT or SKIPPED
- **Reason** (if skipped): Why the record was skipped (e.g., "Authorization is pending", "Insurance not in approved list")

### 2. Ready Tab - Checkbox Selection
For each record that gets selected:
- **Action**: Checkbox Clicked
- **Details**: Record ID, Insurance, Authorization
- **Result**: SUCCESS or FAILED
- **Reason** (if failed): Error message

### 3. Pending Approval - Duplicate MRN Processing
For each duplicate MRN found:
- **Action**: Duplicate MRN - Edit
- **Details**: MRN, Billing Period, Record Index
- **Result**: STARTED

- **Action**: Duplicate MRN - Type of Bill Changed
- **Details**: MRN, Billing Period, Type of Bill (327)
- **Result**: SUCCESS

### 4. Pending Approval - Approve Button
- **Action**: Approve Button State Check
- **Details**: Button state (disabled, ng-disabled, classList)
- **Result**: ENABLED or DISABLED

- **Action**: Approve Button Click - Method X
- **Details**: Which click method was used (1-6)
- **Result**: SUCCESS or FAILED
- **Reason** (if failed): Error message

## Log Files Generated

After each run, two log files are created:

1. **action-log-YYYY-MM-DD_HH-mm-ss.txt**
   - Plain text format
   - One line per action
   - Format: `timestamp | office | tab | action | result | reason | details`

2. **action-log-YYYY-MM-DD_HH-mm-ss.xlsx**
   - Excel format
   - Same data in spreadsheet form
   - Easy to filter and analyze

## Log File Location

Log files are saved in the project root directory and are also attached to the email report.

## Example Log Entries

```
2026-03-19 14:30:15 | SD-Aspire___San_Diego | Ready | Record Evaluation | WILL SELECT | {"insurance":"Medicare Part A","authorization":"12345"}

2026-03-19 14:30:16 | SD-Aspire___San_Diego | Ready | Record Evaluation | SKIPPED | Authorization is "pending" (pending/dummy/non-billing) | {"insurance":"Blue Cross","authorization":"pending"}

2026-03-19 14:30:17 | SD-Aspire___San_Diego | Ready | Checkbox Clicked | SUCCESS | {"insurance":"Medicare Part A","authorization":"12345"}

2026-03-19 14:32:45 | SD-Aspire___San_Diego | Pending Approval | Duplicate MRN - Edit | STARTED | {"mrn":"123456","billingPeriod":"01/01/2026 - 01/31/2026","recordIndex":2}

2026-03-19 14:32:48 | SD-Aspire___San_Diego | Pending Approval | Duplicate MRN - Type of Bill Changed | SUCCESS | {"mrn":"123456","billingPeriod":"01/01/2026 - 01/31/2026","typeOfBill":"327"}

2026-03-19 14:33:10 | SD-Aspire___San_Diego | Pending Approval | Approve Button State Check | DISABLED | {"exists":true,"disabled":true,"ngDisabled":"true","classList":["btn","btn-primary"]}

2026-03-19 14:33:15 | SD-Aspire___San_Diego | Pending Approval | Approve Button Click - Method 1 (Normal) | FAILED | Timeout 5000ms exceeded

2026-03-19 14:33:20 | SD-Aspire___San_Diego | Pending Approval | Approve Button Click - Method 3 (JavaScript) | SUCCESS
```

## Using the Logs

### To find which records were selected:
Filter by: `Action = "Checkbox Clicked"` AND `Result = "SUCCESS"`

### To find which records were skipped:
Filter by: `Action = "Record Evaluation"` AND `Result = "SKIPPED"`

### To see duplicate processing:
Filter by: `Action contains "Duplicate MRN"`

### To debug Approve button issues:
Filter by: `Action contains "Approve Button"`

## Console Output

All actions are also logged to the console in real-time, so you can watch the automation progress and see exactly what's happening at each step.

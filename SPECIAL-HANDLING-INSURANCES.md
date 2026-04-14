# Special Handling Insurances Configuration

This document describes how to configure special handling insurances for the Kinnser Billing Automation.

## Overview

Some insurances require special handling beyond the standard "No changes" or "Paper" processing. These insurances are configured in `insurance-helper.ts` with specific processing rules.

## Current Special Handling Insurances

### 1. Community health Group (SD Location)
- **Special Handling Type**: `severity-points`
- **Ready To Send Processing**: `electronic`
- **Remarks**: "In the remarks, we must need to mention Severity point..."
- **Description**: Requires special handling for Severity points in remarks
- **Implementation Status**: ⚠️ Pending - Special handling logic not yet implemented

### 2. PARTNERSHIP HEALTH PLAN OF CA (YC Location)
- **Special Handling Type**: `type-of-bill-327`
- **Ready To Send Processing**: `electronic`
- **Remarks**: "Taxonomy code for Billing Provider and physician"
- **Description**: Automatically sets Type of Bill to 327 in Pending Approval tab
- **Implementation Status**: ✅ Implemented

## How It Works

### Ready Tab Processing
All special handling insurances are included in the processable insurances list and can be selected for processing in the Ready tab.

### Pending Approval Tab Processing
Special handling insurances may have custom logic:
- **PARTNERSHIP HEALTH PLAN OF CA**: Automatically changes Type of Bill to 327 for duplicate records

### Ready To Send Tab Processing
The system checks the `getReadyToSendProcessingType()` configuration to determine how to process each special handling insurance:
- **`electronic`**: Send electronically via "Send Electronically" button
- **`paper`**: Download as PDF via print icon

## Adding a New Special Handling Insurance

To add a new special handling insurance, update `insurance-helper.ts`:

### Step 1: Add to `requiresSpecialHandling()` method
```typescript
requiresSpecialHandling(insuranceName: string): boolean {
  const nameLower = insuranceName.toLowerCase().trim();
  return nameLower === "community health group" || 
         nameLower === "partnership health plan of ca" ||
         nameLower === "your new insurance name";  // Add here
}
```

### Step 2: Add to `getSpecialHandlingType()` method
```typescript
getSpecialHandlingType(insuranceName: string): string | null {
  const nameLower = insuranceName.toLowerCase().trim();
  
  if (nameLower === "your new insurance name") {
    return "your-handling-type";  // e.g., "custom-field-xyz"
  }
  
  // ... existing code
}
```

### Step 3: Configure Ready To Send processing in `getReadyToSendProcessingType()` method
```typescript
getReadyToSendProcessingType(insuranceName: string): "electronic" | "paper" | null {
  const nameLower = insuranceName.toLowerCase().trim();
  
  const specialHandlingConfig: Record<string, "electronic" | "paper"> = {
    "community health group": "electronic",
    "partnership health plan of ca": "electronic",
    "your new insurance name": "electronic"  // or "paper"
  };
  
  return specialHandlingConfig[nameLower] || null;
}
```

### Step 4: Add to processable insurances in `loadInstructions()` method
```typescript
// Special handling: Your New Insurance
else if (nameLower === "your new insurance name" && remarkLower.includes("your keyword")) {
  this.noChangesInsurances.add(nameLower);
  console.log(`  ℹ️  Added special handling insurance: ${instruction.Name}`);
}
```

### Step 5: Implement custom logic (if needed)
If the insurance requires custom processing logic (like Type of Bill 327 for Partnership Health Plan), implement it in the appropriate processing functions:
- `processPendingApprovalRecords()` for Pending Approval tab logic
- `processReadyToSend()` for Ready To Send tab logic

## Configuration Reference

| Insurance Name | Location | Handling Type | Ready To Send | Status |
|---------------|----------|---------------|---------------|--------|
| Community health Group | SD | severity-points | electronic | Pending |
| PARTNERSHIP HEALTH PLAN OF CA | YC | type-of-bill-327 | electronic | Implemented |

## Notes

- All special handling insurances must be listed in the Insurance Instructions Excel file
- The insurance name matching is case-insensitive
- Special handling insurances are automatically included in the processable insurances list
- The configuration is centralized in `insurance-helper.ts` for easy maintenance

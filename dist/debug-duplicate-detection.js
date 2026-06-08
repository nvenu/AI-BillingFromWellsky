"use strict";
/**
 * Debug Script for Duplicate Detection
 *
 * This script helps identify issues with duplicate detection by:
 * 1. Testing the logic with sample data
 * 2. Providing debug output for troubleshooting
 * 3. Simulating real-world scenarios
 */
// Copy of the function from kinnser-billing-automation.ts
function findDuplicatesWithOverlap(records) {
    const mrnGroups = {};
    // Group by MRN
    records.forEach((record, index) => {
        if (record.mrn) {
            if (!mrnGroups[record.mrn]) {
                mrnGroups[record.mrn] = [];
            }
            mrnGroups[record.mrn].push({ ...record, originalIndex: index });
        }
    });
    const duplicates = [];
    // Check for overlapping dates within each MRN group
    Object.keys(mrnGroups).forEach(mrn => {
        const group = mrnGroups[mrn];
        if (group.length > 1) {
            // Find all records with overlapping dates
            const overlappingIndices = [];
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    const record1 = group[i];
                    const record2 = group[j];
                    // Parse dates (adjust format as needed)
                    const start1 = new Date(record1.billingPeriodStart);
                    const end1 = new Date(record1.billingPeriodEnd);
                    const start2 = new Date(record2.billingPeriodStart);
                    const end2 = new Date(record2.billingPeriodEnd);
                    // Check for overlap
                    if (start1 <= end2 && start2 <= end1) {
                        // Add both indices if not already added
                        if (!overlappingIndices.includes(record1.originalIndex)) {
                            overlappingIndices.push(record1.originalIndex);
                        }
                        if (!overlappingIndices.includes(record2.originalIndex)) {
                            overlappingIndices.push(record2.originalIndex);
                        }
                    }
                }
            }
            // If we found overlapping records, add them as a group
            if (overlappingIndices.length > 1) {
                duplicates.push({
                    mrn,
                    indices: overlappingIndices.sort((a, b) => a - b) // Sort indices
                });
            }
        }
    });
    return duplicates;
}
// Debug function to test with your actual data
function debugDuplicateDetection(records) {
    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║           DUPLICATE DETECTION DEBUG OUTPUT                    ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');
    console.log(`Total records: ${records.length}\n`);
    // Show all records
    console.log('═══ ALL RECORDS ═══');
    records.forEach((record, index) => {
        console.log(`[${index}] MRN: ${record.mrn}`);
        console.log(`    Insurance: ${record.insurance}`);
        console.log(`    Billing Period: ${record.billingPeriodText}`);
        console.log(`    Period Start: ${record.billingPeriodStart}`);
        console.log(`    Period End: ${record.billingPeriodEnd}`);
        console.log(`    Type of Bill: ${record.typeOfBill}`);
        // Test date parsing
        const start = new Date(record.billingPeriodStart);
        const end = new Date(record.billingPeriodEnd);
        console.log(`    Parsed Start: ${start.toISOString()} (Valid: ${!isNaN(start.getTime())})`);
        console.log(`    Parsed End: ${end.toISOString()} (Valid: ${!isNaN(end.getTime())})`);
        console.log('');
    });
    // Group by MRN
    console.log('\n═══ GROUPED BY MRN ═══');
    const mrnGroups = {};
    records.forEach((record, index) => {
        if (!mrnGroups[record.mrn]) {
            mrnGroups[record.mrn] = [];
        }
        mrnGroups[record.mrn].push({ ...record, index });
    });
    Object.keys(mrnGroups).forEach(mrn => {
        const group = mrnGroups[mrn];
        console.log(`\nMRN: ${mrn} (${group.length} record(s))`);
        group.forEach(record => {
            console.log(`  [${record.index}] ${record.billingPeriodText} - ${record.insurance}`);
        });
        // Check for overlaps within this group
        if (group.length > 1) {
            console.log('  Checking for overlaps:');
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    const r1 = group[i];
                    const r2 = group[j];
                    const start1 = new Date(r1.billingPeriodStart);
                    const end1 = new Date(r1.billingPeriodEnd);
                    const start2 = new Date(r2.billingPeriodStart);
                    const end2 = new Date(r2.billingPeriodEnd);
                    const overlaps = start1 <= end2 && start2 <= end1;
                    console.log(`    [${r1.index}] vs [${r2.index}]: ${overlaps ? '⚠️ OVERLAP' : '✓ No overlap'}`);
                    if (overlaps) {
                        console.log(`      ${r1.billingPeriodText} overlaps with ${r2.billingPeriodText}`);
                    }
                }
            }
        }
    });
    // Run duplicate detection
    console.log('\n═══ DUPLICATE DETECTION RESULTS ═══');
    const duplicates = findDuplicatesWithOverlap(records);
    if (duplicates.length === 0) {
        console.log('✓ No duplicates found');
    }
    else {
        console.log(`⚠️ Found ${duplicates.length} duplicate group(s):\n`);
        duplicates.forEach((dup, i) => {
            console.log(`Group ${i + 1}: MRN ${dup.mrn}`);
            console.log(`  Indices: [${dup.indices.join(', ')}]`);
            dup.indices.forEach((idx) => {
                const record = records[idx];
                console.log(`    [${idx}] ${record.billingPeriodText} - ${record.insurance} - TOB: ${record.typeOfBill}`);
            });
            console.log('');
        });
    }
    // Check which records need TOB 327
    console.log('\n═══ RECORDS NEEDING TOB 327 ═══');
    const recordsNeedingTOB327 = [];
    duplicates.forEach(dup => {
        dup.indices.forEach((idx) => {
            const record = records[idx];
            if (!record.typeOfBill.includes('327')) {
                recordsNeedingTOB327.push(idx);
            }
        });
    });
    if (recordsNeedingTOB327.length === 0) {
        console.log('✓ No records need TOB 327 (all duplicates already have it)');
    }
    else {
        console.log(`⚠️ ${recordsNeedingTOB327.length} record(s) need TOB 327:\n`);
        recordsNeedingTOB327.forEach(idx => {
            const record = records[idx];
            console.log(`  [${idx}] MRN: ${record.mrn}`);
            console.log(`      Period: ${record.billingPeriodText}`);
            console.log(`      Insurance: ${record.insurance}`);
            console.log(`      Current TOB: ${record.typeOfBill}`);
            console.log('');
        });
    }
    console.log('\n═══ SUMMARY ═══');
    console.log(`Total records: ${records.length}`);
    console.log(`Duplicate groups: ${duplicates.length}`);
    console.log(`Records needing TOB 327: ${recordsNeedingTOB327.length}`);
    console.log(`Records to approve: ${records.length - recordsNeedingTOB327.length}`);
}
// Example 1: Test with sample data (paste your actual data here)
console.log('\n\n╔═══════════════════════════════════════════════════════════════╗');
console.log('║                    EXAMPLE 1: Sample Data                     ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
const sampleRecords = [
    {
        mrn: 'YSD250514054604',
        insurance: 'PHMG – Graybill',
        billingPeriodText: '04/12/2026 - 04/18/2026',
        billingPeriodStart: '04/12/2026',
        billingPeriodEnd: '04/18/2026',
        typeOfBill: '111 - Admit thru Discharge Claim',
        index: 0
    },
    {
        mrn: 'YSD250514054604',
        insurance: 'PHMG – Graybill',
        billingPeriodText: '04/12/2026 - 04/18/2026',
        billingPeriodStart: '04/12/2026',
        billingPeriodEnd: '04/18/2026',
        typeOfBill: '111 - Admit thru Discharge Claim',
        index: 1
    },
    {
        mrn: 'YSD250514054604',
        insurance: 'PHMG – Graybill',
        billingPeriodText: '04/12/2026 - 04/18/2026',
        billingPeriodStart: '04/12/2026',
        billingPeriodEnd: '04/18/2026',
        typeOfBill: '111 - Admit thru Discharge Claim',
        index: 2
    }
];
debugDuplicateDetection(sampleRecords);
// Example 2: Test with Partnership Health Plan
console.log('\n\n╔═══════════════════════════════════════════════════════════════╗');
console.log('║          EXAMPLE 2: Partnership Health Plan Records          ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
const partnershipRecords = [
    {
        mrn: 'MRN001',
        insurance: 'Partnership Health Plan of CA',
        billingPeriodText: '04/12/2026 - 04/18/2026',
        billingPeriodStart: '04/12/2026',
        billingPeriodEnd: '04/18/2026',
        typeOfBill: '111 - Admit thru Discharge Claim',
        index: 0
    },
    {
        mrn: 'MRN002',
        insurance: 'Partnership Health Plan of CA',
        billingPeriodText: '04/12/2026 - 04/18/2026',
        billingPeriodStart: '04/12/2026',
        billingPeriodEnd: '04/18/2026',
        typeOfBill: '327 - Adjustment Claim',
        index: 1
    }
];
console.log('\n═══ PARTNERSHIP HEALTH PLAN CHECK ═══');
const partnershipNeedingTOB327 = partnershipRecords.filter(r => r.insurance.toUpperCase().includes('PARTNERSHIP HEALTH PLAN') &&
    !r.typeOfBill.includes('327'));
console.log(`Found ${partnershipRecords.length} Partnership Health Plan records`);
console.log(`${partnershipNeedingTOB327.length} need TOB 327`);
console.log(`${partnershipRecords.length - partnershipNeedingTOB327.length} already have TOB 327\n`);
partnershipNeedingTOB327.forEach(record => {
    console.log(`  [${record.index}] MRN: ${record.mrn} - needs TOB 327`);
});
console.log('\n\n╔═══════════════════════════════════════════════════════════════╗');
console.log('║                    HOW TO USE THIS SCRIPT                     ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log('\n1. Replace sampleRecords with your actual data from the page');
console.log('2. Run: npx ts-node debug-duplicate-detection.ts');
console.log('3. Check the output to see:');
console.log('   - If dates are being parsed correctly');
console.log('   - If duplicates are being detected');
console.log('   - If TOB 327 check is working');
console.log('   - Which records would be deselected');
console.log('\n4. If dates are invalid, check the date format in your data');
console.log('5. If duplicates are not detected, check the overlap logic');
console.log('6. If TOB 327 check fails, check the exact text in typeOfBill\n');

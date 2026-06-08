"use strict";
/**
 * Test Suite for Duplicate Detection Logic
 *
 * This file tests the findDuplicatesWithOverlap function to ensure
 * it correctly identifies duplicate MRNs with overlapping billing periods.
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
// Test helper function
function runTest(testName, records, expectedDuplicates) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`TEST: ${testName}`);
    console.log(`${'='.repeat(80)}`);
    console.log('\nInput Records:');
    records.forEach((record, idx) => {
        console.log(`  [${idx}] MRN: ${record.mrn}, Period: ${record.billingPeriodStart} - ${record.billingPeriodEnd}, Insurance: ${record.insurance}`);
    });
    const result = findDuplicatesWithOverlap(records);
    console.log('\nExpected Duplicates:');
    if (expectedDuplicates.length === 0) {
        console.log('  None');
    }
    else {
        expectedDuplicates.forEach(dup => {
            console.log(`  MRN: ${dup.mrn}, Indices: [${dup.indices.join(', ')}]`);
        });
    }
    console.log('\nActual Duplicates:');
    if (result.length === 0) {
        console.log('  None');
    }
    else {
        result.forEach(dup => {
            console.log(`  MRN: ${dup.mrn}, Indices: [${dup.indices.join(', ')}]`);
        });
    }
    // Verify results
    const passed = JSON.stringify(result) === JSON.stringify(expectedDuplicates);
    if (passed) {
        console.log('\n✅ TEST PASSED');
    }
    else {
        console.log('\n❌ TEST FAILED');
        console.log('Expected:', JSON.stringify(expectedDuplicates, null, 2));
        console.log('Got:', JSON.stringify(result, null, 2));
    }
    return passed;
}
// Run all tests
console.log('\n\n');
console.log('╔════════════════════════════════════════════════════════════════════════════╗');
console.log('║                    DUPLICATE DETECTION TEST SUITE                          ║');
console.log('╚════════════════════════════════════════════════════════════════════════════╝');
const results = [];
// TEST 1: No duplicates - different MRNs
results.push({
    name: 'Test 1: No duplicates - different MRNs',
    passed: runTest('Test 1: No duplicates - different MRNs', [
        { mrn: 'MRN001', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance A' },
        { mrn: 'MRN002', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance B' },
        { mrn: 'MRN003', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance C' }
    ], [])
});
// TEST 2: Same MRN, non-overlapping dates
results.push({
    name: 'Test 2: Same MRN, non-overlapping dates',
    passed: runTest('Test 2: Same MRN, non-overlapping dates', [
        { mrn: 'MRN001', billingPeriodStart: '04/01/2026', billingPeriodEnd: '04/07/2026', insurance: 'Insurance A' },
        { mrn: 'MRN001', billingPeriodStart: '04/08/2026', billingPeriodEnd: '04/14/2026', insurance: 'Insurance A' },
        { mrn: 'MRN001', billingPeriodStart: '04/15/2026', billingPeriodEnd: '04/21/2026', insurance: 'Insurance A' }
    ], [])
});
// TEST 3: Same MRN, exact same dates (2 records)
results.push({
    name: 'Test 3: Same MRN, exact same dates (2 records)',
    passed: runTest('Test 3: Same MRN, exact same dates (2 records)', [
        { mrn: 'MRN001', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance A' },
        { mrn: 'MRN001', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance B' }
    ], [
        { mrn: 'MRN001', indices: [0, 1] }
    ])
});
// TEST 4: Same MRN, exact same dates (3 records) - CRITICAL TEST
results.push({
    name: 'Test 4: Same MRN, exact same dates (3 records)',
    passed: runTest('Test 4: Same MRN, exact same dates (3 records)', [
        { mrn: 'MRN001', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance A' },
        { mrn: 'MRN001', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance B' },
        { mrn: 'MRN001', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance C' }
    ], [
        { mrn: 'MRN001', indices: [0, 1, 2] }
    ])
});
// TEST 5: Same MRN, partial overlap
results.push({
    name: 'Test 5: Same MRN, partial overlap',
    passed: runTest('Test 5: Same MRN, partial overlap', [
        { mrn: 'MRN001', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance A' },
        { mrn: 'MRN001', billingPeriodStart: '04/15/2026', billingPeriodEnd: '04/21/2026', insurance: 'Insurance B' }
    ], [
        { mrn: 'MRN001', indices: [0, 1] }
    ])
});
// TEST 6: Multiple MRNs with duplicates
results.push({
    name: 'Test 6: Multiple MRNs with duplicates',
    passed: runTest('Test 6: Multiple MRNs with duplicates', [
        { mrn: 'MRN001', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance A' },
        { mrn: 'MRN001', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance B' },
        { mrn: 'MRN002', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance C' },
        { mrn: 'MRN002', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance D' }
    ], [
        { mrn: 'MRN001', indices: [0, 1] },
        { mrn: 'MRN002', indices: [2, 3] }
    ])
});
// TEST 7: Real-world scenario from logs (3 records with same MRN and dates)
results.push({
    name: 'Test 7: Real-world scenario - Aguilar, Erma (3 records)',
    passed: runTest('Test 7: Real-world scenario - Aguilar, Erma (3 records)', [
        { mrn: 'YSD250514054604', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'PHMG – Graybill' },
        { mrn: 'YSD250514054604', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'PHMG – Graybill' },
        { mrn: 'YSD250514054604', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'PHMG – Graybill' }
    ], [
        { mrn: 'YSD250514054604', indices: [0, 1, 2] }
    ])
});
// TEST 8: Mixed scenario - some duplicates, some not
results.push({
    name: 'Test 8: Mixed scenario',
    passed: runTest('Test 8: Mixed scenario', [
        { mrn: 'MRN001', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance A' },
        { mrn: 'MRN002', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance B' },
        { mrn: 'MRN001', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance C' },
        { mrn: 'MRN003', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance D' },
        { mrn: 'MRN002', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance E' }
    ], [
        { mrn: 'MRN001', indices: [0, 2] },
        { mrn: 'MRN002', indices: [1, 4] }
    ])
});
// TEST 9: Edge case - one day overlap
results.push({
    name: 'Test 9: Edge case - one day overlap',
    passed: runTest('Test 9: Edge case - one day overlap', [
        { mrn: 'MRN001', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance A' },
        { mrn: 'MRN001', billingPeriodStart: '04/18/2026', billingPeriodEnd: '04/24/2026', insurance: 'Insurance B' }
    ], [
        { mrn: 'MRN001', indices: [0, 1] }
    ])
});
// TEST 10: Edge case - adjacent dates (no overlap)
results.push({
    name: 'Test 10: Edge case - adjacent dates (no overlap)',
    passed: runTest('Test 10: Edge case - adjacent dates (no overlap)', [
        { mrn: 'MRN001', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance A' },
        { mrn: 'MRN001', billingPeriodStart: '04/19/2026', billingPeriodEnd: '04/25/2026', insurance: 'Insurance B' }
    ], [])
});
// TEST 11: Complex scenario - 5 records with overlapping dates
results.push({
    name: 'Test 11: Complex scenario - 5 records, 2 groups',
    passed: runTest('Test 11: Complex scenario - 5 records, 2 groups', [
        { mrn: 'SD260216082503', billingPeriodStart: '04/05/2026', billingPeriodEnd: '04/11/2026', insurance: 'Insurance A' },
        { mrn: 'SD260216082503', billingPeriodStart: '04/05/2026', billingPeriodEnd: '04/11/2026', insurance: 'Insurance B' },
        { mrn: 'SD260216082503', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance C' },
        { mrn: 'SD260216082503', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance D' },
        { mrn: 'SD260216082503', billingPeriodStart: '04/12/2026', billingPeriodEnd: '04/18/2026', insurance: 'Insurance E' }
    ], [
        { mrn: 'SD260216082503', indices: [0, 1, 2, 3, 4] }
    ])
});
// Print summary
console.log('\n\n');
console.log('╔════════════════════════════════════════════════════════════════════════════╗');
console.log('║                              TEST SUMMARY                                  ║');
console.log('╚════════════════════════════════════════════════════════════════════════════╝');
console.log('');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
const total = results.length;
results.forEach((result, idx) => {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${idx + 1}. ${status} - ${result.name}`);
});
console.log('');
console.log(`Total: ${total} tests`);
console.log(`Passed: ${passed} tests`);
console.log(`Failed: ${failed} tests`);
console.log('');
if (failed === 0) {
    console.log('🎉 ALL TESTS PASSED! 🎉');
}
else {
    console.log(`⚠️  ${failed} TEST(S) FAILED - Review output above`);
}
console.log('');

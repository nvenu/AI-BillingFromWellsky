"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const pdf_helper_1 = require("./pdf-helper");
async function testPdfExtraction() {
    console.log('=== Testing PDF Extraction ===\n');
    // Read the sample PDF file
    const pdfPath = 'admission.pdf';
    console.log(`Reading PDF file: ${pdfPath}`);
    const pdfBuffer = fs.readFileSync(pdfPath);
    console.log(`✓ PDF loaded (${pdfBuffer.length} bytes)\n`);
    // Extract date of admission
    console.log('Extracting date of admission...');
    const dateOfAdmission = await (0, pdf_helper_1.extractDateOfAdmission)(pdfBuffer);
    if (!dateOfAdmission) {
        console.error('\n✗ FAILED: Could not extract date of admission');
        process.exit(1);
    }
    console.log(`\n✓ SUCCESS: Extracted date of admission: ${dateOfAdmission}`);
    // Parse and display the date
    const month = dateOfAdmission.substring(0, 2);
    const day = dateOfAdmission.substring(2, 4);
    const year = dateOfAdmission.substring(4, 8);
    console.log(`  Formatted: ${month}/${day}/${year}`);
    // Calculate severity point
    console.log('\nCalculating severity point...');
    const severityPoint = (0, pdf_helper_1.calculateSeverityPoint)(dateOfAdmission);
    const remark = (0, pdf_helper_1.formatSeverityPointRemark)(severityPoint);
    console.log(`\n✓ Severity Point: ${severityPoint}`);
    console.log(`✓ Remark: "${remark}"`);
    // Verify expected date
    if (dateOfAdmission === '08062025') {
        console.log('\n✅ VERIFICATION PASSED: Extracted correct admission date (08062025)');
    }
    else {
        console.log(`\n❌ VERIFICATION FAILED: Expected 08062025, got ${dateOfAdmission}`);
        process.exit(1);
    }
}
testPdfExtraction().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});

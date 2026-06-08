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
const pdf_parse_1 = require("pdf-parse");
async function debugPdfText() {
    console.log('=== Debugging PDF Text ===\n');
    const pdfPath = 'admission.pdf';
    const pdfBuffer = fs.readFileSync(pdfPath);
    const parser = new pdf_parse_1.PDFParse({ data: pdfBuffer });
    const result = await parser.getText();
    const text = result.text;
    console.log(`PDF text length: ${text.length}\n`);
    // Find ADMISSION keyword
    const admissionIndex = text.toUpperCase().indexOf('ADMISSION');
    console.log(`ADMISSION keyword at position: ${admissionIndex}\n`);
    // Find all dates
    const dates = ['08062025', '04072026', '12051965', '62941457'];
    for (const date of dates) {
        const index = text.indexOf(date);
        if (index >= 0) {
            const distance = index - admissionIndex;
            console.log(`Date ${date}:`);
            console.log(`  Position: ${index}`);
            console.log(`  Distance from ADMISSION: ${distance} characters`);
            console.log(`  Context: "${text.substring(Math.max(0, index - 50), index + 50)}"`);
            console.log();
        }
    }
    // Show text around ADMISSION
    console.log('\n=== Text around ADMISSION (500 chars) ===');
    console.log(text.substring(admissionIndex, admissionIndex + 500));
}
debugPdfText().catch(console.error);

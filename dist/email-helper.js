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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const fs = __importStar(require("fs"));
async function sendEmail(config) {
    // Validate SMTP configuration
    if (!process.env.SMTP_USER || process.env.SMTP_USER === 'your_email@solifetec.com') {
        throw new Error('SMTP_USER not configured in .env file. Please set your Office 365 email address.');
    }
    if (!process.env.SMTP_PASS || process.env.SMTP_PASS === 'your_password') {
        throw new Error('SMTP_PASS not configured in .env file. Please set your Office 365 password.');
    }
    console.log(`\nSending email to: ${config.to}`);
    console.log(`From: ${process.env.SMTP_USER}`);
    console.log(`SMTP Host: ${process.env.SMTP_HOST || "smtp.office365.com"}`);
    console.log(`SMTP Port: ${process.env.SMTP_PORT || "587"}`);
    console.log(`Subject: ${config.subject}`);
    console.log(`Attachments: ${config.attachments.length} files`);
    // Create transporter for Office 365 with better TLS settings
    const transporter = nodemailer_1.default.createTransport({
        host: process.env.SMTP_HOST || "smtp.office365.com",
        port: parseInt(process.env.SMTP_PORT || "587"),
        secure: false, // false for STARTTLS on port 587
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
        tls: {
            ciphers: 'SSLv3',
            rejectUnauthorized: false // Allow self-signed certificates
        },
        connectionTimeout: 10000, // 10 seconds
        greetingTimeout: 10000,
        socketTimeout: 10000,
        debug: true, // Enable debug output
        logger: true // Enable logger
    });
    // Verify connection
    console.log('\nVerifying SMTP connection...');
    try {
        await transporter.verify();
        console.log('✓ SMTP connection verified successfully');
    }
    catch (error) {
        console.error('✗ SMTP connection verification failed:');
        if (error instanceof Error) {
            console.error(`  Error: ${error.message}`);
            console.error('\nPossible solutions:');
            console.error('  1. Check your email and password are correct');
            console.error('  2. If you have MFA enabled, create an App Password');
            console.error('  3. Check if your firewall is blocking port 587');
            console.error('  4. Try using smtp-mail.outlook.com instead of smtp.office365.com');
        }
        throw error;
    }
    // Prepare attachments
    const attachments = config.attachments
        .filter(file => {
        const exists = fs.existsSync(file);
        if (!exists) {
            console.log(`⚠️  Attachment not found: ${file}`);
        }
        else {
            console.log(`✓ Attachment found: ${file}`);
        }
        return exists;
    })
        .map(file => ({
        filename: file.split('/').pop() || file,
        path: file
    }));
    if (attachments.length === 0) {
        console.log('⚠️  No attachments to send');
    }
    // Send email
    console.log('\nSending email...');
    try {
        const info = await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: config.to,
            subject: config.subject,
            text: config.body,
            html: `<pre>${config.body}</pre>`,
            attachments: attachments,
        });
        console.log("✓ Email sent successfully!");
        console.log(`  Message ID: ${info.messageId}`);
        console.log(`  Response: ${info.response}`);
    }
    catch (error) {
        console.error("✗ Failed to send email:");
        if (error instanceof Error) {
            console.error(`  Error: ${error.message}`);
        }
        throw error;
    }
}

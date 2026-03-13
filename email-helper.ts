import nodemailer from "nodemailer";
import * as fs from "fs";

export interface EmailConfig {
  to: string;
  subject: string;
  body: string;
  attachments: string[];
}

export async function sendEmail(config: EmailConfig): Promise<void> {
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
  const transporter = nodemailer.createTransport({
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
  } catch (error) {
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
      } else {
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
  } catch (error) {
    console.error("✗ Failed to send email:");
    if (error instanceof Error) {
      console.error(`  Error: ${error.message}`);
    }
    throw error;
  }
}

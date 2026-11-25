import { Resend } from "resend";
let nodemailer: any = null;
try {
  nodemailer = require("nodemailer");
} catch {}
import { getSiteUrl } from "@/lib/site-url";

const resendApiKey = process.env.RESEND_API_KEY;

export const resend = resendApiKey ? new Resend(resendApiKey) : null;

export function getSmtpTransporter() {
  const host = process.env.SMTP_HOST || "smtp.hostinger.com";
  const port = Number(process.env.SMTP_PORT || "465");
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });
}

export interface SendInviteEmailParams {
  to: string;
  fullName: string;
  role: string;
  jobTitle?: string;
  departmentName?: string;
  inviteLink?: string;
  temporaryPassword?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  loginUrl?: string;
}

/**
 * Builds responsive HTML email template for employee invitations adhering strictly
 * to the RemoteHR brand design system tokens:
 * - Brand Deep Indigo: #000000
 * - Brand Electric Purple: #000000
 * - Brand Border / Accent: #E6E6E6
 */
export function buildWelcomeEmailHtml(params: SendInviteEmailParams): string {
  const {
    to,
    fullName,
    role,
    jobTitle,
    departmentName,
    inviteLink,
    temporaryPassword,
    shiftStartTime = "09:00 AM",
    shiftEndTime = "05:00 PM",
    loginUrl = `${getSiteUrl()}/login`,
  } = params;

  const actionUrl = inviteLink || loginUrl;
  const siteUrl = getSiteUrl();

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Welcome to Pulse</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        background-color: #F5F5F5;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        color: #000000;
        -webkit-font-smoothing: antialiased;
      }
      .wrapper {
        width: 100%;
        table-layout: fixed;
        background-color: #F5F5F5;
        padding: 30px 10px;
      }
      .container {
        max-width: 560px;
        margin: 0 auto;
        background-color: #ffffff;
        border-radius: 20px;
        border: 1px solid #E6E6E6;
        overflow: hidden;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
      }
      .header {
        background-color: #000000;
        padding: 28px 32px;
        text-align: center;
      }
      .brand-title {
        color: #ffffff;
        font-size: 22px;
        font-weight: 800;
        letter-spacing: -0.5px;
        margin: 0;
      }
      .brand-tag {
        color: #000000;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-top: 4px;
      }
      .body-content {
        padding: 32px;
      }
      .welcome-heading {
        font-size: 20px;
        font-weight: 700;
        color: #000000;
        margin-top: 0;
        margin-bottom: 12px;
      }
      .intro-text {
        font-size: 14px;
        line-height: 1.6;
        color: #4b5563;
        margin-bottom: 24px;
      }
      .details-card {
        background-color: #FFFFFF;
        border: 1px solid #E6E6E6;
        border-radius: 14px;
        padding: 6px 18px;
        margin-bottom: 24px;
      }
      .details-table {
        width: 100%;
        border-collapse: collapse;
      }
      .detail-label {
        color: #000000;
        font-weight: 700;
        font-size: 13px;
        padding: 11px 12px 11px 0;
        border-bottom: 1px solid #F5F5F5;
        width: 38%;
        white-space: nowrap;
        vertical-align: middle;
      }
      .detail-value {
        color: #000000;
        font-weight: 700;
        font-size: 13px;
        padding: 11px 0 11px 12px;
        border-bottom: 1px solid #F5F5F5;
        text-align: right;
        word-break: break-all;
        vertical-align: middle;
      }
      .cta-container {
        text-align: center;
        margin: 28px 0;
      }
      .cta-button {
        display: inline-block;
        background-color: #000000;
        color: #ffffff !important;
        text-decoration: none;
        padding: 14px 32px;
        border-radius: 12px;
        font-weight: 700;
        font-size: 14px;
        letter-spacing: 0.2px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }
      .security-box {
        background-color: #F5F5F5;
        border-left: 4px solid #000000;
        border-radius: 4px;
        padding: 14px 16px;
        margin-top: 24px;
        margin-bottom: 24px;
      }
      .security-title {
        font-size: 12px;
        font-weight: 700;
        color: #000000;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
      }
      .security-text {
        font-size: 12px;
        line-height: 1.5;
        color: #64748b;
        margin: 0;
      }
      .footer {
        padding: 24px 32px;
        background-color: #faf9ff;
        border-top: 1px solid #E6E6E6;
        text-align: center;
        font-size: 11px;
        color: #94a3b8;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="container">
        <div class="header">
          <div class="brand-title">Pulse</div>
          <div class="brand-tag">Workforce &amp; HR Management System</div>
        </div>
        <div class="body-content">
          <h2 class="welcome-heading">Welcome, ${fullName}!</h2>
          <p class="intro-text">
            Your organization has invited you to join <strong>Pulse</strong> with the role of
            <strong>${role.toUpperCase()}</strong>.
            ${jobTitle ? `You are appointed as <strong>${jobTitle}</strong>.` : ""}
            ${departmentName ? `Assigned department: <strong>${departmentName}</strong>.` : ""}
          </p>

          <div class="details-card">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="details-table">
              <tr>
                <td class="detail-label">Login Email :</td>
                <td class="detail-value">${to}</td>
              </tr>
              ${
                temporaryPassword
                  ? `
              <tr>
                <td class="detail-label">Temporary Password :</td>
                <td class="detail-value">
                  <span style="display: inline-block; background-color: #F5F5F5; color: #000000; padding: 4px 10px; border-radius: 6px; font-weight: 800; font-family: monospace; font-size: 13px; letter-spacing: 0.5px; border: 1px dashed #E6E6E6;">
                    ${temporaryPassword}
                  </span>
                </td>
              </tr>`
                  : ""
              }
              ${
                departmentName
                  ? `
              <tr>
                <td class="detail-label">Department :</td>
                <td class="detail-value">${departmentName}</td>
              </tr>`
                  : ""
              }
              ${
                jobTitle
                  ? `
              <tr>
                <td class="detail-label">Job Title :</td>
                <td class="detail-value">${jobTitle}</td>
              </tr>`
                  : ""
              }
              <tr>
                <td class="detail-label">Working Hours :</td>
                <td class="detail-value">${shiftStartTime} - ${shiftEndTime}</td>
              </tr>
              <tr>
                <td class="detail-label" style="border-bottom: none;">System Role :</td>
                <td class="detail-value" style="border-bottom: none;">${role.toUpperCase()}</td>
              </tr>
            </table>
          </div>

          <div class="cta-container">
            <a href="${actionUrl}" class="cta-button" target="_blank" rel="noopener noreferrer">
              Accept Invitation &amp; Complete Onboarding
            </a>
          </div>
          <p style="font-size: 12px; color: #64748b; text-align: center; margin-top: -16px; margin-bottom: 24px;">
            You can either click the button above to begin onboarding immediately, or sign in at <strong>${siteUrl}/login</strong> using your email and temporary password.
          </p>

          <div class="security-box">
            <div class="security-title">Anti-Phishing Security Notice</div>
            <p class="security-text">
              Pulse administrators will never ask for your password, TOTP code, or multi-factor authentication setup key. Zero Invasive Monitoring policy is strictly enforced. Always verify that your browser address bar points to your organization's legitimate domain before entering credentials.
            </p>
          </div>
        </div>
        <div class="footer">
          Pulse Automated Management System &bull; Zenxea<br />
          If you did not expect this invitation, please contact your company administrator.
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export function buildAttendanceEmailTemplate(
  title: string,
  message: string,
  actionText: string,
  actionUrl: string
): string {
  return `
    <!DOCTYPE html>
    <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #F5F5F5; padding: 24px;">
        <div style="background-color: #ffffff; max-width: 520px; margin: 0 auto; border-radius: 20px; padding: 32px; border: 1px solid #E6E6E6;">
          <h2 style="color: #000000; margin-top: 0;">Pulse</h2>
          <h3 style="color: #000000;">${title}</h3>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">${message}</p>
          <div style="margin-top: 24px;">
            <a href="${actionUrl}" style="background-color: #000000; color: #ffffff; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-size: 13px; font-weight: 700; display: inline-block;">
              ${actionText}
            </a>
          </div>
        </div>
      </body>
    </html>
  `;
}

export async function sendWelcomeCredentialsEmail(params: SendInviteEmailParams): Promise<{
  success: boolean;
  simulated?: boolean;
  messageId?: string;
  error?: string;
}> {
  const { to } = params;
  const subject = `Welcome to Pulse — Your Account Invitation`;
  const htmlContent = buildWelcomeEmailHtml(params);

  // 1. Prioritize Hostinger / Custom SMTP if configured
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = getSmtpTransporter();
      if (transporter) {
        const fromAddress = process.env.SMTP_FROM || `Pulse <${process.env.SMTP_USER || "business@zenxea.com"}>`;
        const info = await transporter.sendMail({
          from: fromAddress,
          to,
          subject,
          html: htmlContent,
        });
        return { success: true, messageId: info.messageId };
      }
    } catch (smtpErr: any) {
      console.warn("[SMTP Error, falling back to Resend]:", smtpErr?.message || smtpErr);
    }
  }

  // 2. Fall back to Resend if configured
  if (process.env.RESEND_API_KEY) {
    const client = resend || new Resend(process.env.RESEND_API_KEY);
    try {
      const fromAddress = process.env.RESEND_FROM_EMAIL || "Pulse <onboarding@remotehr.io>";
      const response = await client.emails.send({
        from: fromAddress,
        to: [to],
        subject,
        html: htmlContent,
      });

      if (response.error) {
        console.error("[Resend Error]:", response.error);
        return { success: false, error: response.error.message };
      }

      return { success: true, messageId: response.data?.id };
    } catch (err: any) {
      console.error("[Resend Exception]:", err);
      return { success: false, error: err.message || String(err) };
    }
  }

  // 3. Fallback for non-production environments
  if (process.env.NODE_ENV === "production") {
    return {
      success: false,
      error: "RESEND_API_KEY is not configured in production environment.",
    };
  }

  console.warn(`[Resend Simulated Email to ${to}] SMTP/Resend not configured. Subject: ${subject}`);
  return { success: true, simulated: true, messageId: `sim_${Date.now()}` };
}

export interface SendPasswordResetParams {
  to: string;
  otpCode: string;
}

export function buildPasswordResetEmailHtml(params: SendPasswordResetParams): string {
  const { otpCode } = params;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reset your password - Pulse</title>
    <style>
      body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
      .wrapper { width: 100%; padding: 40px 0; background-color: #f8fafc; }
      .card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; }
      .header { background: #000000; padding: 28px 32px; text-align: center; }
      .brand { font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px; }
      .badge { display: inline-block; background: rgba(99, 85, 220, 0.25); color: #c4b5fd; font-size: 11px; font-weight: 600; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; margin-top: 8px; }
      .body { padding: 32px; }
      .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px; line-height: 1.3; }
      .paragraph { font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px; }
      .otp-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
      .otp-label { font-size: 11px; font-weight: 600; color: #000000; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
      .otp-number { font-size: 32px; font-weight: 700; font-family: monospace; letter-spacing: 6px; color: #000000; }
      .notice { background: #f1f5f9; border-radius: 8px; padding: 16px; font-size: 12px; color: #64748b; line-height: 1.5; margin-top: 24px; }
      .footer { text-align: center; padding: 24px 32px; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="header">
          <div class="brand">Pulse</div>
          <div class="badge">Security &amp; Account Access</div>
        </div>
        <div class="body">
          <h1 class="title">Password Reset Verification</h1>
          <p class="paragraph">
            We received a request to reset the password for your Pulse account. Enter this code on the password reset screen to continue.
          </p>

          <div class="otp-box">
            <div class="otp-label">Your verification code</div>
            <div class="otp-number">${otpCode}</div>
          </div>

          <div class="notice">
            If you did not initiate this request, you can safely disregard this email. Your account credentials will remain secure and unchanged.
          </div>
        </div>
        <div class="footer">
          Delivered securely via Hostinger SMTP &bull; Pulse Automated Platform
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export interface SendMfaResetParams {
  to: string;
  otpCode: string;
}

export function buildMfaResetEmailHtml(params: SendMfaResetParams): string {
  const { otpCode } = params;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reset Authenticator - Pulse</title>
    <style>
      body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
      .wrapper { width: 100%; padding: 40px 0; background-color: #f8fafc; }
      .card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; }
      .header { background: #000000; padding: 28px 32px; text-align: center; }
      .brand { font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px; }
      .badge { display: inline-block; background: rgba(99, 85, 220, 0.25); color: #c4b5fd; font-size: 11px; font-weight: 600; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; margin-top: 8px; }
      .body { padding: 32px; }
      .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px; line-height: 1.3; }
      .paragraph { font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px; }
      .otp-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
      .otp-label { font-size: 11px; font-weight: 600; color: #000000; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
      .otp-number { font-size: 32px; font-weight: 700; font-family: monospace; letter-spacing: 6px; color: #000000; }
      .notice { background: #f1f5f9; border-radius: 8px; padding: 16px; font-size: 12px; color: #64748b; line-height: 1.5; margin-top: 24px; }
      .footer { text-align: center; padding: 24px 32px; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="header">
          <div class="brand">Pulse</div>
          <div class="badge">Two-Factor Recovery</div>
        </div>
        <div class="body">
          <h1 class="title">Reset Two-Factor Authentication</h1>
          <p class="paragraph">
            We received a request to reset your authenticator app for Pulse. Enter this 6-digit recovery code on the verification screen to disconnect your previous device and set up a new one.
          </p>

          <div class="otp-box">
            <div class="otp-label">Your recovery code</div>
            <div class="otp-number">${otpCode}</div>
          </div>

          <div class="notice">
            This code expires in 10 minutes. If you did not request to reset your authenticator, please change your password immediately.
          </div>
        </div>
        <div class="footer">
          Delivered securely via Hostinger SMTP &bull; Pulse Automated Platform
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export interface SendOnboardingSubmittedParams {
  to?: string;
  candidateName: string;
  candidateEmail: string;
  candidateType: string;
}

export async function sendOnboardingSubmittedEmail(params: SendOnboardingSubmittedParams): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
  simulated?: boolean;
}> {
  const hrRecipient = params.to || process.env.SMTP_USER || "hr@zenxea.com";
  const subject = `New Candidate Onboarding Submission: ${params.candidateName}`;
  const siteUrl = getSiteUrl();

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Candidate Onboarding Submission</title>
  </head>
  <body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #1e293b;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden;">
      <tr>
        <td style="padding: 28px; background-color: #4f46e5; text-align: center;">
          <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 700;">Pulse HR Portal</h1>
          <p style="margin: 6px 0 0; color: #e0e7ff; font-size: 13px;">Candidate Onboarding Notification</p>
        </td>
      </tr>
      <tr>
        <td style="padding: 28px;">
          <p style="font-size: 14px; margin-top: 0;">A new candidate has completed their document submission and set up their workplace account:</p>
          <table width="100%" cellpadding="8" cellspacing="0" style="font-size: 13px; background-color: #f8fafc; border-radius: 12px; margin: 16px 0; border: 1px solid #e2e8f0;">
            <tr>
              <td style="font-weight: 700; width: 35%;">Candidate Name</td>
              <td>: ${params.candidateName}</td>
            </tr>
            <tr>
              <td style="font-weight: 700;">Email Address</td>
              <td>: ${params.candidateEmail}</td>
            </tr>
            <tr>
              <td style="font-weight: 700;">Candidate Track</td>
              <td>: ${params.candidateType.replace("_", " ")}</td>
            </tr>
          </table>
          <div style="text-align: center; margin-top: 24px;">
            <a href="${siteUrl}/hr/onboarding" style="display: inline-block; padding: 12px 24px; background-color: #4f46e5; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 13px; border-radius: 10px;">Review Candidate in HR Portal</a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding: 16px 28px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #64748b;">
          Pulse by Zenxea • Automated Workforce Orchestration
        </td>
      </tr>
    </table>
  </body>
</html>`;

  // 1. Prioritize Hostinger / Custom SMTP if configured
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = getSmtpTransporter();
      if (transporter) {
        const fromAddress = process.env.SMTP_FROM || `Pulse <${process.env.SMTP_USER || "business@zenxea.com"}>`;
        const info = await transporter.sendMail({
          from: fromAddress,
          to: hrRecipient,
          subject,
          html,
        });
        return { success: true, messageId: info.messageId };
      }
    } catch (smtpErr: any) {
      console.warn("[SMTP Error, falling back to Resend]:", smtpErr?.message || smtpErr);
    }
  }

  // 2. Fall back to Resend if configured
  if (process.env.RESEND_API_KEY) {
    const client = resend || new Resend(process.env.RESEND_API_KEY);
    try {
      const fromAddress = process.env.RESEND_FROM_EMAIL || "Pulse <onboarding@remotehr.io>";
      const response = await client.emails.send({
        from: fromAddress,
        to: [hrRecipient],
        subject,
        html,
      });

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      return { success: true, messageId: response.data?.id };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  return { success: true, simulated: true, messageId: `sim_${Date.now()}` };
}

export async function sendPasswordResetEmail(params: SendPasswordResetParams): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  const { to } = params;
  const subject = `Reset Your Pulse Account Password`;
  const htmlContent = buildPasswordResetEmailHtml(params);

  // 1. Prioritize Hostinger SMTP if configured
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = getSmtpTransporter();
      if (transporter) {
        const fromAddress = process.env.SMTP_FROM || `Pulse <${process.env.SMTP_USER || "business@zenxea.com"}>`;
        const info = await transporter.sendMail({
          from: fromAddress,
          to,
          subject,
          html: htmlContent,
        });
        return { success: true, messageId: info.messageId };
      }
    } catch (smtpErr: any) {
      console.warn("[SMTP Error, falling back to Resend]:", smtpErr?.message || smtpErr);
    }
  }

  // 2. Fall back to Resend if configured
  if (process.env.RESEND_API_KEY) {
    const client = resend || new Resend(process.env.RESEND_API_KEY);
    try {
      const fromAddress = process.env.RESEND_FROM_EMAIL || "Pulse <onboarding@remotehr.io>";
      const response = await client.emails.send({
        from: fromAddress,
        to: [to],
        subject,
        html: htmlContent,
      });

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      return { success: true, messageId: response.data?.id };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  return { success: false, error: "Email delivery failed. Check the configured mail transport." };
}

export async function sendMfaResetEmail(params: SendMfaResetParams): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  const { to } = params;
  const subject = `Your Two-Factor Authentication Recovery Code`;
  const htmlContent = buildMfaResetEmailHtml(params);

  // 1. Prioritize Hostinger SMTP if configured
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = getSmtpTransporter();
      if (transporter) {
        const fromAddress = process.env.SMTP_FROM || `Pulse <${process.env.SMTP_USER || "business@zenxea.com"}>`;
        const info = await transporter.sendMail({
          from: fromAddress,
          to,
          subject,
          html: htmlContent,
        });
        return { success: true, messageId: info.messageId };
      }
    } catch (smtpErr: any) {
      console.warn("[SMTP Error, falling back to Resend]:", smtpErr?.message || smtpErr);
    }
  }

  // 2. Fall back to Resend if configured
  if (process.env.RESEND_API_KEY) {
    const client = resend || new Resend(process.env.RESEND_API_KEY);
    try {
      const fromAddress = process.env.RESEND_FROM_EMAIL || "Pulse <onboarding@remotehr.io>";
      const response = await client.emails.send({
        from: fromAddress,
        to: [to],
        subject,
        html: htmlContent,
      });

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      return { success: true, messageId: response.data?.id };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn(`[Simulated MFA Reset Email to ${to}] OTP: ${params.otpCode}`);
    return { success: true, messageId: `sim_mfa_${Date.now()}` };
  }

  return { success: false, error: "Email delivery failed. Check the configured mail transport." };
}

export interface SendNotificationEmailParams {
  to: string;
  recipientName?: string;
  title: string;
  body: string;
  link?: string | null;
}

export function buildNotificationEmailHtml(params: SendNotificationEmailParams): string {
  const { recipientName, title, body, link } = params;
  const siteUrl = getSiteUrl();
  const actionUrl = link ? (link.startsWith("http") ? link : `${siteUrl}${link.startsWith("/") ? "" : "/"}${link}`) : siteUrl;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; padding: 0; background-color: #F5F5F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
      .container { max-width: 580px; margin: 32px auto; background: #ffffff; border-radius: 16px; border: 1px solid #E6E6E6; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08); }
      .header { background: #000000; padding: 28px 32px; text-align: left; }
      .content { padding: 32px; }
      .btn { display: inline-block; background: #000000; color: #ffffff !important; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-size: 14px; margin-top: 20px; }
      .footer { background: #faf9fe; padding: 20px 32px; border-top: 1px solid #E6E6E6; font-size: 12px; color: #718096; text-align: center; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em;">Pulse HRMS</h1>
        <p style="color: #a0aec0; margin: 4px 0 0; font-size: 12px;">Workplace Notification</p>
      </div>
      <div class="content">
        ${recipientName ? `<p style="font-size: 15px; color: #2d3748; margin-top: 0;">Hi <strong>${recipientName}</strong>,</p>` : ""}
        <h2 style="font-size: 18px; color: #000000; margin: 0 0 12px 0;">${title}</h2>
        <p style="font-size: 14px; line-height: 1.6; color: #4a5568; white-space: pre-line; margin: 0 0 20px 0;">${body}</p>
        ${link ? `<a href="${actionUrl}" class="btn" target="_blank" rel="noopener noreferrer">View in Pulse →</a>` : ""}
      </div>
      <div class="footer">
        <p style="margin: 0 0 6px 0;">You received this email according to your Pulse workplace notification settings.</p>
        <p style="margin: 0;"><a href="${siteUrl}/settings" style="color: #000000; text-decoration: none;">Manage Notification Preferences</a></p>
      </div>
    </div>
  </body>
</html>`;
}

export async function sendNotificationEmail(params: SendNotificationEmailParams): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  const { to, title } = params;
  const subject = `[Pulse] ${title}`;
  const htmlContent = buildNotificationEmailHtml(params);

  // 1. Hostinger SMTP
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = getSmtpTransporter();
      if (transporter) {
        const fromAddress = process.env.SMTP_FROM || `Pulse <${process.env.SMTP_USER || "business@zenxea.com"}>`;
        const info = await transporter.sendMail({
          from: fromAddress,
          to,
          subject,
          html: htmlContent,
        });
        return { success: true, messageId: info.messageId };
      }
    } catch (smtpErr: any) {
      console.warn("[SMTP Error, falling back to Resend]:", smtpErr?.message || smtpErr);
    }
  }

  // 2. Resend fallback
  if (process.env.RESEND_API_KEY) {
    const client = resend || new Resend(process.env.RESEND_API_KEY);
    try {
      const fromAddress = process.env.RESEND_FROM_EMAIL || "Pulse <onboarding@remotehr.io>";
      const response = await client.emails.send({
        from: fromAddress,
        to: [to],
        subject,
        html: htmlContent,
      });
      if (response.error) {
        return { success: false, error: response.error.message };
      }
      return { success: true, messageId: response.data?.id };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  return { success: true, messageId: `sim_${Date.now()}` };
}

export interface SendApprovalEmailParams {
  to: string;
  firstName: string;
  departmentName?: string;
  jobTitle?: string;
}

export function buildApprovalEmailHtml(params: SendApprovalEmailParams): string {
  const { to, firstName, departmentName, jobTitle } = params;
  const loginUrl = `${getSiteUrl()}/login`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Onboarding Approved - Pulse</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        background-color: #F5F5F5;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        color: #000000;
        -webkit-font-smoothing: antialiased;
      }
      .wrapper {
        width: 100%;
        table-layout: fixed;
        background-color: #F5F5F5;
        padding: 30px 10px;
      }
      .container {
        max-width: 560px;
        margin: 0 auto;
        background-color: #ffffff;
        border-radius: 20px;
        border: 1px solid #E6E6E6;
        overflow: hidden;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
      }
      .header {
        background-color: #000000;
        padding: 28px 32px;
        text-align: center;
      }
      .brand-title {
        color: #ffffff;
        font-size: 22px;
        font-weight: 800;
        margin: 0;
      }
      .brand-tag {
        color: #000000;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-top: 4px;
      }
      .body-content {
        padding: 32px;
      }
      .greeting {
        font-size: 18px;
        font-weight: 700;
        color: #000000;
        margin-bottom: 12px;
      }
      .paragraph {
        font-size: 14px;
        line-height: 1.6;
        color: #4A4868;
        margin-bottom: 20px;
      }
      .details-card {
        background-color: #F8F9FC;
        border: 1px solid #E2E8F0;
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 24px;
      }
      .detail-row {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        padding: 4px 0;
      }
      .detail-label {
        color: #64748B;
        font-weight: 600;
      }
      .detail-val {
        color: #0F172A;
        font-weight: 700;
      }
      .btn-container {
        text-align: center;
        margin: 28px 0;
      }
      .login-btn {
        background-color: #000000;
        color: #ffffff !important;
        padding: 14px 32px;
        border-radius: 9999px;
        text-decoration: none;
        font-size: 14px;
        font-weight: 700;
        display: inline-block;
      }
      .note {
        font-size: 12px;
        line-height: 1.5;
        color: #64748B;
        border-top: 1px solid #E2E8F0;
        padding-top: 16px;
        margin-top: 24px;
      }
      .footer {
        background-color: #F5F5F5;
        padding: 18px 32px;
        text-align: center;
        font-size: 11px;
        color: #8C8A9E;
        border-top: 1px solid #E6E6E6;
      }
    </style>
  </head>
  <body>
    <table class="wrapper" role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <div class="container">
            <div class="header">
              <div class="brand-title">Pulse</div>
              <div class="brand-tag">Zen Xea Workspace</div>
            </div>

            <div class="body-content">
              <div class="greeting">Hello ${firstName},</div>
              <div class="paragraph">
                Your onboarding has been approved by HR and your Pulse account is now active.
              </div>

              <div class="details-card">
                <table width="100%" cellspacing="0" cellpadding="4" style="font-size: 13px;">
                  <tr>
                    <td style="color: #64748B; font-weight: 600;">Login Email:</td>
                    <td align="right" style="color: #0F172A; font-weight: 700;">${to}</td>
                  </tr>
                  ${
                    departmentName
                      ? `<tr>
                    <td style="color: #64748B; font-weight: 600;">Department:</td>
                    <td align="right" style="color: #0F172A; font-weight: 700;">${departmentName}</td>
                  </tr>`
                      : ""
                  }
                  ${
                    jobTitle
                      ? `<tr>
                    <td style="color: #64748B; font-weight: 600;">Job Title:</td>
                    <td align="right" style="color: #0F172A; font-weight: 700;">${jobTitle}</td>
                  </tr>`
                      : ""
                  }
                </table>
              </div>

              <div class="btn-container">
                <a href="${loginUrl}" class="login-btn" target="_blank" rel="noopener noreferrer">
                  Log in to Pulse
                </a>
              </div>

              <div class="paragraph" style="font-size: 13px; color: #4A4868;">
                Log in with the email address and the password you set during onboarding. If you forgot it, use &apos;Forgot password&apos; on the login page.
              </div>

              <div class="note">
                <strong>Quick Start:</strong> A quick walkthrough will start on your first login to guide you through your new workspace.
              </div>
            </div>

            <div class="footer">
              Pulse HRMS &bull; Zen Xea Technologies &bull; This is an automated transactional notification.
            </div>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendOnboardingApprovalEmail(params: SendApprovalEmailParams): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  const { to } = params;
  const subject = "You're approved - log in to Pulse";
  const htmlContent = buildApprovalEmailHtml(params);

  // 1. Hostinger / SMTP
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = getSmtpTransporter();
      if (transporter) {
        const fromAddress = process.env.SMTP_FROM || `Pulse <${process.env.SMTP_USER || "business@zenxea.com"}>`;
        const info = await transporter.sendMail({
          from: fromAddress,
          to,
          subject,
          html: htmlContent,
        });
        return { success: true, messageId: info.messageId };
      }
    } catch (smtpErr: any) {
      console.warn("[SMTP Error, falling back to Resend]:", smtpErr?.message || smtpErr);
    }
  }

  // 2. Resend fallback
  if (process.env.RESEND_API_KEY) {
    const client = resend || new Resend(process.env.RESEND_API_KEY);
    try {
      const fromAddress = process.env.RESEND_FROM_EMAIL || "Pulse <onboarding@remotehr.io>";
      const response = await client.emails.send({
        from: fromAddress,
        to: [to],
        subject,
        html: htmlContent,
      });

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      return { success: true, messageId: response.data?.id };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  return { success: true, messageId: `sim_${Date.now()}` };
}

export interface SendAdminDossierEmailParams {
  to: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone?: string;
  employeeId: string;
  departmentName?: string;
  jobTitle?: string;
  reviewedByName?: string;
  approvedAt?: string;
  candidateUserId?: string;
  documents: Array<{ name: string; url?: string }>;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}

export function buildAdminDossierEmailHtml(params: SendAdminDossierEmailParams): string {
  const {
    candidateName,
    candidateEmail,
    candidatePhone,
    employeeId,
    departmentName = "General",
    jobTitle = "Employee",
    reviewedByName = "HR Team",
    approvedAt = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    candidateUserId,
    documents = [],
    attachments = [],
  } = params;

  const siteUrl = getSiteUrl();
  const profileUrl = candidateUserId ? `${siteUrl}/employees/${candidateUserId}` : `${siteUrl}/hr/onboarding`;

  const docRows = documents
    .map(
      (doc) => `
      <tr>
        <td style="padding: 10px 14px; border-bottom: 1px solid #E2E8F0; font-size: 13px; font-weight: 600; color: #1E293B;">
          ${doc.name}
        </td>
        <td align="right" style="padding: 10px 14px; border-bottom: 1px solid #E2E8F0; font-size: 12px; font-weight: 700;">
          ${
            doc.url
              ? `<a href="${doc.url}" target="_blank" rel="noopener noreferrer" style="color: #000000; text-decoration: none; margin-right: 8px;">View Link</a>`
              : ""
          }
          <span style="display: inline-block; background-color: #ECFDF5; color: #059669; padding: 2px 8px; border-radius: 6px; font-size: 11px;">Approved</span>
        </td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Candidate Onboarding Dossier</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #F8F9FC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #000000;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #F8F9FC; padding: 32px 0 48px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 620px; background-color: #ffffff; border-radius: 20px; border: 1px solid #E2E8F0; overflow: hidden; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);">
            <!-- Header -->
            <tr>
              <td style="background: #000000; padding: 32px 36px 28px;">
                <p style="font-size: 20px; font-weight: 800; color: #ffffff; margin: 0; letter-spacing: -0.5px;">Pulse HRMS</p>
                <p style="font-size: 11px; font-weight: 700; color: #A5B4FC; text-transform: uppercase; letter-spacing: 1.2px; margin: 4px 0 0 0;">Employee Onboarding Dossier</p>
              </td>
            </tr>

            <!-- Content -->
            <tr>
              <td style="padding: 32px 36px 28px;">
                <div style="display: inline-block; padding: 5px 12px; border-radius: 9999px; background-color: #ECFDF5; color: #059669; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 14px;">
                  ✓ Approved & Activated
                </div>

                <h1 style="font-size: 22px; font-weight: 800; color: #000000; margin: 0 0 10px; line-height: 1.3;">
                  Candidate Approved: ${candidateName}
                </h1>
                <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px;">
                  The candidate onboarding submission has been fully reviewed and approved by HR. All verified documents are attached to this email and archived in the corporate employee registry.
                </p>

                <!-- Candidate Details Card -->
                <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 14px; padding: 18px 20px; margin-bottom: 24px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 13px;">
                    <tr>
                      <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Employee ID:</td>
                      <td align="right" style="padding: 6px 0; color: #0F172A; font-weight: 800; font-family: monospace;">${employeeId}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Full Name:</td>
                      <td align="right" style="padding: 6px 0; color: #0F172A; font-weight: 700;">${candidateName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Email:</td>
                      <td align="right" style="padding: 6px 0; color: #0F172A; font-weight: 700;">${candidateEmail}</td>
                    </tr>
                    ${
                      candidatePhone
                        ? `<tr>
                      <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Phone:</td>
                      <td align="right" style="padding: 6px 0; color: #0F172A; font-weight: 700;">${candidatePhone}</td>
                    </tr>`
                        : ""
                    }
                    <tr>
                      <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Department:</td>
                      <td align="right" style="padding: 6px 0; color: #0F172A; font-weight: 700;">${departmentName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Role / Title:</td>
                      <td align="right" style="padding: 6px 0; color: #0F172A; font-weight: 700;">${jobTitle}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Reviewed & Approved By:</td>
                      <td align="right" style="padding: 6px 0; color: #0F172A; font-weight: 700;">${reviewedByName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Approval Timestamp:</td>
                      <td align="right" style="padding: 6px 0; color: #0F172A; font-weight: 700;">${approvedAt}</td>
                    </tr>
                  </table>
                </div>

                <!-- Verified Documents List -->
                <p style="font-size: 13px; font-weight: 800; color: #000000; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 12px;">
                  Attached Documents (${attachments.length} files attached)
                </p>
                <div style="background-color: #ffffff; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; margin-bottom: 24px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    ${docRows}
                  </table>
                </div>

                <!-- Action Button -->
                <div style="text-align: center; margin: 28px 0 16px;">
                  <a href="${profileUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #000000; color: #ffffff !important; padding: 13px 28px; font-size: 13px; font-weight: 800; text-decoration: none; border-radius: 12px; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);">
                    Open Employee Profile in Pulse
                  </a>
                </div>

                <p style="font-size: 12px; color: #64748B; text-align: center; margin: 0;">
                  All attached documents are also safely preserved in the Supabase Storage encrypted vault.
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background-color: #F8FAFC; border-top: 1px solid #E2E8F0; padding: 20px 36px; text-align: center; font-size: 11px; color: #94A3B8;">
                Pulse HRMS &bull; Zen Xea Technologies &bull; Automated HR Document Dispatch
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendAdminOnboardingDossierEmail(params: SendAdminDossierEmailParams): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  const { to, candidateName, employeeId, attachments = [] } = params;
  const subject = `[Pulse HR] Candidate Approved & Documents Dossier - ${candidateName} (${employeeId})`;
  const htmlContent = buildAdminDossierEmailHtml(params);

  // 1. Hostinger / SMTP
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = getSmtpTransporter();
      if (transporter) {
        const fromAddress = process.env.SMTP_FROM || `Pulse HR <${process.env.SMTP_USER || "business@zenxea.com"}>`;
        const info = await transporter.sendMail({
          from: fromAddress,
          to,
          subject,
          html: htmlContent,
          attachments: attachments.map((att) => ({
            filename: att.filename,
            content: att.content,
            contentType: att.contentType,
          })),
        });
        return { success: true, messageId: info.messageId };
      }
    } catch (smtpErr: any) {
      console.warn("[SMTP Error, falling back to Resend]:", smtpErr?.message || smtpErr);
    }
  }

  // 2. Resend fallback
  if (process.env.RESEND_API_KEY) {
    const client = resend || new Resend(process.env.RESEND_API_KEY);
    try {
      const fromAddress = process.env.RESEND_FROM_EMAIL || "Pulse HR <hr@zenxea.com>";
      const response = await client.emails.send({
        from: fromAddress,
        to: [to],
        subject,
        html: htmlContent,
        attachments: attachments.map((att) => ({
          filename: att.filename,
          content: att.content,
        })),
      });

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      return { success: true, messageId: response.data?.id };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  return { success: true, messageId: `sim_${Date.now()}` };
}


export interface SendMagicLinkParams {
  to: string;
  magicLink: string;
}

export function buildMagicLinkEmailHtml(params: SendMagicLinkParams): string {
  const { magicLink } = params;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sign In to Pulse — Secure Workplace Access</title>
    <style>
      body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
      .wrapper { width: 100%; padding: 40px 0; background-color: #f8fafc; }
      .card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 24px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
      .header { background: #000000; padding: 32px 32px 28px; text-align: center; }
      .brand { font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; }
      .badge { display: inline-block; background: rgba(0, 0, 0, 0.15); color: #a29bfe; font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; margin-top: 8px; }
      .body { padding: 32px; }
      .title { font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 12px; line-height: 1.3; }
      .paragraph { font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px; }
      .otp-box { background: #f8fafc; border: 2px dashed #000000; border-radius: 16px; padding: 20px; text-align: center; margin: 24px 0; }
      .otp-label { font-size: 11px; font-weight: 700; color: #000000; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
      .otp-number { font-size: 32px; font-weight: 800; font-family: monospace; letter-spacing: 6px; color: #000000; }
      .cta-box { text-align: center; margin: 28px 0; }
      .cta-btn { display: inline-block; background: #000000; color: #ffffff !important; text-decoration: none; font-size: 14px; font-weight: 700; padding: 14px 32px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); }
      .notice { background: #f1f5f9; border-radius: 12px; padding: 16px; font-size: 12px; color: #64748b; line-height: 1.5; margin-top: 24px; }
      .footer { text-align: center; padding: 24px 32px; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="header">
          <div class="brand">Pulse</div>
          <div class="badge">Passwordless Secure Access</div>
        </div>
        <div class="body">
          <h1 class="title">Sign In With Your Magic Link</h1>
          <p class="paragraph">
            You requested passwordless sign-in for your Pulse workplace account. Open the link below and choose Continue to finish signing in.
          </p>

          ${
            magicLink
              ? `<div class="cta-box">
                  <a href="${magicLink}" class="cta-btn" target="_blank" rel="noopener noreferrer">
                    Sign In to Pulse
                  </a>
                </div>`
              : ""
          }

          <div class="notice">
            This secure sign-in link can only be used once. If you did not request this login, please contact your workplace administrator.
          </div>
        </div>
        <div class="footer">
          Delivered securely via Hostinger SMTP &bull; Pulse Platform
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export async function sendMagicLinkEmail(params: SendMagicLinkParams): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  const { to } = params;
  const subject = `Your Secure Sign-In Link for Pulse`;
  const htmlContent = buildMagicLinkEmailHtml(params);

  // 1. Hostinger SMTP
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = getSmtpTransporter();
      if (transporter) {
        const fromAddress = process.env.SMTP_FROM || `Pulse <${process.env.SMTP_USER || "business@zenxea.com"}>`;
        const info = await transporter.sendMail({
          from: fromAddress,
          to,
          subject,
          html: htmlContent,
        });
        return { success: true, messageId: info.messageId };
      }
    } catch (smtpErr: any) {
      console.warn("[Hostinger SMTP Magic Link Error, falling back to Resend]:", smtpErr?.message || smtpErr);
    }
  }

  // 2. Resend fallback
  if (process.env.RESEND_API_KEY) {
    const client = resend || new Resend(process.env.RESEND_API_KEY);
    try {
      const fromAddress = process.env.RESEND_FROM_EMAIL || "Pulse <onboarding@remotehr.io>";
      const response = await client.emails.send({
        from: fromAddress,
        to: [to],
        subject,
        html: htmlContent,
      });

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      return { success: true, messageId: response.data?.id };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  }

  return { success: false, error: "Email delivery failed. Check the configured mail transport." };
}


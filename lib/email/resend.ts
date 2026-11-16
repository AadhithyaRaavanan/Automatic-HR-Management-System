import { Resend } from "resend";
import nodemailer from "nodemailer";
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
 * - Brand Deep Indigo: #14123A
 * - Brand Electric Purple: #6C5CE7
 * - Brand Border / Accent: #e2e0f0
 */
export function buildWelcomeEmailHtml(params: SendInviteEmailParams): string {
  const {
    to,
    fullName,
    role,
    jobTitle,
    departmentName,
    inviteLink,
    shiftStartTime = "09:00 AM",
    shiftEndTime = "05:00 PM",
    loginUrl = `${getSiteUrl()}/login`,
  } = params;

  const actionUrl = inviteLink || loginUrl;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Welcome to RemoteHR</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        background-color: #f7f6fd;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        color: #14123A;
        -webkit-font-smoothing: antialiased;
      }
      .wrapper {
        width: 100%;
        table-layout: fixed;
        background-color: #f7f6fd;
        padding: 30px 10px;
      }
      .container {
        max-width: 560px;
        margin: 0 auto;
        background-color: #ffffff;
        border-radius: 20px;
        border: 1px solid #e2e0f0;
        overflow: hidden;
        box-shadow: 0 4px 16px rgba(20, 18, 58, 0.06);
      }
      .header {
        background-color: #14123A;
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
        color: #6C5CE7;
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
        color: #14123A;
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
        background-color: #fcfcff;
        border: 1px solid #e2e0f0;
        border-radius: 14px;
        padding: 6px 18px;
        margin-bottom: 24px;
      }
      .details-table {
        width: 100%;
        border-collapse: collapse;
      }
      .detail-label {
        color: #6C5CE7;
        font-weight: 700;
        font-size: 13px;
        padding: 11px 12px 11px 0;
        border-bottom: 1px solid #f1f0fa;
        width: 38%;
        white-space: nowrap;
        vertical-align: middle;
      }
      .detail-value {
        color: #14123A;
        font-weight: 700;
        font-size: 13px;
        padding: 11px 0 11px 12px;
        border-bottom: 1px solid #f1f0fa;
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
        background-color: #6C5CE7;
        color: #ffffff !important;
        text-decoration: none;
        padding: 14px 32px;
        border-radius: 12px;
        font-weight: 700;
        font-size: 14px;
        letter-spacing: 0.2px;
        box-shadow: 0 4px 12px rgba(108, 92, 231, 0.25);
      }
      .security-box {
        background-color: #f7f6fd;
        border-left: 4px solid #6C5CE7;
        border-radius: 4px;
        padding: 14px 16px;
        margin-top: 24px;
        margin-bottom: 24px;
      }
      .security-title {
        font-size: 12px;
        font-weight: 700;
        color: #14123A;
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
        border-top: 1px solid #e2e0f0;
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
              Accept Invitation &amp; Set Password
            </a>
          </div>

          <div class="security-box">
            <div class="security-title">Anti-Phishing Security Notice</div>
            <p class="security-text">
              Pulse administrators will never ask for your password, TOTP code, or multi-factor authentication setup key. Always verify that your browser address bar points to your organization's legitimate domain before entering credentials.
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
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f7f6fd; padding: 24px;">
        <div style="background-color: #ffffff; max-width: 520px; margin: 0 auto; border-radius: 20px; padding: 32px; border: 1px solid #e2e0f0;">
          <h2 style="color: #6C5CE7; margin-top: 0;">RemoteHR Workplace</h2>
          <h3 style="color: #14123A;">${title}</h3>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">${message}</p>
          <div style="margin-top: 24px;">
            <a href="${actionUrl}" style="background-color: #14123A; color: #ffffff; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-size: 13px; font-weight: 700; display: inline-block;">
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
        const fromAddress = process.env.SMTP_FROM || `Pulse <hr@zenxea.com>`;
        const info = await transporter.sendMail({
          from: fromAddress,
          to,
          subject,
          html: htmlContent,
        });
        return { success: true, messageId: info.messageId };
      }
    } catch (smtpErr: any) {
      console.error("[Hostinger SMTP Error]:", smtpErr);
      return { success: false, error: smtpErr.message || "Failed to dispatch email via Hostinger SMTP" };
    }
  }

  // 2. Fall back to Resend if configured
  if (process.env.RESEND_API_KEY) {
    const client = resend || new Resend(process.env.RESEND_API_KEY);
    try {
      const fromAddress = process.env.RESEND_FROM_EMAIL || "RemoteHR <onboarding@remotehr.io>";
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
      error: "Email delivery service unavailable: neither SMTP (Hostinger) nor RESEND_API_KEY is configured in production environment.",
    };
  }

  console.warn(`[Simulated Email to ${to}] SMTP/Resend not configured. Subject: ${subject}`);
  return { success: true, simulated: true, messageId: `sim_${Date.now()}` };
}

export interface SendPasswordResetParams {
  to: string;
  otpCode?: string;
  resetLink?: string;
}

export function buildPasswordResetEmailHtml(params: SendPasswordResetParams): string {
  const { otpCode, resetLink } = params;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reset Your Password — RemoteHR</title>
    <style>
      body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
      .wrapper { width: 100%; padding: 40px 0; background-color: #f8fafc; }
      .card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 24px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
      .header { background: #14123A; padding: 32px 32px 28px; text-align: center; }
      .brand { font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; }
      .badge { display: inline-block; background: rgba(108, 92, 231, 0.25); color: #a29bfe; font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; margin-top: 8px; }
      .body { padding: 32px; }
      .title { font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 12px; line-height: 1.3; }
      .paragraph { font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px; }
      .otp-box { background: #f8fafc; border: 2px dashed #6C5CE7; border-radius: 16px; padding: 20px; text-align: center; margin: 24px 0; }
      .otp-label { font-size: 11px; font-weight: 700; color: #6C5CE7; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
      .otp-number { font-size: 32px; font-weight: 800; font-family: monospace; letter-spacing: 6px; color: #14123A; }
      .cta-box { text-align: center; margin: 28px 0; }
      .cta-btn { display: inline-block; background: #6C5CE7; color: #ffffff !important; text-decoration: none; font-size: 14px; font-weight: 700; padding: 14px 32px; border-radius: 12px; box-shadow: 0 4px 12px rgba(108, 92, 231, 0.3); }
      .notice { background: #f1f5f9; border-radius: 12px; padding: 16px; font-size: 12px; color: #64748b; line-height: 1.5; margin-top: 24px; }
      .footer { text-align: center; padding: 24px 32px; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="header">
          <div class="brand">RemoteHR</div>
          <div class="badge">Security &amp; Account Access</div>
        </div>
        <div class="body">
          <h1 class="title">Password Reset Verification</h1>
          <p class="paragraph">
            We received a request to reset the password for your RemoteHR account. You can verify your identity using the 6-digit code below or click the direct button.
          </p>

          ${
            otpCode
              ? `<div class="otp-box">
                  <div class="otp-label">Your Verification Code</div>
                  <div class="otp-number">${otpCode}</div>
                </div>`
              : ""
          }

          ${
            resetLink
              ? `<div class="cta-box">
                  <a href="${resetLink}" class="cta-btn" target="_blank" rel="noopener noreferrer">
                    Reset My Password
                  </a>
                </div>`
              : ""
          }

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
        const fromAddress = process.env.SMTP_FROM || `Pulse <hr@zenxea.com>`;
        const info = await transporter.sendMail({
          from: fromAddress,
          to: hrRecipient,
          subject,
          html,
        });
        return { success: true, messageId: info.messageId };
      }
    } catch (smtpErr: any) {
      console.error("[Hostinger SMTP Onboarding Notice Error]:", smtpErr);
      return { success: false, error: smtpErr.message || "Failed to dispatch email via Hostinger SMTP" };
    }
  }

  // 2. Fall back to Resend if configured
  if (process.env.RESEND_API_KEY) {
    const client = resend || new Resend(process.env.RESEND_API_KEY);
    try {
      const fromAddress = process.env.RESEND_FROM_EMAIL || "RemoteHR <onboarding@remotehr.io>";
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
        const fromAddress = process.env.SMTP_FROM || `Pulse <hr@zenxea.com>`;
        const info = await transporter.sendMail({
          from: fromAddress,
          to,
          subject,
          html: htmlContent,
        });
        return { success: true, messageId: info.messageId };
      }
    } catch (smtpErr: any) {
      console.error("[Hostinger SMTP Password Reset Error]:", smtpErr);
      return { success: false, error: smtpErr.message || "Failed to dispatch reset email via Hostinger SMTP" };
    }
  }

  // 2. Fall back to Resend if configured
  if (process.env.RESEND_API_KEY) {
    const client = resend || new Resend(process.env.RESEND_API_KEY);
    try {
      const fromAddress = process.env.RESEND_FROM_EMAIL || "RemoteHR <onboarding@remotehr.io>";
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

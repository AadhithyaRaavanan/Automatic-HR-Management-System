import { Resend } from "resend";

const resendApiKey = process.env.RESEND_API_KEY;

export const resend = resendApiKey ? new Resend(resendApiKey) : null;

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
    loginUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/login`
      : "http://localhost:3000/login",
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
        padding: 20px;
        margin-bottom: 24px;
      }
      .detail-row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        border-bottom: 1px solid #f1f0fa;
        font-size: 13px;
      }
      .detail-row:last-child {
        border-bottom: none;
      }
      .detail-label {
        color: #6C5CE7;
        font-weight: 600;
      }
      .detail-value {
        color: #14123A;
        font-weight: 700;
        text-align: right;
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
          <div class="brand-title">RemoteHR</div>
          <div class="brand-tag">Secure Workforce Management</div>
        </div>
        <div class="body-content">
          <h2 class="welcome-heading">Welcome, ${fullName}!</h2>
          <p class="intro-text">
            Your organization has invited you to join RemoteHR with the role of
            <strong>${role.toUpperCase()}</strong>.
            ${jobTitle ? `You are appointed as <strong>${jobTitle}</strong>.` : ""}
            ${departmentName ? `Assigned department: <strong>${departmentName}</strong>.` : ""}
          </p>

          <div class="details-card">
            <div class="detail-row">
              <span class="detail-label">Login Email</span>
              <span class="detail-value">${to}</span>
            </div>
            ${
              departmentName
                ? `
            <div class="detail-row">
              <span class="detail-label">Department</span>
              <span class="detail-value">${departmentName}</span>
            </div>`
                : ""
            }
            ${
              jobTitle
                ? `
            <div class="detail-row">
              <span class="detail-label">Title</span>
              <span class="detail-value">${jobTitle}</span>
            </div>`
                : ""
            }
            <div class="detail-row">
              <span class="detail-label">Working Hours</span>
              <span class="detail-value">${shiftStartTime} - ${shiftEndTime}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">System Role</span>
              <span class="detail-value">${role.toUpperCase()}</span>
            </div>
          </div>

          <div class="cta-container">
            <a href="${actionUrl}" class="cta-button" target="_blank" rel="noopener noreferrer">
              Accept Invitation &amp; Set Password
            </a>
          </div>

          <div class="security-box">
            <div class="security-title">Anti-Phishing Security Notice</div>
            <p class="security-text">
              RemoteHR administrators will never ask for your password, TOTP code, or multi-factor authentication setup key. Always verify that your browser address bar points to your organization's legitimate RemoteHR domain before entering any credentials.
            </p>
          </div>
        </div>
        <div class="footer">
          RemoteHR Automated Management System &bull; Zero Invasive Monitoring<br />
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
  const subject = `Welcome to RemoteHR — Your Account Invitation`;
  const htmlContent = buildWelcomeEmailHtml(params);

  // Fail closed in production if RESEND_API_KEY is not configured
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "production") {
      return {
        success: false,
        error: "Email delivery service unavailable: RESEND_API_KEY is not configured in production environment.",
      };
    }
    // In development and test environments, fall back cleanly with a logged warning
    console.warn(`[Resend Simulated Email to ${to}] RESEND_API_KEY not configured. Subject: ${subject}`);
    return { success: true, simulated: true, messageId: `sim_${Date.now()}` };
  }

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

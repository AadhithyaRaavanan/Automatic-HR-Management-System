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
    loginUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/login`
      : "http://localhost:3000/login",
  } = params;

  const subject = `Welcome to RemoteHR — Your Account Credentials`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Welcome to RemoteHR</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7f6fd; color: #1e1b4b; margin: 0; padding: 24px; }
          .card { background-color: #ffffff; max-width: 540px; margin: 0 auto; border-radius: 20px; padding: 32px; border: 1px solid #e2e0f0; box-shadow: 0 4px 12px rgba(108, 92, 231, 0.08); }
          .header { text-align: center; margin-bottom: 24px; }
          .brand { font-size: 20px; font-weight: 800; color: #6c5ce7; }
          .title { font-size: 18px; font-weight: 700; margin-top: 8px; color: #1e1b4b; }
          .info-box { background-color: #f8f7ff; border-radius: 12px; padding: 18px; border: 1px solid #e6e4f7; margin: 20px 0; }
          .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
          .label { color: #64748b; font-weight: 600; }
          .val { color: #0f172a; font-weight: 700; font-family: monospace; }
          .btn { display: inline-block; background-color: #1e1b4b; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 12px; font-weight: 700; font-size: 13px; margin-top: 16px; }
          .footer { font-size: 11px; color: #94a3b8; text-align: center; margin-top: 24px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <div class="brand">RemoteHR</div>
            <div class="title">Welcome, ${fullName}!</div>
          </div>
          <p style="font-size: 13px; line-height: 1.6; color: #334155;">
            An account has been created for you at RemoteHR with security role <strong>${role.toUpperCase()}</strong>.
            ${jobTitle ? `You are appointed as <strong>${jobTitle}</strong>.` : ""}
            ${departmentName ? `Assigned department: <strong>${departmentName}</strong>.` : ""}
            Your assigned working hours are <strong>${shiftStartTime} - ${shiftEndTime}</strong>.
          </p>
          <div class="info-box">
            <div class="info-row">
              <span class="label">Login Email:</span>
              <span class="val">${to}</span>
            </div>
            ${
              jobTitle
                ? `
            <div class="info-row">
              <span class="label">Company Role / Title:</span>
              <span class="val">${jobTitle}</span>
            </div>
            `
                : ""
            }
            ${
              departmentName
                ? `
            <div class="info-row">
              <span class="label">Department:</span>
              <span class="val">${departmentName}</span>
            </div>
            `
                : ""
            }
            <div class="info-row">
              <span class="label">Portal URL:</span>
              <span class="val">${loginUrl}</span>
            </div>
          </div>
          <p style="font-size: 12px; color: #64748b;">
            Click below to accept your invitation and securely configure your password (link expires in 24 hours).
          </p>
          <div style="text-align: center;">
            <a href="${inviteLink || loginUrl}" class="btn">Accept Invitation &amp; Set Password</a>
          </div>
          <div class="footer">
            RemoteHR Secure Automated Workplace &bull; Zero Invasive Monitoring
          </div>
        </div>
      </body>
    </html>
  `;

  if (!resend) {
    if (process.env.NODE_ENV === "production") {
      return {
        success: false,
        error: "Email delivery service unavailable: RESEND_API_KEY is not configured in production environment.",
      };
    }
    // In non-production environments, simulate dispatch without leaking credentials
    console.log(`[Resend Simulated Email to ${to}] Subject: ${subject}`);
    return { success: true, simulated: true, messageId: `sim_${Date.now()}` };
  }

  try {
    const fromAddress = process.env.RESEND_FROM_EMAIL || "RemoteHR <onboarding@resend.dev>";
    const response = await resend.emails.send({
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

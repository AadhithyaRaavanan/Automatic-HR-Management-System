/**
 * Global Application Branding & Configuration
 * Reads customizable white-label settings from environment with sensible defaults.
 */

export interface AppConfig {
  companyName: string;
  supportEmail: string;
  privacyPolicyUrl: string;
  termsOfServiceUrl: string;
  appUrl: string;
}

export const appConfig: AppConfig = {
  companyName: process.env.COMPANY_NAME || "RemoteHR",
  supportEmail: process.env.SUPPORT_EMAIL || "support@remotehr.io",
  privacyPolicyUrl: process.env.PRIVACY_POLICY_URL || "/privacy",
  termsOfServiceUrl: process.env.TERMS_OF_SERVICE_URL || "/terms",
  appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
};

export default appConfig;

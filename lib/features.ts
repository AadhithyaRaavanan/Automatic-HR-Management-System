export const FEATURES = {
  KPI: false,
  TASKS: false,
  LOCATIONS: process.env.NEXT_PUBLIC_FEATURE_LOCATIONS === 'true',
  SHIFTS: process.env.NEXT_PUBLIC_FEATURE_SHIFTS === 'true',
  AUDITS: process.env.NEXT_PUBLIC_FEATURE_AUDITS === 'true',
};

# RemoteHR Enterprise Feature Roadmap

This document outlines features, hardware integrations, and workflow extensions that are deliberately planned for subsequent enterprise phases and are not part of the core production release.

---

## 1. Physical & Hardware Punch Channels (Enterprise Roadmap)
Currently in development and gated behind the Punch Channels Governance card in `/admin/settings`:

1. **Geofencing Punch Validation**:
   - Mobile and desktop GPS coordinate validation against configured office boundaries (latitude, longitude, radius).
   - Real-time client-side location query with backend validation in `public.check_in` / `public.check_out`.

2. **Office IP Whitelisting**:
   - Restricting punch operations to validated corporate gateway CIDR blocks / static egress IPs.
   - Database schema placeholders currently stored in `organizations.allowed_ip_ranges`.

3. **Rotating Dynamic QR Code**:
   - Wall-mounted tablet display rendering TOTP-style rotating QR codes that refresh every 15–30 seconds.
   - Eliminates employee proxy punching via camera scanning on mobile web.

4. **Dedicated Hardware Kiosk Support**:
   - Shared front-desk tablets with camera face-match or NFC badge swipe punch verification.

---

## 2. Zen Xea Advanced Workforce Scheduling (Phase 3 Extension)
The following specialized rules and extensions are tracked for future integration:

1. **Granular Break Tracking**:
   - Tracking lunch, tea, and short intermittent pause sessions within an active shift.
   - Dedicated pause/resume timers with policy-driven deduction.

2. **Short Permission Slip Requests**:
   - Two-hour permission requests for delayed reporting or early departure.
   - Automatic deduction from monthly grace periods upon managerial sign-off.

3. **Automated Monthly Late Allowance Deductions**:
   - Policy allowing up to 3 late arrivals per month (<15 mins) before converting subsequent infractions into half-day leave deductions.

4. **Multi-Step Leave Approval Workflows**:
   - Sequential multi-tier approvals (Reporting Manager -> Department Head -> HR Director).

5. **Earned Leave (EL) Accrual Compounding Engine**:
   - Monthly and quarterly fractional accrual compounding based on tenure and completed shifts.

6. **Drizzle ORM Evaluation**:
   - Abstracting direct SQL queries with type-safe schema definitions if multi-database target support is required.

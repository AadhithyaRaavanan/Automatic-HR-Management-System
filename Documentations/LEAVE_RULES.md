# Leave & Attendance Policy Rules

## Half-Day Overlap Rule

Active leave requests (`status IN ('pending', 'approved')`) enforce a half-day slot exclusion constraint (`exclude_overlapping_leave_requests`) per employee:

- Each calendar date `d` (measured as days since `2000-01-01`) occupies two half-day integer slots: `[2*d, 2*d + 1)` (`first_half`) and `[2*d + 1, 2*d + 2)` (`second_half`).
- A `full` day leave request covering `[start_date, end_date]` occupies `[2*(start_date - '2000-01-01'), 2*(end_date - '2000-01-01') + 2)`.
- A `first_half` leave request requires `start_date = end_date` and occupies `[2*d, 2*d + 1)`.
- A `second_half` leave request requires `start_date = end_date` and occupies `[2*d + 1, 2*d + 2)`.

**Allowed vs. Disallowed Combinations on the Same Date:**
- **Allowed:** One `first_half` request and one `second_half` request on the same date (e.g., morning Casual Leave + afternoon Sick Leave), totaling 1.0 working day.
- **Disallowed:** Two `first_half` requests, two `second_half` requests, or a `full` day request overlapping any `first_half`, `second_half`, or `full` day request on the same date.

## Month Locking & Cancellation Rules

- `attendance_days.locked` is the single canonical lock source across attendance, regularization approvals, leave approvals, and leave cancellations (controlled via `lock_month` and admin-only `unlock_month`).
- `cancel_leave` restores unused balance (if previously approved) and calls `recalculate_day()` for each date in the cancelled leave range rather than hardcoding `'absent'` or `'regular'`.
- `recalculate_day()` never marks future dates (`work_date > local today`) as `'absent'`; if a future date has no sessions, holidays, weekends, or active approved leave, any stale non-locked future day record is removed.

## Sole-Admin Leave Approval Fallback

- Standard separation of duties strictly prohibits any employee, manager, HR officer, or admin from approving or rejecting their own leave request (`employee_id = caller_id`).
- **Sole-Admin Organization Exception:** When an `admin` at `aal2` submits leave and the organization has **zero** other active `'admin'` or `'hr'` members (`organization_members.status = 'active'`) and the admin has no assigned active manager, `approve_leave` permits self-approval and explicitly records `"sole_admin_fallback": true` and `"regular_approvers_present": 0` in `audit_logs.new_data`.


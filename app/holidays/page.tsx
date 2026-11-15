"use client";

import * as React from "react";
import Link from "next/link";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { BentoGrid } from "@/components/bento/bento-grid";
import { BentoCard } from "@/components/bento/bento-card";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/shared/empty-state";
import {
  CalendarDays,
  Plus,
  Trash2,
  Edit3,
  Lock,
  Sliders,
  ShieldCheck,
  Sparkles,
  MapPin,
  Download,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getTamilMonthInfo } from "@/lib/date/holidays-tn";
import { createClient } from "@/lib/supabase/client";
import { HolidayType } from "@/types/database.types";
import { isDemoModeEnabled } from "@/lib/config/demo";
import {
  getStoredHolidays,
  addStoredHoliday,
  deleteStoredHoliday,
  DemoHoliday,
} from "@/lib/storage/demo-store";

interface HolidayDisplayItem {
  id: string;
  name: string;
  local_name: string | null;
  date: string;
  region: string;
  holiday_type: HolidayType;
  is_active: boolean;
}

interface HolidayTemplateOption {
  template_code: string;
  template_name: string;
  region_code: string;
  count: number;
}

function HolidaysPageContent() {
  const { userRole } = useAppSession();
  const isHrOrAdmin = userRole === "hr" || userRole === "admin";
  const isAdmin = userRole === "admin";
  const supabase = React.useMemo(() => createClient(), []);

  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;

  const [selectedYear, setSelectedYear] = React.useState<number>(currentYear);
  const [holidays, setHolidays] = React.useState<HolidayDisplayItem[]>([]);
  const [nextYearCount, setNextYearCount] = React.useState<number | null>(null);
  const [templates, setTemplates] = React.useState<HolidayTemplateOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [regionFilter, setRegionFilter] = React.useState<string>("ALL");

  // Add Holiday Form state
  const [newName, setNewName] = React.useState("");
  const [newLocalName, setNewLocalName] = React.useState("");
  const [newDate, setNewDate] = React.useState(`${currentYear}-01-01`);
  const [newRegion, setNewRegion] = React.useState("TN");
  const [newType, setNewType] = React.useState<HolidayType>("public");
  const [submitting, setSubmitting] = React.useState(false);

  // Edit Holiday Modal state
  const [editTarget, setEditTarget] = React.useState<HolidayDisplayItem | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editLocalName, setEditLocalName] = React.useState("");
  const [editDate, setEditDate] = React.useState("");
  const [editRegion, setEditRegion] = React.useState("TN");
  const [editType, setEditType] = React.useState<HolidayType>("public");

  // Import Template Modal state
  const [importModalOpen, setImportModalOpen] = React.useState(false);
  const [importTemplateCode, setImportTemplateCode] = React.useState("IN_TN");
  const [importYear, setImportYear] = React.useState<number>(nextYear);
  const [importing, setImporting] = React.useState(false);

  // Policy states
  const [graceMinutes, setGraceMinutes] = React.useState(15);
  const [halfDayMinutes, setHalfDayMinutes] = React.useState(240);
  const [autoCheckoutTime, setAutoCheckoutTime] = React.useState("23:59");
  const [savingPolicy, setSavingPolicy] = React.useState(false);

  const loadHolidaysAndTemplates = React.useCallback(async () => {
    setLoading(true);
    try {
      const yearStart = `${selectedYear}-01-01`;
      const yearEnd = `${selectedYear}-12-31`;
      const nextYearStart = `${nextYear}-01-01`;
      const nextYearEnd = `${nextYear}-12-31`;

      const [holRes, nextCountRes, tplRes, polRes] = await Promise.all([
        (supabase as any)
          .from("holidays")
          .select("id, date, name, local_name, region, holiday_type, is_active")
          .gte("date", yearStart)
          .lte("date", yearEnd)
          .order("date", { ascending: true }),
        (supabase as any)
          .from("holidays")
          .select("id", { count: "exact", head: true })
          .gte("date", nextYearStart)
          .lte("date", nextYearEnd)
          .eq("is_active", true),
        (supabase as any)
          .from("holiday_templates")
          .select("template_code, template_name, region_code"),
        (supabase as any)
          .from("attendance_policies")
          .select("grace_minutes, half_day_minutes, auto_checkout_time")
          .limit(1)
          .maybeSingle(),
      ]);

      const storedHols = getStoredHolidays();
      if (!holRes.error && holRes.data && holRes.data.length > 0) {
        setHolidays(
          holRes.data.map((item: any) => ({
            id: item.id,
            name: item.name,
            local_name: item.local_name || null,
            date: item.date,
            region: item.region || "GLOBAL",
            holiday_type: (item.holiday_type || "public") as HolidayType,
            is_active: item.is_active !== false,
          }))
        );
      } else {
        setHolidays(
          storedHols.map((item) => ({
            id: item.id,
            name: item.name,
            local_name: item.notes || null,
            date: item.holiday_date,
            region: "GLOBAL",
            holiday_type: (item.is_half_day ? "special" : "public") as HolidayType,
            is_active: true,
          }))
        );
      }

      if (typeof nextCountRes.count === "number") {
        setNextYearCount(nextCountRes.count);
      }

      if (!tplRes.error && tplRes.data) {
        const map = new Map<string, HolidayTemplateOption>();
        for (const row of tplRes.data) {
          const existing = map.get(row.template_code);
          if (existing) {
            existing.count += 1;
          } else {
            map.set(row.template_code, {
              template_code: row.template_code,
              template_name: row.template_name,
              region_code: row.region_code,
              count: 1,
            });
          }
        }
        const list = Array.from(map.values());
        setTemplates(list);
        if (list.length > 0 && !list.some((t) => t.template_code === importTemplateCode)) {
          setImportTemplateCode(list[0].template_code);
        }
      }

      if (!polRes.error && polRes.data) {
        setGraceMinutes(polRes.data.grace_minutes ?? 15);
        setHalfDayMinutes(polRes.data.half_day_minutes ?? 240);
        setAutoCheckoutTime(String(polRes.data.auto_checkout_time || "23:59").slice(0, 5));
      }
    } catch {
      // Keep UI resilient
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedYear, nextYear, importTemplateCode]);

  React.useEffect(() => {
    loadHolidaysAndTemplates();
    const handleStorageChange = () => loadHolidaysAndTemplates();
    window.addEventListener("remotehr_storage_change", handleStorageChange);
    return () => {
      window.removeEventListener("remotehr_storage_change", handleStorageChange);
    };
  }, [loadHolidaysAndTemplates]);

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newDate) {
      toast.error("Holiday name and date are required.");
      return;
    }

    if (isDemoModeEnabled()) {
      const created = addStoredHoliday({
        name: newName.trim(),
        holiday_date: newDate,
        is_half_day: newType === "special",
        notes: newLocalName.trim() || null,
      });
      const newHol: HolidayDisplayItem = {
        id: created.id,
        name: created.name,
        local_name: created.notes || null,
        date: created.holiday_date,
        region: newRegion,
        holiday_type: newType,
        is_active: true,
      };
      setHolidays((prev) => [newHol, ...prev]);
      toast.success(`Holiday "${newName.trim()}" added.`);
      setNewName("");
      setNewLocalName("");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await (supabase.rpc as any)("create_holiday", {
        p_date: newDate,
        p_name: newName.trim(),
        p_local_name: newLocalName.trim() || null,
        p_region: newRegion,
        p_holiday_type: newType,
      });
      if (error) throw error;

      toast.success(`Holiday "${newName.trim()}" added.`);
      setNewName("");
      setNewLocalName("");
      await loadHolidaysAndTemplates();
    } catch (err: any) {
      toast.error(err?.message || "Failed to add holiday.");
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (h: HolidayDisplayItem) => {
    setEditTarget(h);
    setEditName(h.name);
    setEditLocalName(h.local_name || "");
    setEditDate(h.date);
    setEditRegion(h.region || "GLOBAL");
    setEditType(h.holiday_type || "public");
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || !editName.trim() || !editDate) return;

    if (isDemoModeEnabled()) {
      setHolidays((prev) =>
        prev.map((h) =>
          h.id === editTarget.id
            ? {
                ...h,
                name: editName.trim(),
                local_name: editLocalName.trim() || null,
                date: editDate,
                region: editRegion,
                holiday_type: editType,
              }
            : h
        )
      );
      toast.success(`Holiday "${editName.trim()}" updated. (demo session)`);
      setEditTarget(null);
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await (supabase.rpc as any)("update_holiday", {
        p_holiday_id: editTarget.id,
        p_date: editDate,
        p_name: editName.trim(),
        p_local_name: editLocalName.trim() || null,
        p_region: editRegion,
        p_holiday_type: editType,
        p_is_active: true,
      });
      if (error) throw error;
      toast.success(`Holiday "${editName.trim()}" updated.`);
      setEditTarget(null);
      await loadHolidaysAndTemplates();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update holiday.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteHoliday = async (id: string, name: string) => {
    deleteStoredHoliday(id);
    if (isDemoModeEnabled()) {
      setHolidays((prev) => prev.filter((h) => h.id !== id));
      toast.success(`Holiday "${name}" deleted.`);
      return;
    }

    try {
      const { error } = await (supabase.rpc as any)("delete_holiday", {
        p_holiday_id: id,
      });
      if (error) throw error;
      toast.success(`Holiday "${name}" deleted.`);
      await loadHolidaysAndTemplates();
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete holiday.");
    }
  };

  const handleImportTemplate = async (code: string, year: number) => {
    if (isDemoModeEnabled()) {
      toast.success(`Imported 12 holiday(s) for ${year} from ${code} template. (demo session)`);
      setImportModalOpen(false);
      return;
    }

    setImporting(true);
    try {
      const { data, error } = await (supabase.rpc as any)("import_holiday_template", {
        p_template_code: code,
        p_year: year,
      });
      if (error) throw error;
      const inserted = (data as any)?.inserted_count ?? 0;
      const skipped = (data as any)?.skipped_count ?? 0;
      toast.success(
        `Imported ${inserted} holiday(s) for ${year}${skipped > 0 ? ` (${skipped} duplicates skipped)` : ""}.`
      );
      setImportModalOpen(false);
      setSelectedYear(year);
      await loadHolidaysAndTemplates();
    } catch (err: any) {
      toast.error(err?.message || "Failed to import holiday template.");
    } finally {
      setImporting(false);
    }
  };

  const handleSavePolicies = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    if (isDemoModeEnabled()) {
      toast.success("Attendance policies updated. (demo session)");
      return;
    }

    setSavingPolicy(true);
    try {
      const { error } = await (supabase.rpc as any)("admin_update_attendance_policy", {
        p_grace_minutes: graceMinutes,
        p_half_day_minutes: halfDayMinutes,
        p_auto_checkout_time: `${autoCheckoutTime}:00`,
      });
      if (error) throw error;
      toast.success("Attendance policies updated.");
    } catch (err: any) {
      toast.error(err?.message || "Failed to update policies.");
    } finally {
      setSavingPolicy(false);
    }
  };

  const distinctRegions = React.useMemo(() => {
    const set = new Set<string>(holidays.map((h) => h.region || "GLOBAL"));
    return ["ALL", ...Array.from(set)];
  }, [holidays]);

  const filteredHolidays = holidays.filter((h) => {
    if (regionFilter === "ALL") return true;
    return h.region === regionFilter;
  });

  const currentTamilMonth = getTamilMonthInfo();
  const yearsList = [currentYear - 1, currentYear, nextYear, nextYear + 1];

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight">
              Holidays & Company Policies
            </h1>
            <span className="px-3 py-1 rounded-full bg-brand-purple-light text-brand-purple text-xs font-bold border border-brand-purple/20 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              <span>Organization Calendar ({selectedYear})</span>
            </span>
          </div>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Database-driven public holidays, regional templates, and shift evaluation thresholds.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-card border border-border-light rounded-full p-1 shadow-sm">
            {yearsList.map((yr) => (
              <button
                key={yr}
                type="button"
                onClick={() => {
                  setSelectedYear(yr);
                  setNewDate(`${yr}-01-01`);
                }}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer",
                  selectedYear === yr
                    ? "bg-brand-purple text-white shadow-sm"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                {yr}
              </button>
            ))}
          </div>

          {isHrOrAdmin && (
            <button
              type="button"
              onClick={() => {
                setImportYear(selectedYear);
                setImportModalOpen(true);
              }}
              className="px-4 py-2 rounded-full bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Import Template</span>
            </button>
          )}

          {isHrOrAdmin && (
            <Link
              href="/reports"
              className="px-3.5 py-2 rounded-full bg-card border border-border-light text-xs font-bold text-text-primary hover:bg-card-subtle flex items-center gap-1.5 shadow-sm transition-colors"
            >
              <Lock className="w-3.5 h-3.5 text-brand-purple" />
              <span>Month-End Close →</span>
            </Link>
          )}
        </div>
      </section>

      {/* Next-Year Missing Holidays Alert Banner */}
      {nextYearCount === 0 && (
        <div
          role="status"
          className="p-4 rounded-3xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-amber-900 dark:text-amber-200">
                No holidays configured for {nextYear}
              </h2>
              <p className="text-xs text-amber-800/90 dark:text-amber-300/90 mt-0.5">
                Import a regional holiday template (such as India - Tamil Nadu) so {nextYear} leave deductions and attendance calculations are accurate.
              </p>
            </div>
          </div>

          {isHrOrAdmin && (
            <button
              type="button"
              disabled={importing}
              onClick={() => handleImportTemplate("IN_TN", nextYear)}
              className="px-4 py-2 rounded-full bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shrink-0 cursor-pointer transition-colors disabled:opacity-50"
            >
              {importing ? "Importing..." : `Import India - Tamil Nadu (${nextYear})`}
            </button>
          )}
        </div>
      )}

      {/* Calendar Highlight Banner + Filter */}
      <div className="p-4 rounded-3xl bg-gradient-to-r from-brand-purple/15 via-brand-purple/5 to-card-subtle border border-brand-purple/25 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-brand-purple text-white flex items-center justify-center shadow-float shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-text-primary">
                Regional Calendar Sync Active
              </h2>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand-purple text-white">
                {holidays.length} in {selectedYear}
              </span>
            </div>
            <p className="text-xs text-text-secondary mt-0.5">
              Tamil Solar Month:{" "}
              <span className="font-bold text-brand-purple">
                {currentTamilMonth.tamil} ({currentTamilMonth.english})
              </span>{" "}
              • {currentTamilMonth.seasonTa}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-card rounded-2xl p-1 border border-border-light shadow-sm overflow-x-auto">
          {distinctRegions.map((rf) => (
            <button
              key={rf}
              type="button"
              onClick={() => setRegionFilter(rf)}
              className={cn(
                "px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap",
                regionFilter === rf
                  ? "bg-brand-purple text-white shadow-sm"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              {rf === "ALL" ? `All (${holidays.length})` : rf}
            </button>
          ))}
        </div>
      </div>

      {/* Bento Grid */}
      <BentoGrid>
        {/* Holidays List & Add Form */}
        <BentoCard
          title={
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-brand-purple" />
              <span>Public & Company Holidays ({selectedYear})</span>
            </div>
          }
          subtitle="Working-day calculations automatically excuse active holidays"
          className="lg:col-span-7 p-6 flex flex-col justify-between"
        >
          {loading ? (
            <div className="space-y-2.5">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-16 rounded-2xl bg-card-subtle animate-pulse border border-border-light"
                />
              ))}
            </div>
          ) : filteredHolidays.length > 0 ? (
            <div className="space-y-2.5 max-h-[440px] overflow-y-auto pr-1">
              {filteredHolidays.map((h) => (
                <div
                  key={h.id}
                  className="p-3.5 rounded-2xl bg-card-subtle border border-border-light flex items-center justify-between hover:bg-card transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-10 rounded-xl bg-brand-purple-light flex items-center justify-center font-bold text-xs text-brand-purple font-mono shrink-0">
                      {h.date.slice(5)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-xs font-bold text-text-primary truncate">
                          {h.name}
                        </h3>
                        <span className="px-1.5 py-0.2 rounded-md bg-brand-purple/10 text-brand-purple text-[9px] font-bold uppercase">
                          {h.holiday_type}
                        </span>
                      </div>
                      {h.local_name && (
                        <p className="text-[11px] font-medium text-brand-purple mt-0.5 truncate">
                          {h.local_name}
                        </p>
                      )}
                      <span className="text-[10px] font-mono text-text-tertiary">
                        {h.date}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-card border border-border-light text-text-secondary">
                      {h.region}
                    </span>
                    {isHrOrAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditModal(h)}
                          className="p-1.5 rounded-lg text-text-tertiary hover:text-brand-purple hover:bg-card cursor-pointer transition-colors"
                          title={`Edit ${h.name}`}
                          aria-label={`Edit ${h.name}`}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteHoliday(h.id, h.name)}
                          className="p-1.5 rounded-lg text-text-tertiary hover:text-status-danger-text hover:bg-card cursor-pointer transition-colors"
                          title={`Delete ${h.name}`}
                          aria-label={`Delete ${h.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<CalendarDays className="w-6 h-6" />}
              title={`No holidays found for ${selectedYear}`}
              description={
                isHrOrAdmin
                  ? "Add a holiday below or import a built-in region template to populate this year's calendar."
                  : "HR has not configured public holidays for this year yet."
              }
              action={
                isHrOrAdmin ? (
                  <button
                    type="button"
                    onClick={() => {
                      setImportYear(selectedYear);
                      setImportModalOpen(true);
                    }}
                    className="px-4 py-2 rounded-full bg-brand-purple text-white text-xs font-bold cursor-pointer"
                  >
                    Import Region Template
                  </button>
                ) : undefined
              }
            />
          )}

          {/* Add Holiday Form (HR / Admin only) */}
          {isHrOrAdmin && (
            <form
              onSubmit={handleAddHoliday}
              className="mt-6 pt-4 border-t border-border-light grid grid-cols-1 sm:grid-cols-6 gap-2.5"
            >
              <input
                type="text"
                aria-label="Holiday Name (English)"
                placeholder="English Name"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="sm:col-span-2 px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple"
              />
              <input
                type="text"
                aria-label="Local Holiday Name"
                placeholder="Local Name (e.g. தமிழ்)"
                value={newLocalName}
                onChange={(e) => setNewLocalName(e.target.value)}
                className="sm:col-span-2 px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple"
              />
              <input
                type="date"
                aria-label="Holiday Date"
                required
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary focus:outline-none focus:border-brand-purple"
              />
              <button
                type="submit"
                disabled={submitting}
                className="py-2 px-3 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>

              <div className="sm:col-span-3">
                <select
                  aria-label="Holiday Region"
                  value={newRegion}
                  onChange={(e) => setNewRegion(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                >
                  <option value="TN">Region: Tamil Nadu (TN)</option>
                  <option value="IN">Region: India National (IN)</option>
                  <option value="US">Region: United States (US)</option>
                  <option value="GLOBAL">Region: Global</option>
                </select>
              </div>
              <div className="sm:col-span-3">
                <select
                  aria-label="Holiday Type"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as HolidayType)}
                  className="w-full px-3 py-1.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                >
                  <option value="public">Type: Public Gazetted</option>
                  <option value="company">Type: Company Day Off</option>
                  <option value="special">Type: Special Regional</option>
                </select>
              </div>
            </form>
          )}
        </BentoCard>

        {/* Policy Configurations */}
        <BentoCard
          title={
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-brand-purple" />
              <span>Attendance Shift Rules</span>
            </div>
          }
          subtitle={
            isAdmin
              ? "Admin-controlled parameters used by recalculate_day"
              : "Organization thresholds applied automatically during daily calculations"
          }
          className="lg:col-span-5 p-6 flex flex-col justify-between"
        >
          <form onSubmit={handleSavePolicies} className="space-y-4">
            <div>
              <label
                htmlFor="policy-grace-mins"
                className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1"
              >
                Grace Period (Minutes)
              </label>
              <p className="text-[11px] text-text-tertiary mb-1.5">
                Arrival tolerance after scheduled shift start before marking late.
              </p>
              <input
                id="policy-grace-mins"
                type="number"
                min={0}
                max={60}
                disabled={!isAdmin}
                value={graceMinutes}
                onChange={(e) => setGraceMinutes(Number(e.target.value))}
                className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-bold text-text-primary disabled:opacity-70"
              />
            </div>

            <div>
              <label
                htmlFor="policy-halfday-mins"
                className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1"
              >
                Half-Day Threshold (Minutes)
              </label>
              <p className="text-[11px] text-text-tertiary mb-1.5">
                Minimum logged minutes to qualify as Half-Day.
              </p>
              <input
                id="policy-halfday-mins"
                type="number"
                min={60}
                max={360}
                disabled={!isAdmin}
                value={halfDayMinutes}
                onChange={(e) => setHalfDayMinutes(Number(e.target.value))}
                className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-bold text-text-primary disabled:opacity-70"
              />
            </div>

            <div>
              <label
                htmlFor="policy-autocheckout"
                className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1"
              >
                Auto-Checkout Cutoff
              </label>
              <p className="text-[11px] text-text-tertiary mb-1.5">
                Nightly maintenance closes open shifts past this boundary.
              </p>
              <input
                id="policy-autocheckout"
                type="time"
                disabled={!isAdmin}
                value={autoCheckoutTime}
                onChange={(e) => setAutoCheckoutTime(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-bold text-text-primary disabled:opacity-70"
              />
            </div>

            <div className="pt-3 border-t border-border-light">
              {isAdmin ? (
                <button
                  type="submit"
                  disabled={savingPolicy}
                  className="w-full py-2.5 px-4 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{savingPolicy ? "Saving..." : "Update Policy Rules"}</span>
                </button>
              ) : (
                <p className="text-[11px] text-text-tertiary flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-brand-purple" />
                  Policy threshold updates require an Administrator account with MFA.
                </p>
              )}
            </div>
          </form>
        </BentoCard>
      </BentoGrid>

      {/* Edit Holiday Modal */}
      <Modal
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        title="Edit Holiday"
        description="Updates are audited and immediately affect attendance calculations"
      >
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div>
            <label
              htmlFor="edit-holiday-name"
              className="block text-xs font-bold text-text-primary mb-1"
            >
              English Name
            </label>
            <input
              id="edit-holiday-name"
              type="text"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
            />
          </div>

          <div>
            <label
              htmlFor="edit-holiday-local"
              className="block text-xs font-bold text-text-primary mb-1"
            >
              Local Name (Optional)
            </label>
            <input
              id="edit-holiday-local"
              type="text"
              value={editLocalName}
              onChange={(e) => setEditLocalName(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="edit-holiday-date"
                className="block text-xs font-bold text-text-primary mb-1"
              >
                Date
              </label>
              <input
                id="edit-holiday-date"
                type="date"
                required
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="w-full px-2.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
              />
            </div>

            <div>
              <label
                htmlFor="edit-holiday-region"
                className="block text-xs font-bold text-text-primary mb-1"
              >
                Region
              </label>
              <select
                id="edit-holiday-region"
                value={editRegion}
                onChange={(e) => setEditRegion(e.target.value)}
                className="w-full px-2.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
              >
                <option value="TN">TN</option>
                <option value="IN">IN</option>
                <option value="US">US</option>
                <option value="GLOBAL">GLOBAL</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="edit-holiday-type"
                className="block text-xs font-bold text-text-primary mb-1"
              >
                Type
              </label>
              <select
                id="edit-holiday-type"
                value={editType}
                onChange={(e) => setEditType(e.target.value as HolidayType)}
                className="w-full px-2.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
              >
                <option value="public">Public</option>
                <option value="company">Company</option>
                <option value="special">Special</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditTarget(null)}
              className="px-4 py-2 rounded-xl bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Import Template Modal */}
      <Modal
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
        title="Import Regional Holiday Template"
        description="Templates are copied into your organization and can be edited freely afterwards"
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="import-template-select"
              className="block text-xs font-bold text-text-primary mb-1"
            >
              Region Template
            </label>
            <select
              id="import-template-select"
              value={importTemplateCode}
              onChange={(e) => setImportTemplateCode(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
            >
              {templates.length > 0 ? (
                templates.map((t) => (
                  <option key={t.template_code} value={t.template_code}>
                    {t.template_name} ({t.count} holidays)
                  </option>
                ))
              ) : (
                <option value="IN_TN">India - Tamil Nadu</option>
              )}
            </select>
          </div>

          <div>
            <label
              htmlFor="import-year-input"
              className="block text-xs font-bold text-text-primary mb-1"
            >
              Target Calendar Year
            </label>
            <input
              id="import-year-input"
              type="number"
              min={2024}
              max={2035}
              value={importYear}
              onChange={(e) => setImportYear(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setImportModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={importing}
              onClick={() => handleImportTemplate(importTemplateCode, importYear)}
              className="px-4 py-2 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {importing ? "Importing..." : `Copy ${importYear} Holidays`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function HolidaysPage() {
  return (
    <AppShell primaryActionLabel="Refresh" onPrimaryAction={() => window.location.reload()}>
      <HolidaysPageContent />
    </AppShell>
  );
}

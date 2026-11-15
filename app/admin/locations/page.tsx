"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { createClient } from "@/lib/supabase/client";
import { MapPin, Plus, Edit, Trash2, Globe, Clock } from "lucide-react";
import { toast } from "sonner";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { EmptyState } from "@/components/shared/empty-state";

import {
  getStoredLocations,
  saveStoredLocations,
  addStoredLocation,
  deleteStoredLocation,
  type DemoLocation,
} from "@/lib/storage/demo-store";

export type LocationItem = DemoLocation;

export default function LocationsAdminPage() {
  const [locations, setLocations] = React.useState<LocationItem[]>(() => getStoredLocations());
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingLoc, setEditingLoc] = React.useState<LocationItem | null>(null);

  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [timezone, setTimezone] = React.useState("Asia/Kolkata");
  const [workingHours, setWorkingHours] = React.useState(480);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);

  const supabase = React.useMemo(() => createClient(), []);

  const loadLocations = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("locations")
        .select("id, name, code, address, timezone, working_hours, weekly_off_days")
        .order("name");

      if (!error && data && data.length > 0) {
        const mapped: LocationItem[] = data.map((l: any) => ({
          id: l.id,
          name: l.name,
          code: l.code,
          address: l.address || "",
          timezone: l.timezone || "UTC",
          workingHours: Number(l.working_hours || 480),
          weeklyOffDays: Array.isArray(l.weekly_off_days) ? l.weekly_off_days : [0, 6],
        }));
        setLocations(mapped);
        saveStoredLocations(mapped);
      } else {
        setLocations(getStoredLocations());
      }
    } catch {
      setLocations(getStoredLocations());
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  React.useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  const handleOpenAdd = () => {
    setEditingLoc(null);
    setName("");
    setCode("");
    setAddress("");
    setTimezone("Asia/Kolkata");
    setWorkingHours(480);
    setModalOpen(true);
  };

  const handleOpenEdit = (loc: LocationItem) => {
    setEditingLoc(loc);
    setName(loc.name);
    setCode(loc.code);
    setAddress(loc.address || "");
    setTimezone(loc.timezone);
    setWorkingHours(loc.workingHours);
    setModalOpen(true);
  };

  const handleSaveLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) {
      toast.error("Please enter location name and code.");
      return;
    }

    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();

    setIsSubmitting(true);
    let nextList: LocationItem[];

    if (editingLoc) {
      nextList = locations.map((l) =>
        l.id === editingLoc.id
          ? { ...l, name: trimmedName, code: trimmedCode, address, timezone, workingHours }
          : l
      );
      toast.success(`Location "${trimmedName}" updated!`);
    } else {
      const newLoc: LocationItem = {
        id: `loc-${Date.now()}`,
        name: trimmedName,
        code: trimmedCode,
        address,
        timezone,
        workingHours,
        weeklyOffDays: [0, 6],
      };
      nextList = [...locations, newLoc];
      toast.success(`Location "${trimmedName}" created!`);
    }

    setLocations(nextList);
    saveStoredLocations(nextList);
    setModalOpen(false);
    setIsSubmitting(false);

    try {
      if (editingLoc) {
        await (supabase.rpc as any)("admin_update_location", {
          p_location_id: editingLoc.id,
          p_name: trimmedName,
          p_address: address || null,
          p_timezone: timezone,
          p_working_hours: workingHours,
          p_weekly_off_days: [0, 6],
        });
      } else {
        await (supabase.rpc as any)("admin_create_location", {
          p_name: trimmedName,
          p_code: trimmedCode,
          p_address: address || null,
          p_timezone: timezone,
          p_working_hours: workingHours,
          p_weekly_off_days: [0, 6],
        });
      }
    } catch {}
  };

  const handleDelete = async (loc: LocationItem) => {
    if (!confirm(`Are you sure you want to delete ${loc.name}? Associated employees will have their primary location unlinked.`)) {
      return;
    }
    const nextList = locations.filter((l) => l.id !== loc.id);
    setLocations(nextList);
    saveStoredLocations(nextList);
    toast.success(`Location ${loc.name} deleted.`);

    try {
      await (supabase.rpc as any)("admin_delete_location", {
        p_location_id: loc.id,
      });
    } catch {}
  };

  return (
    <AppShell primaryActionLabel="Add Location" onPrimaryAction={handleOpenAdd}>
      <div className="space-y-6">
        {/* Header */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary dark:text-white tracking-tight flex items-center gap-2">
              Locations & Facilities
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary dark:text-slate-400 mt-1">
              Configure physical offices, local timezones, expected working hours, and weekly off schedules.
            </p>
          </div>
          <button
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-brand-purple hover:bg-brand-purple-hover text-white text-sm font-semibold shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            Add Location
          </button>
        </section>

        {/* Locations Grid */}
        {locations.length === 0 ? (
          <EmptyState
            icon={<MapPin className="w-6 h-6" />}
            title={isLoading ? "Loading locations..." : "No locations added yet"}
            description={
              isLoading
                ? "Fetching office hubs and timezones..."
                : "Add your physical offices or regional hubs with default working hours and timezones."
            }
            action={
              !isLoading && (
                <button
                  onClick={handleOpenAdd}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-purple text-white text-xs font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Location
                </button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {locations.map((loc) => (
            <div
              key={loc.id}
              className="bg-white dark:bg-slate-900 rounded-[28px] p-6 border border-border-light dark:border-slate-800 shadow-card flex flex-col justify-between space-y-4 hover:shadow-shell transition-all"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-2xl bg-card-subtle dark:bg-slate-800 text-brand-purple flex items-center justify-center">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-full bg-brand-purple/10 text-brand-purple">
                    {loc.code}
                  </span>
                </div>

                <div>
                  <h3 className="text-base font-extrabold text-text-primary dark:text-white">
                    {loc.name}
                  </h3>
                  <p className="text-xs text-text-secondary dark:text-slate-400 mt-0.5 line-clamp-1">
                    {loc.address || "No address specified"}
                  </p>
                </div>

                <div className="pt-2 border-t border-border-light dark:border-slate-800 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-text-tertiary block">Timezone</span>
                    <span className="font-semibold text-text-primary dark:text-white flex items-center gap-1 mt-0.5">
                      <Globe className="w-3 h-3 text-brand-purple" />
                      {loc.timezone}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-tertiary block">Shift Target</span>
                    <span className="font-semibold text-text-primary dark:text-white flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3 text-status-success-dot" />
                      {Math.round(loc.workingHours / 60)}h / day
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-border-light dark:border-slate-800">
                <button
                  onClick={() => handleOpenEdit(loc)}
                  className="px-3 py-1.5 rounded-xl bg-card-subtle hover:bg-slate-200 dark:bg-slate-800 text-text-secondary text-xs font-semibold flex items-center gap-1 transition-colors"
                >
                  <Edit className="w-3.5 h-3.5" />
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(loc)}
                  className="px-3 py-1.5 rounded-xl bg-status-danger-bg hover:bg-red-100 text-status-danger-text text-xs font-semibold flex items-center gap-1 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            </div>
            ))}
          </div>
        )}

        {/* Add/Edit Modal */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-[28px] max-w-md w-full p-6 shadow-shell border border-border-light dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-extrabold text-text-primary dark:text-white flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-brand-purple" />
                  {editingLoc ? "Edit Location" : "Add Location"}
                </h3>
                <button
                  onClick={() => setModalOpen(false)}
                  className="text-text-tertiary hover:text-text-primary text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveLocation} className="space-y-3.5">
                <div>
                  <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                    Location Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Bangalore Campus"
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                    Location Code
                  </label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="e.g. BLR-02"
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm font-mono text-text-primary dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                    Street Address
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Tech Park"
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                      Timezone
                    </label>
                    <input
                      type="text"
                      required
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      placeholder="Asia/Kolkata"
                      className="w-full px-3 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                      Target Minutes
                    </label>
                    <input
                      type="number"
                      required
                      value={workingHours}
                      onChange={(e) => setWorkingHours(parseInt(e.target.value) || 480)}
                      placeholder="480"
                      className="w-full px-3 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary text-sm font-semibold hover:bg-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? "Saving..." : editingLoc ? "Save Changes" : "Create Location"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

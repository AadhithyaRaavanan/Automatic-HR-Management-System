"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useDeclareCompanyDayOff } from "../hooks/use-leave";
import { createClient } from "@/lib/supabase/client";
import { format } from "date-fns";
import { Building2, Calendar } from "lucide-react";

interface CompanyDayOffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CompanyDayOffModal({ open, onOpenChange }: CompanyDayOffModalProps) {
  const supabase = createClient();
  const declareMutation = useDeclareCompanyDayOff();

  const [departments, setDepartments] = React.useState<Array<{ id: string; name: string }>>([]);
  const [date, setDate] = React.useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [title, setTitle] = React.useState<string>("");
  const [departmentId, setDepartmentId] = React.useState<string>("all");

  React.useEffect(() => {
    async function loadDepts() {
      const { data } = await supabase.from("departments").select("id, name").order("name");
      if (data) setDepartments(data);
    }
    if (open) {
      loadDepts();
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !title.trim()) return;

    await declareMutation.mutateAsync({
      date,
      title: title.trim(),
      departmentId: departmentId === "all" ? null : departmentId,
    });

    onOpenChange(false);
    setTitle("");
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Declare Company Day Off"
      description="Announce an ad-hoc organization-wide or department holiday."
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        <div>
          <label className="block text-xs font-bold text-text-secondary mb-1">
            Holiday Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Founder's Day, Emergency Weather Closure"
            className="w-full px-3 py-2 text-xs bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-text-secondary mb-1">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-text-secondary mb-1">
            Scope
          </label>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple"
          >
            <option value="all">Entire Organization (All Departments)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                Department: {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="pt-2 flex items-center justify-end gap-2.5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={declareMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!date || !title.trim() || declareMutation.isPending}
            isLoading={declareMutation.isPending}
          >
            Declare Day Off
          </Button>
        </div>
      </form>
    </Modal>
  );
}


import { NextRequest, NextResponse } from "next/server";
import { getNotificationCaller } from "@/lib/notifications/auth";
import { getManagersOf } from "@/lib/notifications/recipients";
import { notify } from "@/lib/notifications/notify";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await getNotificationCaller(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { event, taskId, taskTitle, assigneeId, newStatus, newDueDate, commentText } = body;

    // Fetch task details if not provided
    let task = null;
    if (taskId) {
      const { data } = await (supabaseAdmin.from("tasks") as any)
        .select("id, title, creator_id, assignee_id, status, due_date")
        .eq("id", taskId)
        .maybeSingle();
      task = data;
    }

    const title = taskTitle || task?.title || "Task";
    const creatorId = task?.creator_id;
    const targetAssigneeId = assigneeId || task?.assignee_id;

    if (event === "assigned" && targetAssigneeId) {
      await notify({
        userIds: [targetAssigneeId],
        type: "task_assigned",
        typeGroup: "tasks",
        title: "New Task Assigned",
        body: `You have been assigned to task: "${title}".`,
        link: "/tasks",
        entityType: "tasks",
        entityId: taskId,
        actorId: user.id,
      });
      return NextResponse.json({ success: true });
    }

    if (event === "status_changed") {
      if (newStatus === "blocked") {
        const recipients = new Set<string>();
        if (creatorId) recipients.add(creatorId);
        if (task?.assignee_id) {
          const managers = await getManagersOf(task.assignee_id);
          managers.forEach((m) => recipients.add(m));
        }

        await notify({
          userIds: Array.from(recipients),
          type: "task_blocked",
          typeGroup: "tasks",
          title: "Task Marked as Blocked",
          body: `Task "${title}" has been marked as blocked and requires attention.`,
          link: "/tasks",
          entityType: "tasks",
          entityId: taskId,
          actorId: user.id,
        });
      } else if (newStatus === "done") {
        const recipients = new Set<string>();
        if (creatorId) recipients.add(creatorId);
        if (task?.assignee_id) {
          const managers = await getManagersOf(task.assignee_id);
          managers.forEach((m) => recipients.add(m));
        }

        await notify({
          userIds: Array.from(recipients),
          type: "task_completed",
          typeGroup: "tasks",
          title: "Task Completed",
          body: `Task "${title}" was marked as completed.`,
          link: "/tasks",
          entityType: "tasks",
          entityId: taskId,
          actorId: user.id,
        });
      }
      return NextResponse.json({ success: true });
    }

    if (event === "due_date_changed" && targetAssigneeId) {
      await notify({
        userIds: [targetAssigneeId],
        type: "task_due_date_changed",
        typeGroup: "tasks",
        title: "Task Due Date Changed",
        body: `The due date for "${title}" has been updated to ${newDueDate || "new date"}.`,
        link: "/tasks",
        entityType: "tasks",
        entityId: taskId,
        actorId: user.id,
      });
      return NextResponse.json({ success: true });
    }

    if (event === "comment") {
      const recipients = new Set<string>();
      if (creatorId) recipients.add(creatorId);
      if (targetAssigneeId) recipients.add(targetAssigneeId);

      await notify({
        userIds: Array.from(recipients),
        type: "task_comment",
        typeGroup: "tasks",
        title: "New Task Comment",
        body: `New comment on "${title}": "${commentText || "Comment added"}"`,
        link: "/tasks",
        entityType: "tasks",
        entityId: taskId,
        actorId: user.id,
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

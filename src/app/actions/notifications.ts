"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import { captureError } from "@/lib/observability/sentry";
import { messageSchema, type ActionResult } from "@/lib/validation/schemas";
import type { NotificationMessage } from "@/types";

const notificationIdSchema = z.object({
  notificationId: z.string().uuid(),
});

export async function getNotificationsAction(): Promise<
  ActionResult<NotificationMessage[]>
> {
  try {
    const user = await requireUser();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      captureError(error, {
        action: "notifications.list",
        userId: user.id,
        reason: "db_error",
      });
      return { success: false, error: "Failed to load notifications" };
    }

    const notifications: NotificationMessage[] = (data ?? []).map((n) => ({
      id: n.id,
      userId: n.user_id,
      message: n.message,
      read: n.read,
      createdAt: n.created_at,
      type: n.type,
      rideId: n.ride_id ?? undefined,
    }));

    return { success: true, data: notifications };
  } catch (err) {
    captureError(err, { action: "notifications.action" });
    return { success: false, error: "Unauthorized" };
  }
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = notificationIdSchema.safeParse({ notificationId });
    if (!parsed.success) {
      return { success: false, error: "Invalid notification" };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", parsed.data.notificationId)
      .eq("user_id", user.id);

    if (error) {
      return { success: false, error: "Failed to update notification" };
    }

    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    captureError(err, { action: "notifications.action" });
    return { success: false, error: "Unauthorized" };
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const supabase = await createClient();

    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);

    if (error) {
      return { success: false, error: "Failed to update notifications" };
    }

    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    captureError(err, { action: "notifications.action" });
    return { success: false, error: "Unauthorized" };
  }
}

export async function createNotificationAction(input: {
  message: string;
  type: NotificationMessage["type"];
  rideId?: string;
}): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const message = messageSchema.parse(input.message);
    const type = z
      .enum(["match", "update", "join", "system", "leave"])
      .parse(input.type);

    const supabase = await createClient();
    const { error } = await supabase.from("notifications").insert({
      user_id: user.id,
      message,
      type,
      read: false,
      ride_id: input.rideId ?? null,
    });

    if (error) {
      return { success: false, error: "Failed to create notification" };
    }

    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    captureError(err, { action: "notifications.action" });
    return { success: false, error: "Unauthorized" };
  }
}

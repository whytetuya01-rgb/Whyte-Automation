import { connectMongoDB } from "@/lib/mongodb";
import { Notification, FollowUpTask, Lead, type NotificationType, type INotificationDocument } from "@/models";
import { businessDayKey, followUpBucket } from "@/lib/followUps";
import type { ClientSession } from "mongoose";

export interface CreateNotificationParams {
  companyId: number;
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown> | null;
  session?: ClientSession | null;
}

/**
 * Extensible hook for external delivery channels (email, whatsapp, push, etc.).
 * Currently delivery is in-app only; future channels plug in here without modifying caller APIs.
 */
async function dispatchExternalNotification(_notification: {
  companyId: number;
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  link: string;
}): Promise<void> {
  // Clean hook for future webhook, email, or WhatsApp push integrations.
}

/**
 * Creates an in-app notification for a user in a specific company.
 * If a `dedupeKey` is provided, creation is strictly idempotent: duplicate triggers
 * are silently absorbed without creating multiple notifications.
 */
export async function createNotification(
  params: CreateNotificationParams
): Promise<INotificationDocument | null> {
  await connectMongoDB();

  const notifId = `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  if (params.dedupeKey) {
    try {
      const existing = await Notification.findOne({
        companyId: params.companyId,
        dedupeKey: params.dedupeKey,
      }).session(params.session ?? null);

      if (existing) {
        return existing;
      }

      const [created] = await Notification.create(
        [
          {
            _id: notifId,
            companyId: params.companyId,
            userId: params.userId,
            type: params.type,
            title: params.title,
            body: params.body,
            link: params.link,
            readAt: null,
            dedupeKey: params.dedupeKey,
            metadata: params.metadata ?? null,
            createdAt: new Date(),
          },
        ],
        { session: params.session }
      );

      await dispatchExternalNotification(created);
      return created;
    } catch (err: unknown) {
      // E11000 duplicate key race
      if (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 11000) {
        return Notification.findOne({
          companyId: params.companyId,
          dedupeKey: params.dedupeKey,
        }).session(params.session ?? null);
      }
      throw err;
    }
  }

  const [created] = await Notification.create(
    [
      {
        _id: notifId,
        companyId: params.companyId,
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body,
        link: params.link,
        readAt: null,
        dedupeKey: null,
        metadata: params.metadata ?? null,
        createdAt: new Date(),
      },
    ],
    { session: params.session }
  );

  await dispatchExternalNotification(created);
  return created;
}

/**
 * Lazily evaluates open follow-up tasks for this user and generates due or overdue
 * notifications with deterministic de-duplication keys. Works reliably without cron.
 */
export async function syncFollowUpNotifications(
  companyId: number,
  userId: number
): Promise<void> {
  await connectMongoDB();

  const now = new Date();
  const openTasks = await FollowUpTask.find({
    companyId,
    ownerId: userId,
    status: "open",
  })
    .select("_id leadId dueAt")
    .lean();

  if (!openTasks.length) return;

  // Pre-load lead reference numbers and names for friendlier notification text
  const leadIds = Array.from(new Set(openTasks.map((t) => t.leadId)));
  const leads = await Lead.find({
    companyId,
    _id: { $in: leadIds },
  })
    .select("_id referenceNumber customerName")
    .lean();
  const leadMap = new Map(leads.map((l) => [String(l._id), l]));

  for (const task of openTasks) {
    if (!task.dueAt) continue;

    const due = new Date(task.dueAt);
    const bucket = followUpBucket(due, now);
    const dayKey = businessDayKey(due);
    const lead = leadMap.get(String(task.leadId));
    const leadName = lead ? `${lead.customerName} (${lead.referenceNumber})` : "Lead";

    if (bucket === "overdue") {
      const dedupeKey = `fu_overdue:${task._id}:${dayKey}`;
      await createNotification({
        companyId,
        userId,
        type: "follow_up_overdue",
        title: "Follow-up Overdue",
        body: `Scheduled follow-up for ${leadName} is past due.`,
        link: "/admin/crm/follow-ups",
        dedupeKey,
        metadata: { taskId: task._id, leadId: task.leadId },
      });
    } else if (bucket === "today") {
      const dedupeKey = `fu_due:${task._id}:${dayKey}`;
      await createNotification({
        companyId,
        userId,
        type: "follow_up_due",
        title: "Follow-up Due Today",
        body: `Follow-up for ${leadName} is scheduled for today.`,
        link: "/admin/crm/follow-ups",
        dedupeKey,
        metadata: { taskId: task._id, leadId: task.leadId },
      });
    }
  }
}

/**
 * Lists user's notifications, lazily syncing follow-up due/overdue alerts first.
 */
export async function getUserNotifications(
  companyId: number,
  userId: number,
  options?: { unreadOnly?: boolean; limit?: number; skip?: number }
): Promise<{
  items: Array<{
    id: string;
    type: NotificationType;
    title: string;
    body: string;
    link: string;
    readAt: Date | null;
    createdAt: Date;
  }>;
  unreadCount: number;
}> {
  await connectMongoDB();

  // Lazy sync follow-ups for this user
  try {
    await syncFollowUpNotifications(companyId, userId);
  } catch {
    // Non-fatal: notification view should not fail if task sync encounters a transient issue
  }

  const query: Record<string, unknown> = {
    companyId,
    userId,
  };

  if (options?.unreadOnly) {
    query.readAt = null;
  }

  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
  const skip = Math.max(options?.skip ?? 0, 0);

  const [docs, unreadCount] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments({ companyId, userId, readAt: null }),
  ]);

  return {
    items: docs.map((d) => ({
      id: d._id,
      type: d.type,
      title: d.title,
      body: d.body,
      link: d.link,
      readAt: d.readAt,
      createdAt: d.createdAt,
    })),
    unreadCount,
  };
}

/**
 * Marks one notification as read. Strictly tenant- and user-scoped.
 */
export async function markNotificationRead(
  companyId: number,
  userId: number,
  notificationId: string
): Promise<boolean> {
  await connectMongoDB();
  const res = await Notification.updateOne(
    { _id: notificationId, companyId, userId, readAt: null },
    { $set: { readAt: new Date() } }
  );
  return res.modifiedCount > 0;
}

/**
 * Marks all notifications for a user as read.
 */
export async function markAllNotificationsRead(
  companyId: number,
  userId: number
): Promise<number> {
  await connectMongoDB();
  const res = await Notification.updateMany(
    { companyId, userId, readAt: null },
    { $set: { readAt: new Date() } }
  );
  return res.modifiedCount;
}


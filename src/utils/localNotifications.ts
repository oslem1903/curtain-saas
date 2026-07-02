import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export type ReminderOffset = "at_time" | "15m" | "30m" | "1h" | "1d";
export type ReminderStatus = "planned" | "sent" | "cancelled";
export type ReminderTaskType = "measurement" | "installation" | "collection" | "quote_followup" | "supplier" | "other";

export type ReminderPayload = {
  id: string;
  title: string;
  customerName?: string | null;
  phone?: string | null;
  address?: string | null;
  taskType: ReminderTaskType;
  startAt: string | Date | null;
  reminderOffset?: ReminderOffset | null;
  amountText?: string | null;
  supplierName?: string | null;
  detailUrl?: string | null;
};

export const REMINDER_OPTIONS: Array<{ value: ReminderOffset; label: string; minutes: number }> = [
  { value: "at_time", label: "Tam saatinde", minutes: 0 },
  { value: "15m", label: "15 dakika önce", minutes: 15 },
  { value: "30m", label: "30 dakika önce", minutes: 30 },
  { value: "1h", label: "1 saat önce", minutes: 60 },
  { value: "1d", label: "1 gün önce", minutes: 1440 },
];

const SETTINGS_KEY = "perdepro_notification_settings";
const STATUS_KEY = "perdepro_notification_status";

export type NotificationSettings = {
  enabled: boolean;
  defaultReminderOffset: ReminderOffset;
};

const defaultSettings: NotificationSettings = {
  enabled: true,
  defaultReminderOffset: "30m",
};

function isNativeNotificationsAvailable() {
  return Capacitor.isNativePlatform();
}

function hashToNotificationId(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash % 2147483000) + 1;
}

function offsetMinutes(offset?: ReminderOffset | null) {
  return REMINDER_OPTIONS.find((option) => option.value === offset)?.minutes ?? 30;
}

export function getNotificationSettings(): NotificationSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return { ...defaultSettings, ...parsed };
  } catch {
    return defaultSettings;
  }
}

export function saveNotificationSettings(settings: NotificationSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getNotificationStatus(entityId: string): ReminderStatus {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATUS_KEY) || "{}") as Record<string, ReminderStatus>;
    return parsed[entityId] ?? "planned";
  } catch {
    return "planned";
  }
}

function setNotificationStatus(entityId: string, status: ReminderStatus) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATUS_KEY) || "{}") as Record<string, ReminderStatus>;
    parsed[entityId] = status;
    localStorage.setItem(STATUS_KEY, JSON.stringify(parsed));
  } catch {
    // ignore local persistence errors
  }
}

export async function ensureNotificationPermission() {
  if (isNativeNotificationsAvailable()) {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === "granted") return true;
    const requested = await LocalNotifications.requestPermissions();
    return requested.display === "granted";
  }
  // Web / PWA: tarayıcı Notification API
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

function labelForTask(type: ReminderTaskType) {
  if (type === "measurement") return "ölçü";
  if (type === "installation") return "montaj";
  if (type === "collection") return "tahsilat";
  if (type === "quote_followup") return "teklif geri dönüş";
  if (type === "supplier") return "tedarikçi";
  return "görev";
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function notificationBody(payload: ReminderPayload, start: Date) {
  const customer = payload.customerName?.trim();
  if (payload.taskType === "supplier") {
    return `${payload.supplierName || customer || payload.title} tedarikçi siparişi bugün teslim alınacak.`;
  }
  if (payload.taskType === "quote_followup") {
    return `${customer || payload.title} teklif geri dönüşü için aranacak.`;
  }
  if (payload.taskType === "collection") {
    return `${customer || payload.title}${payload.amountText ? ` - ${payload.amountText}` : ""} tahsilat hatırlatması.`;
  }
  return `${formatDateTime(start)} tarihinde ${customer || payload.title} için ${labelForTask(payload.taskType)} randevun var.`;
}

export async function cancelReminderNotification(entityId: string) {
  const id = hashToNotificationId(entityId);
  if (isNativeNotificationsAvailable()) {
    await LocalNotifications.cancel({ notifications: [{ id }] });
  }
  setNotificationStatus(entityId, "cancelled");
}

export async function scheduleReminderNotification(payload: ReminderPayload) {
  const settings = getNotificationSettings();
  await cancelReminderNotification(payload.id);

  if (!settings.enabled || !payload.startAt) return;

  const start = payload.startAt instanceof Date ? payload.startAt : new Date(payload.startAt);
  if (Number.isNaN(start.getTime())) return;

  const minutes = offsetMinutes(payload.reminderOffset || settings.defaultReminderOffset);
  const notifyAt = new Date(start.getTime() - minutes * 60 * 1000);
  if (notifyAt.getTime() <= Date.now()) return;

  const allowed = await ensureNotificationPermission();
  if (!allowed) return;

  // Web / PWA: uygulama açıkken zamanlanmış tarayıcı bildirimi
  if (!isNativeNotificationsAvailable()) {
    const delay = notifyAt.getTime() - Date.now();
    // 24 saatten uzun gecikmeleri planlamayalım (sekme zaten o kadar açık kalmaz)
    if (delay <= 24 * 60 * 60 * 1000) {
      window.setTimeout(() => {
        try {
          new Notification(payload.title || "Hatırlatma", {
            body: notificationBody(payload, start),
            tag: payload.id,
          });
        } catch {
          // bildirim oluşturulamadı — sessizce geç
        }
      }, Math.max(delay, 0));
    }
    setNotificationStatus(payload.id, "planned");
    return;
  }

  await LocalNotifications.schedule({
    notifications: [
      {
        id: hashToNotificationId(payload.id),
        title: payload.title || "Hatırlatma",
        body: notificationBody(payload, start),
        schedule: { at: notifyAt, allowWhileIdle: true },
        extra: {
          entityId: payload.id,
          taskType: payload.taskType,
          detailUrl: payload.detailUrl || "/route/today",
          phone: payload.phone || "",
          address: payload.address || "",
          notificationStatus: "planned",
        },
      },
    ],
  });

  setNotificationStatus(payload.id, "planned");
}

export function initLocalNotificationNavigation(onNavigate: (url: string) => void) {
  if (!isNativeNotificationsAvailable()) return () => {};
  let remove: undefined | (() => void);

  LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
    const detailUrl = event.notification.extra?.detailUrl;
    if (typeof detailUrl === "string" && detailUrl) {
      setNotificationStatus(String(event.notification.extra?.entityId || event.notification.id), "sent");
      onNavigate(detailUrl);
    }
  }).then((listener) => {
    remove = () => listener.remove();
  });

  return () => {
    remove?.();
  };
}

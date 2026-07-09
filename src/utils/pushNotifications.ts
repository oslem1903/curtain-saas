import { supabase } from "../supabaseClient";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Capacitor } from "@capacitor/core";

export type NotificationLogEntry = {
    id?: string;
    user_id?: string;
    company_id?: string;
    title: string;
    message: string;
    status: "pending" | "sent" | "failed" | "received";
    error_message?: string;
    sent_at?: string;
    received_at?: string;
};

/**
 * Check and request notification permissions for mobile apps
 */
export async function requestNotificationPermissions(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
        return true; // Web platform doesn't need explicit permission
    }

    try {
        const result = await LocalNotifications.requestPermissions();
        return result.display === "granted";
    } catch (error) {
        console.error("Notification permission request failed:", error);
        return false;
    }
}

/**
 * Check if notifications are enabled
 */
export async function areNotificationsEnabled(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
        return true;
    }

    try {
        const result = await LocalNotifications.checkPermissions();
        return result.display === "granted";
    } catch (error) {
        console.error("Notification permission check failed:", error);
        return false;
    }
}

/**
 * Log notification event to database
 */
export async function logNotification(
    entry: NotificationLogEntry
): Promise<string | null> {
    try {
        const { data, error } = await supabase
            .from("notification_logs")
            .insert({
                ...entry,
                sent_at: entry.sent_at || new Date().toISOString(),
            })
            .select("id")
            .maybeSingle();

        if (error) {
            console.error("Failed to log notification:", error);
            return null;
        }

        return data?.id || null;
    } catch (e) {
        console.error("Notification logging error:", e);
        return null;
    }
}

/**
 * Get user's notification token for push service
 */
export async function getUserNotificationToken(): Promise<string | null> {
    if (!Capacitor.isNativePlatform()) {
        return null;
    }

    try {
        const stored = localStorage.getItem("notification_token");
        if (stored) return stored;

        // In real implementation, would get from Firebase Cloud Messaging
        // For now, return device ID
        const deviceId = localStorage.getItem("curtain_saas_device_id");
        if (deviceId) {
            localStorage.setItem("notification_token", deviceId);
            return deviceId;
        }

        return null;
    } catch (error) {
        console.error("Failed to get notification token:", error);
        return null;
    }
}

/**
 * Store user's notification token in database
 */
export async function storeNotificationToken(
    userId: string,
    companyId: string,
    token: string
): Promise<boolean> {
    try {
        const { error } = await supabase
            .from("device_notification_tokens")
            .upsert(
                {
                    user_id: userId,
                    company_id: companyId,
                    token,
                    device_id: localStorage.getItem("curtain_saas_device_id"),
                    platform: Capacitor.isNativePlatform()
                        ? Capacitor.getPlatform()
                        : "web",
                    last_updated_at: new Date().toISOString(),
                },
                { onConflict: "user_id,company_id" }
            );

        if (error) {
            console.error("Failed to store notification token:", error);
            return false;
        }

        return true;
    } catch (e) {
        console.error("Token storage error:", e);
        return false;
    }
}

/**
 * Send test notification
 */
export async function sendTestNotification(title: string, message: string) {
    if (!Capacitor.isNativePlatform()) {
        alert(`[TEST] ${title}\n${message}`);
        return;
    }

    try {
        await LocalNotifications.schedule({
            notifications: [
                {
                    title,
                    body: message,
                    id: Date.now(),
                    schedule: {
                        at: new Date(Date.now() + 1000),
                    },
                },
            ],
        });
    } catch (error) {
        console.error("Failed to send test notification:", error);
    }
}

/**
 * Initialize notification system on app start
 */
export async function initializeNotificationSystem(
    userId: string,
    companyId: string
) {
    try {
        // Request permissions
        const hasPermission = await requestNotificationPermissions();
        if (!hasPermission) {
            console.warn("Notification permissions not granted");
        }

        // Get and store token
        const token = await getUserNotificationToken();
        if (token && userId && companyId) {
            await storeNotificationToken(userId, companyId, token);
        }

        // Log initialization
        await logNotification({
            user_id: userId,
            company_id: companyId,
            title: "Notification System Initialized",
            message: `Permissions: ${hasPermission}, Token: ${Boolean(token)}`,
            status: "sent",
        });
    } catch (error) {
        console.error("Notification system initialization failed:", error);
    }
}

/**
 * Handle incoming notification (foreground)
 */
export function onNotificationReceived(
    callback: (notification: any) => void
) {
    LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
        callback(event.notification);
    });
}

/**
 * Handle notification tap
 */
export function onNotificationTap(
    callback: (notification: any) => void
) {
    LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
        if (event.actionId === "tap") {
            callback(event.notification);
        }
    });
}

import { supabase } from "../supabaseClient";

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  plainText?: string;
}

export interface SendEmailOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

// Queue for retry logic
interface EmailQueueItem {
  payload: EmailPayload;
  attempts: number;
  maxRetries: number;
  nextRetryTime?: number;
}

const emailQueue: Map<string, EmailQueueItem> = new Map();

/**
 * Send email via Supabase Edge Function or local queue
 * Returns immediately without blocking
 */
export async function sendEmail(
  payload: EmailPayload,
  options: SendEmailOptions = {}
): Promise<{ success: boolean; messageId?: string }> {
  const { maxRetries = 3, retryDelayMs = 5000 } = options;

  try {
    // Try to send via Supabase Edge Function if available
    const { data, error } = await supabase.functions.invoke("send-email", {
      body: payload,
    }).catch(() => ({ data: null, error: { message: "Function not available" } }));

    if (error) {
      console.warn("Email function error, queuing for retry:", error);
      queueEmailForRetry(payload, maxRetries, retryDelayMs);
      return { success: false };
    }

    if (data?.messageId) {
      console.log("Email sent successfully:", payload.to, data.messageId);
      return { success: true, messageId: data.messageId };
    }

    throw new Error("No messageId returned");
  } catch (err: any) {
    console.error("Email send error:", err?.message);
    queueEmailForRetry(payload, maxRetries, retryDelayMs);
    return { success: false };
  }
}

/**
 * Queue email for retry (fire-and-forget)
 */
function queueEmailForRetry(
  payload: EmailPayload,
  maxRetries: number,
  retryDelayMs: number
): void {
  const queueKey = `${payload.to}-${Date.now()}`;
  const item: EmailQueueItem = {
    payload,
    attempts: 1,
    maxRetries,
    nextRetryTime: Date.now() + retryDelayMs,
  };

  emailQueue.set(queueKey, item);

  // Schedule retry
  setTimeout(() => {
    retryEmail(queueKey);
  }, retryDelayMs);
}

/**
 * Retry failed email
 */
async function retryEmail(queueKey: string): Promise<void> {
  const item = emailQueue.get(queueKey);
  if (!item) return;

  if (item.attempts >= item.maxRetries) {
    console.error(
      "Email failed after retries:",
      item.payload.to,
      item.attempts
    );
    emailQueue.delete(queueKey);
    // Could log to database here for manual review
    return;
  }

  try {
    const { data, error } = await supabase.functions.invoke("send-email", {
      body: item.payload,
    }).catch(() => ({ data: null, error: { message: "Function not available" } }));

    if (!error && data?.messageId) {
      console.log("Email retry successful:", item.payload.to);
      emailQueue.delete(queueKey);
      return;
    }

    item.attempts++;
    item.nextRetryTime = Date.now() + (5000 * Math.pow(2, item.attempts - 1)); // Exponential backoff

    setTimeout(() => {
      retryEmail(queueKey);
    }, (item.nextRetryTime || 0) - Date.now());
  } catch (err: any) {
    console.error("Retry error:", err?.message);
    item.attempts++;

    if (item.attempts < item.maxRetries) {
      item.nextRetryTime = Date.now() + (5000 * Math.pow(2, item.attempts - 1));
      setTimeout(() => {
        retryEmail(queueKey);
      }, (item.nextRetryTime || 0) - Date.now());
    }
  }
}

/**
 * Get queue status (for monitoring)
 */
export function getEmailQueueStatus(): {
  pending: number;
  details: Array<{ to: string; attempts: number; maxRetries: number }>;
} {
  const details = Array.from(emailQueue.values()).map((item) => ({
    to: item.payload.to,
    attempts: item.attempts,
    maxRetries: item.maxRetries,
  }));

  return {
    pending: emailQueue.size,
    details,
  };
}

/**
 * Clear all pending emails from queue (use with caution)
 */
export function clearEmailQueue(): void {
  emailQueue.clear();
}

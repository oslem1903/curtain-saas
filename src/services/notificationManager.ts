/**
 * Notification Manager
 * Handles email sending for all business events
 * Emails are sent asynchronously and never block business operations
 */

import { sendEmail } from "./emailService";
import {
  invoiceEmailTemplate,
  paymentConfirmationTemplate,
  appointmentReminderTemplate,
  orderStatusChangeTemplate,
  genericNotificationTemplate,
  generatePlainText,
} from "./emailTemplates";

export interface NotificationContext {
  companyName: string;
  companyEmail?: string;
}

let globalContext: NotificationContext = {
  companyName: "PerdePRO",
};

/**
 * Initialize notification context with company info
 */
export function initializeNotificationContext(context: NotificationContext): void {
  globalContext = { ...globalContext, ...context };
}

/**
 * Get current notification context
 */
export function getNotificationContext(): NotificationContext {
  return globalContext;
}

/**
 * Send invoice notification to customer
 * Fires asynchronously, never blocks payment/invoice operations
 */
export async function notifyInvoiceCreated(params: {
  customerEmail: string;
  customerName: string;
  invoiceNumber: string;
  invoiceId: string;
  totalAmount: number;
  dueDate?: string;
  itemsCount?: number;
}): Promise<void> {
  if (!params.customerEmail) {
    console.warn("No customer email provided for invoice notification");
    return;
  }

  try {
    const html = invoiceEmailTemplate(
      {
        id: "unknown",
        name: params.customerName,
        email: params.customerEmail,
      },
      {
        id: params.invoiceId,
        invoice_number: params.invoiceNumber,
        total_amount: params.totalAmount,
        due_date: params.dueDate,
        items_count: params.itemsCount,
      },
      globalContext.companyName
    );

    await sendEmail({
      to: params.customerEmail,
      subject: `Fatura: ${params.invoiceNumber}`,
      html,
      plainText: generatePlainText(html),
    });
  } catch (err: any) {
    // Log but don't throw - invoice creation should not fail if email fails
    console.error("Failed to send invoice notification:", err?.message);
  }
}

/**
 * Send payment confirmation to customer
 */
export async function notifyPaymentReceived(params: {
  customerEmail: string;
  customerName: string;
  paymentId: string;
  amount: number;
  paymentMethod: string;
  createdAt: string;
}): Promise<void> {
  if (!params.customerEmail) {
    console.warn("No customer email provided for payment notification");
    return;
  }

  try {
    const html = paymentConfirmationTemplate(
      {
        id: "unknown",
        name: params.customerName,
        email: params.customerEmail,
      },
      {
        id: params.paymentId,
        amount: params.amount,
        payment_method: params.paymentMethod,
        created_at: params.createdAt,
      },
      globalContext.companyName
    );

    await sendEmail({
      to: params.customerEmail,
      subject: "Ödeme Alındı - Makbuz",
      html,
      plainText: generatePlainText(html),
    });
  } catch (err: any) {
    console.error("Failed to send payment notification:", err?.message);
  }
}

/**
 * Send appointment reminder to customer
 */
export async function notifyAppointmentReminder(params: {
  customerEmail: string;
  customerName: string;
  appointmentId: string;
  scheduledAt: string;
  address?: string;
  serviceType?: string;
}): Promise<void> {
  if (!params.customerEmail) {
    console.warn("No customer email provided for appointment notification");
    return;
  }

  try {
    const html = appointmentReminderTemplate(
      {
        id: "unknown",
        name: params.customerName,
        email: params.customerEmail,
      },
      {
        id: params.appointmentId,
        scheduled_at: params.scheduledAt,
        address: params.address,
        service_type: params.serviceType,
      },
      globalContext.companyName
    );

    await sendEmail({
      to: params.customerEmail,
      subject: `Randevu Hatırlatması - ${new Date(params.scheduledAt).toLocaleDateString("tr-TR")}`,
      html,
      plainText: generatePlainText(html),
    });
  } catch (err: any) {
    console.error("Failed to send appointment notification:", err?.message);
  }
}

/**
 * Send order status change notification
 */
export async function notifyOrderStatusChanged(params: {
  customerEmail: string;
  customerName: string;
  orderId: string;
  orderNumber?: string;
  totalAmount: number;
  newStatus: string;
  oldStatus?: string;
}): Promise<void> {
  if (!params.customerEmail) {
    console.warn("No customer email provided for order status notification");
    return;
  }

  try {
    const html = orderStatusChangeTemplate(
      {
        id: "unknown",
        name: params.customerName,
        email: params.customerEmail,
      },
      {
        id: params.orderId,
        order_number: params.orderNumber,
        total_amount: params.totalAmount,
        status: params.newStatus,
      },
      params.newStatus,
      globalContext.companyName
    );

    await sendEmail({
      to: params.customerEmail,
      subject: `Siparişiniz Güncellendi`,
      html,
      plainText: generatePlainText(html),
    });
  } catch (err: any) {
    console.error("Failed to send order status notification:", err?.message);
  }
}

/**
 * Send generic notification email
 */
export async function sendNotificationEmail(params: {
  to: string;
  customerName: string;
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
}): Promise<void> {
  if (!params.to) {
    console.warn("No email provided for notification");
    return;
  }

  try {
    const html = genericNotificationTemplate(
      params.customerName,
      params.title,
      params.message,
      params.actionUrl,
      params.actionLabel,
      globalContext.companyName
    );

    await sendEmail({
      to: params.to,
      subject: params.title,
      html,
      plainText: generatePlainText(html),
    });
  } catch (err: any) {
    console.error("Failed to send notification email:", err?.message);
  }
}

/**
 * Send bulk notification (internal, non-blocking)
 */
export async function sendBulkNotification(params: {
  recipients: Array<{ email: string; name: string }>;
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
}): Promise<void> {
  if (params.recipients.length === 0) {
    console.warn("No recipients provided for bulk notification");
    return;
  }

  try {
    // Send in parallel but non-blocking
    Promise.all(
      params.recipients.map((recipient) =>
        sendNotificationEmail({
          to: recipient.email,
          customerName: recipient.name,
          title: params.title,
          message: params.message,
          actionUrl: params.actionUrl,
          actionLabel: params.actionLabel,
        })
      )
    ).catch((err) => {
      console.error("Bulk notification error:", err?.message);
    });
  } catch (err: any) {
    console.error("Failed to send bulk notification:", err?.message);
  }
}

/**
 * Email template generator functions
 * Returns HTML email content for different business events
 */

interface Invoice {
  id: string;
  invoice_number: string;
  total_amount: number;
  due_date?: string;
  items_count?: number;
}

interface Customer {
  id: string;
  name: string;
  email: string;
}

interface Payment {
  id: string;
  amount: number;
  payment_method: string;
  created_at: string;
}

interface Order {
  id: string;
  order_number?: string;
  total_amount: number;
  status: string;
}

interface Appointment {
  id: string;
  scheduled_at: string;
  address?: string;
  service_type?: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  }).format(amount);
}

function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString("tr-TR");
}

function formatDateTime(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString("tr-TR") + " " + d.toLocaleTimeString("tr-TR");
}

const baseStyles = `
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.6;
  color: #333;
`;

const containerStyles = `
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
  background: #f9f9f9;
`;

const cardStyles = `
  background: white;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
`;

const buttonStyles = `
  display: inline-block;
  padding: 12px 24px;
  background: #2563eb;
  color: white;
  text-decoration: none;
  border-radius: 6px;
  font-weight: 500;
  margin: 16px 0;
`;

const footerStyles = `
  text-align: center;
  font-size: 12px;
  color: #666;
  border-top: 1px solid #e5e7eb;
  padding-top: 20px;
  margin-top: 20px;
`;

/**
 * Invoice notification email
 */
export function invoiceEmailTemplate(
  customer: Customer,
  invoice: Invoice,
  companyName: string
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width">
      </head>
      <body style="${baseStyles}">
        <div style="${containerStyles}">
          <div style="${cardStyles}">
            <h2 style="margin-top: 0; color: #1f2937;">Fatura Bildirimi</h2>
            <p>Merhaba ${customer.name},</p>
            <p>PerdePRO üzerinden yeni bir fatura oluşturuldu:</p>

            <div style="${cardStyles}" style="background: #f3f4f6;">
              <p><strong>Fatura No:</strong> ${invoice.invoice_number}</p>
              <p><strong>Tutar:</strong> ${formatCurrency(invoice.total_amount)}</p>
              ${invoice.due_date ? `<p><strong>Son Ödeme Tarihi:</strong> ${formatDate(invoice.due_date)}</p>` : ""}
              ${invoice.items_count ? `<p><strong>Satır Sayısı:</strong> ${invoice.items_count}</p>` : ""}
            </div>

            <p>Lütfen faturayı kontrol etmek ve ödeme işlemini gerçekleştirmek için aşağıdaki butona tıklayın.</p>
            <a href="${getAppUrl()}/invoices" style="${buttonStyles}">Faturayı Görüntüle</a>

            <p>Sorularınız için bize ulaşabilirsiniz.</p>
          </div>

          <div style="${footerStyles}">
            <p>© ${new Date().getFullYear()} ${companyName}. Tüm hakları saklıdır.</p>
            <p>Bu email otomatik olarak gönderilmiştir. Lütfen yanıtlamayınız.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Payment confirmation email
 */
export function paymentConfirmationTemplate(
  customer: Customer,
  payment: Payment,
  companyName: string
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width">
      </head>
      <body style="${baseStyles}">
        <div style="${containerStyles}">
          <div style="${cardStyles}">
            <h2 style="margin-top: 0; color: #16a34a;">✓ Ödeme Alındı</h2>
            <p>Merhaba ${customer.name},</p>
            <p>Ödemeniz başarıyla alınmıştır. İşte ödeme detayları:</p>

            <div style="${cardStyles}" style="background: #f0fdf4;">
              <p><strong>Tutar:</strong> ${formatCurrency(payment.amount)}</p>
              <p><strong>Ödeme Yöntemi:</strong> ${formatPaymentMethod(payment.payment_method)}</p>
              <p><strong>İşlem No:</strong> ${payment.id}</p>
              <p><strong>Tarih:</strong> ${formatDateTime(payment.created_at)}</p>
            </div>

            <p>Faturanız ekli olarak gönderilmiş ya da hesabınızdan indirebilirsiniz.</p>
            <a href="${getAppUrl()}/invoices" style="${buttonStyles}">Faturalarımı Görüntüle</a>

            <p>Teşekkür ederiz!</p>
          </div>

          <div style="${footerStyles}">
            <p>© ${new Date().getFullYear()} ${companyName}. Tüm hakları saklıdır.</p>
            <p>Bu email otomatik olarak gönderilmiştir. Lütfen yanıtlamayınız.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Appointment reminder email
 */
export function appointmentReminderTemplate(
  customer: Customer,
  appointment: Appointment,
  companyName: string
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width">
      </head>
      <body style="${baseStyles}">
        <div style="${containerStyles}">
          <div style="${cardStyles}">
            <h2 style="margin-top: 0; color: #2563eb;">📅 Randevu Hatırlatması</h2>
            <p>Merhaba ${customer.name},</p>
            <p>Yaklaşan randevunuz hakkında hatırlatma:</p>

            <div style="${cardStyles}" style="background: #eff6ff;">
              <p><strong>Tarih & Saat:</strong> ${formatDateTime(appointment.scheduled_at)}</p>
              ${appointment.service_type ? `<p><strong>Hizmet:</strong> ${appointment.service_type}</p>` : ""}
              ${appointment.address ? `<p><strong>Adres:</strong> ${appointment.address}</p>` : ""}
            </div>

            <p>Lütfen başında olmayı unutmayın. Randevu saatinizi değiştirmeniz gerekirse, lütfen bize bildirin.</p>

            <p style="color: #666; font-size: 14px;">
              Sorularınız veya iptal etmek istiyorsanız, lütfen bize +90 (XXX) XXX XXXX numarasından ulaşın.
            </p>
          </div>

          <div style="${footerStyles}">
            <p>© ${new Date().getFullYear()} ${companyName}. Tüm hakları saklıdır.</p>
            <p>Bu email otomatik olarak gönderilmiştir. Lütfen yanıtlamayınız.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Order status change notification
 */
export function orderStatusChangeTemplate(
  customer: Customer,
  order: Order,
  newStatus: string,
  companyName: string
): string {
  const statusLabels: Record<string, string> = {
    pending: "Bekleme",
    confirmed: "Onaylandı",
    processing: "İşleniyor",
    shipped: "Gönderilen",
    delivered: "Teslim Edildi",
    paid: "Ödendi",
    cancelled: "İptal Edildi",
  };

  const statusColors: Record<string, string> = {
    pending: "#f59e0b",
    confirmed: "#3b82f6",
    processing: "#8b5cf6",
    shipped: "#06b6d4",
    delivered: "#10b981",
    paid: "#10b981",
    cancelled: "#ef4444",
  };

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width">
      </head>
      <body style="${baseStyles}">
        <div style="${containerStyles}">
          <div style="${cardStyles}">
            <h2 style="margin-top: 0; color: #1f2937;">Sipariş Durumu Güncellendi</h2>
            <p>Merhaba ${customer.name},</p>
            <p>Siparişinizin durumu değiştirildi:</p>

            <div style="${cardStyles}; border-left: 4px solid ${statusColors[newStatus] || "#3b82f6"};">
              <p><strong>Sipariş No:</strong> ${order.order_number || order.id}</p>
              <p><strong>Tutar:</strong> ${formatCurrency(order.total_amount)}</p>
              <p><strong>Yeni Durum:</strong> <span style="background: ${statusColors[newStatus] || "#3b82f6"}; color: white; padding: 4px 8px; border-radius: 4px;">${statusLabels[newStatus] || newStatus}</span></p>
            </div>

            <a href="${getAppUrl()}/orders" style="${buttonStyles}">Sipariş Detaylarını Görüntüle</a>

            <p>Herhangi bir sorunuz olursa, lütfen bize ulaşın.</p>
          </div>

          <div style="${footerStyles}">
            <p>© ${new Date().getFullYear()} ${companyName}. Tüm hakları saklıdır.</p>
            <p>Bu email otomatik olarak gönderilmiştir. Lütfen yanıtlamayınız.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Generic notification email
 */
export function genericNotificationTemplate(
  customerName: string,
  title: string,
  message: string,
  actionUrl?: string,
  actionLabel?: string,
  companyName?: string
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width">
      </head>
      <body style="${baseStyles}">
        <div style="${containerStyles}">
          <div style="${cardStyles}">
            <h2 style="margin-top: 0; color: #1f2937;">${title}</h2>
            <p>Merhaba ${customerName},</p>
            <p>${message}</p>
            ${
              actionUrl && actionLabel
                ? `<a href="${actionUrl}" style="${buttonStyles}">${actionLabel}</a>`
                : ""
            }
          </div>

          <div style="${footerStyles}">
            <p>© ${new Date().getFullYear()} ${companyName || "PerdePRO"}. Tüm hakları saklıdır.</p>
            <p>Bu email otomatik olarak gönderilmiştir. Lütfen yanıtlamayınız.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Helper: Format payment method
 */
function formatPaymentMethod(method: string): string {
  const methods: Record<string, string> = {
    credit_card: "Kredi Kartı",
    debit_card: "Debit Kartı",
    bank_transfer: "Banka Transferi",
    cash: "Nakit",
    check: "Çek",
    other: "Diğer",
  };
  return methods[method] || method;
}

/**
 * Helper: Get app URL (can be configured via env)
 */
function getAppUrl(): string {
  // This should be configured based on environment
  return import.meta.env.VITE_APP_URL || "https://app.perdepro.com";
}

/**
 * Plain text fallback generator
 */
export function generatePlainText(htmlContent: string): string {
  // Simple HTML to plain text conversion
  return (
    htmlContent
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .trim()
  );
}

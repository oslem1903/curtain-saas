import { assertRowsDeleted } from "./strictDelete";
import { getErrorMessage } from "./errorMessage";

export function shouldCreateOrderInvoice(status: string, accountingEnabled: boolean): boolean {
    return status !== "quoted" && accountingEnabled;
}

/** Never report a rollback until every delete has been acknowledged by the server. */
export async function rollbackCreatedOrder(params: {
    itemCount: number;
    deleteItems: () => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
    deleteOrder: () => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}): Promise<void> {
    if (params.itemCount > 0) {
        assertRowsDeleted(await params.deleteItems(), "Sipariş kalemleri", params.itemCount);
    }
    assertRowsDeleted(await params.deleteOrder(), "Sipariş");
}

export function incompleteOrderMessage(orderId: string, error: unknown): string {
    return `İşlem tamamlanamadı ve siparişin geri alındığı doğrulanamadı. Sipariş: ${orderId}. Mükerrer kayıt oluşturmamak için siparişi kontrol edin. ${getErrorMessage(error, "Geri alma başarısız.")}`;
}

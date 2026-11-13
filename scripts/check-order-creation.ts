import assert from "node:assert/strict";
import { shouldCreateOrderInvoice, rollbackCreatedOrder, incompleteOrderMessage } from "../src/utils/orderCreation";

assert.equal(shouldCreateOrderInvoice("new_order", false), false, "Solo siparişi fatura istememeli");
assert.equal(shouldCreateOrderInvoice("new_order", true), true, "Muhasebeli paket fatura oluşturmalı");
assert.equal(shouldCreateOrderInvoice("quoted", true), false, "Teklif fatura oluşturmamalı");

let orderDeleteCalls = 0;
await assert.rejects(rollbackCreatedOrder({
    itemCount: 1,
    deleteItems: async () => ({ data: [], error: null }),
    deleteOrder: async () => { orderDeleteCalls++; return { data: [{ id: "order" }], error: null }; },
}), /silinemedi/);
assert.equal(orderDeleteCalls, 0, "Kalem silinmezse sipariş temizlendi sayılmamalı");

await assert.rejects(rollbackCreatedOrder({
    itemCount: 1,
    deleteItems: async () => ({ data: [{ id: "item" }], error: null }),
    deleteOrder: async () => ({ data: [], error: null }),
}), /silinemedi/, "RLS'nin sessiz 0 satır sonucu hata olmalı");

await assert.rejects(rollbackCreatedOrder({
    itemCount: 0,
    deleteItems: async () => { throw new Error("Çağrılmamalı"); },
    deleteOrder: async () => ({ data: null, error: { message: "Yetki engeli" } }),
}), /Yetki engeli/);

await rollbackCreatedOrder({
    itemCount: 2,
    deleteItems: async () => ({ data: [{ id: "a" }, { id: "b" }], error: null }),
    deleteOrder: async () => ({ data: [{ id: "order" }], error: null }),
});
await assert.rejects(rollbackCreatedOrder({
    itemCount: 2,
    deleteItems: async () => ({ data: [{ id: "a" }], error: null }),
    deleteOrder: async () => ({ data: [{ id: "order" }], error: null }),
}), /yalnız 1/);

assert.match(incompleteOrderMessage("order-123", { message: "Veritabanı hatası" }), /order-123.*Mükerrer.*Veritabanı hatası/);
console.log("PASS: Solo/muhasebe/teklif, sıfır-kısmi silme, yetki hatası, başarılı geri alma ve kurtarma mesajı");

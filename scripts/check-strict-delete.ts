import { assertRowsDeleted } from "../src/utils/strictDelete";
let fail = 0;
const t = (n: string, fn: () => void, expectThrow: RegExp | null) => {
  let msg: string | null = null; try { fn(); } catch (e: any) { msg = e.message; }
  const ok = expectThrow ? !!msg && expectThrow.test(msg) : msg === null;
  if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${msg ? "  -> " + msg.slice(0, 80) : ""}`);
};
t("1 satir silindi (beklenen 1)", () => assertRowsDeleted({ data: [{ id: 1 }], error: null }), null);
t("0 satir etkilendi -> hata", () => assertRowsDeleted({ data: [], error: null }, "Kayıt"), /silinemedi/);
t("data null -> hata", () => assertRowsDeleted({ data: null, error: null }), /silinemedi/);
t("API hatasi -> hata", () => assertRowsDeleted({ data: null, error: { message: "boom" } }), /boom/);
t("toplu: beklenen 5, 5 silindi", () => assertRowsDeleted({ data: [1, 2, 3, 4, 5].map((id) => ({ id })), error: null }, "Toplu", 5), null);
t("toplu: beklenen 5, yalniz 1 silindi -> TAM BASARI SAYILMAZ", () => assertRowsDeleted({ data: [{ id: 1 }], error: null }, "Toplu", 5), /yalnız 1/);
t("toplu: beklenen 5, 4 silindi -> hata", () => assertRowsDeleted({ data: [1, 2, 3, 4].map((id) => ({ id })), error: null }, "Toplu", 5), /yalnız 4/);
console.log(fail ? `\n${fail} BASARISIZ` : "\nTUM KONTROLLER GECTI");
process.exit(fail ? 1 : 0);

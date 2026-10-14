// Tahsilat ve Ödemeler: tedarikçi/montajcı açık kalem hesabı. npx tsx scripts/check-payables.ts
import { allocateFifo } from "../src/utils/payables";
let fail = 0;
const eq = (n: string, a: number, b: number) => { const ok = Math.abs(a - b) < 0.005; if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}: ${a} (beklenen ${b})`); };
const sum = (r: { remaining: number }[]) => r.reduce((s, x) => s + x.remaining, 0);
eq("tedarikçi 3937.50 ödenmemiş", sum(allocateFifo([{ key: "a", amount: 3937.5, sortDate: "2026-10-01" }], 0).open), 3937.5);
eq("montajcı 350 ödenmemiş", sum(allocateFifo([{ key: "h", amount: 350, sortDate: null }], 0).open), 350);
eq("net fark 7000-3937.5-350", 7000 - 3937.5 - 350, 2712.5);
eq("kısmi ödeme 1000 → kalan 2937.5", sum(allocateFifo([{ key: "a", amount: 3937.5, sortDate: "2026-10-01" }], 1000).open), 2937.5);
const full = allocateFifo([{ key: "a", amount: 350, sortDate: null }], 350);
eq("tam ödenen kayıt açık listeden çıkar", full.open.length, 0);
const adv = allocateFifo([{ key: "a", amount: 350, sortDate: null }], 500);
eq("fazla ödeme borç sayılmaz (avans 150)", sum(adv.open), 0); eq("avans", adv.advance, 150);
const two = allocateFifo([{ key: "x", amount: 100, sortDate: "2026-10-05" }, { key: "y", amount: 200, sortDate: "2026-10-01" }], 150);
eq("FIFO: eski borç önce kapanır (y kalan 50, x 100)", sum(two.open), 150);
eq("en eski kayıt kalan", two.open.find((o) => o.key === "y")!.remaining, 50);
console.log(fail ? `\n${fail} BASARISIZ` : "\nTUM KONTROLLER GECTI");
process.exit(fail ? 1 : 0);

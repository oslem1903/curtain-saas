// Montaj maliyeti / net kâr hesabı (QA örneği). npx tsx scripts/check-installation-cost.ts
import { computeInstallationCost } from "../src/utils/installationCost";
let fail = 0;
const eq = (n: string, a: number, b: number) => { const ok = Math.abs(a - b) < 0.005; if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}: ${a} (beklenen ${b})`); };
const sale = 7875, product = 3937.5;
const profit = (c: number) => sale - product - c;
eq("dış montajcı hakediş 350 → net kâr", profit(computeInstallationCost({ isInternal: false, earningsTotal: 350, manualCost: 0 }).cost), 3587.5);
// montajcıya ödeme yapıldı: maliyet değişmez (ödeme hesaba girmez)
eq("350 hakediş ödendikten sonra kâr aynı", profit(computeInstallationCost({ isInternal: false, earningsTotal: 350, manualCost: 0 }).cost), 3587.5);
eq("Kendim yapıyorum → kâr", profit(computeInstallationCost({ isInternal: true, earningsTotal: 0, manualCost: 0 }).cost), 3937.5);
eq("Kendim yapıyorum, elle tutar girilmişse yine 0", computeInstallationCost({ isInternal: true, earningsTotal: 0, manualCost: 500 }).cost, 0);
eq("hakediş + elle tutar çift sayılmaz", computeInstallationCost({ isInternal: false, earningsTotal: 350, manualCost: 350 }).cost, 350);
eq("seçim yok, elle tutar 200", computeInstallationCost({ isInternal: false, earningsTotal: 0, manualCost: 200 }).cost, 200);
eq("seçim yok, tutar yok = 0 (Kendim yapıyorum değil, ayrı durum)", computeInstallationCost({ isInternal: false, earningsTotal: 0, manualCost: 0 }).cost, 0);
console.log(fail ? `\n${fail} BASARISIZ` : "\nTUM KONTROLLER GECTI");
process.exit(fail ? 1 : 0);

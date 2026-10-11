import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { decorativeRail, railDescription } from "../src/utils/decorativeRail.ts";
import { calculate as sharedMeasurement } from "../src/constants/measurementConstants.ts";

// Run the actual pure functions declared in each screen, without mounting React
// or importing a real Supabase client. AST extraction fails if a function disappears.
function functionsFrom(path: string, names: string[], baseline = false) {
  const source = baseline ? execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8" }) : fs.readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ""));
  assert.equal(declarations.length, names.length, `missing production function in ${path}`);
  const code = ts.transpileModule(declarations.map(node => node.getText(ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function("decorativeRail", `${code}; return { ${names.join(",")} };`)(decorativeRail);
}
const measurementNames = ["calculate", "ceil10", "isManual", "isLinear"];
const orderNames = ["calcAreaM2ByProduct", "calcLineTotalByProduct", "safeNumber", "roundByRule", "normalizeProductType"];
const measurement = functionsFrom("src/pages/MeasurementEntry.tsx", measurementNames);
const order = functionsFrom("src/pages/NewOrder.tsx", orderNames);
const detail = functionsFrom("src/pages/OrderDetail.tsx", ["computeLineItem"]);
const quote = functionsFrom("src/pages/Quotes.tsx", ["areaM2Of", "calcEstimate", "quoteLineMetrics"]);
function productionArrow(path: string, parentPrefix: string, bindings: Record<string, unknown>) {
  const source = fs.readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let match: ts.ArrowFunction | undefined;
  function visit(node: ts.Node) {
    if (ts.isArrowFunction(node) && ts.isCallExpression(node.parent) && node.parent.getText(ast).startsWith(parentPrefix)) match = node;
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(match, parentPrefix);
  const code = ts.transpileModule("const actual = " + match.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(bindings), code + "; return actual;")(...Object.values(bindings));
}
const newOrderItem = productionArrow("src/pages/NewOrder.tsx", "items.map((it) => {", {
  decorativeRail, railDescription, ...order, products: [],
  findProductByType: () => ({ min_area: 20, min_price: 9999, rounding_rule: 100 }), productLabel: () => "Dekoratif Ray",
});
const newInvoiceItem = productionArrow("src/pages/NewOrder.tsx", "params.items.map", { decorativeRail, railDescription, productLabel: () => "Dekoratif Ray", taxRate: 20 });
const pickedInvoiceItem = productionArrow("src/pages/InvoiceDetail.tsx", "(order.order_items ?? []).map", { decorativeRail, railDescription });
let checks = 0;
for (const [width, rounded] of [[110,125],[135,150],[100,100],[125,125],[150,150],[125.01,150],[0,0],[24.5,25]]) {
  for (const height of [0, 1, 200, 999]) {
    const qty=3, price=80, metres=rounded/100, total=metres*price*qty;
    for (const calc of [measurement.calculate, sharedMeasurement]) {
      const result=calc("dekoratif_ray",width,height,qty,price,"2");
      assert.equal(result.roundedWidth,rounded);assert.equal(result.roundedHeight,0);assert.equal(result.areaM2,metres);assert.equal(result.total,total);
    }
    const dim=order.calcAreaM2ByProduct(width,height,{min_area:20,rounding_rule:10},"dekoratif_ray");
    assert.deepEqual(dim,{roundedWidth:rounded,roundedHeight:0,area:metres});
    const row={product_type:"dekoratif_ray",width_cm:width,height_cm:height,estimated_area_m2:999,quantity:qty,unit_price:price};
    assert.equal(quote.calcEstimate(row),total); // even a stale stored m² must not win
    assert.deepEqual(quote.quoteLineMetrics(row,qty,price,20),{areaM2:metres,lineTotal:total,supplierLineTotal:metres*qty*20});
    const line=detail.computeLineItem({...row,qty,supplier_unit_cost:20,min_area:20,waste_rate:30,rounding_rule:100});
    assert.equal(line.area_m2,metres);assert.equal(line.line_total,total);assert.equal(line.supplier_total_cost,metres*qty*20);
    const item = { product_type:"dekoratif_ray",width_cm:width,height_cm:height,qty,unit_price:price,supplier_cost:20 };
    const computed = newOrderItem(item);
    assert.equal(computed.area,metres);assert.equal(computed.line_total,total);assert.equal(computed.height_cm,0);
    for (const invoiceMap of [newInvoiceItem,pickedInvoiceItem]) {
      const invoice=invoiceMap(computed);
      assert.equal(invoice.quantity,metres*qty);assert.equal(invoice.quantity*invoice.unit_price,total);
      assert.match(invoice.description,/mtül/);assert.ok(!invoice.description.includes("x"+height+" cm"));
    }
    checks++;
  }
}
assert.equal(order.normalizeProductType("Dekoratif Ray"),"dekoratif_ray");
assert.equal(order.normalizeProductType("dekoratif_ray"),"dekoratif_ray");
assert.equal(railDescription(110),"110 cm → 125 cm • 1.25 mtül");
assert.equal(railDescription(135),"135 cm → 150 cm • 1.50 mtül");
const oldMeasurement=functionsFrom("src/pages/MeasurementEntry.tsx",measurementNames,true);
const oldOrder=functionsFrom("src/pages/NewOrder.tsx",orderNames,true);
const oldDetail=functionsFrom("src/pages/OrderDetail.tsx",["computeLineItem"],true);
for(const type of ["stor","zebra","tul","fon","jalousie","picasso","plicell","rustik","kruvaze","katlamali_mekanizma","ip_perde","aksesuar","diger"]) {
 for(const pile of ["2","3","S"]) {
  assert.deepEqual(measurement.calculate(type,135,221,2,80,pile),oldMeasurement.calculate(type,135,221,2,80,pile));
  const rules={min_area:3,rounding_rule:10,min_price:100};
  assert.deepEqual(order.calcAreaM2ByProduct(135,221,rules,type),oldOrder.calcAreaM2ByProduct(135,221,rules));
  assert.equal(order.calcLineTotalByProduct(3,2,80,rules),oldOrder.calcLineTotalByProduct(3,2,80,rules));
  const input={product_type:type,width_cm:135,height_cm:221,qty:2,unit_price:80,supplier_unit_cost:20,min_area:3,waste_rate:10,rounding_rule:10,pile,mechanism:"reducer",control_type:"tape"};
  assert.deepEqual(detail.computeLineItem(input),oldDetail.computeLineItem(input));checks++;
 }
}
console.log(`PASS: ${checks} production calculation cases + category and output assertions`);

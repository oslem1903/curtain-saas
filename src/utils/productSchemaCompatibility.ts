/** Older databases store supplier purchase prices in supplier_product_prices.unit_cost. */
export async function saveProductWithCostCompatibility<T extends { cost_price: number }, R extends { error: { code?: string; message: string } | null }>(
  payload: T,
  write: (value: Omit<T, "cost_price"> & { cost_price?: number }) => PromiseLike<R>,
): Promise<R> {
  const result = await write(payload);
  const error = result.error;
  const missingCostColumn = error && ["PGRST204", "42703"].includes(error.code || "") && /\bcost_price\b/i.test(error.message);
  if (!missingCostColumn) return result;
  const { cost_price: _cost, ...compatiblePayload } = payload;
  void _cost;
  return await write(compatiblePayload);
}

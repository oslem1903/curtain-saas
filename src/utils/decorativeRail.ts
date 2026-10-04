/** Dekoratif ray: boy, minimum alan ve fire bu hesaba katilmaz. */
export function decorativeRail(widthCm: number, qty = 1, unitPrice = 0) {
    const roundedWidth = Math.ceil(Math.max(0, widthCm) / 25) * 25;
    const areaM2 = roundedWidth / 100; // Eski DB alan adi; bu urunde metretul saklar.
    return { roundedWidth, roundedHeight: 0, areaM2, total: areaM2 * Math.max(1, qty) * Math.max(0, unitPrice), fabricWidthCm: null as number | null };
}
export function railDescription(widthCm: number) {
    const rail = decorativeRail(widthCm);
    return `${widthCm} cm → ${rail.roundedWidth} cm • ${rail.areaM2.toFixed(2)} mtül`;
}

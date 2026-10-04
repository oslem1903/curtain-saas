// Mobilde (index.css, max-width: 640px) tablolar kart gorunumune cevrilir ve
// <thead> gizlenir. Hucre basliklari kaybolmasin diye her <td>'ye, ayni
// siradaki <th> metni `data-label` olarak yazilir; CSS bunu hucrenin ustunde
// gosterir. Sayfa kodlarina dokunmadan TUM tablolari kapsar.
// - Zaten data-label'i olan hucreler degistirilmez.
// - colSpan'li hucreler (toplam satirlari vb.) etiketlenmez.
// - Duz metin etiketi olmayan (bos/ikon) basliklar atlanir.

function labelTable(table: HTMLTableElement) {
  const headRow = table.tHead?.rows[0];
  if (!headRow) return;

  const labels: string[] = [];
  Array.from(headRow.cells).forEach((th) => {
    const text = (th.textContent ?? "").replace(/\s+/g, " ").trim();
    for (let i = 0; i < Math.max(th.colSpan, 1); i += 1) labels.push(text);
  });
  if (labels.every((l) => !l)) return;

  Array.from(table.tBodies).forEach((body) => {
    Array.from(body.rows).forEach((row) => {
      let col = 0;
      Array.from(row.cells).forEach((cell) => {
        const label = labels[col];
        if (cell.colSpan <= 1 && label && !cell.hasAttribute("data-label")) {
          cell.setAttribute("data-label", label);
        }
        col += Math.max(cell.colSpan, 1);
      });
    });
  });
}

function labelAllTables() {
  document.querySelectorAll("table").forEach((table) => labelTable(table as HTMLTableElement));
}

export function installTableLabels() {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      try {
        labelAllTables();
      } catch {
        // Etiketleme yalnizca gorsel iyilestirmedir; hata uygulamayi etkilemez.
      }
    });
  };

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
}

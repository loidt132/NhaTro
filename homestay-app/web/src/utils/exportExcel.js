// Builds a one-sheet .xlsx from an array of row arrays (first row = header)
// and triggers a download. The library is loaded on demand so it stays out of
// the main bundle. xlsx-js-style is SheetJS with cell styles, which plain
// "xlsx" cannot write.
//
// Look: green bold header row, thin borders on every cell, numbers right-aligned
// and unformatted (500000, not 500,000). With { totalRow: true } the last row is
// a "Tổng cộng" row whose last cell (the grand total) is bold.
const BORDER = { style: "thin", color: { rgb: "000000" } };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const HEADER_FILL = { patternType: "solid", fgColor: { rgb: "9BBB59" } };

export function styleSheet(XLSX, ws, { totalRow = false } = {}) {
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: "s", v: "" };
      const cell = ws[addr];
      const style = { border: BORDERS, alignment: { vertical: "center" } };
      if (cell.t === "n") style.alignment.horizontal = "right";
      if (r === range.s.r) {
        style.fill = HEADER_FILL;
        style.font = { bold: true };
      } else if (totalRow && r === range.e.r && c === range.e.c) {
        style.font = { bold: true };
      }
      cell.s = style;
    }
  }
}

export async function exportExcel(filename, sheetName, rows, colWidths, options = {}) {
  const mod = await import("xlsx-js-style");
  const XLSX = mod.default ?? mod;
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (colWidths) ws["!cols"] = colWidths.map((wch) => ({ wch }));
  styleSheet(XLSX, ws, options);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

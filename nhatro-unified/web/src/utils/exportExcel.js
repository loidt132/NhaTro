// Builds a styled, colored .xlsx from a column/row description and triggers a
// download. xlsx-js-style (a styling-capable fork of SheetJS) is loaded on
// demand so it stays out of the main bundle.
//
// columns: [{ header, key, width?, align?: "left"|"right"|"center", money?: bool }]
// rows: array of plain objects keyed by column.key
// totals: optional object keyed by column.key — rendered as a highlighted last row
const HEADER_FILL = "1E8E5A"; // emerald-ish, matches the app's brand color
const HEADER_FONT = { bold: true, color: { rgb: "FFFFFF" }, sz: 11 };
const TITLE_FONT = { bold: true, color: { rgb: "1E8E5A" }, sz: 14 };
const TOTALS_FILL = "D7F2E3";
const BAND_FILL = "F3FAF6";
const THIN_BORDER = { style: "thin", color: { rgb: "D9E6E0" } };
const BORDER_ALL = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };

function cell(value, style) {
  // aoa_to_sheet only infers a cell's type (t: "n" vs "s") from a bare
  // primitive. Passing a pre-built {v, s} object — as every cell here does,
  // to carry a style — skips that inference, so every cell (money included)
  // was written out as text: no thousands separator, no right-align, not
  // summable in Excel. Set t explicitly so numbers stay numbers.
  const v = value ?? "";
  return { v, t: typeof v === "number" ? "n" : "s", s: style };
}

export async function exportStyledExcel({ filename, sheetName, title, subtitle, columns, rows, totals }) {
  const XLSX = await import("xlsx-js-style");
  const colCount = columns.length;
  const aoa = [];

  if (title) {
    aoa.push([cell(title, { font: TITLE_FONT, alignment: { horizontal: "left" } })]);
    if (subtitle) aoa.push([cell(subtitle, { font: { italic: true, color: { rgb: "64748B" }, sz: 10 } })]);
    aoa.push([]);
  }

  const headerRowIndex = aoa.length;
  aoa.push(
    columns.map((col) =>
      cell(col.header, {
        font: HEADER_FONT,
        fill: { fgColor: { rgb: HEADER_FILL } },
        alignment: { horizontal: col.align || (col.money ? "right" : "left"), vertical: "center" },
        border: BORDER_ALL,
      })
    )
  );

  rows.forEach((row, i) => {
    const banded = i % 2 === 1;
    aoa.push(
      columns.map((col) => {
        const value = row[col.key];
        return cell(col.money ? Number(value) || 0 : value, {
          font: { sz: 10.5 },
          fill: banded ? { fgColor: { rgb: BAND_FILL } } : undefined,
          alignment: { horizontal: col.align || (col.money ? "right" : "left"), vertical: "center" },
          border: BORDER_ALL,
          numFmt: col.money ? "#,##0" : undefined,
        });
      })
    );
  });

  if (totals) {
    aoa.push(
      columns.map((col, i) =>
        cell(col.money ? Number(totals[col.key]) || 0 : totals[col.key] ?? (i === 0 ? "Tổng cộng" : ""), {
          font: { bold: true, sz: 10.5 },
          fill: { fgColor: { rgb: TOTALS_FILL } },
          alignment: { horizontal: col.align || (col.money ? "right" : "left"), vertical: "center" },
          border: BORDER_ALL,
          numFmt: col.money ? "#,##0" : undefined,
        })
      )
    );
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columns.map((col) => ({ wch: col.width || 16 }));
  ws["!rows"] = aoa.map((_, i) => (i === headerRowIndex ? { hpx: 22 } : undefined));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRowIndex, c: 0 }, e: { r: headerRowIndex, c: colCount - 1 } }) };
  ws["!freeze"] = { xSplit: 0, ySplit: headerRowIndex + 1 };
  ws["!merges"] = title ? [{ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } }, ...(subtitle ? [{ s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } }] : [])] : [];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

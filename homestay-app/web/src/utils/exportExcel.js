// Builds a one-sheet .xlsx from an array of row arrays (first row = header)
// and triggers a download. xlsx is loaded on demand so it stays out of the
// main bundle.
export async function exportExcel(filename, sheetName, rows, colWidths) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (colWidths) ws["!cols"] = colWidths.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

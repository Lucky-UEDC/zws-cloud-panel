import PDFDocument from "pdfkit"

type ExportRow = Record<string, unknown>

function cell(value: unknown) {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function escapeCsv(value: unknown) {
  const text = cell(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function rowsToCsv(rows: ExportRow[], headers: string[]) {
  return [headers.map(escapeCsv).join(","), ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","))].join("\n")
}

/** UTF-8 BOM for Excel-compatible CSV */
const CSV_BOM = "\uFEFF"

export function exportTabularResponse(input: {
  rows: ExportRow[]
  headers: string[]
  filename: string
  format: "csv" | "excel"
}) {
  const body = rowsToCsv(input.rows, input.headers)
  if (input.format === "csv") {
    return new Response(CSV_BOM + body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${input.filename}.csv"`,
        "Cache-Control": "no-store",
      },
    })
  }
  return exportExcelXml({ rows: input.rows, headers: input.headers, filename: input.filename })
}

function escapeXml(value: unknown) {
  const text = cell(value)
  return text
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/'/g, "'")
}

/** Generate Excel 2003 SpreadsheetML XML (no external deps, opens in Excel/LibreOffice) */
export function exportExcelXml(input: { rows: ExportRow[]; headers: string[]; filename: string }) {
  const headerRow = input.headers.map((h) => "<Cell><Data ss:Type=\"String\">" + escapeXml(h) + "</Data></Cell>").join("")
  const dataRows = input.rows
    .map((row) => {
      const cells = input.headers.map((h) => "<Cell><Data ss:Type=\"String\">" + escapeXml(row[h]) + "</Data></Cell>").join("")
      return "<Row>" + cells + "</Row>"
    })
    .join("")

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n' +
    '  xmlns:o="urn:schemas-microsoft-com:office:office"\n' +
    '  xmlns:x="urn:schemas-microsoft-com:office:excel"\n' +
    '  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"\n' +
    '  xmlns:html="http://www.w3.org/TR/REC-html40">\n' +
    '  <Styles>\n' +
    '    <Style ss:ID="Default" ss:Name="Normal">\n' +
    '      <Alignment ss:Vertical="Bottom"/>\n' +
    '      <Borders/>\n' +
    '      <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>\n' +
    '      <Interior/>\n' +
    '      <NumberFormat/>\n' +
    '      <Protection/>\n' +
    '    </Style>\n' +
    '    <Style ss:ID="Header">\n' +
    '      <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000" ss:Bold="1"/>\n' +
    '      <Interior ss:Color="#4472C4" ss:Pattern="Solid"/>\n' +
    '      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>\n' +
    '    </Style>\n' +
    '  </Styles>\n' +
    '  <Worksheet ss:Name="Sheet1">\n' +
    '    <Table ss:ExpandedColumnCount="' + input.headers.length + '" ss:ExpandedRowCount="' + (input.rows.length + 1) + '" x:FullColumns="1" x:FullRows="1">\n' +
    '      <Row ss:StyleID="Header">' + headerRow + '</Row>\n' +
    '      ' + dataRows + '\n' +
    '    </Table>\n' +
    '  </Worksheet>\n' +
    '</Workbook>'

  return new Response(xml, {
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": 'attachment; filename="' + input.filename + '.xls"',
      "Cache-Control": "no-store",
    },
  })
}

export async function exportPdfTable(input: {
  title: string
  rows: ExportRow[]
  headers: string[]
  filename: string
}) {
  const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" })
  const chunks: Buffer[] = []
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))))

  // Title
  doc.fontSize(16).font("Helvetica-Bold").text(input.title)
  doc.moveDown(0.5)

  // Calculate column widths
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const colWidth = pageWidth / input.headers.length

  // Headers
  doc.fontSize(7).font("Helvetica-Bold")
  input.headers.forEach((header, i) => {
    doc.text(escapeCsv(header), doc.page.margins.left + i * colWidth, doc.y, { width: colWidth - 2, align: "left" })
  })
  doc.moveDown(0.3)

  // Draw header line
  const headerY = doc.y
  doc.moveTo(doc.page.margins.left, headerY)
    .lineTo(doc.page.width - doc.page.margins.right, headerY)
    .stroke()

  // Data rows - no arbitrary cap
  doc.fontSize(7).font("Helvetica")
  for (const row of input.rows) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 12) {
      doc.addPage()
      // Redraw headers on new page
      doc.fontSize(7).font("Helvetica-Bold")
      input.headers.forEach((header, i) => {
        doc.text(escapeCsv(header), doc.page.margins.left + i * colWidth, doc.y, { width: colWidth - 2, align: "left" })
      })
      doc.moveDown(0.3)
      doc.moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke()
      doc.fontSize(7).font("Helvetica")
    }
    input.headers.forEach((header, i) => {
      doc.text(escapeCsv(row[header]), doc.page.margins.left + i * colWidth, doc.y, { width: colWidth - 2, align: "left" })
    })
    doc.moveDown(0.2)
  }

  doc.end()
  const body = await done
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="' + input.filename + '.pdf"',
      "Cache-Control": "no-store",
    },
  })
}
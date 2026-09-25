import PDFDocument from "pdfkit"

type ExportRow = Record<string, unknown>

function cell(value: unknown) {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

export function rowsToCsv(rows: ExportRow[], headers: string[]) {
  const escape = (value: unknown) => {
    const text = cell(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [headers.map(escape).join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n")
}

export function exportTabularResponse(input: {
  rows: ExportRow[]
  headers: string[]
  filename: string
  format: "csv" | "excel"
}) {
  const body = rowsToCsv(input.rows, input.headers)
  const extension = input.format === "excel" ? "xls" : "csv"
  const type = input.format === "excel" ? "application/vnd.ms-excel; charset=utf-8" : "text/csv; charset=utf-8"
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${input.filename}.${extension}"`,
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
  const doc = new PDFDocument({ margin: 36, size: "A4" })
  const chunks: Buffer[] = []
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))))
  doc.fontSize(16).text(input.title)
  doc.moveDown()
  doc.fontSize(8)
  doc.text(input.headers.join(" | "))
  doc.moveDown(0.5)
  for (const row of input.rows.slice(0, 250)) {
    doc.text(input.headers.map((header) => cell(row[header])).join(" | "), { lineGap: 2 })
  }
  doc.end()
  const body = await done
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${input.filename}.pdf"`,
      "Cache-Control": "no-store",
    },
  })
}

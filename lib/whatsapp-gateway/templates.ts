import { prisma } from "@/lib/db"
import type { Prisma } from "@prisma/client"
import { WhatsAppGatewayProvider } from "@/lib/whatsapp-gateway/client"
import { classifyTemplateType, buildTemplatePayload } from "@/lib/whatsapp-gateway/payloads"
import type { TemplateDraft, TemplateWireBody } from "@/lib/whatsapp-gateway/types"
import { sanitizeErrorMessage, WhatsAppGatewayError } from "@/lib/whatsapp-gateway/errors"

export type TemplateListParams = {
  page?: number
  pageSize?: number
  search?: string
  category?: string
  status?: string
  wabaId?: string
}

export type TemplateListResult = {
  items: Array<{
    id: string
    templateName: string
    category: string
    language: string
    templateType: string
    status: string
    wabaName: string | null
    createdAt: Date
  }>
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function createGatewayTemplate(input: {
  draft: TemplateDraft
  provider: WhatsAppGatewayProvider
  createdBy?: string | null
}) {
  const { draft, provider, createdBy } = input
  const templateName = draft.templateName.trim()
  const wabaId = draft.wabaId.trim()
  if (!templateName || !wabaId) throw new WhatsAppGatewayError("Template name and WABA are required", { code: "INVALID_TEMPLATE" })

  const exists = await prisma.whatsAppGatewayTemplate.findUnique({
    where: { provider_wabaId_templateName: { provider: "whatsapp_gateway", wabaId, templateName } },
  })
  if (exists) throw new WhatsAppGatewayError("A template with this name already exists for this WABA", { code: "DUPLICATE_TEMPLATE" })

  const wire: TemplateWireBody = buildTemplatePayload(draft)
  let status = "submitted"
  let externalId: string | null = null
  let providerResponse: Prisma.InputJsonObject = {}
  let sanitizedError: string | null = null

  try {
    const result = await provider.createTemplate(draft)
    externalId = result.id || null
    status = result.status || "submitted"
    providerResponse = (result.sanitized ?? {}) as unknown as Prisma.InputJsonObject
  } catch (error) {
    sanitizedError = sanitizeErrorMessage(error instanceof Error ? error.message : "Template submission failed")
    status = "failed"
  }

  return prisma.whatsAppGatewayTemplate.create({
    data: {
      provider: "whatsapp_gateway",
      externalId,
      wabaId,
      templateName,
      category: draft.category,
      language: draft.language,
      templateType: draft.templateType || classifyTemplateType(draft),
      status,
      headerJson: draft.headerText ? { text: draft.headerText } : ({} as Prisma.InputJsonObject),
      bodyText: draft.messageBody || null,
      footerText: draft.footerText || null,
      buttonsJson: (draft.buttons ?? []) as Prisma.InputJsonArray,
      variablesJson: (draft.variableExamples ?? []) as Prisma.InputJsonArray,
      componentsJson: wire as unknown as Prisma.InputJsonObject,
      otpConfig: {
        otpButtons: draft.otpButtons ?? [],
        addSecurityRecommendation: draft.addSecurityRecommendation ?? false,
        codeExpirationMinutes: draft.codeExpirationMinutes,
        otpCodeLength: draft.otpCodeLength,
      } as Prisma.InputJsonObject,
      providerResponse,
      sanitizedError,
      createdBy: createdBy ?? null,
    },
  })
}

export async function listGatewayTemplates(params: TemplateListParams = {}): Promise<TemplateListResult> {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20))

  const where: Prisma.WhatsAppGatewayTemplateWhereInput = { provider: "whatsapp_gateway" }
  if (params.search?.trim()) {
    where.AND = {
      OR: [
        { templateName: { contains: params.search.trim(), mode: "insensitive" } },
        { bodyText: { contains: params.search.trim(), mode: "insensitive" } },
      ],
    }
  }
  if (params.category && params.category !== "all") where.category = params.category
  if (params.status && params.status !== "all") where.status = params.status
  if (params.wabaId && params.wabaId !== "all") where.wabaId = params.wabaId

  const [raw, total] = await Promise.all([
    prisma.whatsAppGatewayTemplate.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { waba: { select: { name: true } } },
    }),
    prisma.whatsAppGatewayTemplate.count({ where }),
  ])

  return {
    items: raw.map((template) => ({
      id: template.id,
      templateName: template.templateName,
      category: template.category,
      language: template.language,
      templateType: template.templateType,
      status: template.status,
      wabaName: template.waba?.name ?? null,
      createdAt: template.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

export async function countGatewayTemplates() {
  return prisma.whatsAppGatewayTemplate.count({ where: { provider: "whatsapp_gateway" } })
}
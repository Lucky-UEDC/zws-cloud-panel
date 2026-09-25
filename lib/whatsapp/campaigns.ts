import { prisma } from "@/lib/db"
import { enqueueWhatsAppCampaign, sendWhatsAppMessage } from "@/lib/whatsapp/queue"
import { WHATSAPP_TEMPLATE_KEYS } from "@/lib/whatsapp/template-registry"
import {
  classifyWhatsAppError,
  normalizeWhatsAppNumber,
  safeErrorMessage,
  safeStackTrace,
  syncWhatsAppCampaignCounters,
  writeWhatsAppErrorLog,
  writeWhatsAppLog,
} from "@/lib/whatsapp/diagnostics"
import { publicUrlToLocalPath } from "@/lib/whatsapp/media"
import { normalizeWhatsAppProvider } from "@/lib/whatsapp/provider"
import { checkWhatsAppSuppression, countRecentWhatsAppMarketingTouches, randomPacedDelayMs, resolveWhatsAppPacingPolicy } from "@/lib/whatsapp/safety"

type CampaignAudienceFilter = {
  audienceType?: string
  activeClients?: boolean
  expiredCustomers?: boolean
  noOrders?: boolean
  suspendedClients?: boolean
  unpaidInvoices?: boolean
  vpsCustomers?: boolean
  domainCustomers?: boolean
  productId?: string
  serviceStatus?: string
  location?: string
  tags?: string[]
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

export async function findCampaignRecipients(filterInput: unknown) {
  const filter = record(filterInput) as CampaignAudienceFilter
  const where: any = {
    phone: { not: null },
    whatsappOptIn: true,
    phoneVerified: true,
  }

  if (filter.audienceType === "active_customers") filter.activeClients = true
  if (filter.audienceType === "expired_customers") filter.expiredCustomers = true
  if (filter.audienceType === "no_orders") filter.noOrders = true
  if (filter.audienceType === "product_owners") filter.vpsCustomers = true
  if (filter.audienceType === "service_owners") filter.vpsCustomers = true

  if (filter.activeClients && !filter.suspendedClients) where.status = "ACTIVE"
  if (filter.expiredCustomers) {
    where.OR = [
      ...(Array.isArray(where.OR) ? where.OR : []),
      { status: "SUSPENDED" },
      { vpsInstances: { some: { OR: [{ status: { in: ["EXPIRED", "SUSPENDED", "PENDING_TERMINATION"] } }, { renewalDueAt: { lt: new Date() } }] } } },
    ]
  }
  if (filter.noOrders) {
    where.orders = { none: {} }
  }
  if (filter.suspendedClients && !filter.activeClients) where.status = "SUSPENDED"
  if (filter.location) {
    where.OR = [
      ...(Array.isArray(where.OR) ? where.OR : []),
      { city: { contains: filter.location, mode: "insensitive" } },
      { state: { contains: filter.location, mode: "insensitive" } },
      { country: { contains: filter.location, mode: "insensitive" } },
    ]
  }
  if (filter.unpaidInvoices) {
    where.invoices = { some: { status: { in: ["pending", "sent", "unpaid", "overdue"] }, deletedAt: null } }
  }
  if (filter.vpsCustomers) {
    where.vpsInstances = {
      some: {
        deletedAt: null,
        ...(filter.productId ? { productId: filter.productId } : {}),
        ...(filter.serviceStatus ? { status: String(filter.serviceStatus).toUpperCase() } : {}),
      },
    }
  }
  if (filter.domainCustomers) {
    where.dedicatedServices = { some: { status: { not: "cancelled" } } }
  }

  const customers = await prisma.customer.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      metadata: true,
      notificationPreferences: {
        where: { category: "marketing" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return customers.filter((customer) => {
    const preference = customer.notificationPreferences[0]
    if (preference && (!preference.whatsappEnabled || !preference.marketingEnabled)) return false
    const tags = Array.isArray(filter.tags) ? filter.tags.map(String).filter(Boolean) : []
    if (!tags.length) return true
    const metadata = record(customer.metadata)
    const customerTags = Array.isArray(metadata.tags) ? metadata.tags.map(String) : []
    return tags.some((tag) => customerTags.includes(tag))
  })
}

export async function createWhatsAppCampaign(input: {
  name: string
  type?: string | null
  provider?: string | null
  message: string
  caption?: string | null
  mediaUrl?: string | null
  mediaAssetId?: string | null
  mediaType?: string | null
  templateId?: string | null
  templateVersionId?: string | null
  templateLanguage?: string | null
  buttons?: Array<{ type: string; label: string; value?: string | null }>
  recurrence?: Record<string, unknown>
  timezone?: string | null
  pacingPolicy?: Record<string, unknown>
  compliance?: Record<string, unknown>
  audienceFilter?: Record<string, unknown>
  scheduledAt?: Date | null
  createdBy?: string | null
}) {
  const mediaAsset = input.mediaAssetId
    ? await (prisma as any).whatsAppMediaAsset.findUnique({ where: { id: input.mediaAssetId } }).catch(() => null)
    : null
  const mediaUrl = input.mediaUrl || mediaAsset?.publicUrl || null
  const mediaType = input.mediaType || mediaAsset?.mediaType || null
  const campaign = await prisma.whatsAppCampaign.create({
    data: {
      name: input.name,
      type: input.type || (mediaType ? `${mediaType}_caption` : "text"),
      provider: normalizeWhatsAppProvider(input.provider),
      message: input.message || input.caption || "",
      caption: input.caption || null,
      mediaUrl,
      mediaPath: mediaUrl ? publicUrlToLocalPath(mediaUrl) : null,
      mediaType,
      templateId: input.templateId || null,
      templateVersionId: input.templateVersionId || null,
      templateLanguage: input.templateLanguage || null,
      recurrence: (input.recurrence || {}) as any,
      timezone: input.timezone || "UTC",
      pacingPolicy: (input.pacingPolicy || {}) as any,
      compliance: {
        consentRequired: true,
        inviteOnlyGroups: true,
        allowForcedGroupJoin: false,
        ...(input.compliance || {}),
      } as any,
      audienceFilter: (input.audienceFilter || {}) as any,
      scheduledAt: input.scheduledAt || null,
      status: input.scheduledAt && input.scheduledAt > new Date() ? "scheduled" : "queued",
      createdBy: input.createdBy || null,
    },
  })

  const campaignMessage = await (prisma as any).whatsAppCampaignMessage.create({
    data: {
      campaignId: campaign.id,
      stepOrder: 1,
      messageType: mediaType || "text",
      templateId: input.templateId || null,
      templateVersionId: input.templateVersionId || null,
      templateLanguage: input.templateLanguage || null,
      headerType: mediaType || "none",
      body: input.message || input.caption || "",
      caption: input.caption || null,
      buttons: (input.buttons || []) as any,
      mediaAssetId: mediaAsset?.id || null,
      variables: [] as any,
      metadata: { source: "campaign_create" },
    },
  }).catch(() => null)

  if (mediaAsset?.id) {
    await (prisma as any).whatsAppCampaignMedia.create({
      data: {
        campaignId: campaign.id,
        campaignMessageId: campaignMessage?.id || null,
        mediaAssetId: mediaAsset.id,
        role: "header",
      },
    }).catch(() => null)
  }

  if (input.templateId) {
    await (prisma as any).whatsAppCampaignTemplate.create({
      data: {
        campaignId: campaign.id,
        templateId: input.templateId,
        templateVersionId: input.templateVersionId || null,
        language: input.templateLanguage || "en",
        role: "primary",
      },
    }).catch(() => null)
  }

  await enqueueWhatsAppCampaign(
    { campaignId: campaign.id },
    input.scheduledAt && input.scheduledAt > new Date() ? { delay: input.scheduledAt.getTime() - Date.now() } : undefined,
  ).catch(async (error) => {
    await writeWhatsAppErrorLog({ error, campaignId: campaign.id, metadata: { stage: "campaign_enqueue" } })
    await prisma.whatsAppCampaign.update({
      where: { id: campaign.id },
      data: { status: "failed", failed: 1, metadata: { queueError: safeErrorMessage(error) } as any },
    }).catch(() => null)
  })

  return campaign
}

export async function processWhatsAppCampaign(campaignId: string, retryFailedOnly = false) {
  const campaign = await prisma.whatsAppCampaign.findUnique({ where: { id: campaignId } })
  if (!campaign) throw new Error("Campaign not found")
  if (campaign.status === "paused") return { ok: true, paused: true }

  const recipients = retryFailedOnly
    ? await prisma.whatsAppCampaignLog.findMany({ where: { campaignId, status: "failed" } })
    : await findCampaignRecipients(campaign.audienceFilter)

  const total = recipients.length
  await prisma.whatsAppCampaign.update({
    where: { id: campaign.id },
    data: {
      status: total > 0 ? "running" : "completed",
      startedAt: campaign.startedAt || new Date(),
      completedAt: total > 0 ? null : new Date(),
      total,
      queued: retryFailedOnly ? campaign.queued : total,
      processing: 0,
      pending: total,
      sent: retryFailedOnly ? campaign.sent : 0,
      delivered: retryFailedOnly ? campaign.delivered : 0,
      read: retryFailedOnly ? campaign.read : 0,
      failed: retryFailedOnly ? Math.max(0, campaign.failed - total) : 0,
      abandoned: retryFailedOnly ? campaign.abandoned : 0,
      retryCount: retryFailedOnly ? { increment: 1 } : campaign.retryCount,
    },
  })

  if (!total) {
    await writeWhatsAppLog({
      event: "campaign.no_recipients",
      status: "completed",
      campaignId: campaign.id,
      metadata: { retryFailedOnly, audienceFilter: campaign.audienceFilter as any },
    })
    return { ok: true, total }
  }

  const campaignMessage = await (prisma as any).whatsAppCampaignMessage.findFirst({
    where: { campaignId: campaign.id },
    orderBy: { stepOrder: "asc" },
  }).catch(() => null)
  const mediaAsset = campaignMessage?.mediaAssetId
    ? await (prisma as any).whatsAppMediaAsset.findUnique({ where: { id: campaignMessage.mediaAssetId } }).catch(() => null)
    : null
  const policy = resolveWhatsAppPacingPolicy({ campaign })

  for (const recipient of recipients as any[]) {
    const customerId = recipient.customerId || recipient.id
    const phone = recipient.phone || ""
    let normalized: ReturnType<typeof normalizeWhatsAppNumber>
    try {
      normalized = normalizeWhatsAppNumber(phone)
    } catch (error) {
      const classification = classifyWhatsAppError(error)
      await prisma.whatsAppCampaignLog.create({
        data: {
          campaignId: campaign.id,
          customerId,
          toMasked: "****",
          status: "abandoned",
          failedAt: new Date(),
          abandonedAt: new Date(),
          failureReason: classification.failureReason,
          errorMessage: safeErrorMessage(error),
          stackTrace: safeStackTrace(error),
          metadata: { source: "whatsapp_campaign", invalidPhone: true } as any,
        },
      })
      await writeWhatsAppErrorLog({ error, campaignId: campaign.id, customerId, metadata: { stage: "campaign_recipient_normalize" } })
      continue
    }

    const suppression = await checkWhatsAppSuppression({
      customerId,
      phone,
      phoneHash: normalized.phoneHash,
      scope: "marketing",
    })
    const recentTouches = await countRecentWhatsAppMarketingTouches({
      customerId,
      phoneHash: normalized.phoneHash,
    })
    if (suppression.suppressed || policy.action === "suppress" || recentTouches >= policy.dailyFrequencyCap) {
      const reason = suppression.reason || (recentTouches >= policy.dailyFrequencyCap ? "frequency_cap" : policy.reason)
      await (prisma as any).whatsAppCampaignRecipient.create({
        data: {
          campaignId: campaign.id,
          campaignMessageId: campaignMessage?.id || null,
          customerId,
          toMasked: normalized.maskedPhone,
          phoneHash: normalized.phoneHash,
          status: "suppressed",
          suppressionReason: reason,
          riskScore: policy.riskScore,
          frequencyCount: recentTouches,
          metadata: { source: "campaign_safety" },
        },
      }).catch(() => null)
      await (prisma as any).whatsAppCampaignEvent.create({
        data: {
          campaignId: campaign.id,
          campaignMessageId: campaignMessage?.id || null,
          customerId,
          eventType: "suppressed",
          status: "suppressed",
          phoneHash: normalized.phoneHash,
          maskedPhone: normalized.maskedPhone,
          metadata: { reason, recentTouches, policy },
        },
      }).catch(() => null)
      continue
    }

    // Skip recipients already sent/queued in this campaign (prevents re-send on worker restart)
    if (!retryFailedOnly) {
      const existingLog = await prisma.whatsAppCampaignLog.findFirst({
        where: { campaignId: campaign.id, customerId, status: { not: "failed" } },
        select: { id: true },
      }).catch(() => null)
      if (existingLog) continue
    }

    const log = retryFailedOnly
      ? await prisma.whatsAppCampaignLog.update({
          where: { id: recipient.id },
          data: {
            status: "queued",
            errorMessage: null,
            failureReason: null,
            retryCount: { increment: 1 },
            pendingAt: new Date(),
            queuedAt: new Date(),
            toMasked: normalized.maskedPhone,
            phoneHash: normalized.phoneHash,
            metadata: {
              source: "whatsapp_campaign",
              campaignMessageId: campaignMessage?.id || null,
              mediaAssetId: mediaAsset?.id || null,
              provider: campaign.provider,
            } as any,
          },
        })
      : await prisma.whatsAppCampaignLog.create({
          data: {
            campaignId: campaign.id,
            customerId,
            toMasked: normalized.maskedPhone,
            phoneHash: normalized.phoneHash,
            status: "queued",
            queuedAt: new Date(),
            queueName: mediaAsset?.storagePath || campaign.mediaPath ? "whatsapp-media" : "whatsapp-send",
            metadata: {
              source: "whatsapp_campaign",
              campaignMessageId: campaignMessage?.id || null,
              mediaAssetId: mediaAsset?.id || null,
              provider: campaign.provider,
            } as any,
          },
        })

    const campaignRecipient = await (prisma as any).whatsAppCampaignRecipient.create({
      data: {
        campaignId: campaign.id,
        campaignMessageId: campaignMessage?.id || null,
        customerId,
        toMasked: normalized.maskedPhone,
        phoneHash: normalized.phoneHash,
        status: "queued",
        riskScore: policy.riskScore,
        frequencyCount: recentTouches,
        variables: {
          first_name: recipient.name || "there",
          offer_name: campaign.name,
        },
        queuedAt: new Date(),
        metadata: { campaignLogId: log.id, policyReason: policy.reason },
      },
    }).catch(() => null)

    const delayMs = randomPacedDelayMs(policy)
    const queued = await sendWhatsAppMessage({
      to: phone,
      provider: normalizeWhatsAppProvider(campaign.provider),
      filePath: mediaAsset?.storagePath || campaign.mediaPath || undefined,
      mediaAssetId: mediaAsset?.id || null,
      campaignMessageId: campaignMessage?.id || null,
      recipientId: campaignRecipient?.id || null,
      buttons: Array.isArray(campaignMessage?.buttons) ? campaignMessage.buttons : [],
      captionText: campaignMessage?.caption || campaign.caption || campaign.message,
      messageType: (campaignMessage?.messageType as any) || (campaign.mediaType as any) || "text",
      customerId,
      campaignId: campaign.id,
      campaignLogId: log.id,
      category: "marketing",
      templateKey: campaign.templateId || WHATSAPP_TEMPLATE_KEYS.CAMPAIGN_CUSTOM,
      templateVersionId: campaign.templateVersionId || null,
      language: campaign.templateLanguage || null,
      variables: {
        first_name: recipient.name || "there",
        offer_name: campaign.name,
        campaign_message: campaignMessage?.body || campaign.message,
        message_text: campaignMessage?.body || campaign.message,
      },
      metadata: {
        source: "whatsapp_campaign",
        campaignName: campaign.name,
        campaignMessageId: campaignMessage?.id || null,
        campaignRecipientId: campaignRecipient?.id || null,
        mediaAssetId: mediaAsset?.id || null,
        pacingPolicy: policy,
      },
    }, { delay: delayMs }).catch(async (error) => {
      const classification = classifyWhatsAppError(error)
      await prisma.whatsAppCampaignLog.update({
        where: { id: log.id },
        data: {
          status: classification.retryable ? "failed" : "abandoned",
          failedAt: new Date(),
          abandonedAt: classification.retryable ? null : new Date(),
          failureReason: classification.failureReason,
          errorMessage: safeErrorMessage(error),
          stackTrace: safeStackTrace(error),
        },
      })
      await writeWhatsAppErrorLog({ error, campaignId: campaign.id, campaignLogId: log.id, customerId, phoneHash: normalized.phoneHash, maskedPhone: normalized.maskedPhone, metadata: { stage: "campaign_recipient_enqueue" } })
      await syncWhatsAppCampaignCounters(campaign.id)
    })
    if (queued?.ok) {
      await (prisma as any).whatsAppCampaignEvent.create({
        data: {
          campaignId: campaign.id,
          campaignMessageId: campaignMessage?.id || null,
          recipientId: campaignRecipient?.id || null,
          customerId,
          mediaAssetId: mediaAsset?.id || null,
          eventType: policy.action === "slow_down" ? "risk_throttled" : "queued",
          status: "queued",
          provider: campaign.provider,
          messageLogId: queued.messageId || null,
          campaignLogId: log.id,
          phoneHash: normalized.phoneHash,
          maskedPhone: normalized.maskedPhone,
          metadata: { delayMs, policy },
        },
      }).catch(() => null)
      await writeWhatsAppLog({
        event: "campaign.recipient_queued",
        status: "queued",
        campaignId: campaign.id,
        campaignLogId: log.id,
        customerId,
        phoneHash: normalized.phoneHash,
        maskedPhone: normalized.maskedPhone,
        metadata: { delayMs, messageLogId: queued.messageId || null },
      })
    }
  }

  await syncWhatsAppCampaignCounters(campaign.id)
  return { ok: true, total }
}

export async function syncCampaignCounters(campaignId: string) {
  return syncWhatsAppCampaignCounters(campaignId)
}

export function randomCampaignDelayMs() {
  const min = Number(process.env.WHATSAPP_CAMPAIGN_MIN_DELAY_MS || 8_000)
  const max = Number(process.env.WHATSAPP_CAMPAIGN_MAX_DELAY_MS || 25_000)
  return Math.floor(min + Math.random() * Math.max(0, max - min))
}

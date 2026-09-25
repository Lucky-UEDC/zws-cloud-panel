import { prisma } from "@/lib/db"
import { getConsoleSettings } from "@/lib/console-access"
import {
  consoleEndpointForVps,
  resolveConsoleType,
  type ConsoleTemplateInput,
} from "@/lib/console-resolution"

export async function resolveConsoleMetadata(input: {
  template?: ConsoleTemplateInput | null
  vpsId: string
  actor?: "client" | "admin"
}) {
  const settings = await getConsoleSettings().catch(() => null)
  const resolution = resolveConsoleType({ template: input.template || null, settings })
  return {
    consoleType: resolution.consoleType,
    consoleEndpoint: consoleEndpointForVps(input.vpsId, input.actor || "client"),
    vmOsFamily: resolution.vmOsFamily,
  }
}

export async function persistVpsConsoleMetadata(input: {
  vpsId: string
  template?: ConsoleTemplateInput | null
  osTemplateId?: string | null
  actor?: "client" | "admin"
}) {
  const template = input.template || (input.osTemplateId
    ? await prisma.osTemplate.findUnique({
        where: { id: input.osTemplateId },
        select: {
          consoleType: true,
          name: true,
          slug: true,
          osType: true,
          category: true,
          osFamily: true,
          osVersion: true,
          proxmoxTemplateName: true,
          proxmoxConfig: true,
        },
      }).catch(() => null)
    : null)
  const metadata = await resolveConsoleMetadata({ template, vpsId: input.vpsId, actor: input.actor || "client" })
  await prisma.vpsInstance.update({
    where: { id: input.vpsId },
    data: metadata,
  }).catch(() => null)
  return metadata
}

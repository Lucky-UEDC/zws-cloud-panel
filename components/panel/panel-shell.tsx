import { PanelBackground } from "@/components/effects/panel-background"
import { cn } from "@/lib/utils"

export function PanelShell({
  header,
  sidebar,
  children,
  className,
}: {
  header: React.ReactNode
  sidebar: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("admin-shell", className)} data-panel-shell data-admin-shell>
      <PanelBackground className="panel-shell-background decorative-layer" />

      <div className="interactive-layer z-20 flex min-h-0 min-w-0 max-w-full flex-1 overflow-hidden">
        {sidebar}
        <main className="admin-main">
          <div className="min-w-0 max-w-full shrink-0">{header}</div>
          <div className="admin-page-scroll hide-scrollbar">
            <div className="decorative-layer fixed inset-0 z-0" data-decorative-layer>
              <div className="absolute left-1/2 top-16 h-[500px] w-[min(900px,100vw)] -translate-x-1/2 rounded-full bg-accent/6 blur-3xl" />
              <div className="absolute bottom-0 left-1/2 h-[380px] w-[min(700px,100vw)] -translate-x-1/2 rounded-full bg-accent/5 blur-3xl" />
            </div>
            <div className="interactive-layer min-w-0 max-w-full overflow-x-hidden p-4 sm:p-6 lg:p-8">
              {children}
              <footer className="mt-10 flex flex-col gap-2 border-t border-border/40 pt-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>Copyright {new Date().getFullYear()}</span>
                <span>Terms · Privacy · Support</span>
              </footer>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

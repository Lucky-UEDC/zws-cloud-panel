import Link from "next/link"
import { ArrowRight, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Container } from "@/components/layout/container"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"

export default function NotFound() {
  return (
    <>
      <Navbar />
      <main className="flex min-h-[70vh] items-center">
        <Container>
          <div className="mx-auto max-w-xl text-center">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
              Error 404
            </p>
            <h1 className="mt-4 text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
              This page drifted off-network.
            </h1>
            <p className="mt-5 text-pretty text-muted-foreground">
              The URL you followed doesn&apos;t exist or has been moved. Head
              back to the homepage or explore our infrastructure.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="gap-1.5">
                <Link href="/">
                  <Home className="h-4 w-4" />
                  Back to home
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="gap-1.5">
                <Link href="/support">
                  Contact support
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </Container>
      </main>
      <Footer />
    </>
  )
}

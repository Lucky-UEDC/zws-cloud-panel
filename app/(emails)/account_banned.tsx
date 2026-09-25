import { Body, Container, Head, Heading, Html, Preview, Text } from "react-email"
import * as React from "react"

type Props = {
  title?: string
  preview?: string
  message?: string
}

export default function Template({ title = "Platform Notification", preview = "Platform update", message = "There is an update on your account." }: Props) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#0b1020", color: "#e6eef8", fontFamily: "Arial, sans-serif", padding: "24px" }}>
        <Container style={{ margin: "0 auto", maxWidth: "560px", backgroundColor: "#111a2e", borderRadius: "12px", padding: "24px" }}>
          <Heading style={{ color: "#7de2d1", marginTop: 0 }}>{title}</Heading>
          <Text style={{ lineHeight: "1.6" }}>{message}</Text>
          <Text style={{ color: "#9fb3c8", fontSize: "12px", marginTop: "24px" }}>{"{{brandName}} • {{websiteUrl}}"}</Text>
        </Container>
      </Body>
    </Html>
  )
}

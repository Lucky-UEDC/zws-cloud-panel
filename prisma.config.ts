import "dotenv/config"
import { defineConfig } from "prisma/config"
import { assertDatabaseUrl } from "./lib/db-url"

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: assertDatabaseUrl(),
  },
})

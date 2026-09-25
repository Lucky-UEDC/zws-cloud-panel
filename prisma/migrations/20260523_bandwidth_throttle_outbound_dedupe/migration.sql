CREATE TABLE "bandwidth_throttle_states" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'clear',
  "limit_bytes" BIGINT NOT NULL DEFAULT 0,
  "cycle_started_at" TIMESTAMP(3),
  "cycle_ends_at" TIMESTAMP(3),
  "throttle_rate_mbps" DECIMAL(10,4) NOT NULL DEFAULT 0.50,
  "proxmox_rate_value" DECIMAL(10,4) NOT NULL DEFAULT 0.0625,
  "original_net0" TEXT,
  "applied_at" TIMESTAMP(3),
  "restored_at" TIMESTAMP(3),
  "last_notified_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bandwidth_throttle_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbound_event_deliveries" (
  "id" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "template_key" TEXT,
  "customer_id" TEXT,
  "order_id" TEXT,
  "vps_instance_id" TEXT,
  "invoice_id" TEXT,
  "cycle_key" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "provider_message_id" TEXT,
  "first_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "outbound_event_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bandwidth_throttle_states_vps_instance_id_key" ON "bandwidth_throttle_states"("vps_instance_id");
CREATE INDEX "bandwidth_throttle_states_status_applied_at_idx" ON "bandwidth_throttle_states"("status", "applied_at");
CREATE INDEX "bandwidth_throttle_states_cycle_ends_at_idx" ON "bandwidth_throttle_states"("cycle_ends_at");

CREATE UNIQUE INDEX "outbound_event_deliveries_dedupe_key_key" ON "outbound_event_deliveries"("dedupe_key");
CREATE INDEX "outbound_event_deliveries_channel_event_type_last_seen_at_idx" ON "outbound_event_deliveries"("channel", "event_type", "last_seen_at");
CREATE INDEX "outbound_event_deliveries_customer_id_event_type_last_seen_at_idx" ON "outbound_event_deliveries"("customer_id", "event_type", "last_seen_at");
CREATE INDEX "outbound_event_deliveries_order_id_event_type_idx" ON "outbound_event_deliveries"("order_id", "event_type");
CREATE INDEX "outbound_event_deliveries_vps_instance_id_event_type_idx" ON "outbound_event_deliveries"("vps_instance_id", "event_type");

ALTER TABLE "bandwidth_throttle_states"
  ADD CONSTRAINT "bandwidth_throttle_states_vps_instance_id_fkey"
  FOREIGN KEY ("vps_instance_id") REFERENCES "vps_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

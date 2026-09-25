CREATE TABLE IF NOT EXISTS "razorpay_customers" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "razorpay_customer_id" TEXT NOT NULL,
    "email" TEXT,
    "contact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "raw" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "razorpay_customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "payment_retry_queue" (
    "id" TEXT NOT NULL,
    "order_id" TEXT,
    "invoice_id" TEXT,
    "payment_id" TEXT,
    "customer_id" TEXT,
    "gateway" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retry_after" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "notification_key" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_retry_queue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "razorpay_customers_customer_id_key" ON "razorpay_customers"("customer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "razorpay_customers_razorpay_customer_id_key" ON "razorpay_customers"("razorpay_customer_id");
CREATE INDEX IF NOT EXISTS "razorpay_customers_status_idx" ON "razorpay_customers"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_retry_queue_notification_key_key" ON "payment_retry_queue"("notification_key");
CREATE INDEX IF NOT EXISTS "payment_retry_queue_gateway_status_retry_after_idx" ON "payment_retry_queue"("gateway", "status", "retry_after");
CREATE INDEX IF NOT EXISTS "payment_retry_queue_invoice_id_idx" ON "payment_retry_queue"("invoice_id");
CREATE INDEX IF NOT EXISTS "payment_retry_queue_order_id_idx" ON "payment_retry_queue"("order_id");
CREATE INDEX IF NOT EXISTS "payment_retry_queue_customer_id_idx" ON "payment_retry_queue"("customer_id");

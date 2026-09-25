-- PaymentGateway is the only active runtime source for external gateway
-- credentials and routing. Preserve domain rows for history/audit, but retire
-- their authority for Razorpay, PhonePe, and Cashfree.

UPDATE domain_configs
SET
  "defaultGateway" = NULL,
  "fallbackGateway" = NULL,
  "allowedGatewayModes" = COALESCE(
    (
      SELECT jsonb_agg(value)
      FROM jsonb_array_elements_text(COALESCE("allowedGatewayModes", '[]'::jsonb)) AS modes(value)
      WHERE lower(value) NOT IN ('razorpay', 'phonepe', 'cashfree')
    ),
    '[]'::jsonb
  ),
  "updatedAt" = NOW()
WHERE
  lower(COALESCE("defaultGateway", '')) IN ('razorpay', 'phonepe', 'cashfree')
  OR lower(COALESCE("fallbackGateway", '')) IN ('razorpay', 'phonepe', 'cashfree')
  OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE("allowedGatewayModes", '[]'::jsonb)) AS modes(value)
    WHERE lower(value) IN ('razorpay', 'phonepe', 'cashfree')
  );

UPDATE domain_gateway_configs
SET
  enabled = FALSE,
  "credentialsEnc" = NULL,
  "credentialsIv" = NULL,
  "credentialsTag" = NULL,
  "webhookUrl" = NULL,
  "returnUrl" = NULL,
  "extraConfig" = COALESCE("extraConfig", '{}'::jsonb) || jsonb_build_object(
    'retiredRuntimeSource', 'PaymentGateway',
    'retiredAt', to_jsonb(NOW())
  ),
  "updatedAt" = NOW()
WHERE lower(gateway) IN ('razorpay', 'phonepe', 'cashfree');

INSERT INTO "pool_node_assignments" ("id", "poolId", "nodeId", "priority", "active", "createdAt", "updatedAt")
SELECT
  concat('pna_', md5(concat(nip."poolId", ':', nip."nodeId"))),
  nip."poolId",
  nip."nodeId",
  CASE WHEN nip."isDefault" THEN 1 WHEN nip."isPremiumDefault" THEN 5 ELSE 100 END,
  true,
  COALESCE(nip."createdAt", now()),
  now()
FROM "node_ip_pools" nip
JOIN "ip_pools" p ON p."id" = nip."poolId"
JOIN "proxmox_nodes" n ON n."id" = nip."nodeId"
ON CONFLICT ("poolId", "nodeId") DO UPDATE
SET
  "priority" = LEAST("pool_node_assignments"."priority", EXCLUDED."priority"),
  "active" = true,
  "updatedAt" = now();

INSERT INTO "pool_product_assignments" ("id", "poolId", "productId", "priority", "active", "createdAt", "updatedAt")
SELECT
  concat('ppa_', md5(concat(pip."poolId", ':', pip."productId"))),
  pip."poolId",
  pip."productId",
  CASE WHEN pip."isDefault" THEN 1 WHEN pip."allowPremium" THEN 5 ELSE 100 END,
  true,
  COALESCE(pip."createdAt", now()),
  now()
FROM "product_ip_pools" pip
JOIN "ip_pools" p ON p."id" = pip."poolId"
JOIN "products" pr ON pr."id" = pip."productId"
ON CONFLICT ("poolId", "productId") DO UPDATE
SET
  "priority" = LEAST("pool_product_assignments"."priority", EXCLUDED."priority"),
  "active" = true,
  "updatedAt" = now();

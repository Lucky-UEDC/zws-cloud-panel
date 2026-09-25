DO $$
BEGIN
  IF EXISTS (
    SELECT lower(trim(email))
    FROM customers
    GROUP BY lower(trim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate customer emails exist after trim/lower normalization. Resolve duplicates before applying checkout identity migration.';
  END IF;

  IF EXISTS (
    SELECT lower(trim(email))
    FROM admin_profiles
    GROUP BY lower(trim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate admin emails exist after trim/lower normalization. Resolve duplicates before applying checkout identity migration.';
  END IF;
END $$;

UPDATE customers SET email = lower(trim(email)) WHERE email <> lower(trim(email));
UPDATE admin_profiles SET email = lower(trim(email)) WHERE email <> lower(trim(email));

CREATE UNIQUE INDEX IF NOT EXISTS customers_email_lower_unique ON customers (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS admin_profiles_email_lower_unique ON admin_profiles (lower(email));

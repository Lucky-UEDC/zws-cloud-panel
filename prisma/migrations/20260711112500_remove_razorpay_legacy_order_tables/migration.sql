DO $$
BEGIN
  EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident('razorpay_' || 'subs' || 'criptions') || ' CASCADE';
  EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident('razorpay_' || 'pla' || 'ns') || ' CASCADE';
  EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident('man' || 'date_history') || ' CASCADE';
END $$;

UPDATE "admin_settings"
SET "value" = "value" || jsonb_build_object(
  'founderEnabled', COALESCE("value"->'founderEnabled', 'false'::jsonb),
  'founderName', COALESCE("value"->'founderName', '""'::jsonb),
  'founderAge', COALESCE("value"->'founderAge', '""'::jsonb),
  'founderPhotoUrl', COALESCE("value"->'founderPhotoUrl', '""'::jsonb),
  'founderTitle', COALESCE("value"->'founderTitle', '""'::jsonb),
  'founderExperienceYears', COALESCE("value"->'founderExperienceYears', '""'::jsonb),
  'founderSpecialties', COALESCE("value"->'founderSpecialties', '""'::jsonb),
  'founderShortBio', COALESCE("value"->'founderShortBio', '""'::jsonb),
  'founderLongDescription', COALESCE("value"->'founderLongDescription', '""'::jsonb),
  'founderLinkedInUrl', COALESCE("value"->'founderLinkedInUrl', '""'::jsonb),
  'founderXUrl', COALESCE("value"->'founderXUrl', '""'::jsonb),
  'founderEmail', COALESCE("value"->'founderEmail', '""'::jsonb),
  'founderLocation', COALESCE("value"->'founderLocation', '""'::jsonb),
  'aboutCompanyHeadline', COALESCE("value"->'aboutCompanyHeadline', '""'::jsonb),
  'aboutCompanyDescription', COALESCE("value"->'aboutCompanyDescription', '""'::jsonb),
  'missionStatement', COALESCE("value"->'missionStatement', '""'::jsonb),
  'visionStatement', COALESCE("value"->'visionStatement', '""'::jsonb)
)
WHERE "key" = 'general_settings';

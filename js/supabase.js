const SUPABASE_URL =
  'https://xipgpnpuqhsearvabhod.supabase.co';

const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_LEhW85M0ov57Tb33abLdZQ_3CFBuXt4';

window.globalQuerySupabase =
  supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );

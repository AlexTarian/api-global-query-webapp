const SUPABASE_URL =
  'https://xipgpnpuqhsearvabhod.supabase.co';

const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_LEhW85M0ov57Tb33abLdZQ_3CFBuXt4';

window.globalQuerySupabase =
  supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );

async function runSupabaseQueryWithRetry_(queryFactory, retries = 1) {
  const result = await queryFactory();

  if (
    retries > 0 &&
    result?.error?.code === 'PGRST303' &&
    result?.error?.message === 'JWT issued at future'
  ) {
    console.warn('Supabase JWT timing issue; retrying request...');

    await new Promise(resolve => setTimeout(resolve, 1500));

    return runSupabaseQueryWithRetry_(queryFactory, retries - 1);
  }

  return result;
}

window.withSupabaseRetry_ = withSupabaseRetry_;

(function () {
  'use strict';
  // anon/publishable key 設計上就是給前端公開用的（受RLS保護），不是密碼，可以進版控。
  // 真正不可外流的是 service_role/secret key，那把從沒進過這支App的任何檔案。
  const SUPABASE_URL = 'https://ejqdyozjpewjwtnqohqd.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_mzkI2x9tbLELjcxK8q_ixQ_LElC_w4R';

  window.SB = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}());

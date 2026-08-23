-- 402 光影獵人 Phase 5b：推播用的資料表補丁
-- 使用方式：SQL Editor貼上執行一次。

create table push_subscriptions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
alter table push_subscriptions enable row level security;
create policy "使用者只能看自己的push訂閱" on push_subscriptions for select using (auth.uid() = user_id);
create policy "使用者只能新增自己的push訂閱" on push_subscriptions for insert with check (auth.uid() = user_id);
create policy "使用者只能刪自己的push訂閱" on push_subscriptions for delete using (auth.uid() = user_id);

-- 避免同一人短時間內被同一個訂閱重複轟炸
alter table subscriptions add column last_notified_at timestamptz;

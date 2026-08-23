-- 402 光影獵人 Supabase 資料庫骨架
-- 使用方式：Supabase 專案建好後，進 SQL Editor 貼上整段執行一次即可。
-- 原始PRD只給了4張表的結構，沒有寫RLS(Row Level Security)——這段是
-- 補上去的，沒有RLS的話任何登入使用者都能改別人的訂閱/資料，必須加。

create extension if not exists "uuid-ossp";

-- 1. 用戶表
create table profiles (
  id uuid references auth.users(id) primary key,
  username text unique,
  expo_push_token text,
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "使用者可讀所有profile" on profiles for select using (true);
create policy "使用者只能改自己的profile" on profiles for update using (auth.uid() = id);
create policy "使用者只能新增自己的profile" on profiles for insert with check (auth.uid() = id);

-- 2. 攝影熱點表（管理員/後台curated，一般使用者只能讀）
create table spots (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  lat float not null,
  lng float not null,
  type text not null, -- 'sunset' / 'sea_of_clouds' / 'stars'
  min_elevation int default 0
);
alter table spots enable row level security;
create policy "所有人可讀熱點" on spots for select using (true);
-- 刻意不開放 insert/update/delete 給 anon/authenticated：
-- 熱點資料由後台（service_role金鑰）維護，避免使用者亂新增假熱點。

-- 3. 用戶訂閱追蹤表
create table subscriptions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id),
  spot_id uuid references spots(id),
  notify_threshold int default 75,
  unique(user_id, spot_id)
);
alter table subscriptions enable row level security;
create policy "使用者只能看自己的訂閱" on subscriptions for select using (auth.uid() = user_id);
create policy "使用者只能新增自己的訂閱" on subscriptions for insert with check (auth.uid() = user_id);
create policy "使用者只能改自己的訂閱" on subscriptions for update using (auth.uid() = user_id);
create policy "使用者只能刪自己的訂閱" on subscriptions for delete using (auth.uid() = user_id);

-- 4. 即時回報打卡表（社群動態牆，大家都看得到，但只能發自己的）
create table reports (
  id uuid default uuid_generate_v4() primary key,
  spot_id uuid references spots(id),
  user_id uuid references profiles(id),
  phenomenon text, -- 'fiery_glow' / 'sea_of_clouds' / 'clear_sky'
  image_url text,
  reported_at timestamptz default now()
);
alter table reports enable row level security;
create policy "所有人可讀即時回報" on reports for select using (true);
create policy "使用者只能新增自己的回報" on reports for insert with check (auth.uid() = user_id);
create policy "使用者只能刪自己的回報" on reports for delete using (auth.uid() = user_id);

-- 開啟 Realtime（Live Radar頁要監聽這張表的insert）
alter publication supabase_realtime add table reports;

-- Storage：回報照片放這個bucket，建好專案後要另外在Dashboard→Storage手動建立
-- bucket名稱："report-photos"，設public read，upload限authenticated。

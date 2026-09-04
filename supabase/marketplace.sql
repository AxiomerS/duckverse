-- ============================================================================
-- Marketplace v1 — SQL для Supabase (выполнить в SQL editor).
-- Добавляет: таблицу эксклюзивов, защиту от повторов покупок и колонку kind в sell_requests.
-- Все таблицы с RLS. Чтение публичное; запись — только сервис-роль (edge fn) или админ.
-- ============================================================================

-- Кошелёк-админ (тот же, что в App.tsx ADMIN_WALLET / sell-payout ADMIN):
--   EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk

-- 1) Эксклюзивные лоты от казны (лимитированный тираж) ------------------------
create table if not exists public.exclusives (
  id         text primary key,
  species    text not null,
  name       text,
  price      numeric not null,          -- цена в SOL
  stock      int not null default 1,    -- остаток
  sold       int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.exclusives enable row level security;

-- читать могут все
drop policy if exists exclusives_read on public.exclusives;
create policy exclusives_read on public.exclusives for select using (true);

-- писать/менять/удалять — только админ (его wallet-claim в JWT)
drop policy if exists exclusives_admin_write on public.exclusives;
create policy exclusives_admin_write on public.exclusives
  for all to authenticated
  using ((auth.jwt() ->> 'wallet') = 'EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk')
  with check ((auth.jwt() ->> 'wallet') = 'EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk');

-- 2) Защита от повторной обработки покупок на маркете ------------------------
create table if not exists public.market_purchases (
  signature  text primary key,          -- подпись tx (уникальна → защита от повторов)
  buyer      text not null,
  kind       text not null,             -- 'sale' | 'exclusive'
  ref_id     text not null,             -- id лота / эксклюзива
  seller     text,
  lamports   bigint,
  created_at timestamptz not null default now()
);
alter table public.market_purchases enable row level security;
-- политик нет → доступ только у сервис-роли (edge function market-buy)

-- 3) Продажи петов идут в общую очередь выплат sell_requests ------------------
alter table public.sell_requests add column if not exists kind text not null default 'sell';
-- значения: 'sell' (продажа PV → SOL) | 'market' (продажа пета между игроками)

-- 4) Атомарная покупка эксклюзива: один UPDATE уменьшает сток (WHERE stock>0) — защита от оверселла
--    при двух одновременных покупателях. Пустой результат = распродан. Вызывается edge-функцией market-buy.
create or replace function public.buy_exclusive(p_id text)
returns setof public.exclusives
language sql
as $$
  update public.exclusives
     set stock = stock - 1,
         sold = sold + 1,
         active = (stock - 1) > 0
   where id = p_id and active = true and stock > 0
  returning *;
$$;

-- 5) Заявки на награды за квесты. Игрок создаёт свою заявку (wallet=свой), админ видит все и
--    отмечает paid (SOL отправляет вручную). unique(wallet, quest_id) → один квест нельзя забрать дважды.
create table if not exists public.quest_claims (
  id         text primary key,
  wallet     text not null,
  quest_id   text not null,
  status     text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (wallet, quest_id)
);
alter table public.quest_claims enable row level security;

-- читать: свои — игрок, все — админ
drop policy if exists quest_claims_read on public.quest_claims;
create policy quest_claims_read on public.quest_claims
  for select to authenticated
  using ((auth.jwt() ->> 'wallet') = wallet
      or (auth.jwt() ->> 'wallet') = 'EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk');

-- создавать: только свою заявку (wallet = свой claim в JWT)
drop policy if exists quest_claims_insert on public.quest_claims;
create policy quest_claims_insert on public.quest_claims
  for insert to authenticated
  with check ((auth.jwt() ->> 'wallet') = wallet);

-- менять статус (mark paid): только админ
drop policy if exists quest_claims_admin_update on public.quest_claims;
create policy quest_claims_admin_update on public.quest_claims
  for update to authenticated
  using ((auth.jwt() ->> 'wallet') = 'EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk')
  with check ((auth.jwt() ->> 'wallet') = 'EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk');

-- ============================================================================
-- Point E · Phase 1 — server-authoritative PV balance.
-- balances = единственный источник правды по PV. Пишет ТОЛЬКО сервис-роль (edge fn pv/sell/buy).
-- Клиент только читает свою строку; saves.data.coins больше не является авторитетным.
-- ============================================================================
create table if not exists public.balances (
  wallet          text primary key,
  coins           numeric not null default 0,
  last_daily      bigint not null default 0,  -- ms epoch последней выдачи дейли
  last_collect    bigint not null default 0,  -- ms epoch последнего начисления пассива
  last_run_reward bigint not null default 0,  -- ms epoch последней награды за топ лидерборда
  battle_day      bigint not null default 0,  -- номер суток (floor(ms/86400000)) для дневного кэпа арены
  battle_gain     numeric not null default 0, -- сколько PV выиграно на арене за текущие сутки
  updated_at      timestamptz not null default now()
);
alter table public.balances enable row level security;

-- читать: свой баланс — игрок, все — админ. ЗАПИСИ через RLS нет → только сервис-роль (edge fns).
drop policy if exists balances_read on public.balances;
create policy balances_read on public.balances
  for select to authenticated
  using ((auth.jwt() ->> 'wallet') = wallet
      or (auth.jwt() ->> 'wallet') = 'EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk');

-- РАЗОВЫЙ бэкфилл: перенести текущий баланс из сейвов (выполнить ОДИН раз перед переключением sell/buy).
insert into public.balances (wallet, coins, last_collect, updated_at)
select wallet, floor(coalesce((data->>'coins')::numeric, 0)), (extract(epoch from now()) * 1000)::bigint, now()
from public.saves
on conflict (wallet) do nothing;

-- ============================================================================
-- Point E · Phase 1 hardening — АТОМАРНЫЕ мутации баланса (защита от гонок read-modify-write).
-- Условие проверяется ВНУТРИ одного UPDATE → параллельные запросы не могут задвоить начисление
-- (дейли/пассив/бой) или уйти в минус (spend/рулетка). Вызываются ТОЛЬКО edge-функцией pv через
-- service_role (execute отозван у public). Возврат numeric = новый баланс; NULL = условие не выполнено.
-- ============================================================================

-- Пассив: начислить за прошедшее время (капнуто), атомарно сдвинуть last_collect.
-- БЫЛО: floor() округлял КАЖДОЕ начисление до целого PV и всё равно сдвигал last_collect —
-- при синке раз в 20с и базовой ставке 2 PV/мин это ~0.667 PV за тик, floor→0, часы сброшены,
-- остаток потерян НАВСЕГДА. Итог: пассив почти никогда не успевал накопиться. coins — numeric,
-- дробные PV на сервере это нормально (клиент везде показывает Math.floor(pet.coins)) — просто
-- перестаём округлять при начислении, округление только для отображения.
create or replace function public.pv_collect(p_wallet text, p_rate numeric, p_cap_ms bigint, p_now bigint)
returns numeric language sql as $$
  update public.balances
     set coins = coins + least(greatest(p_now - last_collect, 0), p_cap_ms) / 60000.0 * p_rate,
         last_collect = p_now, updated_at = now()
   where wallet = p_wallet
  returning coins;
$$;

-- Дейли: начислить только если кулдаун прошёл (иначе 0 строк → NULL).
create or replace function public.pv_daily(p_wallet text, p_reward numeric, p_cooldown bigint, p_now bigint)
returns numeric language sql as $$
  update public.balances set coins = coins + p_reward, last_daily = p_now, updated_at = now()
   where wallet = p_wallet and (p_now - last_daily) >= p_cooldown
  returning coins;
$$;

-- Трата: списать только если хватает баланса (иначе NULL). Без гонки овердрафта.
create or replace function public.pv_spend(p_wallet text, p_amount numeric)
returns numeric language sql as $$
  update public.balances set coins = coins - p_amount, updated_at = now()
   where wallet = p_wallet and coins >= p_amount
  returning coins;
$$;

-- Универсальный: прибавить delta при условии coins ≥ min (рулетка: min=ставка, delta=выигрыш−ставка).
create or replace function public.pv_add_checked(p_wallet text, p_delta numeric, p_min numeric)
returns numeric language sql as $$
  update public.balances set coins = coins + p_delta, updated_at = now()
   where wallet = p_wallet and coins >= p_min
  returning coins;
$$;

-- Арена: атомарно с дневным кэпом выигрыша (сброс на новых сутках). won доверяем (Phase 1), но капнуто.
-- БЫЛО: на победе кэп (p_max - battle_gain) резал СУММУ ставка+награда — игрок, близкий к дневному
-- кэпу, мог не получить назад даже собственную ставку, хотя это его же деньги, а не "доход арены".
-- Теперь ставка возвращается ПОЛНОСТЬЮ всегда; кэпу подчиняется только сама награда (battle_gain
-- считает только награду, не ставку — это и есть "доход", который капаем).
create or replace function public.pv_battle(p_wallet text, p_won boolean, p_stake numeric, p_reward numeric, p_day bigint, p_max numeric)
returns numeric language plpgsql as $$
declare c numeric; g numeric; reward_credit numeric;
begin
  select case when battle_day = p_day then battle_gain else 0 end into g
    from public.balances where wallet = p_wallet for update;
  if g is null then return null; end if;
  if p_won then
    reward_credit := least(p_reward, greatest(p_max - g, 0));
    update public.balances set coins = coins + p_stake + reward_credit, battle_gain = g + reward_credit, battle_day = p_day, updated_at = now()
     where wallet = p_wallet returning coins into c;
  else
    update public.balances set coins = greatest(coins - p_stake, 0), battle_gain = g, battle_day = p_day, updated_at = now()
     where wallet = p_wallet returning coins into c;
  end if;
  return c;
end $$;

-- Награда за топ лидерборда: начислить только если кулдаун прошёл (ранг считает edge из scores).
create or replace function public.pv_run_reward(p_wallet text, p_reward numeric, p_cooldown bigint, p_now bigint)
returns numeric language sql as $$
  update public.balances set coins = coins + p_reward, last_run_reward = p_now, updated_at = now()
   where wallet = p_wallet and (p_now - last_run_reward) >= p_cooldown
  returning coins;
$$;

-- Вызывать эти функции может ТОЛЬКО сервис-роль (edge fn pv). Игрокам — запрещено (defense-in-depth;
-- к тому же RLS balances и так без права записи для authenticated).
revoke execute on function public.pv_collect(text,numeric,bigint,bigint) from public;
revoke execute on function public.pv_daily(text,numeric,bigint,bigint) from public;
revoke execute on function public.pv_spend(text,numeric) from public;
revoke execute on function public.pv_add_checked(text,numeric,numeric) from public;
revoke execute on function public.pv_battle(text,boolean,numeric,numeric,bigint,numeric) from public;
revoke execute on function public.pv_run_reward(text,numeric,bigint,bigint) from public;
grant execute on function public.pv_collect(text,numeric,bigint,bigint) to service_role;
grant execute on function public.pv_daily(text,numeric,bigint,bigint) to service_role;
grant execute on function public.pv_spend(text,numeric) to service_role;
grant execute on function public.pv_add_checked(text,numeric,numeric) to service_role;
grant execute on function public.pv_battle(text,boolean,numeric,numeric,bigint,numeric) to service_role;
grant execute on function public.pv_run_reward(text,numeric,bigint,bigint) to service_role;

-- ============================================================================
-- Phase 2 — SERVER-AUTHORITATIVE PET OWNERSHIP (последний блокер для mainnet).
-- pet_ledger = единственный источник правды: КТО каким видом владеет. Пишет ТОЛЬКО сервис-роль
-- (edge fn pets/market-buy). Клиент только читает свою строку. saves.data.ownedSpecies больше
-- не авторитетно (как и coins). Продать пета за SOL можно только если он есть в этой таблице.
-- ============================================================================
create table if not exists public.pet_ledger (
  wallet     text not null,
  species    text not null,
  level      int not null default 1,
  buffs      jsonb not null default '[]'::jsonb,
  name       text,
  source     text not null default 'grant',   -- starter | chest | breed | market | exclusive | backfill
  created_at timestamptz not null default now(),
  primary key (wallet, species)                -- модель игры: один экземпляр на вид у игрока
);
alter table public.pet_ledger enable row level security;

-- читать: свои строки — игрок, все — админ. ЗАПИСИ через RLS нет → только сервис-роль (edge fns).
drop policy if exists pet_ledger_read on public.pet_ledger;
create policy pet_ledger_read on public.pet_ledger
  for select to authenticated
  using ((auth.jwt() ->> 'wallet') = wallet
      or (auth.jwt() ->> 'wallet') = 'EezTHmjK2x4zYDSSjRwQadrgVsfapMUu9HtBMFXyTrPk');

-- РАЗОВЫЙ бэкфилл: перенести текущих питомцев из сейвов (доверяем текущему devnet-состоянию ОДИН раз,
-- как бэкфиллу balances в Phase 1). Уровень/баффы активного вида лежат в корне сейва, неактивных — в progress.
insert into public.pet_ledger (wallet, species, level, buffs, name, source)
select s.wallet,
       sp.species,
       greatest(coalesce(
         case when sp.species = s.data->>'species'
              then (s.data->>'level')::int
              else (s.data->'progress'->sp.species->>'level')::int end, 1), 1),
       coalesce(
         case when sp.species = s.data->>'species'
              then s.data->'buffs'
              else s.data->'progress'->sp.species->'buffs' end, '[]'::jsonb),
       s.data->'names'->>sp.species,
       'backfill'
from public.saves s
cross join lateral jsonb_array_elements_text(coalesce(s.data->'ownedSpecies', '[]'::jsonb)) as sp(species)
on conflict (wallet, species) do nothing;

-- Выдать вид игроку, если он им ещё НЕ владеет (идемпотентно). Пусто = уже владеет.
create or replace function public.pet_grant(p_wallet text, p_species text, p_level int, p_buffs jsonb, p_name text, p_source text)
returns setof public.pet_ledger language sql as $$
  insert into public.pet_ledger (wallet, species, level, buffs, name, source)
  values (p_wallet, p_species, greatest(coalesce(p_level, 1), 1), coalesce(p_buffs, '[]'::jsonb), p_name, coalesce(p_source, 'grant'))
  on conflict (wallet, species) do nothing
  returning *;
$$;

-- Атомарно «забрать» вид у игрока (эскроу при выставлении на продажу). Пусто = не владеет/уже забрали.
-- Возвращает строку, чтобы edge fn взял авторитетные данные (или откатил при сбое вставки лота).
create or replace function public.pet_take(p_wallet text, p_species text)
returns setof public.pet_ledger language sql as $$
  delete from public.pet_ledger where wallet = p_wallet and species = p_species returning *;
$$;

-- Вызывать эти функции может ТОЛЬКО сервис-роль (edge fn pets / market-buy). Игрокам — запрещено.
revoke execute on function public.pet_grant(text,text,int,jsonb,text,text) from public;
revoke execute on function public.pet_take(text,text) from public;
grant execute on function public.pet_grant(text,text,int,jsonb,text,text) to service_role;
grant execute on function public.pet_take(text,text) to service_role;

-- Аксессуары, надетые на выставленного пета — уходят покупателю вместе с петом.
alter table public.listings add column if not exists accessories jsonb not null default '[]'::jsonb;

-- Запираем запись в listings: раньше лот создавал/удалял сам клиент (createListing/deleteListing).
-- Теперь лоты пишет ТОЛЬКО сервис-роль (edge fn pets, после проверки pet_take по леджеру). Клиент —
-- только чтение. Имена политик неизвестны (DDL таблицы вне репозитория) → сносим их динамически.
alter table public.listings enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'listings' loop
    execute format('drop policy %I on public.listings', p.policyname);
  end loop;
end $$;

-- 6) Rate-limit для buy/market-buy ---------------------------------------------------------------
-- Эти две edge-функции принимают {wallet, signature} БЕЗ авторизации (проверка идёт по самой
-- транзакции), и на каждый запрос дёргают платный mainnet RPC (Helius) до 8 раз. Без ограничения
-- кто угодно может слать мусорные подписи пачками и накручивать счёт/забивать функцию. rl_check —
-- атомарный счётчик "запросов за окно": INSERT..ON CONFLICT + блокировка строки на время функции,
-- так что параллельные запросы с одним и тем же ключом (обычно IP) не проходят мимо счётчика.
create table if not exists public.rate_limits (
  key          text primary key,   -- обычно IP запроса, отдельно для buy/market-buy
  count        int not null default 0,
  window_start bigint not null     -- epoch ms начала текущего окна
);
alter table public.rate_limits enable row level security; -- политик нет — только service_role

create or replace function public.rl_check(p_key text, p_max int, p_window_ms bigint, p_now bigint)
returns boolean
language plpgsql
as $$
declare
  v_count int;
  v_start bigint;
begin
  insert into public.rate_limits (key, count, window_start) values (p_key, 0, p_now)
    on conflict (key) do nothing;
  select count, window_start into v_count, v_start from public.rate_limits where key = p_key for update;
  if p_now - v_start > p_window_ms then
    update public.rate_limits set count = 1, window_start = p_now where key = p_key;
    return true;
  end if;
  if v_count >= p_max then
    return false;
  end if;
  update public.rate_limits set count = count + 1 where key = p_key;
  return true;
end;
$$;
revoke execute on function public.rl_check(text,int,bigint,bigint) from public;
grant execute on function public.rl_check(text,int,bigint,bigint) to service_role;
create policy listings_read on public.listings for select using (true);

-- 7) Глобальная веха "в игре впервые стало 10+ игроков" -----------------------------------------
-- Раньше run-reward (награда за топ в Ranks) открывался у КАЖДОГО игрока по-своему: как только
-- playerCount()>10 на момент ЕГО запроса. Теперь фиксируем момент, когда порог был пройден,
-- ОДИН раз на всю игру — и открываем награду всем ОДНОВРЕМЕННО спустя 2 часа после этого момента
-- (см. RUN_REWARD_UNLOCK_DELAY в edge fn pv). mark_milestone_once — атомарный INSERT..ON CONFLICT:
-- при гонке (несколько игроков одновременно пересекли порог) побеждает только первая запись.
create table if not exists public.milestones (
  key text primary key,
  at  bigint not null   -- epoch ms, когда веха была впервые достигнута
);
alter table public.milestones enable row level security; -- политик нет — только service_role

create or replace function public.mark_milestone_once(p_key text, p_now bigint)
returns bigint
language plpgsql
as $$
declare v_at bigint;
begin
  insert into public.milestones (key, at) values (p_key, p_now) on conflict (key) do nothing;
  select at into v_at from public.milestones where key = p_key;
  return v_at;
end;
$$;
revoke execute on function public.mark_milestone_once(text,bigint) from public;
grant execute on function public.mark_milestone_once(text,bigint) to service_role;

-- 8) Квесты стали ГЛОБАЛЬНОЙ гонкой -------------------------------------------------------------
-- Раньше unique(wallet,quest_id) — у каждого игрока свой независимый прогресс/награда за квест.
-- Теперь первый игрок, кто заявил награду за квест, забирает её и ЗАКРЫВАЕТ квест для всех
-- остальных (они его больше не видят активным, видят кем он закрыт). Атомарность обеспечивает
-- unique-констрейнт на один quest_id — при гонке двух claim'ов вторая вставка получит 409.
alter table public.quest_claims drop constraint if exists quest_claims_wallet_quest_id_key;
alter table public.quest_claims add constraint quest_claims_quest_id_key unique (quest_id);

-- Все игроки (даже без подключённого кошелька) должны видеть, какие квесты уже закрыты и кем —
-- иначе непонятно, почему квест внезапно пропал. Было: читать могли только сам заявитель и админ.
drop policy if exists quest_claims_read on public.quest_claims;
create policy quest_claims_read on public.quest_claims for select using (true);

-- 9) LIVE PvP — очередь матчмейкинга ---------------------------------------------------------------
-- Battle Arena раньше был только async (дерёшься со СНИМКОМ чужого профиля — реальный игрок об этом
-- даже не узнаёт). Теперь: игрок встаёт в очередь battle_queue; следующий, кто тоже встанет в
-- очередь (или уже стоит), атомарно ЗАБИРАЕТ его в пару (battle_queue_poll, лочит строку через
-- `for update skip locked`, чтобы 2 одновременных запроса не схватили одного соперника дважды) —
-- оба игрока получают один и тот же match_id + снимок профиля друг друга. Сам бой каждый клиент
-- считает у себя (client-reported, как и раньше), но ДЕТЕРМИНИРОВАННО (seed = хэш match_id, см.
-- simulateBattle в power.ts) — оба конца матча получают побитово одинаковый исход, не может
-- получиться, что оба «выиграли» у себя локально.
create table if not exists public.battle_queue (
  wallet      text primary key,
  name        text,
  species     text not null,
  level       int not null,
  accessories jsonb not null default '[]'::jsonb,
  bet         numeric not null default 0,
  status      text not null default 'waiting',   -- 'waiting' | 'matched'
  match_id    text,
  opponent    jsonb,                              -- снимок профиля соперника (после матча)
  queued_at   bigint not null
);
alter table public.battle_queue enable row level security;

-- Читать может только сам игрок свою строку (не палим чужой bet/очередь другим клиентам напрямую).
drop policy if exists battle_queue_read on public.battle_queue;
create policy battle_queue_read on public.battle_queue
  for select to authenticated
  using ((auth.jwt() ->> 'wallet') = wallet);
-- Записи через RLS нет — только сервис-роль (edge fn battle-live), см. battle_queue_poll ниже.

-- Атомарный "тик" матчмейкинга: обновить/создать свою строку (если ещё не matched), затем
-- попытаться забрать другого ожидающего в пару. Возврат: текущий статус + матч (если есть).
create or replace function public.battle_queue_poll(
  p_wallet text, p_name text, p_species text, p_level int, p_accessories jsonb, p_bet numeric, p_now bigint
) returns table(status text, match_id text, opponent jsonb)
language plpgsql as $$
declare
  v_status text;
  v_match  text;
  v_opp    jsonb;
  v_opp_wallet text;
begin
  insert into public.battle_queue (wallet, name, species, level, accessories, bet, status, queued_at)
  values (p_wallet, p_name, p_species, p_level, p_accessories, p_bet, 'waiting', p_now)
  on conflict (wallet) do update set
    name = excluded.name, species = excluded.species, level = excluded.level,
    accessories = excluded.accessories, bet = excluded.bet
  where public.battle_queue.status = 'waiting'; -- уже matched → не трогаем, ждём пока клиент это заберёт

  select bq.status, bq.match_id, bq.opponent into v_status, v_match, v_opp
    from public.battle_queue bq where bq.wallet = p_wallet;

  if v_status = 'matched' then
    return query select v_status, v_match, v_opp;
    return;
  end if;

  -- Попробовать найти другого ожидающего (лочим строку — 2 одновременных poll не схватят одного).
  select bq.wallet into v_opp_wallet
    from public.battle_queue bq
   where bq.wallet <> p_wallet and bq.status = 'waiting'
   order by bq.queued_at asc
   limit 1
   for update skip locked;

  if v_opp_wallet is not null then
    v_match := 'm' || p_now::text || substr(md5(random()::text), 1, 8);
    select jsonb_build_object('wallet', bq.wallet, 'name', bq.name, 'species', bq.species, 'level', bq.level, 'accessories', bq.accessories)
      into v_opp from public.battle_queue bq where bq.wallet = v_opp_wallet;

    update public.battle_queue
       set status = 'matched', match_id = v_match,
           opponent = jsonb_build_object('wallet', p_wallet, 'name', p_name, 'species', p_species, 'level', p_level, 'accessories', p_accessories)
     where wallet = v_opp_wallet;

    update public.battle_queue
       set status = 'matched', match_id = v_match, opponent = v_opp
     where wallet = p_wallet;

    return query select 'matched'::text, v_match, v_opp;
    return;
  end if;

  return query select 'waiting'::text, null::text, null::jsonb;
end;
$$;
revoke execute on function public.battle_queue_poll(text,text,text,int,jsonb,numeric,bigint) from public;
grant execute on function public.battle_queue_poll(text,text,text,int,jsonb,numeric,bigint) to service_role;

-- Покинуть очередь (отмена поиска / истёк дедлайн на клиенте, переходим на bot/async).
create or replace function public.battle_queue_leave(p_wallet text) returns void
language sql as $$
  delete from public.battle_queue where wallet = p_wallet and status = 'waiting';
$$;
revoke execute on function public.battle_queue_leave(text) from public;
grant execute on function public.battle_queue_leave(text) to service_role;

-- Убрать обе стороны из очереди после того как матч отыгран (не обязателен вызов от обеих сторон —
-- если вторая сторона так и не подтвердит, строка просто сгниёт в 'matched' и больше никого не
-- заблокирует, т.к. в пару берутся только status='waiting').
create or replace function public.battle_queue_finish(p_match_id text) returns void
language sql as $$
  delete from public.battle_queue where match_id = p_match_id;
$$;
revoke execute on function public.battle_queue_finish(text) from public;
grant execute on function public.battle_queue_finish(text) to service_role;

-- 10) Переезд на Robinhood Chain: админ теперь EVM-адрес -----------------------------------------
-- Все политики ниже раньше сверялись с base58-адресом Solana. После переезда JWT содержит
-- EVM-адрес (0x…, НИЖНИМ регистром — auth приводит его к нижнему регистру, см. edge fn auth),
-- поэтому старые политики не совпадут ни с кем и админ потеряет доступ, пока их не переписать.
--
-- Адрес админа ниже должен совпадать с ADMIN_WALLET (src/App.tsx) и ADMIN (edge fn sell-payout).

-- exclusives: писать/менять/удалять — только админ
drop policy if exists exclusives_admin_write on public.exclusives;
create policy exclusives_admin_write on public.exclusives
  for all to authenticated
  using ((auth.jwt() ->> 'wallet') = '0x69c159cdf7d5264f380c69f68847f806d84ef080')
  with check ((auth.jwt() ->> 'wallet') = '0x69c159cdf7d5264f380c69f68847f806d84ef080');

-- quest_claims: менять статус (mark paid) — только админ
drop policy if exists quest_claims_admin_update on public.quest_claims;
create policy quest_claims_admin_update on public.quest_claims
  for update to authenticated
  using ((auth.jwt() ->> 'wallet') = '0x69c159cdf7d5264f380c69f68847f806d84ef080')
  with check ((auth.jwt() ->> 'wallet') = '0x69c159cdf7d5264f380c69f68847f806d84ef080');

-- balances: читать свой баланс — игрок, все — админ (записи через RLS по-прежнему нет)
drop policy if exists balances_read on public.balances;
create policy balances_read on public.balances
  for select to authenticated
  using ((auth.jwt() ->> 'wallet') = wallet
      or (auth.jwt() ->> 'wallet') = '0x69c159cdf7d5264f380c69f68847f806d84ef080');

-- pet_ledger: читать свои строки — игрок, все — админ
drop policy if exists pet_ledger_read on public.pet_ledger;
create policy pet_ledger_read on public.pet_ledger
  for select to authenticated
  using ((auth.jwt() ->> 'wallet') = wallet
      or (auth.jwt() ->> 'wallet') = '0x69c159cdf7d5264f380c69f68847f806d84ef080');

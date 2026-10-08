-- Trex hosted database. Run once in the Neon SQL editor (then run seed below).
create table if not exists kv(key text primary key, value jsonb not null);
create table if not exists offers(id text primary key, data jsonb not null);
create table if not exists trades(id text primary key, data jsonb not null);
create table if not exists disputes(id text primary key, data jsonb not null);
create table if not exists ledger(id text primary key, kind text not null, trade text, amount numeric not null, ccy text not null, at timestamptz default now());
create table if not exists audit(at timestamptz default now(), event text not null);
create table if not exists otp(target text primary key, code text not null, exp bigint not null, attempts int default 0);
create table if not exists ratings(id text primary key, data jsonb not null);
create table if not exists tickets(id text primary key, data jsonb not null);
create table if not exists idem(key text primary key, response jsonb not null, at timestamptz default now());

-- ---------- seed (safe to re-run: only inserts when tables are empty) ----------
insert into kv(key, value) values
  ('bond', '{"model":"pertrade","base":"USD","caps":{"USD":10000,"NGN":8000000,"GBP":4000,"EUR":6000},"reserved":{}}'),
  ('config', '{"fee_pct":1.5,"confirm_mins":30,"grace_hours":24,"thresh":500000,"disabled":[],"pausedPairs":[]}')
on conflict (key) do nothing;

insert into offers(id, data) values
  ('OFR-1', '{"id":"OFR-1","provide":"USD","want":"NGN","rate":1520,"min":65,"max":330,"vendor":"Adaobi","country":"NG","tier":"Gold","capacity":4000,"rating":4.8,"trades":312,"methods":["Bank transfer"],"terms":"Pay within 30 minutes.","live":true}'),
  ('OFR-2', '{"id":"OFR-2","provide":"GBP","want":"NGN","rate":1940,"min":103,"max":2060,"vendor":"Tunde","country":"NG","tier":"Gold","capacity":3000,"rating":4.9,"trades":540,"methods":["Bank transfer"],"terms":"Pay within 30 minutes.","live":true}'),
  ('OFR-3', '{"id":"OFR-3","provide":"EUR","want":"NGN","rate":1650,"min":60,"max":1500,"vendor":"New vendor","country":"NG","tier":"Probation","capacity":2000,"methods":["Bank transfer"],"terms":"Pay within 1 hour.","live":true}')
on conflict (id) do nothing;

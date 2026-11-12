-- Synthetic rows for the backup and upgrade rehearsal (scripts/backup/testing/run-synthetic.sh). Made-up data on
-- the schema of the commit deployed on 2026-11-12 (49 migrations): nothing here comes from a real database.
-- `:hash` is the password hash of the synthetic password, made by the driver.
begin;
insert into "Provider" (id, code, name) values ('prov-1', 'syn-sky', 'سكاي'), ('prov-2', 'syn-lian', 'ليان');
insert into "Company" (id, code, name) values ('co-1', 'syncell', 'سلكوم'), ('co-2', 'synwe', 'ويكوم');
insert into "Package" (id, code, name, "providerId", "companyId", "providerProductCode", "dataGb", months,
                       "branchCost", "mainPrice", "agentPrice", "posPrice", "subscriberPrice",
                       "renewalBranchCost", "renewalMainPrice", "renewalAgentPrice", "renewalPosPrice", "renewalSubscriberPrice",
                       "autoActivate", "autoCharge", "autoDisconnect", "autoFreeze", "autoSwitch")
select 'pkg-' || lpad(n::text, 4, '0') || '-0000-0000-000000000000',
       case when n % 2 = 0 then 'synsky' else 'synlian' end || '-' || case when n % 3 = 0 then 'synwe' else 'syncell' end || '-' || (n * 50),
       (n * 50) || ' جيجا',
       case when n % 2 = 0 then 'prov-1' else 'prov-2' end,
       case when n % 3 = 0 then 'co-2' else 'co-1' end,
       case when n % 4 = 0 then 'P' || n else null end,
       n * 50, case when n % 5 = 0 then 12 else 1 end,
       2000, 2500, 3000, 3500, 3800, 1800, 2200, 2700, 3200, 3500, true, true, true, true, true
from generate_series(1, 12) n;

insert into "User" (id, "loginName", nickname, "passwordHash", layer, "parentId", "isBranchOwner", "twoFactorExempt")
values ('u-owner', 'syn-owner', 'المالك', :'hash', 'branch', null, true, true),
       ('u-main', 'syn-main', 'رئيسي', :'hash', 'main_agent', 'u-owner', false, true),
       ('u-agent', 'syn-agent', 'وكيل', :'hash', 'agent', 'u-main', false, true),
       ('u-pos1', 'syn-pos1', 'نقطة ١', :'hash', 'pos', 'u-agent', false, true),
       ('u-pos2', 'syn-pos2', 'نقطة ٢', :'hash', 'pos', 'u-agent', false, true),
       ('u-pos3', 'syn-pos3', 'نقطة ٣', :'hash', 'pos', 'u-owner', false, true);
insert into "Wallet" ("userId", balance, ceiling, held)
select id, 100000 + ascii(right(id, 1)), 0, case when id = 'u-pos1' then 700 else 0 end from "User";

insert into "Line" (id, msisdn, iccid, esim, "esimQr", status, "packageId", "posId", "endsAt", terms)
select 'line-' || lpad(n::text, 4, '0'),
       '05' || lpad((50000000 + n)::text, 8, '0'),
       '8997202' || lpad(n::text, 12, '0'),
       n % 3 = 0,
       case when n % 3 = 0 and n % 9 <> 0 then 'data:image/png;base64,' || encode(convert_to('SYNTHETIC-QR-' || n, 'UTF8'), 'base64') end,
       case when n % 7 = 0 then 'frozen' when n % 11 = 0 then 'disconnected' else 'active' end,
       p.id, 'u-pos' || (1 + n % 3), now() + (n || ' days')::interval,
       jsonb_build_object('packageCode', p.code, 'renewalTargets', jsonb_build_array(jsonb_build_object('code', p.code, 'price', 3200), jsonb_build_object('code', 'gone-code', 'price', 1)))
from generate_series(1, 60) n
join "Package" p on p.id = 'pkg-' || lpad((1 + n % 12)::text, 4, '0') || '-0000-0000-000000000000';

insert into "OfficeTask" (id, action, status, "posId", "packageId", "submitterId", "posDelta", esim, msisdn, iccid, "lineId", "esimQr", "updatedAt", log)
select 'task-' || lpad(n::text, 4, '0'),
       case when n % 4 = 0 then 'activate' when n % 4 = 1 then 'sim' when n % 4 = 2 then 'freeze' else 'switch' end,
       case when n <= 3 then 'working' when n % 5 = 0 then 'cancelled' when n % 6 = 0 then 'rejected' else 'done' end,
       'u-pos' || (1 + n % 3), 'pkg-0001-0000-0000-000000000000', 'u-pos' || (1 + n % 3), 0, n % 4 = 1,
       case when n % 4 = 0 then '0599' || lpad(n::text, 6, '0') end,
       case when n % 4 in (0, 1) then '8997209' || lpad(n::text, 12, '0') end,
       case when n % 4 <> 0 then 'line-' || lpad(n::text, 4, '0') end,
       case when n % 4 = 1 and n % 8 = 1 then 'data:image/png;base64,' || encode(convert_to('SYNTHETIC-TASK-QR-' || n, 'UTF8'), 'base64') end,
       now(), 'opened'
from generate_series(1, 40) n;

insert into "Session" (id, "userId", "userAgent", ip, scope, kind, "expiresAt", "revokedAt")
select 'sess-' || md5(n::text), (array['u-owner','u-main','u-agent','u-pos1','u-pos2','u-pos3'])[1 + n % 6], 'synthetic', '203.0.113.' || (n % 250),
       'full', 'account', now() + interval '10 days', case when n % 4 = 0 then now() end
from generate_series(1, 80) n;

insert into "Notice" (id, "userId", kind, href, payload)
select 'notice-' || n, 'u-pos' || (1 + n % 3), case when n % 2 = 0 then 'transfer' else 'task' end, '/tasks',
       case when n % 4 = 0 then jsonb_build_object('toLogin', 'syn-pos2', 'amount', n)
            when n % 4 = 2 then jsonb_build_object('fromLogin', 'syn-agent', 'amount', n)
            else jsonb_build_object('packageName', 'x') end
from generate_series(1, 40) n;

insert into "ActivityEvent" (id, "actorLogin", "actorLayer", action, result, "subjectKind", "subjectRef")
select 'act-' || n, 'syn-owner', 'branch', 'package_update', 'ok',
       case when n % 2 = 0 then 'package' else 'user' end,
       case when n % 2 = 0 then p.code else 'syn-pos1:' || p.code end
from generate_series(1, 30) n
join "Package" p on p.id = 'pkg-' || lpad((1 + n % 12)::text, 4, '0') || '-0000-0000-000000000000';

insert into "WalletEntry" (id, "userId", "actorId", amount, "balanceAfter", kind, "lineId")
select 'entry-' || n, 'u-pos' || (1 + n % 3), 'u-pos' || (1 + n % 3), -3500, 100000 - n * 3500, 'activate', 'line-' || lpad(n::text, 4, '0')
from generate_series(1, 25) n;
commit;

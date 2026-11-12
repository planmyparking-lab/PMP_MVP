-- pgTAP tests for migration 0007_shift_reviews_conflict_resolutions.sql (CLD-02, CON-06, CON-07). Run with `pnpm test:db`.
-- Fixtures are inserted as the superuser; the transaction is rolled back at the end. Policies are not tested here
-- (the insert policies arrive with 0010_rls.sql); this file covers structure, constraints, privileges, the append-only rule
-- and the current deny-by-default RLS behaviour.
begin;
select plan(56);

-- Fixtures: one organization, two facilities, two users, three conflicts (two in F1, one in F2).
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2');
insert into public.organizations (id, name) values ('00000000-0000-0000-0000-00000000000f', 'Org');
insert into public.facilities (id, org_id, name, timezone, slot_count) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000f', 'F1', 'Asia/Kolkata', 10),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000f', 'F2', 'Asia/Kolkata', 10);
insert into public.sync_conflicts (id, facility_id, type, event_ids, session_id, dedupe_key) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', 'DUPLICATE_EXIT',
   array['018f0000-0000-7000-8000-000000000001'::uuid, '018f0000-0000-7000-8000-000000000002'::uuid],
   '018f0000-0000-7000-8000-000000000101', '018f0000-0000-7000-8000-000000000101'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000f1', 'ORPHAN_EXIT',
   array['018f0000-0000-7000-8000-000000000003'::uuid],
   '018f0000-0000-7000-8000-000000000102', '018f0000-0000-7000-8000-000000000102'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000f2', 'DUPLICATE_EXIT',
   array['018f0000-0000-7000-8000-000000000004'::uuid, '018f0000-0000-7000-8000-000000000005'::uuid],
   '018f0000-0000-7000-8000-000000000103', '018f0000-0000-7000-8000-000000000103');

-- structure and privileges
select has_table('public', 'shift_reviews', 'shift_reviews exists');
select has_table('public', 'conflict_resolutions', 'conflict_resolutions exists');
select is((select relrowsecurity from pg_class where oid = 'public.shift_reviews'::regclass), true,
  'RLS enabled on shift_reviews');
select is((select relrowsecurity from pg_class where oid = 'public.conflict_resolutions'::regclass), true,
  'RLS enabled on conflict_resolutions');
select is(has_table_privilege('anon', 'public.shift_reviews', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'anon holds no privileges on shift_reviews');
select is(has_table_privilege('anon', 'public.conflict_resolutions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'anon holds no privileges on conflict_resolutions');
select is(has_table_privilege('authenticated', 'public.shift_reviews', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'authenticated cannot update, delete or truncate shift_reviews');
select is(has_table_privilege('authenticated', 'public.conflict_resolutions', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'authenticated cannot update, delete or truncate conflict_resolutions');
select is(has_table_privilege('service_role', 'public.shift_reviews', 'UPDATE,DELETE,TRUNCATE'), false,
  'service_role cannot update, delete or truncate shift_reviews');
select is(has_table_privilege('service_role', 'public.conflict_resolutions', 'UPDATE,DELETE,TRUNCATE'), false,
  'service_role cannot update, delete or truncate conflict_resolutions');
select columns_are('public', 'shift_reviews',
  array['id', 'facility_id', 'shift_id', 'reviewed_by', 'reviewed_at', 'status', 'note'], 'shift_reviews columns');
select columns_are('public', 'conflict_resolutions',
  array['id', 'conflict_id', 'action', 'note', 'resolved_by', 'resolved_at'], 'conflict_resolutions columns');
select col_type_is('public', 'shift_reviews', 'reviewed_at', 'timestamp with time zone',
  'shift_reviews.reviewed_at is timestamptz');
select col_type_is('public', 'conflict_resolutions', 'resolved_at', 'timestamp with time zone',
  'conflict_resolutions.resolved_at is timestamptz');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'shift_reviews'
                  and indexname = 'shift_reviews_facility_shift_idx'), 'shift_reviews has the (facility, shift) index');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'conflict_resolutions'
                  and indexname = 'conflict_resolutions_conflict_idx'), 'conflict_resolutions has the conflict index');

-- shift_reviews: valid rows
select lives_ok($$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status, note) values
  ('00000000-0000-0000-0000-0000000000f1', '018f0000-0000-7000-8000-0000000000a1',
   '00000000-0000-0000-0000-0000000000a1', 'approved', 'ok')$$, 'a review can be inserted');
select is((select reviewed_at = now() from public.shift_reviews), true, 'reviewed_at defaults to the database time');
select lives_ok($$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status) values
  ('00000000-0000-0000-0000-0000000000f1', '018f0000-0000-7000-8000-0000000000a1',
   '00000000-0000-0000-0000-0000000000a1', 'flagged')$$, 'the same user can later flag the same shift (a newer row)');
select lives_ok($$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status) values
  ('00000000-0000-0000-0000-0000000000f1', '018f0000-0000-7000-8000-0000000000a1',
   '00000000-0000-0000-0000-0000000000a2', 'approved')$$, 'another user can review the same shift');
select lives_ok($$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status) values
  ('00000000-0000-0000-0000-0000000000f2', '018f0000-0000-7000-8000-0000000000a1',
   '00000000-0000-0000-0000-0000000000a1', 'approved')$$, 'the same shift id in another facility is not a duplicate');

-- shift_reviews: rejected rows
select throws_ok($$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status) values
  ('00000000-0000-0000-0000-0000000000f1', '018f0000-0000-7000-8000-0000000000a1',
   '00000000-0000-0000-0000-0000000000a1', 'approved')$$, '23505', null,
  'a duplicate click (same facility, shift, reviewer, status) is rejected');
select throws_ok($$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status) values
  ('00000000-0000-0000-0000-0000000000f1', '018f0000-0000-7000-8000-0000000000a2',
   '00000000-0000-0000-0000-0000000000a1', 'rejected')$$, '23514', null, 'an unknown status is rejected');
select throws_ok($$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status) values
  ('00000000-0000-0000-0000-0000000000f1', null,
   '00000000-0000-0000-0000-0000000000a1', 'approved')$$, '23502', null, 'a null shift_id is rejected');
select throws_ok($$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status) values
  ('00000000-0000-0000-0000-0000000000ff', '018f0000-0000-7000-8000-0000000000a2',
   '00000000-0000-0000-0000-0000000000a1', 'approved')$$, '23503', null, 'an unknown facility is rejected');
select throws_ok($$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status) values
  ('00000000-0000-0000-0000-0000000000f1', '018f0000-0000-7000-8000-0000000000a2',
   '00000000-0000-0000-0000-0000000000ee', 'approved')$$, '23503', null, 'an unknown reviewer is rejected');
select throws_ok($$delete from auth.users where id = '00000000-0000-0000-0000-0000000000a2'$$, '23503', null,
  'a reviewer with reviews cannot be deleted (on delete restrict)');

-- conflict_resolutions: valid rows
select lives_ok($$insert into public.conflict_resolutions (conflict_id, action, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c1', 'KEEP_FIRST', '00000000-0000-0000-0000-0000000000a1')$$,
  'a decision can be recorded without a note');
select is((select resolved_at = now() from public.conflict_resolutions), true,
  'resolved_at defaults to the database time');
select lives_ok($$insert into public.conflict_resolutions (conflict_id, action, note, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c1', 'ADD_NOTE', 'checked with the guard', '00000000-0000-0000-0000-0000000000a1')$$,
  'a note can be recorded on a conflict');
select lives_ok($$insert into public.conflict_resolutions (conflict_id, action, note, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c1', 'ADD_NOTE', E'  checked with\tthe guard\n', '00000000-0000-0000-0000-0000000000a2')$$,
  'a note with text between or around whitespace is accepted');
-- The five action values of apps/console/src/lib/conflicts.ts; KEEP_FIRST and ADD_NOTE are inserted above.
select lives_ok($$insert into public.conflict_resolutions (conflict_id, action, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c2', 'MARK_AS_TEST_ENTRY', '00000000-0000-0000-0000-0000000000a1')$$,
  'MARK_AS_TEST_ENTRY is an allowed action');
select lives_ok($$insert into public.conflict_resolutions (conflict_id, action, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c3', 'KEEP_SECOND', '00000000-0000-0000-0000-0000000000a1')$$,
  'KEEP_SECOND is an allowed action');
select lives_ok($$insert into public.conflict_resolutions (conflict_id, action, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c3', 'ACKNOWLEDGE', '00000000-0000-0000-0000-0000000000a1')$$,
  'ACKNOWLEDGE is an allowed action');

-- conflict_resolutions: rejected rows
select throws_ok($$insert into public.conflict_resolutions (conflict_id, action, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c3', 'ADD_NOTE', '00000000-0000-0000-0000-0000000000a1')$$, '23514', null,
  'ADD_NOTE without a note is rejected');
select throws_ok($$insert into public.conflict_resolutions (conflict_id, action, note, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c3', 'ADD_NOTE', '   ', '00000000-0000-0000-0000-0000000000a1')$$, '23514', null,
  'ADD_NOTE with a spaces-only note is rejected');
select throws_ok($$insert into public.conflict_resolutions (conflict_id, action, note, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c3', 'ADD_NOTE', '', '00000000-0000-0000-0000-0000000000a1')$$, '23514', null,
  'ADD_NOTE with an empty-string note is rejected');
select throws_ok($$insert into public.conflict_resolutions (conflict_id, action, note, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c3', 'ADD_NOTE', E'\t', '00000000-0000-0000-0000-0000000000a1')$$, '23514', null,
  'ADD_NOTE with a tab-only note is rejected');
select throws_ok($$insert into public.conflict_resolutions (conflict_id, action, note, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c3', 'ADD_NOTE', E' \t\r\n \n\t ', '00000000-0000-0000-0000-0000000000a1')$$, '23514', null,
  'ADD_NOTE with a note of mixed spaces, tabs, carriage returns and newlines is rejected');
-- Unicode whitespace counts as blank, as in JavaScript trim() (PR #31 review).
select throws_ok($$insert into public.conflict_resolutions (conflict_id, action, note, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c3', 'ADD_NOTE', E'\u00a0', '00000000-0000-0000-0000-0000000000a1')$$, '23514', null,
  'ADD_NOTE with a non-breaking-space-only note is rejected');
select throws_ok($$insert into public.conflict_resolutions (conflict_id, action, note, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c3', 'ADD_NOTE', E'\u3000\u2028\u2029\ufeff\u202f\u205f\u1680\u2000\u200a ',
   '00000000-0000-0000-0000-0000000000a1')$$, '23514', null,
  'ADD_NOTE with a note of mixed Unicode spaces is rejected');
select throws_ok($$insert into public.conflict_resolutions (conflict_id, action, note, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c3', 'ADD_NOTE', E'\x0b\f', '00000000-0000-0000-0000-0000000000a1')$$, '23514', null,
  'ADD_NOTE with a vertical-tab and form-feed note is rejected');
select lives_ok($$insert into public.conflict_resolutions (conflict_id, action, note, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c3', 'ADD_NOTE', E'\u00a0checked with the guard\u3000', '00000000-0000-0000-0000-0000000000a1')$$,
  'a note with text between Unicode spaces is accepted');
select throws_ok($$insert into public.conflict_resolutions (conflict_id, action, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c3', 'MARK_TEST', '00000000-0000-0000-0000-0000000000a1')$$, '23514', null,
  'the old name MARK_TEST is not an action');
select throws_ok($$insert into public.conflict_resolutions (conflict_id, action, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c3', 'DELETE_EVENT', '00000000-0000-0000-0000-0000000000a1')$$, '23514', null,
  'an unknown action is rejected');
select throws_ok($$insert into public.conflict_resolutions (conflict_id, action, resolved_by) values
  ('00000000-0000-0000-0000-0000000000ff', 'KEEP_FIRST', '00000000-0000-0000-0000-0000000000a1')$$, '23503', null,
  'an unknown conflict is rejected');
select throws_ok($$insert into public.conflict_resolutions (conflict_id, action, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c3', 'KEEP_FIRST', null)$$, '23502', null, 'a null resolver is rejected');
select throws_ok($$delete from public.sync_conflicts where id = '00000000-0000-0000-0000-0000000000c1'$$, '23503', null,
  'a conflict with resolutions cannot be deleted (on delete restrict)');

-- append-only for application roles (privilege check comes before RLS, so no policy is needed for this)
set local role authenticated;
select throws_ok($$update public.shift_reviews set note = 'edited'$$, '42501', null,
  'authenticated cannot update a review');
select throws_ok($$delete from public.conflict_resolutions$$, '42501', null,
  'authenticated cannot delete a resolution');
reset role;

-- Until 0010_rls.sql adds policies, RLS denies direct access to an authenticated user. Fixture rows exist at this point, so an
-- empty read is a real denial. The inserts are otherwise valid rows (new shift id, existing user and conflict), so the
-- expected message proves that RLS, not a constraint, rejects them. The first two assertions make the prerequisite
-- explicit: authenticated holds INSERT, so an insert reaches RLS evaluation instead of failing on privileges.
-- When 0010 adds policies, re-check these RLS denial assertions: they may still pass for this caller (no membership),
-- but a policy that admits the caller would make them fail.
select is(has_table_privilege('authenticated', 'public.shift_reviews', 'INSERT'), true,
  'authenticated holds INSERT on shift_reviews, so inserts reach RLS evaluation');
select is(has_table_privilege('authenticated', 'public.conflict_resolutions', 'INSERT'), true,
  'authenticated holds INSERT on conflict_resolutions, so inserts reach RLS evaluation');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$insert into public.shift_reviews (facility_id, shift_id, reviewed_by, status) values
  ('00000000-0000-0000-0000-0000000000f1', '018f0000-0000-7000-8000-0000000000b1',
   '00000000-0000-0000-0000-0000000000a1', 'approved')$$, '42501',
  'new row violates row-level security policy for table "shift_reviews"',
  'RLS denies a direct insert into shift_reviews');
select throws_ok($$insert into public.conflict_resolutions (conflict_id, action, resolved_by) values
  ('00000000-0000-0000-0000-0000000000c2', 'KEEP_FIRST', '00000000-0000-0000-0000-0000000000a1')$$, '42501',
  'new row violates row-level security policy for table "conflict_resolutions"',
  'RLS denies a direct insert into conflict_resolutions');
select is((select count(*) from public.shift_reviews), 0::bigint, 'RLS hides shift_reviews from authenticated');
select is((select count(*) from public.conflict_resolutions), 0::bigint, 'RLS hides conflict_resolutions from authenticated');
reset role;

select * from finish();
rollback;

-- =============================================================================
-- Local development / test fixtures. Loaded by the Supabase CLI on
-- `supabase start` and `supabase db reset` -- never by production.
--
-- Accounts are not seeded here (auth users need the Auth API): run
--   npm run seed:admin
-- after `supabase start` to create a local mentor login.
--
-- Fixed ids make the fixtures easy to reference from tests.
-- The live room's token is the throwaway local value 'a' x 48.
-- =============================================================================

INSERT INTO public.submissions
  (id, created_at, content, category, intent, emotional_state, community_question,
   highlight_on_instagram, nickname, anon_user_id, chat_enabled, chat_ttl, status,
   is_featured, is_archived, deleted_at, admin_notes, client_request_id)
VALUES
  -- the richest record: every field, multi-line, live chat
  ('aaaaaaaa-0000-4000-8000-000000000001', now() - interval '1 hour',
   E'I have been pretending to be okay at work for months.\nIt is wearing me down.',
   'Career', 'Advice', 2, 'Should I talk to my manager?', 'Yes', 'Tired Owl', 'seed-browser-1',
   true, '24h', 'Pending', false, false, NULL, NULL, 'bbbbbbbb-0000-4000-8000-000000000001'),
  -- consented, approved and featured: the one public whisper
  ('aaaaaaaa-0000-4000-8000-000000000002', now() - interval '1 day',
   'I finally told my sister what I had been carrying. She just hugged me.',
   'Family', 'Express', 4, NULL, 'Yes', NULL, 'seed-browser-2',
   false, 'never', 'Approved', true, false, NULL, 'Lovely. Featured with consent.', 'bbbbbbbb-0000-4000-8000-000000000002'),
  -- approved but no consent: must never be public
  ('aaaaaaaa-0000-4000-8000-000000000003', now() - interval '2 days',
   'Everyone my age seems so far ahead of me and I cannot say it out loud.',
   'Self thoughts', 'Both', 3, 'Is it normal to feel this?', 'No', 'Late Bloomer', 'seed-browser-3',
   false, 'never', 'Approved', true, false, NULL, NULL, 'bbbbbbbb-0000-4000-8000-000000000003'),
  ('aaaaaaaa-0000-4000-8000-000000000004', now() - interval '3 days',
   'I said yes when I meant no. Again. I do not know how to stop doing that.',
   'Relationship', 'Advice', 2, NULL, 'Maybe', NULL, 'seed-browser-4',
   false, 'never', 'Reviewed', false, false, NULL, 'Follow up gently if they write again.', 'bbbbbbbb-0000-4000-8000-000000000004'),
  ('aaaaaaaa-0000-4000-8000-000000000005', now() - interval '4 days',
   'This is spam-like text that a mentor rejected after review, kept for the audit.',
   'Other', 'Both', 5, NULL, 'No', NULL, 'seed-browser-5',
   false, 'never', 'Rejected', false, false, NULL, NULL, 'bbbbbbbb-0000-4000-8000-000000000005'),
  -- archived and trashed shelves
  ('aaaaaaaa-0000-4000-8000-000000000006', now() - interval '10 days',
   'An older story that was handled and archived after the conversation ended.',
   'Anxiety', 'Express', 1, NULL, 'Maybe', NULL, 'seed-browser-6',
   false, 'never', 'Reviewed', false, true, NULL, NULL, 'bbbbbbbb-0000-4000-8000-000000000006'),
  ('aaaaaaaa-0000-4000-8000-000000000007', now() - interval '12 days',
   'A duplicate the writer sent twice by mistake; moved to trash, restorable.',
   'Confusion', 'Both', 3, NULL, 'No', NULL, 'seed-browser-7',
   false, 'never', 'Pending', false, false, now() - interval '11 days', NULL, 'bbbbbbbb-0000-4000-8000-000000000007'),
  -- an expired disappearing chat
  ('aaaaaaaa-0000-4000-8000-000000000008', now() - interval '3 hours',
   'I needed to talk to someone tonight, even for an hour.',
   'Anxiety', 'Express', 1, NULL, 'No', 'Night Owl', 'seed-browser-8',
   true, '1h', 'Pending', false, false, NULL, NULL, 'bbbbbbbb-0000-4000-8000-000000000008')
ON CONFLICT (id) DO NOTHING;

-- a block of ordinary pending confessions so pagination has real pages
INSERT INTO public.submissions (content, category, intent, emotional_state, highlight_on_instagram, status, created_at, client_request_id)
SELECT
  'Seed confession number ' || g || ': something heavy, written late at night.',
  (ARRAY['Relationship','Career','Family','Anxiety','Self thoughts','Social taboos','Confusion','Other'])[1 + g % 8],
  (ARRAY['Advice','Express','Both'])[1 + g % 3],
  1 + g % 5,
  (ARRAY['Yes','No','Maybe'])[1 + g % 3],
  'Pending',
  now() - (g || ' hours')::interval - interval '5 days',
  ('cccccccc-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid
FROM generate_series(1, 40) g
ON CONFLICT (client_request_id) DO NOTHING;

-- chat rooms: one live (token 'a' x 48), one already expired
INSERT INTO public.chat_rooms (id, created_at, expires_at, status, token_hash)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', now() - interval '1 hour', now() + interval '23 hours', 'open',
   encode(extensions.digest(repeat('a', 48), 'sha256'), 'hex')),
  ('aaaaaaaa-0000-4000-8000-000000000008', now() - interval '3 hours', now() - interval '2 hours', 'open',
   encode(extensions.digest(repeat('b', 48), 'sha256'), 'hex'))
ON CONFLICT (id) DO NOTHING;

-- messages go through the validating trigger, so only the live room gets them
INSERT INTO public.chat_messages (room_id, sender_type, message, client_msg_id)
SELECT 'aaaaaaaa-0000-4000-8000-000000000001', m.sender, m.body, m.cid::uuid
FROM (VALUES
  ('user', 'hello, is anyone there?', 'dddddddd-0000-4000-8000-000000000001'),
  ('admin', 'I''m here. Take your time.', 'dddddddd-0000-4000-8000-000000000002')
) AS m(sender, body, cid)
WHERE NOT EXISTS (
  SELECT 1 FROM public.chat_messages x
  WHERE x.room_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND x.client_msg_id = m.cid::uuid
);

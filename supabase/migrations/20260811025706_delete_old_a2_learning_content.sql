-- Replace all learning catalog content for CEFR A2.
-- This migration must run immediately before its generated insertion migration.

delete from public.reading_passages where level = 'A2';
delete from public.quick_lessons where level = 'A2';
delete from public.grammar_topics where level = 'A2';

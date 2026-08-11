-- Replace all learning catalog content for CEFR B2.
-- This migration must run immediately before its generated insertion migration.

delete from public.reading_passages where level = 'B2';
delete from public.quick_lessons where level = 'B2';
delete from public.grammar_topics where level = 'B2';

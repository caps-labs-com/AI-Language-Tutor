-- Replace all learning catalog content for CEFR B1.
-- This migration must run immediately before its generated insertion migration.

delete from public.reading_passages where level = 'B1';
delete from public.quick_lessons where level = 'B1';
delete from public.grammar_topics where level = 'B1';

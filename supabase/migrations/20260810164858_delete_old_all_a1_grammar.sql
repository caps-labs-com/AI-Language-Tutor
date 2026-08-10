-- Replace A1 grammar topics only for languages present in the next migration.
-- Exercises are removed automatically through the topic_id foreign key cascade.

delete from public.grammar_topics
where level = 'A1'
  and language in ('en', 'es', 'fr', 'it');

-- Replace the existing A1 reading catalog for every supported language.
-- The generated replacement content is inserted by the immediately following migrations.

delete from public.reading_passages
where level = 'A1';

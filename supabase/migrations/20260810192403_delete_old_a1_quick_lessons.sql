-- Replace the existing A1 quick-lesson catalog for every supported language.
-- The generated replacement content is inserted by the immediately following migration.

delete from public.quick_lessons
where level = 'A1';

ALTER TABLE conversations ADD COLUMN display_name TEXT;
ALTER TABLE conversations ADD COLUMN display_name_source TEXT CHECK(display_name_source IN ('generated', 'manual', 'imported'));

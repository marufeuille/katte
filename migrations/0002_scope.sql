-- katte migration 0002: item scope (family / personal) on the add event.
ALTER TABLE events ADD COLUMN scope TEXT;

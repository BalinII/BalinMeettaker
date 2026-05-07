-- Store the durable local meeting audio artifact path on the meeting record.
ALTER TABLE meetings ADD COLUMN audio_path TEXT;

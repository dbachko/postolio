-- Update existing campaigns with 'preview_ready' status to use the new 'preview' status
UPDATE campaigns SET status = 'preview' WHERE status = 'preview_ready';
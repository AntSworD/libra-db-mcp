-- Run once on an existing management database before deploying this version.
ALTER TABLE libra_mcp_tokens ADD COLUMN connection_ids JSON NULL;

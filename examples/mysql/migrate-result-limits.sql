-- Run once when upgrading an existing management database.
ALTER TABLE libra_mcp_connections
  ADD COLUMN max_result_bytes INT NOT NULL DEFAULT 5242880 AFTER max_rows;

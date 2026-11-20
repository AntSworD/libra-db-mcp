export async function createDatabase(config) {
  const common = {
    host: config.host, port: config.port, database: config.database,
    user: config.user, password: config.password,
  };
  if (config.type === 'mysql') {
    const { createPool } = await import('mysql2/promise');
    const pool = createPool({
      ...common, connectionLimit: config.poolSize, multipleStatements: false,
      connectTimeout: config.timeout,
    });
    return {
      async query(sql, params = []) {
        const [rows] = await pool.query({ sql, timeout: config.timeout }, params);
        return rows;
      },
      end: () => pool.end(),
    };
  }
  const { Pool } = await import('pg');
  const pool = new Pool({
    ...common, max: config.poolSize, statement_timeout: config.timeout,
    connectionTimeoutMillis: config.timeout,
  });
  pool.on('error', () => { console.error('数据库空闲连接异常，请检查数据库状态'); });
  return {
    async query(sql, params = []) { return (await pool.query(sql, params)).rows; },
    end: () => pool.end(),
  };
}

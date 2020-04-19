// @ts-check

const pino = require('pino');
const logger = pino();

/**
 * Fetch and store global chain counters on session change
 *
 * @param {object} api             Polkadot API object
 * @param {object} pool            Postgres pool object
 */
async function start(api, pool) {

  logger.info('Starting chain crawler');

  let currentSessionIndex = 0;

  // Subscribe to new blocks
  await api.rpc.chain.subscribeNewHeads(async (header) => {

    const [session, blockHeight, totalIssuance] = await Promise.all([
      api.derive.session.info(),
      api.derive.chain.bestNumber(),
      api.query.balances.totalIssuance()
    ]);

    if (session.currentIndex >= currentSessionIndex) {
      currentSessionIndex = session.currentIndex;
      let sqlSelect = `SELECT session_index FROM chain ORDER by session_index DESC LIMIT 1`;
      const res = await pool.query(sqlSelect);

      if (res.rows.length > 0) {
        if (res.rows[0].session_index < currentSessionIndex) {
          const activeAccounts = await getTotalActiveAccounts(api);
          insertRow(pool, blockHeight, currentSessionIndex, totalIssuance, activeAccounts);
        }
      } else {
        const activeAccounts = await getTotalActiveAccounts(api);
        insertRow(pool, blockHeight, currentSessionIndex, totalIssuance, activeAccounts);
      }
    }
  });
}

async function getTotalActiveAccounts(api) {
  const accountKeys = await api.query.system.account.keys()
  const accounts = accountKeys.map(key => key.args[0].toHuman());
  return accounts.length || 0;
}

async function insertRow(pool, blockHeight, currentSessionIndex, totalIssuance, activeAccounts) {
  const sqlInsert = 
    `INSERT INTO chain (
      block_height,
      session_index,
      total_issuance,
      active_accounts,
      timestamp
    ) VALUES (
      '${blockHeight}',
      '${currentSessionIndex}',
      '${totalIssuance}',
      '${activeAccounts}',
      '${new Date().getTime()}'
    );`;
  try {
    await pool.query(sqlInsert);
    logger.info('Updating chain info');
    return true;
  } catch (error) {
    logger.error('Error updating chain info');
    return false;
  }
}

module.exports = { start };
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../../backend/.env') });
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

import { getDb, initDb, persistDb } from '../db/database';

async function main() {
  try {
    // Ensure table exists even in a fresh installation
    await initDb();

    const db = await getDb();
    db.run('DELETE FROM decision_log;');
    db.run('VACUUM;');
    persistDb(db);

    console.log('----------------------------------------------------');
    console.log('[seed] Successfully cleared decision_log table.');
    console.log('[seed] Database is now pristine and ready for demo recording.');
    console.log('----------------------------------------------------');
  } catch (err) {
    console.error('[seed] Error resetting database:', err);
    process.exitCode = 1;
  }
}

main();

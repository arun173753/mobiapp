import { createPool } from '../node_modules/pg/index.js';

const pool = createPool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const client = await pool.connect();
  try {
    // Check current state
    const countResult = await client.query('SELECT COUNT(*) as total, COUNT(CASE WHEN blocked = 1 THEN 1 END) as blocked FROM profiles');
    console.log('BEFORE:', countResult.rows[0]);

    // Delete all users except the two admins
    const deleteResult = await client.query(
      `UPDATE profiles 
       SET blocked = 1 
       WHERE phone NOT LIKE $1 AND phone NOT LIKE $2`,
      ['%8179142535%', '%9398391742%']
    );
    console.log(`✅ Marked ${deleteResult.rowCount} users as deleted/blocked`);

    // Check after
    const countAfter = await client.query('SELECT COUNT(*) as total, COUNT(CASE WHEN blocked = 1 THEN 1 END) as blocked FROM profiles');
    console.log('AFTER:', countAfter.rows[0]);

    // Show remaining active users
    const activeUsers = await client.query(
      `SELECT id, name, phone, role FROM profiles WHERE blocked = 0 ORDER BY phone`
    );
    console.log('\n✅ Remaining active users:');
    activeUsers.rows.forEach(u => console.log(`  - ${u.name} (${u.phone}) - ${u.role}`));

  } catch (e) {
    console.error('Error:', e);
  } finally {
    client.release();
    await pool.end();
  }
})();

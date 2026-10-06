/**
 * DELETE THE LOCAL DATABASE
 * =========================
 * Removes every account, workout and friend connection stored on this computer.
 * Only affects the SQLite file in ./data - it does not touch any hosted
 * database.
 *
 * Run with:  npm run db:reset
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const dataDir = path.join(process.cwd(), 'data');

if (!fs.existsSync(dataDir)) {
  console.log('There is no ./data folder yet, so there is nothing to delete.');
  process.exit(0);
}

const files = fs.readdirSync(dataDir).filter((f) => f.startsWith('pushup-league.db'));

if (files.length === 0) {
  console.log('No database file found in ./data - nothing to delete.');
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(
  `This will permanently delete ${files.length} database file(s) in ./data,\n` +
    'including all accounts and push-up history. Type "yes" to continue: ',
);
rl.close();

if (answer.trim().toLowerCase() !== 'yes') {
  console.log('Cancelled. Nothing was deleted.');
  process.exit(0);
}

let removed = 0;
for (const file of files) {
  fs.rmSync(path.join(dataDir, file), { force: true });
  removed += 1;
}
console.log(`Deleted ${removed} file(s). The next time you start the app it will create a fresh, empty database.`);

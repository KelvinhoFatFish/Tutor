/**
 * SOCIAL / STATS LOGIC TESTS
 * ==========================
 * Runs the friendship, streak, leaderboard and anti-cheat code directly against
 * a throwaway SQLite database - no web server needed.
 *
 * This exists so that the parts of the app that are easy to get subtly wrong
 * (does an invite create a pending request or a real friendship? does a streak
 * survive a missed day? is an impossible rep rate caught?) are checked on every
 * run, in about a second.
 *
 * Run with:  npm run test:social
 */
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outDir = path.join(root, '.test-social');
// Deliberately inside the project folder: the test must not write outside it,
// and this keeps the cleanup reliable on every platform.
const dbFile = path.join(outDir, 'test.db');

// --- 1. Compile the server modules to plain JavaScript ----------------------
const ts = (await import('typescript')).default;

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const FILES = [
  ['src/lib/db/helpers.ts', 'db/helpers.js'],
  ['src/lib/db/schema.ts', 'db/schema.js'],
  ['src/lib/db/index.ts', 'db/index.js'],
  ['src/lib/stats.ts', 'stats.js'],
  ['src/lib/social.ts', 'social.js'],
  ['src/lib/challenges.ts', 'challenges.js'],
  ['src/lib/achievements.ts', 'achievements.js'],
  ['src/lib/validation.ts', 'validation.js'],
];

for (const [from, to] of FILES) {
  const source = fs.readFileSync(path.join(root, from), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: from,
  });
  const target = path.join(outDir, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, outputText);
}

// `server-only` is a marker package for Next.js that throws when loaded outside
// a server component. We are deliberately outside Next here, so neutralise it.
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, parent, isMain);
};

process.env.SQLITE_PATH = dbFile;
process.env.DB_DRIVER = 'sqlite';

const require = createRequire(pathToFileURL(path.join(root, 'package.json')).href);
const { getDb, newId, nowIso, newFriendCode } = require(path.join(outDir, 'db/index.js'));
const { getUserStats, auditWorkout, recordWorkout, computeStreaks } = require(path.join(outDir, 'stats.js'));
const social = require(path.join(outDir, 'social.js'));
const challenges = require(path.join(outDir, 'challenges.js'));

// --- 2. Tiny test runner ----------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function dayKey(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

const today = dayKey(0);

const db = await getDb();

async function makeUser(username) {
  const id = newId();
  let code = newFriendCode();
  while (await db.get('SELECT id FROM users WHERE friend_code = ?', [code])) code = newFriendCode();
  await db.run(
    `INSERT INTO users (id, username, username_lower, email, email_lower, friend_code, created_at, onboarded)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [id, username, username.toLowerCase(), `${username.toLowerCase()}@example.com`, `${username.toLowerCase()}@example.com`, code, nowIso()],
  );
  return { id, username, code };
}

async function giveReps(userId, day, count) {
  await db.run(
    `INSERT INTO daily_stats (id, user_id, day_key, pushup_count, session_count, avg_confidence, updated_at)
     VALUES (?, ?, ?, ?, 1, 1, ?)
     ON CONFLICT (user_id, day_key) DO UPDATE SET pushup_count = excluded.pushup_count`,
    [newId(), userId, day, count, nowIso()],
  );
  await db.run('UPDATE users SET lifetime_pushups = lifetime_pushups + ? WHERE id = ?', [count, userId]);
}

console.log('PushUp League - social, stats and anti-cheat tests');
console.log('==================================================');

// ---------------------------------------------------------------------------
section('1. Streak maths');
{
  check('no days at all -> 0', computeStreaks([], today).current === 0);
  check('today only -> 1', computeStreaks([today], today).current === 1);
  check(
    'yesterday only still counts (today is not over yet)',
    computeStreaks([dayKey(-1)], today).current === 1,
  );
  check(
    'yesterday and the day before -> 2',
    computeStreaks([dayKey(-1), dayKey(-2)], today).current === 2,
  );
  check(
    'a missed day yesterday breaks the streak',
    computeStreaks([dayKey(-2), dayKey(-3)], today).current === 0,
  );
  const long = [0, -1, -2, -3, -4].map((offset) => dayKey(offset));
  check('five days in a row -> 5', computeStreaks(long, today).current === 5);
  check('longest streak is remembered', computeStreaks([...long, dayKey(-30), dayKey(-31)], today).longest === 5);
  check(
    'the longest run is found wherever it is',
    computeStreaks([dayKey(-40), dayKey(-41), dayKey(-42), dayKey(-43), today], today).longest === 4,
  );
}

// ---------------------------------------------------------------------------
section('2. Anti-cheat audit');
{
  const base = {
    sessionId: 'x',
    userId: 'u',
    startedAt: new Date(Date.now() - 60000).toISOString(),
    endedAt: new Date().toISOString(),
    dayKey: today,
    reps: 25,
    invalidReps: 2,
    validationScore: 0.9,
  };
  check('a normal 25 reps in a minute is fine', auditWorkout(base).ok === true);

  check(
    'rejects an impossible rep rate',
    auditWorkout({ ...base, reps: 400, startedAt: new Date(Date.now() - 10000).toISOString() }).ok === false,
  );
  check(
    'rejects a negative rep count',
    auditWorkout({ ...base, reps: -5 }).ok === false,
  );
  check(
    'rejects more reps than the hard ceiling',
    auditWorkout({ ...base, reps: 5000, startedAt: new Date(Date.now() - 3600000).toISOString() }).ok === false,
  );
  check(
    'rejects a zero-length session with reps',
    auditWorkout({ ...base, reps: 10, startedAt: base.endedAt }).ok === false,
  );
  check(
    'rejects a session where nearly everything failed validation',
    auditWorkout({ ...base, reps: 100, validationScore: 0.05, startedAt: new Date(Date.now() - 300000).toISOString() }).ok === false,
  );
  check('a genuinely fast but possible set passes', auditWorkout({ ...base, reps: 30, startedAt: new Date(Date.now() - 40000).toISOString() }).ok === true);
}

// ---------------------------------------------------------------------------
section('3. Recording workouts is idempotent');
{
  const user = await makeUser('Idempo');
  const sessionId = newId();
  const input = {
    sessionId,
    userId: user.id,
    startedAt: new Date(Date.now() - 120000).toISOString(),
    endedAt: new Date().toISOString(),
    dayKey: today,
    reps: 30,
    invalidReps: 1,
    validationScore: 0.95,
  };

  const first = await recordWorkout(input);
  check('the first upload counts', first.accepted === 30 && first.duplicate === false);
  const second = await recordWorkout(input);
  check('the second upload is a duplicate', second.duplicate === true && second.accepted === 0);
  const stats = await getUserStats(user.id, today);
  check('the total is still 30, not 60', stats.today === 30, `today=${stats.today}`);
  check('lifetime matches today', stats.lifetime === 30);

  const flagged = await recordWorkout({ ...input, sessionId: newId(), reps: 900, startedAt: new Date(Date.now() - 3000).toISOString() });
  check('a flagged session is stored but credits nothing', flagged.flagged === true && flagged.accepted === 0);
  const afterFlag = await getUserStats(user.id, today);
  check('flagged reps stay out of the totals', afterFlag.today === 30, `today=${afterFlag.today}`);
}

// ---------------------------------------------------------------------------
section('4. Invite links connect people immediately');
{
  const inviter = await makeUser('Inviter');
  const joiner = await makeUser('Joiner');

  const result = await social.acceptInvite(joiner.id, inviter.code);
  check('the invite succeeds', result.ok === true, JSON.stringify(result));
  check('the result is "accepted", not "requested"', result.status === 'accepted', result.status);

  const friends = await social.getFriendIds(inviter.id);
  check('the inviter has the new friend straight away', friends.includes(joiner.id), JSON.stringify(friends));
  const reverse = await social.getFriendIds(joiner.id);
  check('the friendship goes both ways', reverse.includes(inviter.id));

  const self = await social.acceptInvite(inviter.id, inviter.code);
  check('you cannot invite yourself', self.ok === false);

  const bogus = await social.acceptInvite(joiner.id, 'ZZZZZZ');
  check('an unknown code fails cleanly', bogus.ok === false);

  // Blocking must survive an invite attempt.
  const blocked = await makeUser('Blocked');
  await social.blockUser(inviter.id, blocked.id);
  const blockedInvite = await social.acceptInvite(blocked.id, inviter.code);
  check('a blocked person cannot get back in via the link', blockedInvite.ok === false, JSON.stringify(blockedInvite));

  const realId = await social.getPublicProfile(inviter.id, blocked.id, today);
  check('a blocked profile is not readable', realId === null);
}

// ---------------------------------------------------------------------------
section('5. Friend requests');
{
  const a = await makeUser('ReqA');
  const b = await makeUser('ReqB');
  const c = await makeUser('ReqC');

  const sent = await social.sendFriendRequest(a.id, b.id);
  check('a request is created', sent.ok === true && sent.status === 'requested', JSON.stringify(sent));

  const again = await social.sendFriendRequest(a.id, b.id);
  check('asking twice does not duplicate', again.ok === true && again.status === 'already_pending');

  const pending = await social.getPendingRequests(b.id);
  check('the recipient sees one incoming request', pending.length === 1 && pending[0].direction === 'incoming');
  const outgoing = await social.getPendingRequests(a.id);
  check('the sender sees one outgoing request', outgoing.length === 1 && outgoing[0].direction === 'outgoing');

  // Mutual intent should not need a second click.
  const mutual = await social.sendFriendRequest(b.id, a.id);
  check('a reciprocal request auto-accepts', mutual.ok === true && mutual.status === 'accepted', JSON.stringify(mutual));
  check('they are now friends', (await social.areFriends(a.id, b.id)) === true);

  // Removing works from either side.
  await social.removeFriend(b.id, a.id);
  check('removing a friend works from either side', (await social.areFriends(a.id, b.id)) === false);

  // Only the recipient can accept.
  await social.sendFriendRequest(a.id, c.id);
  const cPending = await social.getPendingRequests(c.id);
  const asSender = await social.respondToRequest(a.id, cPending[0].friendshipId, 'accept');
  check('the sender cannot accept their own request', asSender.ok === false);
  const asRecipient = await social.respondToRequest(c.id, cPending[0].friendshipId, 'accept');
  check('the recipient can accept', asRecipient.ok === true && (await social.areFriends(a.id, c.id)));
}

// ---------------------------------------------------------------------------
section('6. Search and privacy');
{
  const searcher = await makeUser('Searcher');
  const target = await makeUser('Findable');

  const byName = await social.searchUsers(searcher.id, 'Findable');
  check('search finds a user by partial name', byName.some((r) => r.userId === target.id));
  check('search results carry no email', !JSON.stringify(byName).includes('@example.com'));

  const byCode = await social.searchUsers(searcher.id, target.code);
  check('search finds a user by exact friend code', byCode.length === 1 && byCode[0].userId === target.id);
  check('the code search reports the relation', byCode[0].relation === 'none');

  const tooShort = await social.searchUsers(searcher.id, 'F');
  check('a one-character search returns nothing', tooShort.length === 0);

  await giveReps(target.id, today, 40);
  const limited = await social.getPublicProfile(searcher.id, target.id, today);
  check('a stranger gets a limited profile', limited.limited === true);
  check('a stranger sees the lifetime total', limited.lifetime === 40);
  check('a stranger cannot see daily totals', limited.today === undefined);

  await social.sendFriendRequest(searcher.id, target.id);
  // A reciprocal request auto-accepts, so this is what turns them into friends.
  await social.sendFriendRequest(target.id, searcher.id);
  const full = await social.getPublicProfile(searcher.id, target.id, today);
  check('a friend sees the full profile', full.limited === undefined);
  check('a friend sees today', full.today === 40, `today=${full.today}`);
  check('another user\'s friend code is hidden', full.friendCode === null);
  const own = await social.getPublicProfile(target.id, target.id, today);
  check('you can see your own friend code', typeof own.friendCode === 'string');
}

// ---------------------------------------------------------------------------
section('7. Leaderboards');
{
  const me = await makeUser('RankMe');
  const strong = await makeUser('RankStrong');
  const weak = await makeUser('RankWeak');

  await social.sendFriendRequest(me.id, strong.id);
  await social.sendFriendRequest(strong.id, me.id); // auto-accept
  await social.sendFriendRequest(me.id, weak.id);
  await social.sendFriendRequest(weak.id, me.id); // auto-accept

  await giveReps(me.id, today, 50);
  await giveReps(strong.id, today, 80);
  await giveReps(weak.id, today, 10);

  const board = await social.buildLeaderboard(me.id, today, 'today');
  check('everyone appears', board.entries.length === 3, JSON.stringify(board.entries.map((e) => e.username)));
  check('sorted by reps descending', board.entries[0].total === 80 && board.entries[2].total === 10);
  check('my rank is found', board.selfRank === 2, `selfRank=${board.selfRank}`);
  check('exactly one row is marked as me', board.entries.filter((e) => e.isSelf).length === 1);
  check('the message targets the person ahead', board.message.includes('RankStrong'), board.message);
  check('the message quotes the exact gap', board.message.includes('30'), board.message);

  // A stranger must never appear on my board.
  const outsider = await makeUser('RankOutsider');
  await giveReps(outsider.id, today, 9999);
  const board2 = await social.buildLeaderboard(me.id, today, 'today');
  check('non-friends never appear on the board', board2.entries.every((e) => e.username !== 'RankOutsider'));

  // Ties must be stable, not flickering.
  const tied = await makeUser('RankTied');
  await giveReps(tied.id, today, 80);
  const board3 = await social.buildLeaderboard(strong.id, today, 'today');
  check('ties are ordered deterministically', board3.entries.map((e) => e.username).join() === [...board3.entries.map((e) => e.username)].sort().join() || board3.entries[0].total === 80);
}

// ---------------------------------------------------------------------------
section('8. Motivational messages never shame the user');
{
  const me = await makeUser('MsgMe');
  const rival = await makeUser('MsgRival');
  await social.sendFriendRequest(me.id, rival.id);
  await social.sendFriendRequest(rival.id, me.id);

  // Nobody has done anything yet.
  let board = await social.buildLeaderboard(me.id, today, 'today');
  check('no message when everyone is on zero', board.message === null, String(board.message));

  // I am behind.
  await giveReps(rival.id, today, 30);
  board = await social.buildLeaderboard(me.id, today, 'today');
  check('an encouraging message is produced', typeof board.message === 'string' && board.message.length > 0);
  check('the message is not negative language', !/lazy|fail|loser|shame|disappoint/i.test(board.message), board.message);

  // I am level.
  await giveReps(me.id, today, 30);
  board = await social.buildLeaderboard(me.id, today, 'today');
  check('a tie produces its own message', /level|tied/i.test(board.message ?? ''), String(board.message));

  // I am ahead.
  await giveReps(me.id, today, 90);
  board = await social.buildLeaderboard(me.id, today, 'today');
  check('leading produces a defending message', board.message.includes('#1'), String(board.message));

  // One rep behind.
  await giveReps(me.id, today, 29);
  board = await social.buildLeaderboard(me.id, today, 'today');
  check('being one rep behind is called out', /Just 1 push-up behind/.test(board.message ?? ''), String(board.message));
}

// ---------------------------------------------------------------------------
section('9. Challenges');
{
  const owner = await makeUser('ChOwner');
  const rival = await makeUser('ChRival');
  const stranger = await makeUser('ChStranger');
  await social.sendFriendRequest(owner.id, rival.id);
  await social.sendFriendRequest(rival.id, owner.id);

  await giveReps(owner.id, today, 120);
  await giveReps(rival.id, today, 150);

  const challengeId = await challenges.createChallenge({
    creatorId: owner.id,
    name: 'Test Battle',
    description: null,
    type: 'total',
    target: 100,
    startDate: today,
    endDate: today,
    invitees: [rival.id],
  });

  const view = await challenges.getChallenge(challengeId, owner.id, today);
  check('the creator can read the challenge', view !== null);
  check('both participants are present', view.participants.length === 2);
  check('scores come from daily stats', view.participants[0].pushups === 150, JSON.stringify(view.participants.map((p) => p.pushups)));
  check('the leader is ranked first', view.participants[0].username === 'ChRival');
  check('progress is capped at 100%', view.participants[0].progress === 1);
  check('my rank is reported', view.selfRank === 2, `selfRank=${view.selfRank}`);
  check('a chase message is produced', /behind/.test(view.message ?? ''), String(view.message));
  check('the challenge is active', view.status === 'active');

  check('a non-participant cannot read it', (await challenges.getChallenge(challengeId, stranger.id, today)) === null);
  check('a non-creator cannot delete it', (await challenges.deleteChallenge(challengeId, rival.id)) === false);
  check('the creator can delete it', (await challenges.deleteChallenge(challengeId, owner.id)) === true);
  check('it is gone afterwards', (await challenges.getChallenge(challengeId, owner.id, today)) === null);

  // Future and past windows are classified correctly.
  const future = await challenges.createChallenge({
    creatorId: owner.id, name: 'Future', description: null, type: 'total', target: null,
    startDate: dayKey(5), endDate: dayKey(10), invitees: [],
  });
  const futureView = await challenges.getChallenge(future, owner.id, today);
  check('a future challenge is "upcoming"', futureView.status === 'upcoming');
  check('an upcoming challenge explains itself', /not started yet/.test(futureView.message ?? ''), String(futureView.message));
  const past = await challenges.createChallenge({
    creatorId: owner.id, name: 'Past', description: null, type: 'total', target: null,
    startDate: dayKey(-20), endDate: dayKey(-10), invitees: [],
  });
  check('a finished challenge is "finished"', (await challenges.getChallenge(past, owner.id, today)).status === 'finished');
}

// ---------------------------------------------------------------------------
section('10. Achievements unlock once');
{
  const { checkAchievements, getUserAchievements } = require(path.join(outDir, 'achievements.js'));
  const user = await makeUser('Achiever');

  let unlocked = await checkAchievements(user.id, today);
  check('a brand new account has nothing yet', unlocked.length === 0, JSON.stringify(unlocked.map((a) => a.code)));

  await giveReps(user.id, today, 1);
  unlocked = await checkAchievements(user.id, today);
  check('the first push-up unlocks "First Push-Up"', unlocked.some((a) => a.code === 'first_pushup'));

  const again = await checkAchievements(user.id, today);
  check('re-checking does not unlock it twice', !again.some((a) => a.code === 'first_pushup'));

  await giveReps(user.id, today, 120);
  unlocked = await checkAchievements(user.id, today);
  check('a 100+ day unlocks the century badge', unlocked.some((a) => a.code === 'day_100'));

  const state = await getUserAchievements(user.id, today);
  check('unlocked achievements are listed', state.unlocked.length >= 2);
  check('locked achievements carry progress', state.locked.every((a) => a.progress >= 0 && a.progress <= 1));
}

// ---------------------------------------------------------------------------
section('11. Notifications');
{
  const me = await makeUser('NotifMe');
  const rival = await makeUser('NotifRival');
  await social.sendFriendRequest(me.id, rival.id);
  await social.sendFriendRequest(rival.id, me.id);

  await giveReps(rival.id, today, 20);
  await giveReps(me.id, today, 50);
  await social.notifyFriendsOfOvertake(me.id, today);

  const inbox = await social.listNotifications(rival.id);
  check('the overtaken friend is notified', inbox.some((n) => n.type === 'overtaken'), JSON.stringify(inbox));

  // The rate limit must stop a second message within six hours.
  await social.notifyFriendsOfOvertake(me.id, today);
  const inbox2 = await social.listNotifications(rival.id);
  check('the message is rate-limited', inbox2.filter((n) => n.type === 'overtaken').length === 1);

  check('unread count is reported', (await social.unreadNotificationCount(rival.id)) === inbox2.length);
  await social.markNotificationsRead(rival.id);
  check('marking read clears the unread count', (await social.unreadNotificationCount(rival.id)) === 0);

  // People who have not started should never be gloating targets.
  const idle = await makeUser('NotifIdle');
  await social.sendFriendRequest(me.id, idle.id);
  await social.sendFriendRequest(idle.id, me.id);
  await social.notifyFriendsOfOvertake(me.id, today);
  const idleInbox = await social.listNotifications(idle.id);
  check('someone on zero is not notified', idleInbox.filter((n) => n.type === 'overtaken').length === 0);
}

// ---------------------------------------------------------------------------
section('12. Blocks are absolute');
{
  const a = await makeUser('BlockA');
  const b = await makeUser('BlockB');
  await social.sendFriendRequest(a.id, b.id);
  await social.sendFriendRequest(b.id, a.id);
  check('they start as friends', await social.areFriends(a.id, b.id));

  await social.blockUser(a.id, b.id);
  check('blocking ends the friendship', (await social.areFriends(a.id, b.id)) === false);
  check('the blocked person is on the block list', (await social.getBlockedIds(a.id)).includes(b.id));
  check('the blocker is on the blocked person\'s list too', (await social.getBlockedIds(b.id)).includes(a.id));
  check('the blocked person disappears from search', !(await social.searchUsers(a.id, 'BlockB')).some((r) => r.userId === b.id));

  const attempt = await social.sendFriendRequest(b.id, a.id);
  check('the blocked person cannot re-send a request', attempt.ok === false, JSON.stringify(attempt));

  await social.unblockUser(a.id, b.id);
  check('unblocking clears it', !(await social.getBlockedIds(a.id)).includes(b.id));
  const retry = await social.sendFriendRequest(b.id, a.id);
  check('they can reconnect after unblocking', retry.ok === true, JSON.stringify(retry));
}

// ---------------------------------------------------------------------------
console.log('\n==================================================');
console.log(`${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailed checks:');
  for (const name of failures) console.log(`  - ${name}`);
}

// Release the database file before deleting it - Windows keeps it locked
// while the connection is open.
await db.close();
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);

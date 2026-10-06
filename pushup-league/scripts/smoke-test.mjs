/**
 * END-TO-END SMOKE TEST
 * =====================
 * Starts from a running server and exercises the real HTTP API the way the
 * browser does - cookies, accounts, workouts, friends, leaderboards,
 * challenges, anti-cheat and account deletion.
 *
 * Usage:
 *   1. npm run build
 *   2. npm start
 *   3. node scripts/smoke-test.mjs            (in a second terminal)
 *
 * Set BASE_URL to test a deployed site, e.g.
 *   $env:BASE_URL="https://pushupleague.vercel.app"; node scripts/smoke-test.mjs
 */

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

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

/** A minimal cookie jar so each simulated user keeps their own session. */
function makeClient(label) {
  const jar = new Map();

  const cookieHeader = () =>
    Array.from(jar.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');

  const request = async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(jar.size > 0 ? { Cookie: cookieHeader() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });

    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '' || /Max-Age=0/i.test(raw)) jar.delete(name);
      else jar.set(name, value);
    }

    let payload = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 200) };
      }
    }
    return { status: response.status, body: payload };
  };

  return { label, request, jar };
}

const today = new Date();
const dayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
  today.getDate(),
).padStart(2, '0')}`;

/** A realistic session: `reps` push-ups at a plausible pace. */
function session(reps, seconds = null) {
  const durationMs = (seconds ?? Math.max(20, reps * 2)) * 1000;
  const endedAt = new Date();
  const startedAt = new Date(endedAt.getTime() - durationMs);
  return {
    id: crypto.randomUUID(),
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    reps,
    invalidReps: Math.round(reps * 0.1),
    validationScore: 0.9,
    dayKey,
    device: 'smoke-test',
  };
}

console.log(`PushUp League smoke test → ${BASE}`);

// ---------------------------------------------------------------------------
// 0. Is anything there?
// ---------------------------------------------------------------------------
section('0. Server reachable');
{
  try {
    const response = await fetch(`${BASE}/api/auth/me`);
    check('GET /api/auth/me responds', response.ok, `status ${response.status}`);
  } catch (error) {
    console.error(`\nCould not reach ${BASE}. Is "npm start" running in another terminal?`);
    console.error(error.message);
    process.exit(1);
  }
}

const stamp = Date.now().toString(36);
const alice = makeClient('alice');
const bob = makeClient('bob');

const aliceEmail = `alice.${stamp}@example.com`;
const bobEmail = `bob.${stamp}@example.com`;

// ---------------------------------------------------------------------------
// 1. Registration and session
// ---------------------------------------------------------------------------
section('1. Registration and session');
{
  const signedOut = await alice.request('/api/auth/me');
  check('starts signed out', signedOut.body?.user === null);

  const bad = await alice.request('/api/auth/register', {
    method: 'POST',
    body: { username: 'ab', email: 'not-an-email', password: '123' },
  });
  check('rejects a bad email/password', bad.status === 400, JSON.stringify(bad.body));

  const created = await alice.request('/api/auth/register', {
    method: 'POST',
    body: { username: `Alex${stamp.slice(-4)}`, email: aliceEmail, password: 'supersecret1', biometricConsent: true },
  });
  check('creates an account', created.status === 201, JSON.stringify(created.body));
  check('returns the new user', Boolean(created.body?.user?.id));
  check('mints a 6-character friend code', /^[A-Z0-9]{6}$/.test(created.body?.user?.friend_code ?? ''));
  check('sets a session cookie', alice.jar.has('pul_session'));

  const duplicate = await alice.request('/api/auth/register', {
    method: 'POST',
    body: { username: 'SomeoneElse', email: aliceEmail, password: 'supersecret1' },
  });
  check('refuses a duplicate email', duplicate.status === 400, JSON.stringify(duplicate.body));

  const me = await alice.request('/api/auth/me');
  check('session is recognised', me.body?.user?.email === aliceEmail);
  check('email is only ever returned for your own account', me.body?.user?.email !== undefined);
}

// ---------------------------------------------------------------------------
// 2. Recording workouts
// ---------------------------------------------------------------------------
section('2. Recording workouts');
{
  const first = session(20, 60);
  const saved = await alice.request('/api/workouts', { method: 'POST', body: first });
  check('accepts a plausible workout', saved.status === 200 && saved.body?.accepted === 20, JSON.stringify(saved.body));
  check('reports today\'s total as 20', saved.body?.stats?.today === 20, `today=${saved.body?.stats?.today}`);
  check('reports lifetime as 20', saved.body?.stats?.lifetime === 20);
  check('sets a 1-day streak', saved.body?.stats?.currentStreak === 1);

  const retry = await alice.request('/api/workouts', { method: 'POST', body: first });
  check('a duplicate upload is ignored', retry.body?.duplicate === true, JSON.stringify(retry.body));
  check('a duplicate adds no reps', retry.body?.accepted === 0);
  check('a duplicate leaves the total at 20', retry.body?.stats?.today === 20, `today=${retry.body?.stats?.today}`);

  const second = session(15, 45);
  const saved2 = await alice.request('/api/workouts', { method: 'POST', body: second });
  check('a second session accumulates', saved2.body?.stats?.today === 35, `today=${saved2.body?.stats?.today}`);
  check('personal best tracks the best single day', saved2.body?.stats?.personalBest === 35);

  const impossible = session(500, 5); // 6000 reps per minute
  const flagged = await alice.request('/api/workouts', { method: 'POST', body: impossible });
  check('flags an impossible rep rate', flagged.body?.flagged === true, JSON.stringify(flagged.body));
  check('credits nothing for a flagged session', flagged.body?.accepted === 0);
  check('flagged reps do not reach the totals', flagged.body?.stats?.today === 35, `today=${flagged.body?.stats?.today}`);

  const future = await alice.request('/api/workouts', {
    method: 'POST',
    body: { ...session(10, 30), dayKey: '2099-01-01' },
  });
  check('ignores a far-future day key', future.status === 200 && future.body?.stats?.today === 45, JSON.stringify(future.body?.stats));

  const badShape = await alice.request('/api/workouts', { method: 'POST', body: { id: 'x', reps: 9999 } });
  check('rejects a malformed session id', badShape.status === 400);

  const signedOutWrite = await makeClient('nobody').request('/api/workouts', { method: 'POST', body: session(50, 60) });
  check('refuses a workout with no session', signedOutWrite.status === 401);
}

// ---------------------------------------------------------------------------
// 3. Reading stats
// ---------------------------------------------------------------------------
section('3. Stats');
{
  const stats = await alice.request(`/api/stats?day=${dayKey}`);
  const s = stats.body?.stats;
  check('today is 45', s?.today === 45, `today=${s?.today}`);
  check('this week includes today', s?.week >= 45);
  check('this month includes today', s?.month >= 45);
  check('lifetime is 45', s?.lifetime === 45);
  check('the 14-day series has 14 points', s?.todaySeries?.length === 14);
  check('the chart ends on today', s?.todaySeries?.at(-1)?.day === dayKey);
  check('at least one achievement unlocked', (stats.body?.achievements?.unlocked?.length ?? 0) >= 1);
  check('achievement progress is reported', Array.isArray(stats.body?.achievements?.locked));
}

// ---------------------------------------------------------------------------
// 4. Friends
// ---------------------------------------------------------------------------
section('4. Friends');
{
  const bobCreated = await bob.request('/api/auth/register', {
    method: 'POST',
    body: { username: `Bobby${stamp.slice(-4)}`, email: bobEmail, password: 'supersecret1' },
  });
  check('second account created', bobCreated.status === 201);
  const bobId = bobCreated.body.user.id;
  const aliceId = (await alice.request('/api/auth/me')).body.user.id;

  const search = await bob.request(`/api/friends/search?q=${stamp.slice(-4)}`);
  check('search finds the other user', (search.body?.results?.length ?? 0) >= 1, JSON.stringify(search.body));
  check('search never leaks an email', !JSON.stringify(search.body).includes('@example.com'));

  const codeSearch = await bob.request(
    `/api/friends/search?q=${(await alice.request('/api/auth/me')).body.user.friend_code}`,
  );
  check('search by friend code works', (codeSearch.body?.results?.length ?? 0) === 1);

  const request = await bob.request('/api/friends', { method: 'POST', body: { userId: aliceId } });
  check('a friend request is sent', request.body?.status === 'requested', JSON.stringify(request.body));

  const pending = await alice.request('/api/friends');
  check('the request appears for the recipient', pending.body?.incoming?.length === 1);
  const friendshipId = pending.body.incoming[0].friendshipId;

  const wrongPerson = await bob.request('/api/friends/respond', {
    method: 'POST',
    body: { friendshipId, action: 'accept' },
  });
  check('only the recipient can accept', wrongPerson.status === 400, JSON.stringify(wrongPerson.body));

  const accepted = await alice.request('/api/friends/respond', {
    method: 'POST',
    body: { friendshipId, action: 'accept' },
  });
  check('the recipient can accept', accepted.body?.ok === true);

  const friendsNow = await alice.request('/api/friends');
  check('the friend appears in the list', friendsNow.body?.friends?.length === 1);
  check('friend summaries carry today\'s count', typeof friendsNow.body.friends[0].today === 'number');
}

// ---------------------------------------------------------------------------
// 5. Leaderboard
// ---------------------------------------------------------------------------
section('5. Leaderboard');
{
  const before = await bob.request(`/api/leaderboard?range=today&day=${dayKey}`);
  check('the leaderboard has 2 entries', before.body?.entries?.length === 2);

  await bob.request('/api/workouts', { method: 'POST', body: session(60, 120) });

  const after = await alice.request(`/api/leaderboard?range=today&day=${dayKey}`);
  const entries = after.body?.entries ?? [];
  check('bob is now first', entries[0]?.isSelf === false && entries[0]?.total === 60, JSON.stringify(entries));
  check('alice is second', entries[1]?.isSelf === true && entries[1]?.total === 45);
  check('a motivational message is produced', typeof after.body?.message === 'string' && after.body.message.length > 0);
  check('the message names the person ahead', (after.body?.message ?? '').includes(entries[0]?.username ?? '###'), after.body?.message);

  const allTime = await alice.request(`/api/leaderboard?range=all&day=${dayKey}`);
  check('all-time range works', allTime.body?.entries?.length === 2);
  const week = await alice.request(`/api/leaderboard?range=week&day=${dayKey}`);
  check('week range works', week.body?.range === 'week');
  const bogus = await alice.request(`/api/leaderboard?range=nonsense&day=${dayKey}`);
  check('an unknown range falls back to today', bogus.body?.range === 'today');
}

// ---------------------------------------------------------------------------
// 6. Privacy: profiles and cross-account writes
// ---------------------------------------------------------------------------
section('6. Privacy and authorisation');
{
  const aliceId = (await alice.request('/api/auth/me')).body.user.id;
  const bobId = (await bob.request('/api/auth/me')).body.user.id;

  const friendView = await bob.request(`/api/users/${aliceId}?day=${dayKey}`);
  check('a friend profile is visible', friendView.status === 200);
  check('the friend profile has no email field', !JSON.stringify(friendView.body).includes('@example.com'));
  check('the friend profile exposes a streak to friends', typeof friendView.body?.profile?.currentStreak === 'number');
  check('the friend profile hides the friend code of others', friendView.body?.profile?.friendCode === null);

  const selfView = await alice.request(`/api/users/${aliceId}?day=${dayKey}`);
  check('you can see your own friend code', typeof selfView.body?.profile?.friendCode === 'string');

  const stranger = makeClient('stranger');
  await stranger.request('/api/auth/register', {
    method: 'POST',
    body: { username: `Stray${stamp.slice(-4)}`, email: `stray.${stamp}@example.com`, password: 'supersecret1' },
  });
  const limited = await stranger.request(`/api/users/${aliceId}?day=${dayKey}`);
  check('a non-friend gets a limited profile', limited.body?.limited === true, JSON.stringify(limited.body));
  check('a non-friend cannot see daily totals', limited.body?.profile?.today === undefined);

  const before = (await bob.request('/api/auth/me')).body.user.username;
  await alice.request('/api/account', { method: 'PATCH', body: { username: 'AliceRenamed' } });
  const after = (await bob.request('/api/auth/me')).body.user.username;
  check('editing your profile does not touch anyone else', before === after, `${before} -> ${after}`);

  const aliceAfter = (await alice.request('/api/auth/me')).body.user.username;
  check('your own rename worked', aliceAfter === 'AliceRenamed');
  check('bobId differs from aliceId', aliceId !== bobId);

  const takenName = await bob.request('/api/account', { method: 'PATCH', body: { username: 'AliceRenamed' } });
  check('a duplicate username is rejected', takenName.status === 400, JSON.stringify(takenName.body));
}

// ---------------------------------------------------------------------------
// 7. Notifications
// ---------------------------------------------------------------------------
section('7. Notifications');
{
  const notifications = await alice.request('/api/notifications');
  check('notification feed loads', Array.isArray(notifications.body?.notifications));
  check('alice was told bob passed her', notifications.body.notifications.some((n) => n.type === 'overtaken'), JSON.stringify(notifications.body.notifications));
  const read = await alice.request('/api/notifications', { method: 'POST' });
  check('notifications can be marked read', read.body?.ok === true);
  const after = await alice.request('/api/notifications');
  check('unread count drops to zero', after.body?.unread === 0, `unread=${after.body?.unread}`);
}

// ---------------------------------------------------------------------------
// 8. Challenges
// ---------------------------------------------------------------------------
section('8. Challenges');
{
  const aliceId = (await alice.request('/api/auth/me')).body.user.id;
  const bobId = (await bob.request('/api/auth/me')).body.user.id;

  const created = await alice.request('/api/challenges', {
    method: 'POST',
    body: {
      name: 'Smoke Test Battle',
      description: 'Created by the smoke test',
      type: 'total',
      target: 100,
      startDate: dayKey,
      endDate: dayKey,
      invitees: [bobId],
    },
  });
  check('a challenge is created', created.status === 201, JSON.stringify(created.body));
  const challengeId = created.body?.challengeId;

  const bobView = await bob.request(`/api/challenges/${challengeId}?day=${dayKey}`);
  check('an invited friend can see it', bobView.status === 200);
  check('it has both participants', bobView.body?.challenge?.participants?.length === 2);
  check('scores come from real daily stats', bobView.body?.challenge?.participants?.[0]?.pushups === 60, JSON.stringify(bobView.body?.challenge?.participants));
  check('a leader message is produced', typeof bobView.body?.challenge?.message === 'string');

  const strangerChallenge = await makeClient('stranger2').request(`/api/challenges/${challengeId}?day=${dayKey}`);
  check('a non-participant cannot read it', strangerChallenge.status === 404 || strangerChallenge.status === 401);

  const list = await alice.request(`/api/challenges?day=${dayKey}`);
  check('the challenge appears in the list', list.body?.challenges?.length === 1);
  check('the friend picker is populated', (list.body?.friends?.length ?? 0) >= 1);

  const deleteByBob = await bob.request(`/api/challenges/${challengeId}`, { method: 'DELETE' });
  check('only the creator can delete a challenge', deleteByBob.status === 403, JSON.stringify(deleteByBob.body));
  const deleteByAlice = await alice.request(`/api/challenges/${challengeId}`, { method: 'DELETE' });
  check('the creator can delete it', deleteByAlice.body?.ok === true);
}

// ---------------------------------------------------------------------------
// 9. Invite links
// ---------------------------------------------------------------------------
section('9. Invite links');
{
  const aliceCode = (await alice.request('/api/auth/me')).body.user.friend_code;

  const preview = await fetch(`${BASE}/api/invite/${aliceCode}`).then((r) => r.json());
  check('an invite link resolves', preview.valid === true);
  check('it names the inviter', typeof preview.inviter?.username === 'string');
  check('it does not leak an email', !JSON.stringify(preview).includes('@example.com'));

  const bad = await fetch(`${BASE}/api/invite/ZZZZZZ`).then((r) => r.json());
  check('an unknown code is rejected', bad.valid === false);

  // A brand new user arriving through the invite should become friends instantly.
  const invited = makeClient('invited');
  const joined = await invited.request('/api/auth/register', {
    method: 'POST',
    body: {
      username: `Invited${stamp.slice(-4)}`,
      email: `invited.${stamp}@example.com`,
      password: 'supersecret1',
      inviteCode: aliceCode,
    },
  });
  check('signing up through an invite works', joined.status === 201);
  check('the inviter is credited as a friend', joined.body?.invited === true);

  const aliceFriends = await alice.request('/api/friends');
  check('the inviter sees the new friend', aliceFriends.body?.friends?.length === 2, `friends=${aliceFriends.body?.friends?.length}`);
}

// ---------------------------------------------------------------------------
// 10. Account and biometric deletion
// ---------------------------------------------------------------------------
section('10. Deletion');
{
  const biometrics = await bob.request('/api/account/biometrics', { method: 'DELETE' });
  check('biometric data can be deleted', biometrics.body?.ok === true, JSON.stringify(biometrics.body));

  const noConfirm = await bob.request('/api/account', { method: 'DELETE', body: { confirm: 'nope' } });
  check('account deletion needs confirmation', noConfirm.status === 400);

  const deleted = await bob.request('/api/account', { method: 'DELETE', body: { confirm: 'DELETE' } });
  check('account deletion succeeds', deleted.body?.deleted === true, JSON.stringify(deleted.body));

  const afterDelete = await bob.request('/api/auth/me');
  check('the session is gone after deletion', afterDelete.body?.user === null);

  const loginAttempt = await makeClient('ghost').request('/api/auth/login', {
    method: 'POST',
    body: { email: bobEmail, password: 'supersecret1' },
  });
  check('the deleted account cannot log in', loginAttempt.status === 401, JSON.stringify(loginAttempt.body));

  const aliceLeaderboard = await alice.request(`/api/leaderboard?range=today&day=${dayKey}`);
  check('the deleted user vanished from leaderboards', !aliceLeaderboard.body.entries.some((e) => e.total === 60 || e.username?.startsWith('Bobby')), JSON.stringify(aliceLeaderboard.body.entries.map((e) => e.username)));
}

// ---------------------------------------------------------------------------
// 11. Authentication edges
// ---------------------------------------------------------------------------
section('11. Authentication');
{
  const wrongPassword = await makeClient('x').request('/api/auth/login', {
    method: 'POST',
    body: { email: aliceEmail, password: 'definitely-wrong' },
  });
  check('a wrong password is rejected', wrongPassword.status === 401);

  const unknownEmail = await makeClient('y').request('/api/auth/login', {
    method: 'POST',
    body: { email: `nobody.${stamp}@example.com`, password: 'supersecret1' },
  });
  check('an unknown email is rejected the same way', unknownEmail.status === 401);
  check('the two error messages are identical', wrongPassword.body?.error === unknownEmail.body?.error);

  const fresh = makeClient('fresh');
  const login = await fresh.request('/api/auth/login', {
    method: 'POST',
    body: { email: aliceEmail, password: 'supersecret1' },
  });
  check('a correct password signs in', login.status === 200 && Boolean(login.body?.user));

  const loggedOut = await fresh.request('/api/auth/logout', { method: 'POST' });
  check('logout succeeds', loggedOut.body?.ok === true);
  const afterLogout = await fresh.request('/api/auth/me');
  check('the session is invalidated after logout', afterLogout.body?.user === null);
}

// ---------------------------------------------------------------------------
console.log('\n=====================================');
console.log(`${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailed checks:');
  for (const name of failures) console.log(`  - ${name}`);
}
process.exit(failed === 0 ? 0 : 1);

const DEVICE_COOKIE = 'hl_device';
const ADMIN_KEY = 'HOUSEHOLD_ADMIN_KEY';
const INVITE_TTL_MS = 10 * 60 * 1000;
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;
const MAX_BODY_BYTES = 512 * 1024;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/api/')) {
        assertSameOrigin(request, url);
        return await handleApi(request, env, url);
      }

      return await handleAssetRequest(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({error: error.message, ...error.extra}, error.status);
      }

      console.error('household-ledger request failed', {
        path: url.pathname,
        method: request.method,
        error: error instanceof Error ? error.message : String(error)
      });
      return json({error: '서버에서 처리하지 못했습니다.'}, 500);
    }
  }
};

async function handleApi(request, env, url) {
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({ok: true, service: 'household-ledger'});
  }

  if (url.pathname === '/api/session' && request.method === 'GET') {
    const user = await authenticateDevice(request, env);
    return json({
      authenticated: Boolean(user),
      setupRequired: user ? false : !(await hasActiveOwner(env)),
      user: user ? publicMember(user) : null
    });
  }

  if (url.pathname === '/api/admin/session' && request.method === 'POST') {
    return await adminSession(request, env);
  }

  if (url.pathname === '/api/invites' && request.method === 'POST') {
    const owner = await requireOwner(request, env);
    const result = await createInvite(request, env, owner);
    return json(result);
  }

  if (url.pathname === '/api/invites/accept' && request.method === 'POST') {
    return await acceptInvite(request, env);
  }

  if (url.pathname === '/api/recover' && request.method === 'POST') {
    return await recoverDevice(request, env);
  }

  if (url.pathname === '/api/logout' && request.method === 'POST') {
    return await logout(request, env);
  }

  if (url.pathname === '/api/state' && request.method === 'GET') {
    const user = await requireDevice(request, env);
    return await getState(env, user);
  }

  if (url.pathname === '/api/state' && request.method === 'PUT') {
    const user = await requireDevice(request, env);
    return await updateState(request, env, user);
  }

  throw new HttpError(404, '요청한 API를 찾을 수 없습니다.');
}

async function handleAssetRequest(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({error: '지원하지 않는 요청입니다.'}, 405);
  }

  const user = await authenticateDevice(request, env);
  if (!user) {
    const path = new URL(request.url).pathname;
    if (path === '/' || path === '/index.html' || path === '/access' || path === '/access.html') {
      const accessUrl = new URL('/access', request.url);
      return await env.ASSETS.fetch(new Request(accessUrl, request));
    }
    return new Response('인증이 필요합니다.', {
      status: 401,
      headers: {
        'content-type': 'text/plain; charset=UTF-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      }
    });
  }

  return await env.ASSETS.fetch(request);
}

async function adminSession(request, env) {
  const body = await readObject(request);
  const key = String(body.key || body.adminKey || '').trim();
  await verifyAdminKey(key, env);

  const displayName = displayNameOrDefault(body.displayName, '관리자');
  let owner = await env.DB.prepare(
    `SELECT id, display_name, role
       FROM members
      WHERE role = 'OWNER' AND revoked_at IS NULL
      LIMIT 1`
  ).first();

  if (!owner) {
    const activeMember = await env.DB.prepare(
      `SELECT id FROM members WHERE revoked_at IS NULL LIMIT 1`
    ).first();
    if (activeMember) {
      throw new HttpError(409, '저장소 상태를 확인할 수 없습니다. 관리자에게 문의해주세요.');
    }

    const now = new Date().toISOString();
    const ownerId = crypto.randomUUID();
    const initialState = JSON.stringify({
      version: 2,
      metadata: {sample: false, recurringPosted: {}}
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO members (id, display_name, role, created_at)
         VALUES (?, ?, 'OWNER', ?)`
      ).bind(ownerId, displayName, now),
      env.DB.prepare(
        `INSERT INTO household_state (id, state_json, revision, created_at, updated_at)
         VALUES (1, ?, 1, ?, ?)`
      ).bind(initialState, now, now)
    ]);
    owner = {id: ownerId, display_name: displayName, role: 'OWNER'};
  } else if (displayName !== owner.display_name) {
    await env.DB.prepare(
      `UPDATE members SET display_name = ? WHERE id = ? AND revoked_at IS NULL`
    ).bind(displayName, owner.id).run();
    owner.display_name = displayName;
  }

  const session = await createDeviceSession(env, owner.id, {withRecovery: false});
  return withCookie(json({
    authenticated: true,
    user: publicMember(owner)
  }), session.token, request);
}

async function createInvite(request, env, owner) {
  const body = await readObject(request, {allowEmpty: true});
  const inviteCode = randomInviteCode();
  const codeHash = await hashText(inviteCode);
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();

  let partner = await env.DB.prepare(
    `SELECT id, display_name, role
       FROM members
      WHERE role = 'PARTNER' AND revoked_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1`
  ).first();

  if (!partner) {
    const partnerId = crypto.randomUUID();
    const partnerName = displayNameOrDefault(body.displayName, '배우자');
    await env.DB.prepare(
      `INSERT INTO members (id, display_name, role, created_at)
       VALUES (?, ?, 'PARTNER', ?)`
    ).bind(partnerId, partnerName, createdAt).run();
    partner = {id: partnerId, display_name: partnerName, role: 'PARTNER'};
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE invites
          SET used_at = COALESCE(used_at, ?)
        WHERE member_id = ? AND used_at IS NULL AND expires_at > ?`
    ).bind(createdAt, partner.id, createdAt),
    env.DB.prepare(
      `INSERT INTO invites (id, member_id, code_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), partner.id, codeHash, expiresAt, createdAt)
  ]);

  return {
    ok: true,
    inviteCode: formatInviteCode(inviteCode),
    expiresAt,
    member: publicMember(partner),
    issuedBy: publicMember(owner)
  };
}

async function acceptInvite(request, env) {
  const body = await readObject(request);
  const inviteCode = normalizeInviteCode(body.inviteCode || body.code);
  if (inviteCode.length !== 12) {
    throw new HttpError(400, '초대코드를 확인해주세요.');
  }

  const displayName = displayNameOrDefault(body.displayName, '배우자');
  const codeHash = await hashText(inviteCode);
  const now = new Date().toISOString();
  const invite = await env.DB.prepare(
    `SELECT i.id AS invite_id, i.member_id, m.display_name, m.role
       FROM invites i
       JOIN members m ON m.id = i.member_id
      WHERE i.code_hash = ?
        AND i.used_at IS NULL
        AND i.expires_at > ?
        AND m.role = 'PARTNER'
        AND m.revoked_at IS NULL
      LIMIT 1`
  ).bind(codeHash, now).first();

  if (!invite) {
    throw new HttpError(401, '초대코드가 만료되었거나 이미 사용되었습니다.');
  }

  const session = await createDeviceSessionValues(env, invite.member_id, {withRecovery: true});
  const result = await env.DB.batch([
    env.DB.prepare(
      `UPDATE invites
          SET used_at = ?
        WHERE id = ? AND used_at IS NULL AND expires_at > ?`
    ).bind(now, invite.invite_id, now),
    env.DB.prepare(
      `UPDATE members SET display_name = ?
        WHERE id = ? AND role = 'PARTNER' AND revoked_at IS NULL`
    ).bind(displayName, invite.member_id),
    env.DB.prepare(
      `INSERT INTO device_tokens
        (id, member_id, token_hash, recovery_hash, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      session.id,
      invite.member_id,
      session.tokenHash,
      session.recoveryHash,
      now,
      now
    )
  ]);

  if (!result[0]?.meta?.changes) {
    throw new HttpError(401, '초대코드가 만료되었거나 이미 사용되었습니다.');
  }

  return withCookie(json({
    authenticated: true,
    user: {id: invite.member_id, displayName, role: 'PARTNER'},
    recoveryCode: formatRecoveryCode(session.recoveryCode),
    recoveryNotice: '이 복구코드는 지금 한 번만 표시됩니다. 안전한 곳에 복사해주세요.'
  }), session.token, request);
}

async function recoverDevice(request, env) {
  const body = await readObject(request);
  const recoveryCode = normalizeRecoveryCode(body.recoveryCode || body.code);
  if (!recoveryCode || recoveryCode.length < 24) {
    throw new HttpError(400, '복구코드를 확인해주세요.');
  }

  const recoveryHash = await hashText(recoveryCode);
  const device = await env.DB.prepare(
    `SELECT dt.id, dt.member_id, m.display_name, m.role
       FROM device_tokens dt
       JOIN members m ON m.id = dt.member_id
      WHERE dt.recovery_hash = ?
        AND dt.revoked_at IS NULL
        AND m.role = 'PARTNER'
        AND m.revoked_at IS NULL
      LIMIT 1`
  ).bind(recoveryHash).first();

  if (!device) {
    throw new HttpError(401, '복구코드가 올바르지 않거나 이미 사용되었습니다.');
  }

  const session = await createDeviceSessionValues(env, device.member_id, {withRecovery: true});
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE device_tokens
        SET token_hash = ?, recovery_hash = ?, last_seen_at = ?, revoked_at = NULL
      WHERE id = ? AND recovery_hash = ? AND revoked_at IS NULL`
  ).bind(
    session.tokenHash,
    session.recoveryHash,
    now,
    device.id,
    recoveryHash
  ).run();

  if (!result.meta?.changes) {
    throw new HttpError(401, '복구코드가 올바르지 않거나 이미 사용되었습니다.');
  }

  return withCookie(json({
    authenticated: true,
    user: {id: device.member_id, displayName: device.display_name, role: device.role},
    recoveryCode: formatRecoveryCode(session.recoveryCode),
    recoveryNotice: '새 복구코드가 발급되었습니다. 이전 복구코드는 폐기되었습니다.'
  }), session.token, request);
}

async function logout(request, env) {
  const token = getCookie(request, DEVICE_COOKIE);
  if (token) {
    const tokenHash = await hashText(token);
    await env.DB.prepare(
      `UPDATE device_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`
    ).bind(new Date().toISOString(), tokenHash).run();
  }
  return withCookie(json({ok: true}), null, request);
}

async function getState(env, user) {
  const row = await env.DB.prepare(
    `SELECT state_json, revision, updated_at FROM household_state WHERE id = 1`
  ).first();
  if (!row) {
    throw new HttpError(503, '가계부 저장소가 아직 준비되지 않았습니다.');
  }

  let state;
  try {
    state = JSON.parse(row.state_json);
  } catch (_) {
    console.error('household-ledger invalid state JSON', {memberId: user.id});
    throw new HttpError(500, '가계부 데이터를 읽을 수 없습니다.');
  }
  return json({state, revision: Number(row.revision) || 1, updatedAt: row.updated_at});
}

async function updateState(request, env, user) {
  const body = await readObject(request);
  const baseRevision = Number(body.baseRevision);
  if (!Number.isInteger(baseRevision) || baseRevision < 1) {
    throw new HttpError(400, '저장 버전이 올바르지 않습니다.');
  }
  if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
    throw new HttpError(400, '가계부 데이터 형식이 올바르지 않습니다.');
  }

  const stateJson = JSON.stringify(body.state);
  if (new TextEncoder().encode(stateJson).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, '가계부 데이터가 너무 큽니다.');
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE household_state
        SET state_json = ?, revision = revision + 1, updated_at = ?
      WHERE id = 1 AND revision = ?`
  ).bind(stateJson, now, baseRevision).run();

  if (!result.meta?.changes) {
    const latest = await env.DB.prepare(
      `SELECT state_json, revision, updated_at FROM household_state WHERE id = 1`
    ).first();
    let latestState = null;
    try { latestState = latest ? JSON.parse(latest.state_json) : null; } catch (_) {}
    return json({
      error: '다른 기기에서 먼저 변경했습니다.',
      state: latestState,
      revision: Number(latest?.revision) || 1,
      updatedAt: latest?.updated_at || null
    }, 409);
  }

  return json({ok: true, revision: baseRevision + 1, updatedAt: now, savedBy: user.id});
}

async function requireDevice(request, env) {
  const user = await authenticateDevice(request, env);
  if (!user) throw new HttpError(401, '인증이 필요합니다.');
  return user;
}

async function requireOwner(request, env) {
  const user = await requireDevice(request, env);
  if (user.role !== 'OWNER') throw new HttpError(403, '관리자만 사용할 수 있습니다.');
  return user;
}

async function authenticateDevice(request, env) {
  const rawToken = getCookie(request, DEVICE_COOKIE);
  if (!rawToken) return null;

  const tokenHash = await hashText(rawToken);
  const user = await env.DB.prepare(
    `SELECT dt.id AS token_id, dt.member_id, dt.last_seen_at,
            m.display_name, m.role
       FROM device_tokens dt
       JOIN members m ON m.id = dt.member_id
      WHERE dt.token_hash = ?
        AND dt.revoked_at IS NULL
        AND m.revoked_at IS NULL
      LIMIT 1`
  ).bind(tokenHash).first();
  if (!user) return null;

  const lastSeen = Date.parse(user.last_seen_at || '');
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 5 * 60 * 1000) {
    await env.DB.prepare(
      `UPDATE device_tokens SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL`
    ).bind(new Date().toISOString(), user.token_id).run();
  }
  return user;
}

async function hasActiveOwner(env) {
  const row = await env.DB.prepare(
    `SELECT 1 AS present FROM members
      WHERE role = 'OWNER' AND revoked_at IS NULL LIMIT 1`
  ).first();
  return Boolean(row);
}

async function createDeviceSession(env, memberId, options) {
  const session = await createDeviceSessionValues(env, memberId, options);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO device_tokens
      (id, member_id, token_hash, recovery_hash, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    session.id,
    memberId,
    session.tokenHash,
    session.recoveryHash,
    now,
    now
  ).run();
  return session;
}

async function createDeviceSessionValues(env, memberId, {withRecovery}) {
  const token = randomToken(32);
  const recoveryCode = withRecovery ? randomRecoveryCode() : null;
  return {
    id: crypto.randomUUID(),
    token,
    tokenHash: await hashText(token),
    recoveryCode,
    recoveryHash: recoveryCode ? await hashText(recoveryCode) : null
  };
}

async function verifyAdminKey(provided, env) {
  const expected = String(env[ADMIN_KEY] || '');
  if (!expected) throw new HttpError(500, '관리자 인증 KEY가 Worker Secret에 설정되지 않았습니다.');

  const [providedHash, expectedHash] = await Promise.all([
    hashText(provided),
    hashText(expected)
  ]);
  const encoder = new TextEncoder();
  if (!crypto.subtle.timingSafeEqual(encoder.encode(providedHash), encoder.encode(expectedHash))) {
    throw new HttpError(401, '관리자 인증 KEY가 올바르지 않습니다.');
  }
}

async function readJson(request, {allowEmpty = false} = {}) {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new HttpError(413, '요청 데이터가 너무 큽니다.');
  }

  const reader = request.body?.getReader();
  if (!reader) {
    if (allowEmpty) return {};
    throw new HttpError(400, '요청 데이터가 필요합니다.');
  }

  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, '요청 데이터가 너무 큽니다.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (!total && allowEmpty) return {};
  if (!total) throw new HttpError(400, '요청 데이터가 필요합니다.');

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (_) {
    throw new HttpError(400, 'JSON 형식이 올바르지 않습니다.');
  }
}

async function readObject(request, options) {
  const body = await readJson(request, options);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, '요청 데이터 형식이 올바르지 않습니다.');
  }
  return body;
}

function assertSameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) {
    throw new HttpError(403, '허용되지 않은 출처의 요청입니다.');
  }
}

function publicMember(member) {
  return {
    id: member.id || member.member_id,
    displayName: member.display_name,
    role: member.role
  };
}

function displayNameOrDefault(value, fallback) {
  const name = String(value || '').trim();
  if (!name) return fallback;
  if (name.length > 40) throw new HttpError(400, '이름은 40자 이내로 입력해주세요.');
  return name;
}

function normalizeInviteCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeRecoveryCode(value) {
  return String(value || '').replace(/[\s-]/g, '');
}

function formatInviteCode(value) {
  return value.match(/.{1,4}/g).join('-');
}

function formatRecoveryCode(value) {
  return value.match(/.{1,8}/g).join('-');
}

function randomInviteCode() {
  return randomString(12, CODE_ALPHABET);
}

function randomRecoveryCode() {
  return randomString(32, RECOVERY_ALPHABET);
}

function randomToken(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function randomString(length, alphabet) {
  const result = [];
  const limit = 256 - (256 % alphabet.length);
  while (result.length < length) {
    const bytes = new Uint8Array(Math.max(32, length * 2));
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      result.push(alphabet[byte % alphabet.length]);
      if (result.length === length) break;
    }
  }
  return result.join('');
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hashText(value) {
  return hashBytes(new TextEncoder().encode(value));
}

async function hashBytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get('cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer'
    }
  });
}

function withCookie(response, token, request) {
  const headers = new Headers(response.headers);
  const secure = request && new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  if (token) {
    headers.append(
      'Set-Cookie',
      `${DEVICE_COOKIE}=${encodeURIComponent(token)}; Max-Age=${SESSION_MAX_AGE}; Path=/; HttpOnly; SameSite=Strict${secure}`
    );
  } else if (request) {
    headers.append(
      'Set-Cookie',
      `${DEVICE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure}`
    );
  }
  return new Response(response.body, {status: response.status, headers});
}

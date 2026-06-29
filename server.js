import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { createServer } from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || `http://localhost:${PORT}`;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const publicDir = join(process.cwd(), 'public');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

export async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, PUBLIC_SITE_URL);

    if (isBackendRoute(url.pathname)) {
      const missing = missingEnvVars();
      if (missing.length) {
        return sendJson(res, 500, {
          error: 'Variaveis de ambiente ausentes na Vercel.',
          missing
        });
      }
    }

    if (req.method === 'GET' && url.pathname === '/auth/discord') {
      return startDiscordLogin(req, res);
    }

    if (req.method === 'GET' && url.pathname === '/auth/discord/callback') {
      return finishDiscordLogin(req, res, url);
    }

    if (req.method === 'POST' && url.pathname === '/api/logout') {
      return logout(req, res);
    }

    if (req.method === 'GET' && url.pathname === '/api/me') {
      return apiMe(req, res);
    }

    if (req.method === 'GET' && url.pathname === '/api/giveaway') {
      return apiGiveaway(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/api/join') {
      return apiJoin(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/draw') {
      return apiDraw(req, res);
    }

    if (req.method === 'GET') {
      return serveStatic(req, res, url.pathname);
    }

    return sendJson(res, 405, { error: 'Metodo nao permitido.' });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: 'Erro interno no servidor.' });
  }
}

if (!process.env.VERCEL) {
  createServer(handleRequest).listen(PORT, () => {
    console.log(`Sorteio PIX rodando em http://localhost:${PORT}`);
  });
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente ausente: ${name}`);
  }
  return value;
}

function isBackendRoute(pathname) {
  return pathname.startsWith('/api/') || pathname.startsWith('/auth/');
}

function missingEnvVars() {
  return [
    'PUBLIC_SITE_URL',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'DISCORD_REDIRECT_URI',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SESSION_SECRET',
    'ADMIN_TOKEN'
  ].filter((name) => !process.env[name]);
}

function startDiscordLogin(req, res) {
  const state = randomBytes(24).toString('hex');
  const signedState = signJson({ state, expiresAt: Date.now() + 10 * 60 * 1000 });

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state
  });

  setCookie(res, 'oauth_state', signedState, { maxAge: 600, httpOnly: true, sameSite: 'Lax' });
  redirect(res, `https://discord.com/oauth2/authorize?${params}`);
}

async function finishDiscordLogin(req, res, url) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(req);
  const storedState = verifyJson(cookies.oauth_state);

  if (!code || !state || !storedState || storedState.state !== state || storedState.expiresAt < Date.now()) {
    return redirect(res, '/?erro=discord_state');
  }

  clearCookie(res, 'oauth_state');

  const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: DISCORD_REDIRECT_URI
    })
  });

  if (!tokenResponse.ok) {
    console.error(await tokenResponse.text());
    return redirect(res, '/?erro=discord_token');
  }

  const token = await tokenResponse.json();
  const discordResponse = await fetch('https://discord.com/api/users/@me', {
    headers: { authorization: `${token.token_type} ${token.access_token}` }
  });

  if (!discordResponse.ok) {
    console.error(await discordResponse.text());
    return redirect(res, '/?erro=discord_user');
  }

  const discordUser = await discordResponse.json();
  const appUser = await upsertUser(discordUser);
  const signedSession = signJson({
    userId: appUser.id,
    discordId: discordUser.id,
    username: discordUser.username,
    globalName: discordUser.global_name,
    avatar: discordUser.avatar,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
  });

  setCookie(res, 'session', signedSession, { maxAge: 7 * 24 * 60 * 60, httpOnly: true, sameSite: 'Lax' });
  redirect(res, '/');
}

async function logout(req, res) {
  clearCookie(res, 'session');
  sendJson(res, 200, { ok: true });
}

async function apiMe(req, res) {
  const session = getSession(req);
  if (!session) return sendJson(res, 401, { user: null });
  sendJson(res, 200, { user: publicUser(session) });
}

async function apiGiveaway(req, res) {
  const giveaway = await getOpenOrLatestGiveaway();
  if (!giveaway) return sendJson(res, 404, { error: 'Nenhum sorteio cadastrado.' });

  const participantCount = await countParticipants(giveaway.id);
  const session = getSession(req);
  const myEntry = session ? await getParticipant(giveaway.id, session.discordId) : null;
  const winner = giveaway.winner_participant_id ? await getParticipantById(giveaway.winner_participant_id) : null;

  sendJson(res, 200, {
    giveaway: {
      id: giveaway.id,
      title: giveaway.title,
      pixPrize: giveaway.pix_prize,
      status: giveaway.status,
      participantCount,
      joined: Boolean(myEntry),
      winner: winner ? { username: winner.username, discordId: winner.discord_id } : null
    }
  });
}

async function apiJoin(req, res) {
  const session = getSession(req);
  if (!session) return sendJson(res, 401, { error: 'Faca login com Discord antes de participar.' });

  const body = await readJson(req);
  const deviceHash = cleanToken(body.deviceHash);
  const browserId = cleanToken(body.browserId);

  if (!deviceHash || !browserId) {
    return sendJson(res, 400, { error: 'Identificacao do dispositivo ausente.' });
  }

  const giveaway = await getOpenOrLatestGiveaway();
  if (!giveaway || giveaway.status !== 'open') {
    return sendJson(res, 400, { error: 'Nao existe sorteio aberto agora.' });
  }

  const ipHash = hashIp(req);
  const payload = {
    giveaway_id: giveaway.id,
    user_id: session.userId,
    discord_id: session.discordId,
    username: session.globalName || session.username,
    device_hash: deviceHash,
    browser_id: browserId,
    ip_hash: ipHash,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 500)
  };

  const result = await supabase('/rest/v1/giveaway_participants', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });

  if (result.status === 409) {
    return sendJson(res, 409, {
      error: 'Essa conta, navegador ou dispositivo ja esta inscrito neste sorteio.'
    });
  }

  if (!result.ok) {
    console.error(result.text);
    return sendJson(res, 500, { error: 'Nao foi possivel confirmar sua inscricao.' });
  }

  await supabase(`/rest/v1/app_users?id=eq.${encodeURIComponent(session.userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ first_device_hash: deviceHash, first_browser_id: browserId, updated_at: new Date().toISOString() })
  });

  sendJson(res, 201, { ok: true, participant: result.json[0] });
}

async function apiDraw(req, res) {
  const auth = String(req.headers.authorization || '');
  if (auth !== `Bearer ${ADMIN_TOKEN}`) {
    return sendJson(res, 403, { error: 'Token admin invalido.' });
  }

  const giveaway = await getOpenOrLatestGiveaway();
  if (!giveaway) return sendJson(res, 404, { error: 'Nenhum sorteio cadastrado.' });

  const participants = await listParticipants(giveaway.id);
  if (!participants.length) {
    return sendJson(res, 400, { error: 'Nao ha participantes para sortear.' });
  }

  const winner = participants[Math.floor(Math.random() * participants.length)];
  const update = await supabase(`/rest/v1/giveaways?id=eq.${encodeURIComponent(giveaway.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'drawn',
      winner_participant_id: winner.id,
      drawn_at: new Date().toISOString()
    })
  });

  if (!update.ok) {
    console.error(update.text);
    return sendJson(res, 500, { error: 'Falha ao salvar o ganhador.' });
  }

  sendJson(res, 200, {
    winner: {
      username: winner.username,
      discordId: winner.discord_id,
      participantId: winner.id
    }
  });
}

async function upsertUser(discordUser) {
  const username = discordUser.username || 'discord-user';
  const payload = {
    discord_id: discordUser.id,
    username,
    global_name: discordUser.global_name,
    avatar: discordUser.avatar,
    updated_at: new Date().toISOString()
  };

  const result = await supabase('/rest/v1/app_users?on_conflict=discord_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload)
  });

  if (!result.ok) throw new Error(result.text);
  return result.json[0];
}

async function getOpenOrLatestGiveaway() {
  const open = await supabase('/rest/v1/giveaways?select=*&status=eq.open&order=created_at.desc&limit=1');
  if (!open.ok) throw new Error(open.text);
  if (open.json[0]) return open.json[0];

  const latest = await supabase('/rest/v1/giveaways?select=*&order=created_at.desc&limit=1');
  if (!latest.ok) throw new Error(latest.text);
  return latest.json[0] || null;
}

async function countParticipants(giveawayId) {
  const result = await supabase(`/rest/v1/giveaway_participants?giveaway_id=eq.${encodeURIComponent(giveawayId)}&select=id`, {
    headers: { Prefer: 'count=exact' }
  });
  if (!result.ok) throw new Error(result.text);
  return Number(result.headers.get('content-range')?.split('/')[1] || 0);
}

async function getParticipant(giveawayId, discordId) {
  const result = await supabase(`/rest/v1/giveaway_participants?giveaway_id=eq.${encodeURIComponent(giveawayId)}&discord_id=eq.${encodeURIComponent(discordId)}&limit=1`);
  if (!result.ok) throw new Error(result.text);
  return result.json[0] || null;
}

async function getParticipantById(id) {
  const result = await supabase(`/rest/v1/giveaway_participants?id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!result.ok) throw new Error(result.text);
  return result.json[0] || null;
}

async function listParticipants(giveawayId) {
  const result = await supabase(`/rest/v1/giveaway_participants?giveaway_id=eq.${encodeURIComponent(giveawayId)}&select=*&order=created_at.asc`);
  if (!result.ok) throw new Error(result.text);
  return result.json;
}

async function supabase(path, options = {}) {
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...(options.headers || {})
  };

  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { ok: response.ok, status: response.status, headers: response.headers, json, text };
}

function getSession(req) {
  const cookies = parseCookies(req);
  const signed = cookies.session;
  if (!signed) return null;

  const session = verifyJson(signed);
  if (!session || session.expiresAt < Date.now()) return null;
  return session;
}

function publicUser(session) {
  return {
    discordId: session.discordId,
    username: session.username,
    globalName: session.globalName,
    avatar: session.avatar
  };
}

function sign(value) {
  const mac = createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${mac}`;
}

function verify(signed) {
  const [value, mac] = String(signed).split('.');
  if (!value || !mac) return null;

  const expected = createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return value;
}

function signJson(payload) {
  return sign(Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'));
}

function verifyJson(signed) {
  const value = verify(signed);
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function hashIp(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  return createHmac('sha256', SESSION_SECRET).update(ip).digest('hex');
}

function cleanToken(value) {
  const token = String(value || '').trim();
  return /^[a-f0-9]{32,128}$/i.test(token) ? token : '';
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  return Object.fromEntries(
    header.split(';').filter(Boolean).map((part) => {
      const index = part.indexOf('=');
      const key = decodeURIComponent(part.slice(0, index).trim());
      const value = decodeURIComponent(part.slice(index + 1).trim());
      return [key, value];
    })
  );
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`, 'Path=/'];
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (PUBLIC_SITE_URL.startsWith('https://')) parts.push('Secure');
  res.setHeader('Set-Cookie', appendHeader(res.getHeader('Set-Cookie'), parts.join('; ')));
}

function clearCookie(res, name) {
  res.setHeader('Set-Cookie', appendHeader(res.getHeader('Set-Cookie'), `${name}=; Path=/; Max-Age=0; SameSite=Lax`));
}

function appendHeader(existing, next) {
  if (!existing) return next;
  return Array.isArray(existing) ? [...existing, next] : [existing, next];
}

function sendJson(res, status, payload) {
  res.writeHead(status, securityHeaders({ 'content-type': 'application/json; charset=utf-8' }));
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.writeHead(302, securityHeaders({ location }));
  res.end();
}

function serveStatic(req, res, pathname) {
  const filePath = normalize(join(publicDir, pathname === '/' ? 'index.html' : pathname));
  const insidePublicDir = filePath === publicDir || filePath.startsWith(`${publicDir}${sep}`);
  if (!insidePublicDir || !existsSync(filePath)) {
    res.writeHead(404, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
    return res.end('Arquivo nao encontrado.');
  }

  const ext = extname(filePath);
  res.writeHead(200, securityHeaders({ 'content-type': mimeTypes[ext] || 'application/octet-stream' }));
  createReadStream(filePath).pipe(res);
}

function securityHeaders(headers = {}) {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...headers
  };
}

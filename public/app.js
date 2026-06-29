const state = {
  user: null,
  giveaway: null
};

const els = {
  avatar: document.querySelector('#avatar'),
  userName: document.querySelector('#user-name'),
  participantCount: document.querySelector('#participant-count'),
  giveawayStatus: document.querySelector('#giveaway-status'),
  giveawayTitle: document.querySelector('#giveaway-title'),
  giveawayPrize: document.querySelector('#giveaway-prize'),
  notice: document.querySelector('#notice'),
  loginButton: document.querySelector('#login-button'),
  joinButton: document.querySelector('#join-button'),
  logoutButton: document.querySelector('#logout-button'),
  adminToken: document.querySelector('#admin-token'),
  drawButton: document.querySelector('#draw-button'),
  adminResult: document.querySelector('#admin-result')
};

boot();

els.joinButton.addEventListener('click', joinGiveaway);
els.logoutButton.addEventListener('click', logout);
els.drawButton.addEventListener('click', drawWinner);

async function boot() {
  ensureBrowserId();
  await Promise.allSettled([loadMe(), loadGiveaway()]);
  render();
}

async function loadMe() {
  try {
    const response = await fetch('/api/me');
    if (!response.ok) return;
    const data = await response.json();
    state.user = data.user;
  } catch {
    state.user = null;
  }
}

async function loadGiveaway() {
  try {
    const response = await fetch('/api/giveaway');
    const data = await response.json();
    if (!response.ok) {
      showNotice(data.error || 'Nao foi possivel carregar o sorteio.', 'error');
      return;
    }
    state.giveaway = data.giveaway;
  } catch {
    showNotice('Site aberto. A API ainda nao respondeu; confira as variaveis e o banco depois.', 'error');
  }
}

async function joinGiveaway() {
  setBusy(els.joinButton, true);
  showNotice('Confirmando sua participacao...');

  const response = await fetch('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      browserId: ensureBrowserId(),
      deviceHash: await makeDeviceHash()
    })
  });

  const data = await response.json();
  if (!response.ok) {
    showNotice(data.error || 'Nao foi possivel participar.', 'error');
    setBusy(els.joinButton, false);
    return;
  }

  localStorage.setItem('sorteio_pix_joined', state.giveaway.id);
  showNotice('Participacao confirmada. Boa sorte!', 'success');
  await loadGiveaway();
  render();
  setBusy(els.joinButton, false);
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  state.user = null;
  render();
}

async function drawWinner() {
  const token = els.adminToken.value.trim();
  if (!token) {
    setAdminResult('Informe o token admin.', 'error');
    return;
  }

  setBusy(els.drawButton, true);
  const response = await fetch('/api/admin/draw', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` }
  });

  const data = await response.json();
  if (!response.ok) {
    setAdminResult(data.error || 'Falha ao sortear.', 'error');
  } else {
    setAdminResult(`Ganhador: ${data.winner.username} (${data.winner.discordId})`, 'success');
    await loadGiveaway();
    render();
  }
  setBusy(els.drawButton, false);
}

function render() {
  renderUser();
  renderGiveaway();

  const logged = Boolean(state.user);
  els.loginButton.hidden = logged;
  els.logoutButton.hidden = !logged;
  els.joinButton.hidden = !logged || !state.giveaway || state.giveaway.joined || state.giveaway.status !== 'open';
}

function renderUser() {
  if (!state.user) {
    els.avatar.textContent = '?';
    els.userName.textContent = 'Nao conectado';
    return;
  }

  const displayName = state.user.globalName || state.user.username;
  els.userName.textContent = displayName;

  if (state.user.avatar) {
    els.avatar.innerHTML = '';
    const img = document.createElement('img');
    img.alt = displayName;
    img.src = `https://cdn.discordapp.com/avatars/${state.user.discordId}/${state.user.avatar}.png?size=128`;
    els.avatar.appendChild(img);
  } else {
    els.avatar.textContent = displayName.slice(0, 1).toUpperCase();
  }
}

function renderGiveaway() {
  if (!state.giveaway) return;

  els.giveawayTitle.textContent = state.giveaway.title;
  els.giveawayPrize.textContent = state.giveaway.pixPrize;
  els.participantCount.textContent = String(state.giveaway.participantCount);
  els.giveawayStatus.textContent = statusLabel(state.giveaway.status);

  if (state.giveaway.winner) {
    showNotice(`Sorteio encerrado. Ganhador: ${state.giveaway.winner.username}.`, 'success');
    return;
  }

  if (!state.user) {
    showNotice('Faca login com Discord para liberar a inscricao.');
    return;
  }

  if (state.giveaway.joined || localStorage.getItem('sorteio_pix_joined') === state.giveaway.id) {
    showNotice('Voce ja esta participando deste sorteio.', 'success');
    return;
  }

  showNotice('Conta validada. Clique em Participar para entrar no sorteio.');
}

function statusLabel(status) {
  return {
    open: 'Aberto',
    closed: 'Fechado',
    drawn: 'Sorteado'
  }[status] || status;
}

function showNotice(message, type = '') {
  els.notice.textContent = message;
  els.notice.className = `notice ${type}`.trim();
}

function setAdminResult(message, type = '') {
  els.adminResult.textContent = message;
  els.adminResult.className = `notice ${type}`.trim();
}

function setBusy(button, busy) {
  button.disabled = busy;
}

function ensureBrowserId() {
  const key = 'sorteio_pix_browser_id';
  let browserId = localStorage.getItem(key);
  if (!browserId) {
    browserId = crypto.randomUUID().replaceAll('-', '');
    localStorage.setItem(key, browserId);
  }
  return browserId;
}

async function makeDeviceHash() {
  const parts = [
    navigator.userAgent,
    navigator.language,
    navigator.platform,
    screen.width,
    screen.height,
    screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency || '',
    navigator.deviceMemory || '',
    await canvasFingerprint()
  ];

  const bytes = new TextEncoder().encode(parts.join('|'));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function canvasFingerprint() {
  const canvas = document.createElement('canvas');
  canvas.width = 220;
  canvas.height = 40;
  const context = canvas.getContext('2d');
  context.textBaseline = 'top';
  context.font = '16px Arial';
  context.fillStyle = '#26d07c';
  context.fillRect(0, 0, 220, 40);
  context.fillStyle = '#101216';
  context.fillText('Sorteio PIX Discord', 8, 10);
  return canvas.toDataURL();
}

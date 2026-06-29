const els = {
  status: document.querySelector('#admin-status'),
  title: document.querySelector('#admin-giveaway-title'),
  prize: document.querySelector('#admin-giveaway-prize'),
  participantCount: document.querySelector('#admin-participant-count'),
  giveawayStatus: document.querySelector('#admin-giveaway-status'),
  result: document.querySelector('#admin-result'),
  drawButton: document.querySelector('#draw-button'),
  dialog: document.querySelector('#draw-dialog'),
  token: document.querySelector('#admin-token'),
  confirmButton: document.querySelector('#confirm-draw-button'),
  participantToken: document.querySelector('#participant-token'),
  loadParticipantsButton: document.querySelector('#load-participants-button'),
  participantListStatus: document.querySelector('#participant-list-status'),
  participantList: document.querySelector('#participant-list')
};

let giveaway = null;

boot();

els.drawButton.addEventListener('click', () => {
  els.token.value = '';
  els.dialog.showModal();
  els.token.focus();
});

els.dialog.addEventListener('close', () => {
  if (els.dialog.returnValue === 'confirm') drawWinner();
});

els.loadParticipantsButton.addEventListener('click', loadParticipants);

async function boot() {
  await loadGiveaway();
  render();
}

async function loadGiveaway() {
  try {
    const response = await fetch('/api/giveaway');
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || 'Nao foi possivel carregar o sorteio.', 'error');
      return;
    }
    giveaway = data.giveaway;
  } catch {
    setStatus('A API ainda nao respondeu. Confira as variaveis e o banco.', 'error');
  }
}

async function drawWinner() {
  const token = els.token.value.trim();
  if (!token) {
    setResult('Senha do sorteio obrigatoria.', 'error');
    return;
  }

  setBusy(true);
  setResult('Sorteando ganhador...');

  const response = await fetch('/api/admin/draw', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` }
  });

  const data = await response.json();
  if (!response.ok) {
    setResult(data.error || 'Falha ao sortear.', 'error');
  } else {
    setResult(`Ganhador: ${data.winner.username} (${data.winner.discordId})`, 'success');
    await loadGiveaway();
    render();
  }
  setBusy(false);
}

async function loadParticipants() {
  const token = els.participantToken.value.trim();
  if (!token) {
    setParticipantStatus('Informe a senha admin para ver os participantes.', 'error');
    return;
  }

  els.loadParticipantsButton.disabled = true;
  setParticipantStatus('Carregando participantes...');
  els.participantList.innerHTML = '';

  try {
    const response = await fetch('/api/admin/participants', {
      headers: { authorization: `Bearer ${token}` }
    });
    const data = await response.json();

    if (!response.ok) {
      setParticipantStatus(data.error || 'Nao foi possivel carregar participantes.', 'error');
      return;
    }

    renderParticipants(data.participants);
    setParticipantStatus(`${data.participants.length} participante(s) carregado(s).`, 'success');
  } catch {
    setParticipantStatus('A API nao respondeu ao carregar participantes.', 'error');
  } finally {
    els.loadParticipantsButton.disabled = false;
  }
}

function render() {
  if (!giveaway) return;
  els.title.textContent = giveaway.title;
  els.prize.textContent = giveaway.pixPrize;
  els.participantCount.textContent = String(giveaway.participantCount);
  els.giveawayStatus.textContent = statusLabel(giveaway.status);
  setStatus(giveaway.winner ? `Ganhador atual: ${giveaway.winner.username}.` : 'Sorteio carregado e pronto.');
}

function statusLabel(status) {
  return {
    open: 'Aberto',
    closed: 'Fechado',
    drawn: 'Sorteado'
  }[status] || status;
}

function setStatus(message, type = '') {
  els.status.textContent = message;
  els.status.className = `notice ${type}`.trim();
}

function setResult(message, type = '') {
  els.result.textContent = message;
  els.result.className = `notice ${type}`.trim();
}

function setParticipantStatus(message, type = '') {
  els.participantListStatus.textContent = message;
  els.participantListStatus.className = `notice ${type}`.trim();
}

function renderParticipants(participants) {
  if (!participants.length) {
    els.participantList.innerHTML = '<p class="empty-list">Ainda nao tem participantes.</p>';
    return;
  }

  els.participantList.replaceChildren(
    ...participants.map((participant, index) => {
      const item = document.createElement('article');
      item.className = 'participant-item';

      const name = document.createElement('strong');
      name.textContent = `${index + 1}. ${participant.username}`;

      const meta = document.createElement('span');
      meta.textContent = `${participant.discordId} - ${formatDate(participant.joinedAt)}`;

      item.append(name, meta);
      return item;
    })
  );
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function setBusy(busy) {
  els.drawButton.disabled = busy;
  els.confirmButton.disabled = busy;
}

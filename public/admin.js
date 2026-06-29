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
  confirmButton: document.querySelector('#confirm-draw-button')
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

function setBusy(busy) {
  els.drawButton.disabled = busy;
  els.confirmButton.disabled = busy;
}

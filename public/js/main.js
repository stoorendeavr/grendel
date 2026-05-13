// Entry point: wires net, input, renderer, HUD; switches between home/lobby/game.

import { Net } from './net.js?v=__BUILD__';
import { Input } from './input.js?v=__BUILD__';
import { Renderer } from './render.js?v=__BUILD__';
import { HUD } from './hud.js?v=__BUILD__';
import { Atmosphere } from './atmosphere.js?v=__BUILD__';
import { ROUND, ROLE } from '/shared/constants.js?v=__BUILD__';

const screens = {
  home:  document.getElementById('screen-home'),
  lobby: document.getElementById('screen-lobby'),
  game:  document.getElementById('screen-game'),
};

const atmoCanvas = document.getElementById('atmosphere');
const atmosphere = new Atmosphere(atmoCanvas);

function showScreen(name) {
  for (const k of Object.keys(screens)) screens[k].classList.toggle('active', k === name);
  if (name === 'game') {
    atmosphere.stop();
    atmoCanvas.style.display = 'none';
    // Defensively re-measure the canvas — if the game container was hidden
    // when the renderer first constructed (e.g. some embedded contexts return
    // 0×0 for hidden parents), our scale was 0 and nothing would draw.
    if (renderer && typeof renderer._resize === 'function') {
      requestAnimationFrame(() => renderer._resize());
    }
  } else {
    atmoCanvas.style.display = 'block';
    atmosphere.start();
  }
}
atmosphere.start();

// --- DOM refs ---
const inputName     = document.getElementById('input-name');
const inputCode     = document.getElementById('input-code');
const btnCreate     = document.getElementById('btn-create');
const btnJoin       = document.getElementById('btn-join');
const btnDemo       = document.getElementById('btn-demo');
const homeError     = document.getElementById('home-error');
const lobbyCodeBtn  = document.getElementById('lobby-code');
const lobbyCodeText = document.getElementById('lobby-code-text');
const lobbyCopied   = document.getElementById('lobby-copied');
const lobbyPlayers  = document.getElementById('lobby-players');
const lobbyHint     = document.getElementById('lobby-hint');
const btnStart      = document.getElementById('btn-start');
const btnLeaveLobby = document.getElementById('btn-leave-lobby');
const btnRestart    = document.getElementById('btn-restart');

inputName.value = localStorage.getItem('grendel.name') || '';

const net = new Net();
const canvas = document.getElementById('canvas');
const input = new Input(canvas);
const renderer = new Renderer(canvas, net);
const hud = new HUD();

let phase = 'home';

function setError(msg) {
  if (!msg) { homeError.hidden = true; homeError.textContent = ''; return; }
  homeError.hidden = false; homeError.textContent = msg;
}

function friendly(err) {
  switch (err) {
    case 'no_room':           return 'No hall stands at that name.';
    case 'room_full':         return 'The hall is full of warriors.';
    case 'room_closed':       return 'The hall is closed.';
    case 'already_in_room':   return 'You sit at a bench already.';
    case 'need_more_players': return 'Hrothgar needs at least one thane.';
    case 'not_host':          return 'Only Grendel may begin the night.';
    default:                  return err || 'Wyrd has gone awry.';
  }
}

btnCreate.addEventListener('click', async () => {
  setError(null);
  const name = inputName.value.trim();
  localStorage.setItem('grendel.name', name);
  btnCreate.disabled = true;
  const r = await net.create(name);
  btnCreate.disabled = false;
  if (r.error) return setError(friendly(r.error));
  enterLobby();
});

btnDemo.addEventListener('click', async () => {
  setError(null);
  const name = inputName.value.trim() || 'Wanderer';
  localStorage.setItem('grendel.name', name);
  btnDemo.disabled = true;
  const r = await net.demo(name);
  btnDemo.disabled = false;
  if (r.error) return setError(friendly(r.error));
  hud.setRoomCode(net.code);
  hud.setDemo(true);
  phase = 'game';
  showScreen('game');
});

btnJoin.addEventListener('click', async () => {
  setError(null);
  const code = inputCode.value.trim().toUpperCase();
  if (code.length < 4) return setError('Speak the room\'s name.');
  const name = inputName.value.trim();
  localStorage.setItem('grendel.name', name);
  btnJoin.disabled = true;
  const r = await net.join(code, name);
  btnJoin.disabled = false;
  if (r.error) return setError(friendly(r.error));
  enterLobby();
});

inputCode.addEventListener('input', () => {
  inputCode.value = inputCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
});
inputCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnJoin.click(); });
inputName.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnCreate.click(); });

btnStart.addEventListener('click', async () => {
  const r = await net.start();
  if (r.error) lobbyHint.textContent = friendly(r.error);
});

btnLeaveLobby.addEventListener('click', () => { window.location.reload(); });

btnRestart.addEventListener('click', async () => {
  const r = await net.restart();
  if (r.error) console.warn(r.error);
});

lobbyCodeBtn.addEventListener('click', async () => {
  const code = net.code;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    lobbyCopied.textContent = 'Copied — share with the hall.';
    lobbyCopied.hidden = false;
    setTimeout(() => { lobbyCopied.hidden = true; }, 1800);
  } catch {}
});

(function prefillCode() {
  const params = new URLSearchParams(window.location.search);
  const c = params.get('code');
  if (c) inputCode.value = c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
})();

function enterLobby() {
  phase = 'lobby';
  showScreen('lobby');
  lobbyCodeText.textContent = net.code || '—';
  hud.setRoomCode(net.code);
}

net.on('lobby', (lobby) => {
  lobbyCodeText.textContent = lobby.code;
  lobbyPlayers.innerHTML = '';
  const thanes = lobby.players.filter(p => p.role !== ROLE.GRENDEL).length;
  for (const p of lobby.players) {
    const li = document.createElement('li');
    const avatar = document.createElement('div');
    avatar.className = `avatar ${p.role}`;
    const name = document.createElement('div');
    name.className = 'name' + (p.id === net.youId ? ' you' : '');
    name.textContent = p.name;
    li.appendChild(avatar);
    li.appendChild(name);
    if (p.bot) {
      const tag = document.createElement('span');
      tag.className = 'bot-tag';
      tag.textContent = 'BOT';
      li.appendChild(tag);
    }
    if (p.shaper) {
      const tag = document.createElement('span');
      tag.className = 'shaper-tag';
      tag.textContent = '♪ SHAPER';
      li.appendChild(tag);
    }
    if (p.id === lobby.hostId) {
      const tag = document.createElement('span');
      tag.className = 'host-tag';
      tag.textContent = 'GRENDEL';
      li.appendChild(tag);
    }
    const role = document.createElement('div');
    role.className = `role ${p.role}`;
    role.textContent = p.role === ROLE.GRENDEL ? 'the beast' : 'thane';
    li.appendChild(role);
    lobbyPlayers.appendChild(li);
  }
  const isHost = net.youId === lobby.hostId;
  const ready = thanes >= (ROUND.minPlayers - 1);
  btnStart.disabled = !(isHost && ready);
  if (!isHost) lobbyHint.textContent = 'Grendel will begin when he is ready…';
  else if (!ready) lobbyHint.textContent = 'Waiting for a thane to take a bench…';
  else lobbyHint.textContent = 'The benches are full. Begin the night.';

  if (lobby.phase === 'playing' && phase !== 'game') {
    phase = 'game'; showScreen('game');
  } else if (lobby.phase === 'lobby' && phase === 'game') {
    phase = 'lobby'; showScreen('lobby');
  }
});

net.on('state', (snap) => {
  if (snap.phase === 'playing' && phase !== 'game') {
    phase = 'game'; showScreen('game');
  }
  hud.update(snap, net.youId);
});

net.on('connect', () => hud.setConnected(true));
net.on('disconnect', () => hud.setConnected(false));

// ---- main loop ----
let lastSent = 0;
function frame(now) {
  if (phase === 'game') {
    const world = renderer.screenToWorld(input.mouseX, input.mouseY);
    const latest = net.snapshots.length ? net.snapshots[net.snapshots.length - 1] : null;
    const you = latest?.players.find(p => p.id === net.youId);
    const role = you?.role || null;
    if (role) {
      const intent = input.buildIntent(world.x, world.y, role);
      if (now - lastSent >= 33) {
        net.sendInput(intent);
        lastSent = now;
      }
    }
    renderer.draw(now);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setTimeout(() => inputName.focus(), 50);

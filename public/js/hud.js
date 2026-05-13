// HUD DOM updates. Reads the latest snapshot + the local player.

import { ROUND, GRENDEL, THANE, WEAPONS, ROLE } from '/shared/constants.js?v=__BUILD__';

const WEAPON_GLYPH = {
  spear: '⚔',
  axe:   '🪓',
  torch: '✺',
  bow:   '⤔',
};

const WEAPON_KENNING = {
  spear: 'Ash-spear',
  axe:   'Wound-axe',
  torch: 'Fire-brand',
  bow:   'Yew-bow',
};

const ROLE_LABEL = {
  grendel: 'GRENDEL',
  thane:   'THANE',
};

const ROLE_SUB = {
  grendel: 'kin of Cain · hell-haunter',
  thane:   "of Hrothgar's hall",
};

export class HUD {
  constructor() {
    this.els = {
      timer:    document.getElementById('hud-timer'),
      role:     document.getElementById('hud-role'),
      room:     document.getElementById('hud-room'),
      demoTag:  document.getElementById('hud-demo-tag'),
      killsNum: document.querySelector('#hud-kills .kills-num'),
      killsTot: document.querySelector('#hud-kills .kills-tot'),
      hpFill:   document.getElementById('hp-fill'),
      hpText:   document.getElementById('hp-text'),
      weapon:      document.getElementById('hud-weapon'),
      weaponName:  document.querySelector('#hud-weapon .weapon-name'),
      weaponIcon:  document.querySelector('#hud-weapon .weapon-icon'),
      weaponDura:  document.querySelectorAll('#hud-weapon .weapon-dura span'),
      abilities:   document.getElementById('hud-abilities'),
      ab: {
        roar:     document.querySelector('.ab[data-ab="roar"]'),
        leap:     document.querySelector('.ab[data-ab="leap"]'),
        darkness: document.querySelector('.ab[data-ab="darkness"]'),
      },
      killPrompt:     document.getElementById('kill-prompt'),
      grapplePrompt:  document.getElementById('grapple-prompt'),
      grappleBanner:  document.getElementById('grapple-banner'),
      saga:           document.getElementById('saga-feed'),
      respawn:        document.getElementById('respawn-overlay'),
      respawnCount:   document.getElementById('respawn-countdown'),
      roundEnd:       document.getElementById('round-end'),
      reTitle:        document.getElementById('re-title'),
      reSub:          document.getElementById('re-sub'),
      reQuote:        document.getElementById('re-quote'),
      reQuoteText:    document.getElementById('re-quote-text'),
      reQuoteCite:    document.getElementById('re-quote-cite'),
      reRestart:      document.getElementById('btn-restart'),
      reWaiting:      document.getElementById('re-waiting'),
      conn:           document.getElementById('connection-banner'),
    };
    this._sagaEls = new Map();
  }

  setRoomCode(code) { this.els.room.textContent = code || '—'; }
  setConnected(ok)  { this.els.conn.hidden = !!ok; }
  setDemo(on)       { this.els.demoTag.hidden = !on; }

  update(snap, youId) {
    if (!snap) return;
    const you = snap.players.find(p => p.id === youId);
    const role = you?.role ?? null;

    if (role) {
      const label = ROLE_LABEL[role] || role.toUpperCase();
      let sub = ROLE_SUB[role] || '';
      if (you?.shaper) sub = 'the Shaper · Gardner ch. 3';
      this.els.role.innerHTML = `<span class="role-name">${label}${you?.shaper ? ' ♪' : ''}</span><span class="role-sub">${sub}</span>`;
      this.els.role.className = `role-tag ${role}${you?.shaper ? ' shaper' : ''}`;
    }

    const msLeft = Math.max(0, (snap.round?.endsAt || 0) - Date.now());
    const mm = Math.floor(msLeft / 60000);
    const ss = Math.floor((msLeft % 60000) / 1000);
    this.els.timer.textContent = `${mm}:${String(ss).padStart(2, '0')}`;

    const grendel = snap.players.find(p => p.role === ROLE.GRENDEL);
    const kills = grendel?.kills ?? 0;
    const target = snap.round?.killsToWin ?? ROUND.grendelKillsToWin;
    this.els.killsNum.textContent = kills;
    this.els.killsTot.textContent = target;

    const focus = you ?? grendel;
    if (focus) {
      const frac = Math.max(0, Math.min(1, focus.hp / focus.maxHp));
      this.els.hpFill.style.width = (frac * 100).toFixed(1) + '%';
      this.els.hpText.textContent = `${focus.hp} / ${focus.maxHp}`;
    }

    // Weapon card
    if (you?.role === ROLE.THANE) {
      if (you.weapon) {
        this.els.weapon.classList.add('has');
        this.els.weapon.classList.remove('barehand');
        this.els.weaponName.textContent = WEAPON_KENNING[you.weapon.type] || you.weapon.type;
        this.els.weaponIcon.textContent = WEAPON_GLYPH[you.weapon.type] || '?';
        const max = WEAPONS[you.weapon.type]?.durability || 5;
        this.els.weaponDura.forEach((dot, i) => {
          dot.classList.toggle('full', i < you.weapon.durability && i < max);
        });
      } else {
        this.els.weapon.classList.add('barehand');
        this.els.weapon.classList.remove('has');
        this.els.weaponName.textContent = 'Bare hands — close in to grip';
        this.els.weaponIcon.textContent = '✊';
        this.els.weaponDura.forEach(d => d.classList.remove('full'));
      }
    } else {
      this.els.weapon.classList.remove('has', 'barehand');
      this.els.weaponName.textContent = 'The hunt';
      this.els.weaponIcon.textContent = '✦';
      this.els.weaponDura.forEach(d => d.classList.remove('full'));
    }

    if (you?.role === ROLE.GRENDEL) {
      this.els.abilities.hidden = false;
      const cd = you.cooldowns || {};
      for (const name of ['roar', 'leap', 'darkness']) {
        const el = this.els.ab[name];
        const remaining = cd[name] || 0;
        const cdEl = el.querySelector('.cd');
        if (remaining > 0) {
          el.classList.add('cooling'); el.classList.remove('ready');
          cdEl.textContent = (remaining / 1000).toFixed(remaining < 1000 ? 1 : 0);
        } else {
          el.classList.remove('cooling'); el.classList.add('ready');
          cdEl.textContent = '';
        }
      }
      const nearestDist = this._nearestThaneDist(snap, you);
      const inRange = nearestDist !== Infinity && nearestDist <= GRENDEL.killRange;
      this.els.killPrompt.hidden = !(inRange && you.alive && !you.grappledById);
      this.els.grapplePrompt.hidden = true;
    } else if (you?.role === ROLE.THANE) {
      this.els.abilities.hidden = true;
      this.els.killPrompt.hidden = true;
      // GRIP prompt: only if bare-handed and within range
      const canGrip = !you.weapon;
      const g = grendel;
      const inRange = g && Math.hypot(g.x - you.x, g.y - you.y) <= THANE.grappleRange + (g.radius || 30);
      this.els.grapplePrompt.hidden = !(canGrip && inRange && you.alive && g?.alive);
    } else {
      this.els.abilities.hidden = true;
      this.els.killPrompt.hidden = true;
      this.els.grapplePrompt.hidden = true;
    }

    const gripping = !!grendel?.grappledById;
    this.els.grappleBanner.hidden = !gripping;

    if (you && !you.alive && snap.phase === 'playing') {
      this.els.respawn.hidden = false;
      this.els.respawnCount.textContent = Math.max(1, Math.ceil((you.respawnIn || 0) / 1000));
    } else {
      this.els.respawn.hidden = true;
    }

    this._updateSaga(snap.saga || []);

    if (snap.phase === 'ended') {
      this.els.roundEnd.hidden = false;
      let title, sub, quote = null, cite = null;
      if (snap.winner === 'grendel') {
        title = 'GRENDEL FEASTS';
        sub = 'Hart lies silent. The benches are wet with blood.';
        // From Gardner ch. 1 — Grendel's opening cosmology.
        quote = '"I create the whole universe, blink by blink."';
        cite = 'Gardner, Grendel (1971), ch. 1';
      } else if (snap.winner === 'villagers') {
        title = 'THE BEAST FALLS';
        sub = 'Grendel whispers his curse and crawls toward the cliffs.';
        // The novel's famous final words.
        quote = '"Poor Grendel’s had an accident. So may you all."';
        cite = 'Gardner, Grendel (1971), ch. 12 — final line';
      } else {
        title = 'EMPTY HALL';
        sub = 'The hunt is abandoned, the saga unsung.';
      }
      this.els.reTitle.textContent = title;
      this.els.reSub.textContent = sub;
      if (quote) {
        this.els.reQuote.hidden = false;
        this.els.reQuoteText.textContent = quote;
        this.els.reQuoteCite.textContent = cite;
      } else {
        this.els.reQuote.hidden = true;
      }
      const isHost = snap.hostId === youId;
      this.els.reRestart.hidden = !isHost;
      this.els.reWaiting.hidden = isHost;
    } else {
      this.els.roundEnd.hidden = true;
    }
  }

  _nearestThaneDist(snap, g) {
    let best = Infinity;
    for (const p of snap.players) {
      if (p.role === ROLE.GRENDEL || !p.alive) continue;
      const dx = p.x - g.x, dy = p.y - g.y;
      const d = Math.hypot(dx, dy);
      if (d < best) best = d;
    }
    return best;
  }

  _updateSaga(lines) {
    const now = Date.now();
    const incoming = new Set(lines.map(l => l.id));
    for (const line of lines) {
      if (this._sagaEls.has(line.id)) continue;
      const el = document.createElement('div');
      el.className = 'saga-line';
      el.textContent = line.text;
      this.els.saga.appendChild(el);
      this._sagaEls.set(line.id, { el, ts: now });
    }
    for (const [id, rec] of this._sagaEls) {
      const age = now - rec.ts;
      if (age > 4000) rec.el.classList.add('fade');
      if (age > 9000 || (!incoming.has(id) && age > 6000)) {
        rec.el.remove();
        this._sagaEls.delete(id);
      }
    }
    while (this.els.saga.childNodes.length > 8) {
      const first = this.els.saga.firstChild;
      this.els.saga.removeChild(first);
      for (const [id, rec] of this._sagaEls) {
        if (rec.el === first) { this._sagaEls.delete(id); break; }
      }
    }
  }
}

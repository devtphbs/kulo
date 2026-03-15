import './style.css'
import { supabase } from './supabase.js'
import { buildDeck, shuffle, canPlay, nextPlayerIndex, NUM_COLORS } from './cards.js'
import { renderCard, renderColorPicker, renderTargetPicker } from './cardRender.js'
import QRCode from 'qrcode'

// ── State ─────────────────────────────────────────────────────
let state = {
  gameId: null, playerId: null, playerName: null,
  isHost: false, game: null, players: [],
  myHand: [], selectedCard: null, subscription: null,
}

// ── Screen switching ──────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => {
    s.style.display = 'none'
  })
  const el = document.getElementById(name + '-screen')
  if (el) el.style.display = 'flex'
}

// ── Helpers ───────────────────────────────────────────────────
function genId(len) { return Math.random().toString(36).substring(2, 2+len).toUpperCase() }

function toast(msg) {
  const c = document.getElementById('toast-container')
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  c.appendChild(t)
  setTimeout(() => t.remove(), 3200)
}

function myTurn() {
  if (!state.game || !state.players.length) return false
  const cur = state.players[state.game.current_player_index]
  return cur?.id === state.playerId
}

function isFrozen() {
  return ((state.game?.frozen_turns || {})[state.playerId] || 0) > 0
}

// ── DB helpers ─────────────────────────────────────────────────
async function getGame(id) {
  const { data } = await supabase.from('games').select('*').eq('id', id).single()
  return data
}
async function getPlayers(gameId) {
  const { data } = await supabase.from('players').select('*').eq('game_id', gameId).order('turn_order')
  return data || []
}
async function updateGame(gameId, updates) {
  await supabase.from('games').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', gameId)
}
async function updatePlayer(playerId, updates) {
  await supabase.from('players').update(updates).eq('id', playerId)
}

// ── Realtime ──────────────────────────────────────────────────
function subscribe(gameId) {
  if (state.subscription) supabase.removeChannel(state.subscription)
  state.subscription = supabase.channel('game:' + gameId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: 'id=eq.' + gameId }, async () => {
      state.game = await getGame(gameId)
      onGameUpdate()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: 'game_id=eq.' + gameId }, async () => {
      state.players = await getPlayers(gameId)
      const me = state.players.find(p => p.id === state.playerId)
      if (me) state.myHand = me.hand || []
      onGameUpdate()
    })
    .subscribe()
}

function onGameUpdate() {
  if (!state.game) return
  if (state.game.status === 'lobby') renderLobby()
  else if (state.game.status === 'playing') { showScreen('game'); renderGame() }
  else if (state.game.status === 'finished') renderWinner()
}

// ── HOME ──────────────────────────────────────────────────────
document.getElementById('btn-create').addEventListener('click', () => {
  document.getElementById('setup-title').textContent = 'Skapa spel'
  document.getElementById('setup-mode').dataset.mode = 'create'
  document.getElementById('setup-code-row').style.display = 'none'
  document.getElementById('player-name').value = ''
  document.getElementById('btn-enter').textContent = 'Kör! 🚀'
  document.getElementById('btn-enter').disabled = false
  showScreen('setup')
})

document.getElementById('btn-join').addEventListener('click', () => {
  document.getElementById('setup-title').textContent = 'Gå med i spel'
  document.getElementById('setup-mode').dataset.mode = 'join'
  document.getElementById('setup-code-row').style.display = 'flex'
  document.getElementById('player-name').value = ''
  document.getElementById('game-code').value = ''
  document.getElementById('btn-enter').textContent = 'Kör! 🚀'
  document.getElementById('btn-enter').disabled = false
  showScreen('setup')
})

// ── SETUP ─────────────────────────────────────────────────────
document.getElementById('btn-back-home').addEventListener('click', () => showScreen('home'))

document.getElementById('btn-enter').addEventListener('click', async () => {
  const mode = document.getElementById('setup-mode').dataset.mode
  const name = document.getElementById('player-name').value.trim()
  const code = document.getElementById('game-code').value.trim().toUpperCase()
  if (!name) { toast('Skriv in ditt namn! 😅'); return }
  if (mode === 'join' && !code) { toast('Skriv in spelkoden! 🎮'); return }
  const btn = document.getElementById('btn-enter')
  btn.disabled = true
  btn.textContent = 'Laddar...'
  try {
    if (mode === 'create') await createGame(name)
    else await joinGame(name, code)
  } catch(e) {
    console.error(e)
    toast('Något gick fel, försök igen')
    btn.disabled = false
    btn.textContent = 'Kör! 🚀'
  }
})

async function createGame(name) {
  const gameId = genId(4)
  const playerId = genId(10)
  await supabase.from('games').insert({
    id: gameId, host_id: playerId, status: 'lobby',
    current_player_index: 0, direction: 1,
    draw_pile: [], discard_pile: [], frozen_turns: {}, pending_draw: 0,
  })
  await supabase.from('players').insert({
    id: playerId, game_id: gameId, name,
    hand: [], is_host: true, turn_order: 0, kulo_called: false,
  })
  state.playerId = playerId; state.playerName = name
  state.gameId = gameId; state.isHost = true; state.myHand = []
  state.game = await getGame(gameId)
  state.players = await getPlayers(gameId)
  subscribe(gameId)
  showScreen('lobby')
  renderLobby()
}

async function joinGame(name, code) {
  const game = await getGame(code)
  if (!game) { toast('Hittade inget spel! 🤔'); document.getElementById('btn-enter').disabled = false; document.getElementById('btn-enter').textContent = 'Kör! 🚀'; return }
  if (game.status !== 'lobby') { toast('Spelet har redan startat! 🎮'); document.getElementById('btn-enter').disabled = false; document.getElementById('btn-enter').textContent = 'Kör! 🚀'; return }
  const players = await getPlayers(code)
  if (players.length >= 6) { toast('Spelet är fullt! Max 6 spelare 😅'); document.getElementById('btn-enter').disabled = false; document.getElementById('btn-enter').textContent = 'Kör! 🚀'; return }
  const playerId = genId(10)
  await supabase.from('players').insert({
    id: playerId, game_id: code, name,
    hand: [], is_host: false, turn_order: players.length, kulo_called: false,
  })
  state.playerId = playerId; state.playerName = name
  state.gameId = code; state.isHost = false; state.myHand = []
  state.game = game
  state.players = await getPlayers(code)
  subscribe(code)
  showScreen('lobby')
  renderLobby()
}

// ── LOBBY ─────────────────────────────────────────────────────
async function renderLobby() {
  showScreen('lobby')
  const joinUrl = window.location.origin + '?join=' + state.gameId
  const canvas = document.getElementById('qr-canvas')
  try {
    await QRCode.toCanvas(canvas, joinUrl, { width: 180, margin: 1, color: { dark: '#000', light: '#fff' } })
  } catch(e) { console.error('QR error', e) }

  document.getElementById('lobby-code').textContent = state.gameId

  const list = document.getElementById('lobby-players')
  list.innerHTML = ''
  state.players.forEach(p => {
    const div = document.createElement('div')
    div.className = 'player-item'
    div.innerHTML = `<span>${p.name}</span><div style="display:flex;gap:6px">${p.is_host ? '<span class="host-badge">HOST</span>' : ''}${p.id === state.playerId ? '<span class="you-badge">DU</span>' : ''}</div>`
    list.appendChild(div)
  })

  const startBtn = document.getElementById('btn-start-game')
  if (state.isHost) {
    startBtn.style.display = 'flex'
    if (state.players.length < 2) {
      startBtn.disabled = true
      startBtn.textContent = 'Väntar på spelare... (' + state.players.length + '/2 min)'
    } else {
      startBtn.disabled = false
      startBtn.textContent = '🚀 Starta spelet (' + state.players.length + ' spelare)'
    }
  } else {
    startBtn.style.display = 'none'
  }
}

document.getElementById('btn-start-game').addEventListener('click', async () => {
  if (!state.isHost || state.players.length < 2) return
  await startGame()
})

async function startGame() {
  let deck = shuffle(buildDeck())
  const players = shuffle([...state.players])
  const hands = {}
  players.forEach(p => { hands[p.id] = [] })
  for (let i = 0; i < 7; i++) players.forEach(p => { hands[p.id].push(deck.pop()) })

  let topCard = deck.pop()
  while (topCard.type !== 'number') { deck.unshift(topCard); topCard = deck.pop() }

  for (let i = 0; i < players.length; i++) {
    await supabase.from('players').update({ turn_order: i, hand: hands[players[i].id], kulo_called: false }).eq('id', players[i].id)
  }
  const me = players.find(p => p.id === state.playerId)
  if (me) state.myHand = hands[me.id]

  await updateGame(state.gameId, {
    status: 'playing', current_player_index: 0, direction: 1,
    top_card: topCard, active_color: topCard.color || null,
    draw_pile: deck, discard_pile: [topCard],
    frozen_turns: {}, pending_draw: 0, winner_id: null,
  })
}

// ── GAME ──────────────────────────────────────────────────────
function renderGame() {
  const game = state.game
  const players = state.players
  const me = players.find(p => p.id === state.playerId)
  if (!me) return
  state.myHand = me.hand || []

  const isMyTurn = myTurn()
  const frozen = isFrozen()
  const currentPlayer = players[game.current_player_index]

  // Top bar
  document.getElementById('game-turn-label').textContent =
    isMyTurn ? (frozen ? '❄️ Du är fryst!' : '🎯 Din tur!') : (currentPlayer?.name + 's tur')

  // Opponents
  const othersEl = document.getElementById('game-others')
  othersEl.innerHTML = ''
  players.filter(p => p.id !== state.playerId).forEach(p => {
    const isActive = players[game.current_player_index]?.id === p.id
    const frozenLeft = (game.frozen_turns || {})[p.id] || 0
    const handCount = (p.hand || []).length
    const div = document.createElement('div')
    div.className = 'opponent-block' + (isActive ? ' active-turn' : '')
    div.innerHTML = `
      <div class="mini-cards">${Array.from({length:Math.min(handCount,5)},(_,i)=>`<div class="mini-card" style="left:${i*8}px;background:hsl(${i*40},60%,45%)"></div>`).join('')}</div>
      <div class="opponent-name">${p.name}</div>
      <div class="opponent-cards">${handCount} kort</div>
      ${p.kulo_called ? '<div class="opponent-kulo">KULO!</div>' : ''}
      ${frozenLeft > 0 ? `<div class="opponent-frozen">❄️ ${frozenLeft}t</div>` : ''}
    `
    othersEl.appendChild(div)
  })

  // Top card
  const topCardEl = document.getElementById('top-card-slot')
  topCardEl.innerHTML = ''
  if (game.top_card) {
    const cardEl = renderCard(game.top_card, { large: true })
    if (game.active_color && game.active_color !== game.top_card.color) {
      const tint = document.createElement('div')
      tint.style.cssText = `position:absolute;inset:0;border-radius:6px;background:${colorBgByName(game.active_color)};opacity:0.35;pointer-events:none;z-index:5`
      cardEl.appendChild(tint)
    }
    topCardEl.appendChild(cardEl)
  }

  // Active color dot
  const colorInd = document.getElementById('active-color-ind')
  if (game.active_color) {
    colorInd.style.background = colorBgByName(game.active_color)
    colorInd.style.display = 'block'
  } else {
    colorInd.style.display = 'none'
  }

  // Status banner
  const banner = document.getElementById('status-banner')
  if (isMyTurn && frozen) {
    banner.className = 'status-banner frozen'
    const fl = (game.frozen_turns || {})[state.playerId] || 0
    banner.textContent = '❄️ Du är fryst — ' + fl + ' tur' + (fl > 1 ? 'er' : '') + ' kvar'
  } else if (isMyTurn) {
    banner.className = 'status-banner your-turn'
    banner.textContent = game.pending_draw > 0 ? '⚡ Du måste dra ' + game.pending_draw + ' kort!' : '✨ Din tur — lägg ett kort!'
  } else {
    banner.className = 'status-banner waiting'
    banner.textContent = '⏳ Väntar på ' + (currentPlayer?.name || '') + '...'
  }

  // Draw pile
  const drawEl = document.getElementById('draw-pile-slot')
  drawEl.innerHTML = ''
  drawEl.appendChild(renderCard(null, { isBack: true, large: true }))

  // Hand
  renderHand(isMyTurn && !frozen)

  // KULO button
  document.getElementById('kulo-btn').style.display =
    (state.myHand.length === 1 && !me.kulo_called) ? 'block' : 'none'
}

function colorBgByName(name) {
  const found = Object.values(NUM_COLORS).find(c => c.name === name)
  return found ? found.bg : '#888'
}

function renderHand(canAct) {
  const handEl = document.getElementById('hand-cards')
  handEl.innerHTML = ''
  const game = state.game

  // Sort: numbers first, then by value, then specials, then wilds
  const sorted = [...state.myHand].map((c, i) => ({ c, i })).sort((a, b) => {
    const typeOrder = { number: 0, special: 1, wild: 2 }
    const ta = typeOrder[a.c.type] ?? 3
    const tb = typeOrder[b.c.type] ?? 3
    if (ta !== tb) return ta - tb
    if (a.c.type === 'number') return (a.c.value || 0) - (b.c.value || 0)
    return (a.c.name || '').localeCompare(b.c.name || '')
  })

  sorted.forEach(({ c: card, i: origIdx }) => {
    const playable = canAct && canPlay(card, game.top_card, game.active_color) &&
      (game.pending_draw === 0 || card.name === 'Dra 2' || card.name === 'Dra 4')
    const isSelected = state.selectedCard === origIdx

    const cardEl = renderCard(card, { selected: isSelected, unplayable: !playable })
    cardEl.addEventListener('click', () => {
      if (!canAct) { toast('Det är inte din tur! 😅'); return }
      if (!playable) { toast('Det kortet passar inte! 🚫'); return }
      if (isSelected) {
        state.selectedCard = null
        playCard(origIdx)
      } else {
        state.selectedCard = origIdx
        renderHand(canAct)
      }
    })
    handEl.appendChild(cardEl)
  })
}

// Draw pile click
document.getElementById('draw-pile-slot').addEventListener('click', async () => {
  if (!myTurn() || isFrozen()) return
  if (state.game?.pending_draw > 0) {
    const hasStack = state.myHand.some(c => c.name === 'Dra 2' || c.name === 'Dra 4')
    if (hasStack) { toast('Du kan stacka ett Dra-kort! Eller dra.'); }
    await drawCards(state.game.pending_draw, false)
    return
  }
  await drawCards(1, true)
})

async function drawCards(count, fromClick) {
  const game = state.game
  let deck = [...(game.draw_pile || [])]
  let discard = [...(game.discard_pile || [])]

  if (deck.length < count) {
    const keep = discard.splice(discard.length - 1, 1)
    deck = shuffle(discard)
    discard = keep
    toast('Kortleken blandas om! 🔀')
  }

  const drawn = deck.splice(deck.length - count, count)
  const newHand = [...state.myHand, ...drawn]
  state.myHand = newHand
  await updatePlayer(state.playerId, { hand: newHand })
  await updateGame(state.gameId, { draw_pile: deck, discard_pile: discard, pending_draw: 0 })

  if (fromClick && drawn.length === 1) {
    const drawnCard = drawn[0]
    if (canPlay(drawnCard, game.top_card, game.active_color)) {
      toast('Du drog ett kort som passar — lägg det!')
      renderHand(true)
      return
    } else {
      toast('Kortet passar inte, passar!')
    }
  }
  await advanceToNextPlayer()
}

async function playCard(idx) {
  const card = state.myHand[idx]
  const game = state.game
  const players = state.players
  state.selectedCard = null

  if (game.pending_draw > 0 && card.name !== 'Dra 2' && card.name !== 'Dra 4') {
    toast('Du måste dra kort eller stacka! 😬'); return
  }

  const newHand = state.myHand.filter((_, i) => i !== idx)
  state.myHand = newHand
  await updatePlayer(state.playerId, { hand: newHand })

  const newDiscard = [...(game.discard_pile || []), card]
  let activeColor = card.color || game.active_color

  const updates = {
    top_card: card, discard_pile: newDiscard,
    active_color: activeColor, pending_draw: 0,
  }

  let skipNext = 0, reverseDir = false, pendingDraw = 0, needColorPick = false, needTarget = false, targetAction = null

  switch (card.name) {
    case 'Hoppa Över': skipNext = 1; break
    case 'Vänd': reverseDir = true; break
    case 'Dra 2': pendingDraw = (game.pending_draw || 0) + 2; break
    case 'Dra 4': pendingDraw = (game.pending_draw || 0) + 4; needColorPick = true; break
    case 'Byt Färg': needColorPick = true; break
    case 'Frys': needTarget = true; targetAction = 'frys'; break
    case 'Ge Bort': needTarget = true; targetAction = 'gebart'; break
    case 'Stjäl': needTarget = true; targetAction = 'stjal'; break
    case 'Byt Hand': needTarget = true; targetAction = 'bythand'; break
  }

  updates.pending_draw = pendingDraw

  if (needColorPick) {
    renderColorPicker(async (chosenColor) => {
      updates.active_color = chosenColor
      if (reverseDir) updates.direction = game.direction * -1
      await updateGame(state.gameId, updates)
      await advanceToNextPlayer(reverseDir ? game.direction * -1 : game.direction, skipNext + (pendingDraw > 0 ? 1 : 0))
      checkWin(newHand)
    })
    return
  }

  if (needTarget) {
    if (players.filter(p => p.id !== state.playerId).length === 0) {
      await updateGame(state.gameId, updates)
      await advanceToNextPlayer(game.direction, skipNext)
      checkWin(newHand)
      return
    }
    renderTargetPicker(players, state.playerId, async (targetId) => {
      await applyTargetAction(targetAction, targetId, updates, reverseDir, skipNext)
      checkWin(newHand)
    })
    return
  }

  if (reverseDir) {
    updates.direction = game.direction * -1
    if (players.length === 2) skipNext = 1
  }

  await updateGame(state.gameId, updates)
  await advanceToNextPlayer(reverseDir ? game.direction * -1 : game.direction, skipNext)
  checkWin(newHand)
}

async function applyTargetAction(action, targetId, updates, reverseDir, skipNext) {
  const game = state.game
  const players = state.players
  const target = players.find(p => p.id === targetId)
  if (!target) return
  let targetHand = [...(target.hand || [])]
  let myHand = [...state.myHand]

  if (action === 'frys') {
    const frozen = { ...(game.frozen_turns || {}) }
    frozen[targetId] = (frozen[targetId] || 0) + 2
    updates.frozen_turns = frozen
    toast('❄️ ' + target.name + ' är fryst i 2 turer!')
  } else if (action === 'gebart') {
    const n = Math.min(3, myHand.length)
    const toGive = myHand.splice(myHand.length - n, n)
    targetHand = [...targetHand, ...toGive]
    state.myHand = myHand
    await updatePlayer(state.playerId, { hand: myHand })
    await updatePlayer(targetId, { hand: targetHand })
    toast('🤝 Gav ' + n + ' kort till ' + target.name + '!')
  } else if (action === 'stjal') {
    if (targetHand.length === 0) { toast(target.name + ' har inga kort!'); } else {
      const si = Math.floor(Math.random() * targetHand.length)
      const stolen = targetHand.splice(si, 1)[0]
      myHand = [...myHand, stolen]
      state.myHand = myHand
      await updatePlayer(state.playerId, { hand: myHand })
      await updatePlayer(targetId, { hand: targetHand })
      toast('🎯 Du stal ett kort från ' + target.name + '!')
    }
  } else if (action === 'bythand') {
    state.myHand = targetHand
    await updatePlayer(state.playerId, { hand: targetHand })
    await updatePlayer(targetId, { hand: myHand })
    toast('🔄 Bytte hand med ' + target.name + '!')
  }

  if (reverseDir) updates.direction = game.direction * -1
  await updateGame(state.gameId, updates)
  await advanceToNextPlayer(reverseDir ? game.direction * -1 : game.direction, skipNext)
}

async function advanceToNextPlayer(dir, extraSkip = 0) {
  const game = state.game
  const players = state.players
  const actualDir = dir ?? game.direction
  const nextIdx = nextPlayerIndex(game.current_player_index, actualDir, players.length, 1 + extraSkip)

  const frozen = { ...(game.frozen_turns || {}) }
  const nextPlayer = players[nextIdx]
  if (nextPlayer && (frozen[nextPlayer.id] || 0) > 0) {
    frozen[nextPlayer.id]--
    toast('❄️ ' + nextPlayer.name + ' är fryst, hoppar!')
    const skipIdx = nextPlayerIndex(nextIdx, actualDir, players.length, 1)
    await updateGame(state.gameId, { current_player_index: skipIdx, frozen_turns: frozen, direction: actualDir })
    return
  }

  await updateGame(state.gameId, { current_player_index: nextIdx, direction: actualDir })
}

async function checkWin(hand) {
  if (hand.length === 0) {
    await updateGame(state.gameId, { status: 'finished', winner_id: state.playerId })
  }
}

// KULO button
document.getElementById('kulo-btn').addEventListener('click', async () => {
  await updatePlayer(state.playerId, { kulo_called: true })
  toast('🔔 KULO! Du är säker!')
})

// ── WINNER ────────────────────────────────────────────────────
function renderWinner() {
  showScreen('winner')
  const winner = state.players.find(p => p.id === state.game?.winner_id)
  document.getElementById('winner-name').textContent = winner?.name || '???'
  document.getElementById('winner-is-you').style.display =
    state.game?.winner_id === state.playerId ? 'block' : 'none'
}

document.getElementById('btn-play-again').addEventListener('click', async () => {
  if (!state.isHost) { toast('Vänta på att hosten startar om!'); return }
  await updateGame(state.gameId, { status: 'lobby', winner_id: null })
  for (const p of state.players) {
    await updatePlayer(p.id, { hand: [], kulo_called: false })
  }
})

document.getElementById('btn-leave').addEventListener('click', async () => {
  await supabase.from('players').delete().eq('id', state.playerId)
  if (state.subscription) supabase.removeChannel(state.subscription)
  window.location.reload()
})

// ── INIT ──────────────────────────────────────────────────────
async function init() {
  // Hide all screens first
  document.querySelectorAll('.screen').forEach(s => { s.style.display = 'none' })

  const params = new URLSearchParams(window.location.search)
  const joinCode = params.get('join')
  if (joinCode) {
    window.history.replaceState({}, '', window.location.pathname)
    document.getElementById('setup-title').textContent = 'Gå med i spel'
    document.getElementById('setup-mode').dataset.mode = 'join'
    document.getElementById('setup-code-row').style.display = 'flex'
    document.getElementById('game-code').value = joinCode
    showScreen('setup')
    return
  }
  showScreen('home')
}

init()

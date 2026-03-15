import './style.css'
import { supabase } from './supabase.js'
import { buildDeck, shuffle, canPlay, nextPlayerIndex, NUM_COLORS } from './cards.js'
import { renderCard, renderColorPicker, renderTargetPicker } from './cardRender.js'
import QRCode from 'qrcode'

// ── State ──────────────────────────────────────────────────────
let state = {
  screen: 'home',
  gameId: null,
  playerId: null,
  playerName: null,
  isHost: false,
  game: null,
  players: [],
  myHand: [],
  selectedCard: null,
  subscription: null,
  pendingWild: null, // card waiting for color selection
  frozenTurnsLeft: 0,
}

// ── Helpers ───────────────────────────────────────────────────
function genId(len = 6) {
  return Math.random().toString(36).substring(2, 2 + len).toUpperCase()
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById(`${name}-screen`).classList.add('active')
  state.screen = name
}

function toast(msg) {
  const container = document.getElementById('toast-container')
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  container.appendChild(t)
  setTimeout(() => t.remove(), 3100)
}

function myTurn() {
  if (!state.game || !state.players.length) return false
  const me = state.players.find(p => p.id === state.playerId)
  if (!me) return false
  const currentPlayer = state.players[state.game.current_player_index]
  return currentPlayer?.id === state.playerId
}

function isFrozen() {
  const frozen = state.game?.frozen_turns || {}
  return (frozen[state.playerId] || 0) > 0
}

// ── Database helpers ───────────────────────────────────────────
async function getGame(gameId) {
  const { data } = await supabase.from('games').select('*').eq('id', gameId).single()
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

// ── Realtime subscription ──────────────────────────────────────
function subscribe(gameId) {
  if (state.subscription) {
    supabase.removeChannel(state.subscription)
  }
  state.subscription = supabase.channel(`game:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, async () => {
      state.game = await getGame(gameId)
      renderGameOrLobby()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` }, async () => {
      state.players = await getPlayers(gameId)
      // Refresh own hand
      const me = state.players.find(p => p.id === state.playerId)
      if (me) state.myHand = me.hand || []
      renderGameOrLobby()
    })
    .subscribe()
}

function renderGameOrLobby() {
  if (!state.game) return
  if (state.game.status === 'lobby') renderLobby()
  else if (state.game.status === 'playing') renderGame()
  else if (state.game.status === 'finished') renderWinner()
}

// ── HOME SCREEN ────────────────────────────────────────────────
function renderHome() {
  showScreen('home')
}

document.getElementById('btn-create').addEventListener('click', () => {
  showScreen('setup')
  document.getElementById('setup-mode').dataset.mode = 'create'
  document.getElementById('setup-title').textContent = 'Skapa spel'
  document.getElementById('setup-code-row').style.display = 'none'
})

document.getElementById('btn-join').addEventListener('click', () => {
  showScreen('setup')
  document.getElementById('setup-mode').dataset.mode = 'join'
  document.getElementById('setup-title').textContent = 'Gå med i spel'
  document.getElementById('setup-code-row').style.display = 'flex'
})

// ── SETUP SCREEN ───────────────────────────────────────────────
document.getElementById('btn-back-home').addEventListener('click', renderHome)

document.getElementById('btn-enter').addEventListener('click', async () => {
  const mode = document.getElementById('setup-mode').dataset.mode
  const name = document.getElementById('player-name').value.trim()
  const code = document.getElementById('game-code').value.trim().toUpperCase()

  if (!name) { toast('Skriv in ditt namn! 😅'); return }
  if (mode === 'join' && !code) { toast('Skriv in spelkoden! 🎮'); return }

  const btn = document.getElementById('btn-enter')
  btn.classList.add('btn-disabled')
  btn.textContent = 'Laddar...'

  try {
    if (mode === 'create') {
      await createGame(name)
    } else {
      await joinGame(name, code)
    }
  } catch (e) {
    toast('Något gick fel, försök igen')
    btn.classList.remove('btn-disabled')
    btn.textContent = 'Kör!'
  }
})

async function createGame(name) {
  const gameId = genId(4)
  const playerId = genId(10)

  await supabase.from('games').insert({
    id: gameId,
    host_id: playerId,
    status: 'lobby',
    current_player_index: 0,
    direction: 1,
    draw_pile: [],
    discard_pile: [],
    frozen_turns: {},
    pending_draw: 0,
  })

  await supabase.from('players').insert({
    id: playerId,
    game_id: gameId,
    name,
    hand: [],
    is_host: true,
    turn_order: 0,
  })

  state.playerId = playerId
  state.playerName = name
  state.gameId = gameId
  state.isHost = true
  state.myHand = []

  state.game = await getGame(gameId)
  state.players = await getPlayers(gameId)

  subscribe(gameId)
  showLobbyScreen()
}

async function joinGame(name, code) {
  const game = await getGame(code)
  if (!game) { toast('Hittade inget spel med den koden 🤔'); document.getElementById('btn-enter').classList.remove('btn-disabled'); document.getElementById('btn-enter').textContent = 'Kör!'; return }
  if (game.status !== 'lobby') { toast('Det spelet har redan startat 🎮'); document.getElementById('btn-enter').classList.remove('btn-disabled'); document.getElementById('btn-enter').textContent = 'Kör!'; return }

  const players = await getPlayers(code)
  if (players.length >= 6) { toast('Spelet är fullt! Max 6 spelare 😅'); document.getElementById('btn-enter').classList.remove('btn-disabled'); document.getElementById('btn-enter').textContent = 'Kör!'; return }

  const playerId = genId(10)
  await supabase.from('players').insert({
    id: playerId,
    game_id: code,
    name,
    hand: [],
    is_host: false,
    turn_order: players.length,
  })

  state.playerId = playerId
  state.playerName = name
  state.gameId = code
  state.isHost = false
  state.myHand = []

  state.game = game
  state.players = await getPlayers(code)

  subscribe(code)
  showLobbyScreen()
}

// ── LOBBY SCREEN ───────────────────────────────────────────────
function showLobbyScreen() {
  showScreen('lobby')
  renderLobby()
}

async function renderLobby() {
  if (state.screen !== 'lobby') return

  // QR code
  const joinUrl = `${window.location.origin}?join=${state.gameId}`
  const qrCanvas = document.getElementById('qr-canvas')
  await QRCode.toCanvas(qrCanvas, joinUrl, { width: 180, margin: 1, color: { dark: '#000', light: '#fff' } })

  document.getElementById('lobby-code').textContent = state.gameId

  // Player list
  const list = document.getElementById('lobby-players')
  list.innerHTML = ''
  state.players.forEach(p => {
    const div = document.createElement('div')
    div.className = 'player-item'
    div.innerHTML = `
      <span>${p.name}</span>
      <div style="display:flex;gap:6px">
        ${p.is_host ? '<span class="host-badge">HOST</span>' : ''}
        ${p.id === state.playerId ? '<span class="you-badge">DU</span>' : ''}
      </div>
    `
    list.appendChild(div)
  })

  // Start button (host only)
  const startBtn = document.getElementById('btn-start-game')
  if (state.isHost) {
    startBtn.style.display = 'flex'
    if (state.players.length < 2) {
      startBtn.classList.add('btn-disabled')
      startBtn.textContent = `Väntar på spelare... (${state.players.length}/2 min)`
    } else {
      startBtn.classList.remove('btn-disabled')
      startBtn.textContent = `🚀 Starta spelet (${state.players.length} spelare)`
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
  // Build & shuffle deck
  let deck = shuffle(buildDeck())

  // Deal 7 cards to each player
  const players = [...state.players]
  const hands = {}
  players.forEach(p => { hands[p.id] = [] })

  for (let i = 0; i < 7; i++) {
    players.forEach(p => {
      hands[p.id].push(deck.pop())
    })
  }

  // Draw until we get a number card as start card
  let topCard = deck.pop()
  while (topCard.type !== 'number') {
    deck.unshift(topCard)
    topCard = deck.pop()
  }

  // Randomize turn order
  const shuffledPlayers = shuffle(players)
  for (let i = 0; i < shuffledPlayers.length; i++) {
    await supabase.from('players').update({ turn_order: i, hand: hands[shuffledPlayers[i].id] }).eq('id', shuffledPlayers[i].id)
  }

  // Refresh my hand
  const me = shuffledPlayers.find(p => p.id === state.playerId)
  if (me) state.myHand = hands[me.id]

  await updateGame(state.gameId, {
    status: 'playing',
    current_player_index: 0,
    direction: 1,
    top_card: topCard,
    active_color: topCard.color || null,
    draw_pile: deck,
    discard_pile: [topCard],
    frozen_turns: {},
    pending_draw: 0,
    winner_id: null,
  })
}

// ── GAME SCREEN ────────────────────────────────────────────────
function renderGame() {
  if (state.screen !== 'game') showScreen('game')

  const game = state.game
  const players = state.players
  const me = players.find(p => p.id === state.playerId)
  if (!me) return

  state.myHand = me.hand || []

  const isMyTurn = myTurn()
  const frozen = isFrozen()
  const currentPlayer = players[game.current_player_index]

  // Top bar
  document.getElementById('game-turn-label').textContent = isMyTurn
    ? (frozen ? '❄️ Du är fryst!' : '🎯 Din tur!')
    : `${currentPlayer?.name || ''}s tur`

  // Opponents
  const othersEl = document.getElementById('game-others')
  othersEl.innerHTML = ''
  players.filter(p => p.id !== state.playerId).forEach(p => {
    const isActive = players[game.current_player_index]?.id === p.id
    const frozenLeft = (game.frozen_turns || {})[p.id] || 0
    const div = document.createElement('div')
    div.className = `opponent-block${isActive ? ' active-turn' : ''}`
    const handCount = (p.hand || []).length
    div.innerHTML = `
      <div class="mini-cards">
        ${Array.from({ length: Math.min(handCount, 5) }, (_, i) =>
          `<div class="mini-card" style="left:${i * 8}px;background:hsl(${i * 40},60%,45%)"></div>`
        ).join('')}
      </div>
      <div class="opponent-name">${p.name}</div>
      <div class="opponent-cards">${handCount} kort</div>
      ${p.kulo_called ? '<div class="opponent-kulo">KULO!</div>' : ''}
      ${frozenLeft > 0 ? `<div class="opponent-frozen">❄️ ${frozenLeft} turer</div>` : ''}
    `
    othersEl.appendChild(div)
  })

  // Top card
  const topCardEl = document.getElementById('top-card-slot')
  topCardEl.innerHTML = ''
  if (game.top_card) {
    const cardEl = renderCard(game.top_card, { large: true })
    // Tint if active color differs from card color
    if (game.active_color && game.active_color !== game.top_card.color) {
      const tint = document.createElement('div')
      tint.style.cssText = `position:absolute;inset:0;border-radius:6px;background:${colorBgByName(game.active_color)};opacity:0.35;pointer-events:none;z-index:5`
      tint.title = `Aktiv färg: ${game.active_color}`
      cardEl.appendChild(tint)
    }
    topCardEl.appendChild(cardEl)
  }

  // Active color indicator
  const colorInd = document.getElementById('active-color-ind')
  if (game.active_color) {
    colorInd.style.background = colorBgByName(game.active_color)
    colorInd.title = game.active_color
    colorInd.style.display = 'block'
  } else {
    colorInd.style.display = 'none'
  }

  // Status banner
  const banner = document.getElementById('status-banner')
  if (isMyTurn && frozen) {
    banner.className = 'status-banner frozen'
    const frozenLeft = (game.frozen_turns || {})[state.playerId] || 0
    banner.textContent = `❄️ Du är fryst — ${frozenLeft} tur${frozenLeft > 1 ? 'er' : ''} kvar`
  } else if (isMyTurn) {
    banner.className = 'status-banner your-turn'
    if (game.pending_draw > 0) {
      banner.textContent = `⚡ Du måste dra ${game.pending_draw} kort!`
    } else {
      banner.textContent = '✨ Din tur — lägg ett kort!'
    }
  } else {
    banner.className = 'status-banner waiting'
    banner.textContent = `⏳ Väntar på ${currentPlayer?.name || ''}...`
  }

  // Draw pile
  const drawPileEl = document.getElementById('draw-pile-slot')
  drawPileEl.innerHTML = ''
  const backCard = renderCard(null, { isBack: true, large: true })
  drawPileEl.appendChild(backCard)

  // Hand
  renderHand(isMyTurn && !frozen)

  // KULO button
  const kuloBtn = document.getElementById('kulo-btn')
  if (state.myHand.length === 1 && !me.kulo_called) {
    kuloBtn.style.display = 'block'
  } else {
    kuloBtn.style.display = 'none'
  }
}

function colorBgByName(name) {
  const found = Object.values(NUM_COLORS).find(c => c.name === name)
  return found ? found.bg : '#888'
}

function renderHand(canAct) {
  const handEl = document.getElementById('hand-cards')
  handEl.innerHTML = ''
  const game = state.game

  state.myHand.forEach((card, idx) => {
    const playable = canAct && canPlay(card, game.top_card, game.active_color) && (game.pending_draw === 0 || card.name === 'Dra 2' || card.name === 'Dra 4')
    const isSelected = state.selectedCard === idx

    const cardEl = renderCard(card, { selected: isSelected, unplayable: !playable })
    cardEl.addEventListener('click', () => {
      if (!canAct) return
      if (!playable) { toast('Det kortet kan du inte lägga nu 🚫'); return }
      if (isSelected) {
        playCard(idx)
      } else {
        state.selectedCard = idx
        renderHand(canAct)
      }
    })
    handEl.appendChild(cardEl)
  })
}

// ── Draw pile click ────────────────────────────────────────────
document.getElementById('draw-pile-slot').addEventListener('click', async () => {
  if (!myTurn()) return
  if (isFrozen()) return
  await drawCards(1, true)
})

async function drawCards(count, fromClick = false) {
  const game = state.game
  let deck = [...(game.draw_pile || [])]
  let discard = [...(game.discard_pile || [])]

  // Reshuffle discard into draw if needed
  if (deck.length < count) {
    const keep = discard.splice(discard.length - 1, 1)
    deck = shuffle(discard)
    discard = keep
    toast('Kortleken blandas om! 🔀')
  }

  const drawn = deck.splice(deck.length - count, count)
  const newHand = [...state.myHand, ...drawn]

  // Check if drawn card can be played (only for single draw from click)
  let advanceTurn = true
  if (fromClick && drawn.length === 1) {
    const drawnCard = drawn[0]
    if (canPlay(drawnCard, game.top_card, game.active_color)) {
      toast(`Du drog ${drawnCard.type === 'number' ? drawnCard.value : drawnCard.name} — och kan lägga det!`)
      state.myHand = newHand
      await updatePlayer(state.playerId, { hand: newHand })
      await updateGame(state.gameId, { draw_pile: deck, discard_pile: discard })
      renderHand(true)
      return // Let player decide to play or not — turn doesn't advance yet
    } else {
      toast(`Du drog ett kort. Passar!`)
    }
  }

  await updatePlayer(state.playerId, { hand: newHand })
  state.myHand = newHand

  if (advanceTurn) {
    await updateGame(state.gameId, { draw_pile: deck, discard_pile: discard, pending_draw: 0 })
    await advanceToNextPlayer()
  }
}

// ── Play a card ────────────────────────────────────────────────
async function playCard(idx) {
  const card = state.myHand[idx]
  const game = state.game
  const players = state.players

  state.selectedCard = null

  // Handle pending draw stack — can only stack same type or must take
  if (game.pending_draw > 0) {
    const isStackable = (card.name === 'Dra 2' || card.name === 'Dra 4')
    if (!isStackable) { toast('Du måste dra kort! 😬'); return }
  }

  // Remove from hand
  const newHand = state.myHand.filter((_, i) => i !== idx)
  state.myHand = newHand
  await updatePlayer(state.playerId, { hand: newHand })

  // Build new discard pile
  const newDiscard = [...(game.discard_pile || []), card]

  // Determine active color
  let activeColor = card.color || game.active_color

  // Apply card effect
  const updates = {
    top_card: card,
    discard_pile: newDiscard,
    active_color: activeColor,
    pending_draw: 0,
  }

  let skipNext = 0
  let reverseDir = false
  let pendingDraw = 0
  let needColorPick = false
  let needTarget = false
  let targetAction = null

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

  // Handle wild color pick BEFORE advancing
  if (needColorPick) {
    // Apply current updates first
    if (reverseDir) updates.direction = game.direction * -1
    if (skipNext > 0) updates.current_player_index = nextPlayerIndex(game.current_player_index, reverseDir ? (game.direction * -1) : game.direction, players.length, skipNext + 1)

    renderColorPicker(async (chosenColor) => {
      updates.active_color = chosenColor
      if (!updates.current_player_index && !skipNext) {
        await updateGame(state.gameId, updates)
        await advanceToNextPlayer(reverseDir, skipNext + (pendingDraw > 0 ? 1 : 0))
      } else {
        await updateGame(state.gameId, updates)
      }
      checkWin(newHand)
    })
    return
  }

  if (needTarget) {
    renderTargetPicker(players, state.playerId, async (targetId) => {
      await applyTargetAction(targetAction, targetId, updates, reverseDir, skipNext)
      checkWin(newHand)
    })
    return
  }

  if (reverseDir) {
    updates.direction = game.direction * -1
    if (players.length === 2) skipNext = 1 // 2-player reverse = extra turn
  }

  await updateGame(state.gameId, updates)
  await advanceToNextPlayer(reverseDir, skipNext)
  checkWin(newHand)
}

async function applyTargetAction(action, targetId, updates, reverseDir, skipNext) {
  const game = state.game
  const players = state.players
  const targetPlayer = players.find(p => p.id === targetId)
  if (!targetPlayer) return

  let targetHand = [...(targetPlayer.hand || [])]
  let myHand = [...state.myHand]

  if (action === 'frys') {
    const frozen = { ...(game.frozen_turns || {}) }
    frozen[targetId] = (frozen[targetId] || 0) + 2
    updates.frozen_turns = frozen
    toast(`❄️ ${targetPlayer.name} är fryst i 2 turer!`)
  }

  if (action === 'gebart') {
    if (myHand.length === 0) { toast('Du har inga kort att ge! 😅'); return }
    // Give up to 3 cards (worst = last in hand, auto-pick)
    const toGive = myHand.splice(myHand.length - Math.min(3, myHand.length), Math.min(3, myHand.length))
    targetHand = [...targetHand, ...toGive]
    state.myHand = myHand
    await updatePlayer(state.playerId, { hand: myHand })
    await updatePlayer(targetId, { hand: targetHand })
    toast(`🤝 Gav ${toGive.length} kort till ${targetPlayer.name}!`)
  }

  if (action === 'stjal') {
    if (targetHand.length === 0) { toast(`${targetPlayer.name} har inga kort!`); return }
    const stealIdx = Math.floor(Math.random() * targetHand.length)
    const stolen = targetHand.splice(stealIdx, 1)[0]
    myHand = [...myHand, stolen]
    state.myHand = myHand
    await updatePlayer(state.playerId, { hand: myHand })
    await updatePlayer(targetId, { hand: targetHand })
    toast(`🎯 Du stal ett kort från ${targetPlayer.name}!`)
  }

  if (action === 'bythand') {
    state.myHand = targetHand
    await updatePlayer(state.playerId, { hand: targetHand })
    await updatePlayer(targetId, { hand: myHand })
    toast(`🔄 Bytte hand med ${targetPlayer.name}!`)
  }

  if (reverseDir) updates.direction = game.direction * -1
  await updateGame(state.gameId, updates)
  await advanceToNextPlayer(reverseDir, skipNext)
}

async function advanceToNextPlayer(reverseDir = false, extraSkip = 0) {
  const game = state.game
  const players = state.players
  const dir = reverseDir ? game.direction * -1 : game.direction
  const actualDir = reverseDir ? dir : (game.direction ?? 1)
  const nextIdx = nextPlayerIndex(game.current_player_index, actualDir, players.length, 1 + extraSkip)

  // Reduce frozen turns for next player
  const frozen = { ...(game.frozen_turns || {}) }
  const nextPlayer = players[nextIdx]
  if (nextPlayer && frozen[nextPlayer.id] > 0) {
    frozen[nextPlayer.id]--
    await updateGame(state.gameId, {
      current_player_index: nextIdx,
      frozen_turns: frozen,
      direction: actualDir,
    })
    return
  }

  await updateGame(state.gameId, { current_player_index: nextIdx, direction: actualDir })
}

// Handle pending draw — if it's your turn and pending_draw > 0 and you can't stack
async function handleForcedDraw() {
  const game = state.game
  if (!game || !myTurn() || game.pending_draw === 0) return

  // Check if player has a stackable card
  const hasStack = state.myHand.some(c => c.name === 'Dra 2' || c.name === 'Dra 4')
  if (!hasStack) {
    toast(`⚡ Du måste dra ${game.pending_draw} kort!`)
    await drawCards(game.pending_draw, false)
    await updateGame(state.gameId, { pending_draw: 0 })
  }
}

// ── KULO button ────────────────────────────────────────────────
document.getElementById('kulo-btn').addEventListener('click', async () => {
  await updatePlayer(state.playerId, { kulo_called: true })
  toast('🔔 KULO! Du är säker!')
})

// ── Check win condition ────────────────────────────────────────
async function checkWin(hand) {
  if (hand.length === 0) {
    await updateGame(state.gameId, { status: 'finished', winner_id: state.playerId })
    toast('🎉 Du vann! KULO!')
  }
}

// ── WINNER SCREEN ──────────────────────────────────────────────
function renderWinner() {
  showScreen('winner')
  const winner = state.players.find(p => p.id === state.game?.winner_id)
  document.getElementById('winner-name').textContent = winner?.name || '???'
  document.getElementById('winner-is-you').style.display =
    state.game?.winner_id === state.playerId ? 'block' : 'none'
}

document.getElementById('btn-play-again').addEventListener('click', async () => {
  if (state.isHost) {
    // Reset game to lobby
    await updateGame(state.gameId, { status: 'lobby', winner_id: null })
    // Reset all players
    for (const p of state.players) {
      await updatePlayer(p.id, { hand: [], kulo_called: false })
    }
  } else {
    toast('Vänta på att hosten startar om spelet!')
  }
})

document.getElementById('btn-leave').addEventListener('click', async () => {
  // Remove player
  await supabase.from('players').delete().eq('id', state.playerId)
  if (state.subscription) supabase.removeChannel(state.subscription)
  window.location.reload()
})

// ── INIT ───────────────────────────────────────────────────────
async function init() {
  // Check for ?join= query param (scanned QR)
  const params = new URLSearchParams(window.location.search)
  const joinCode = params.get('join')
  if (joinCode) {
    // Pre-fill join code and show setup
    window.history.replaceState({}, '', window.location.pathname)
    showScreen('setup')
    document.getElementById('setup-mode').dataset.mode = 'join'
    document.getElementById('setup-title').textContent = 'Gå med i spel'
    document.getElementById('setup-code-row').style.display = 'flex'
    document.getElementById('game-code').value = joinCode
    document.getElementById('player-name').focus()
    return
  }
  renderHome()
}

init()

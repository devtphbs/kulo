// ── Card colors per number ─────────────────────────────────────
export const NUM_COLORS = {
  1: { bg: '#e74c3c', name: 'Röd' },
  2: { bg: '#e67e22', name: 'Orange' },
  3: { bg: '#d4ac0d', name: 'Gul' },
  4: { bg: '#27ae60', name: 'Grön' },
  5: { bg: '#1abc9c', name: 'Turkos' },
  6: { bg: '#2980b9', name: 'Blå' },
  7: { bg: '#1a5276', name: 'Marinblå' },
  8: { bg: '#8e44ad', name: 'Lila' },
  9: { bg: '#e91e8c', name: 'Rosa' },
}

// ── Build the full deck ────────────────────────────────────────
export function buildDeck() {
  const cards = []
  let id = 0
  const mk = (obj) => ({ id: id++, ...obj })

  // Numbers 1–9: 8 copies each
  for (let n = 1; n <= 9; n++) {
    for (let i = 0; i < 8; i++) {
      cards.push(mk({ type: 'number', value: n, color: NUM_COLORS[n].name, bg: NUM_COLORS[n].bg }))
    }
  }

  // Suited specials (one per number-color, some 2x)
  const specials2x = ['Hoppa Över', 'Vänd', 'Dra 2']
  const specials1x = ['Frys', 'Ge Bort', 'Stjäl', 'Byt Hand']

  for (let n = 1; n <= 9; n++) {
    const col = NUM_COLORS[n]
    for (const s of specials2x) {
      cards.push(mk({ type: 'special', name: s, color: col.name, bg: col.bg }))
      cards.push(mk({ type: 'special', name: s, color: col.name, bg: col.bg }))
    }
    for (const s of specials1x) {
      cards.push(mk({ type: 'special', name: s, color: col.name, bg: col.bg }))
    }
  }

  // Wild cards
  for (let i = 0; i < 6; i++) cards.push(mk({ type: 'wild', name: 'Byt Färg', bg: 'wild' }))
  for (let i = 0; i < 6; i++) cards.push(mk({ type: 'wild', name: 'Dra 4', bg: 'wild' }))

  return cards
}

// ── Shuffle ───────────────────────────────────────────────────
export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Can a card be played? ─────────────────────────────────────
export function canPlay(card, topCard, activeColor) {
  if (!topCard) return true
  if (card.type === 'wild') return true

  // Match color
  const cardColor = card.color
  const matchColor = activeColor || topCard.color
  if (cardColor === matchColor) return true

  // Match number for number cards
  if (card.type === 'number' && topCard.type === 'number' && card.value === topCard.value) return true

  // Match special name
  if (card.type === 'special' && topCard.type === 'special' && card.name === topCard.name) return true

  return false
}

// ── Get card display color ─────────────────────────────────────
export function getCardBg(card, activeColor) {
  if (card.bg === 'wild') {
    return 'conic-gradient(#e74c3c 0deg 40deg,#e67e22 40deg 80deg,#d4ac0d 80deg 120deg,#27ae60 120deg 160deg,#1abc9c 160deg 200deg,#2980b9 200deg 240deg,#8e44ad 240deg 280deg,#e91e8c 280deg 320deg,#e74c3c 320deg 360deg)'
  }
  return card.bg
}

// ── Get color bg by name ───────────────────────────────────────
export function colorByName(name) {
  const found = Object.values(NUM_COLORS).find(c => c.name === name)
  return found ? found.bg : '#888'
}

// ── Funny texts per card ───────────────────────────────────────
export const FUNNY = {
  1: '"Ettan. Ensam men stolt."',
  2: '"Tvåan. Dubbelt så bra. Typ."',
  3: '"Trean — ett magiskt tal!"',
  4: '"Fyran! Som årstiderna, men roligare."',
  5: '"Femman. Halvvägs till 10!"',
  6: '"Sexan. Det är allt."',
  7: '"Sjuan — tur? (Garanteras ej.)"',
  8: '"Åttan. Liggandes = oändligheten."',
  9: '"Nian. Nästan klar. Nästan."',
  'Hoppa Över': '"Ingen tur för dig. Bokstavligen."',
  'Vänd': '"Panik! Fel håll nu."',
  'Dra 2': '"Ta två. Gratis! (Inte gratis.)"',
  'Frys': '"2 turer utan dig. Vi klarar oss."',
  'Ge Bort': '"Ge 3 kort. Välj med ondska."',
  'Stjäl': '"Ta ett kort. Ingen dömer dig."',
  'Byt Hand': '"Byt hela handen. Kaoset börjar."',
  'Byt Färg': '"Välj ny färg. Makt!"',
  'Dra 4': '"Näste drar 4. Förlåt aldrig."',
}

// ── Game logic helpers ─────────────────────────────────────────

export function nextPlayerIndex(currentIndex, direction, playerCount, skip = 1) {
  return ((currentIndex + direction * skip) % playerCount + playerCount) % playerCount
}

export function getActiveColor(topCard, activeColor) {
  if (activeColor) return activeColor
  if (!topCard) return null
  return topCard.color || null
}

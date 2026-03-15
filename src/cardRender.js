import { FUNNY, NUM_COLORS } from './cards.js'

export function renderCard(card, opts = {}) {
  const { selected = false, unplayable = false, large = false, isBack = false } = opts

  if (isBack) return renderBackCard(large)

  const div = document.createElement('div')
  div.className = `card${large ? ' lg' : ''}${selected ? ' selected' : ''}${unplayable ? ' unplayable' : ''}`

  const isWild = card.type === 'wild'

  if (isWild) {
    div.classList.add('wild-gradient')
  } else {
    div.style.background = card.bg
  }

  const cornerText = card.type === 'number' ? String(card.value)
    : card.type === 'special' ? card.name
    : card.name

  const isSmCorner = card.type !== 'number'
  const stripText = isWild ? 'VILDKORT' : card.color?.toUpperCase()
  const funny = card.type === 'number' ? FUNNY[card.value] : FUNNY[card.name] || ''

  div.innerHTML = `
    <div class="card-frame"></div>
    ${!isWild ? '<div class="card-oval"></div>' : ''}
    <div class="card-tl">
      <span class="card-corner-num${isSmCorner ? ' sm' : ''}">${cornerText}</span>
    </div>
    <div class="card-br">
      <span class="card-corner-num${isSmCorner ? ' sm' : ''}">${cornerText}</span>
    </div>
    <div class="card-center">
      ${card.type === 'number'
        ? `<div class="card-big-num">${card.value}</div>`
        : `<div class="card-big-label">${card.name}</div>`
      }
      ${funny ? `<div class="card-funny">${funny}</div>` : ''}
    </div>
    <div class="card-strip"><span>${stripText}</span></div>
  `

  return div
}

function renderBackCard(large = false) {
  const div = document.createElement('div')
  div.className = `card card-back${large ? ' lg' : ''}`
  div.innerHTML = `
    <div class="card-back-inner">
      <div class="card-back-title">KULO</div>
      <div class="card-back-sub">kortspelet</div>
    </div>
  `
  return div
}

// Render color picker overlay
export function renderColorPicker(onSelect) {
  const overlay = document.createElement('div')
  overlay.className = 'color-picker-overlay'
  overlay.innerHTML = `
    <div class="color-picker-box">
      <h3>Välj ny färg 🎨</h3>
      <div class="color-grid" id="colorGrid"></div>
    </div>
  `
  document.body.appendChild(overlay)

  const grid = overlay.querySelector('#colorGrid')
  Object.entries(NUM_COLORS).forEach(([n, c]) => {
    const btn = document.createElement('div')
    btn.className = 'color-btn'
    btn.style.background = c.bg
    btn.textContent = c.name
    btn.addEventListener('click', () => {
      overlay.remove()
      onSelect(c.name)
    })
    grid.appendChild(btn)
  })

  return overlay
}

// Render target picker
export function renderTargetPicker(players, selfId, onSelect) {
  const overlay = document.createElement('div')
  overlay.className = 'target-picker-overlay'
  const box = document.createElement('div')
  box.className = 'target-picker-box'
  box.innerHTML = `<h3 style="font-family:'Fredoka One',cursive;font-size:18px">Välj spelare 👇</h3>`
  overlay.appendChild(box)
  document.body.appendChild(overlay)

  players.filter(p => p.id !== selfId).forEach(p => {
    const btn = document.createElement('button')
    btn.className = 'target-btn'
    btn.textContent = p.name
    btn.addEventListener('click', () => {
      overlay.remove()
      onSelect(p.id)
    })
    box.appendChild(btn)
  })

  return overlay
}

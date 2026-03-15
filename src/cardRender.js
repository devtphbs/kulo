import {FUNNY,NUM_COLORS} from './cards.js'

export function renderCard(card,{selected=false,unplayable=false,large=false,isBack=false,bwMode=false}={}){
  if(isBack){
    const d=document.createElement('div')
    d.className='card card-back'+(large?' lg':'')
    d.innerHTML=`<div class="card-back-inner"><div class="card-back-title">KULO</div><div class="card-back-sub">kortspelet</div></div>`
    return d
  }
  const d=document.createElement('div')
  const isWild=card.type==='wild'
  if(bwMode){d.className='card bw-card'+(large?' lg':'')+(selected?' selected':'')+(unplayable?' unplayable':'')}
  else{d.className='card'+(large?' lg':'')+(selected?' selected':'')+(unplayable?' unplayable':'')+(isWild?' wild-bg':'');if(!isWild)d.style.background=card.bg}
  const corner=card.type==='number'?String(card.value):card.name
  const isSm=card.type!=='number'
  const strip=isWild?'VILDKORT':(card.color?.toUpperCase()||'')
  const funny=card.type==='number'?FUNNY[card.value]:FUNNY[card.name]||''
  d.innerHTML=`
    <div class="card-frame"></div>
    ${!isWild?'<div class="card-oval"></div>':''}
    <div class="card-tl"><span class="cnum${isSm?' sm':''}">${corner}</span></div>
    <div class="card-br"><span class="cnum${isSm?' sm':''}">${corner}</span></div>
    <div class="card-center">
      ${card.type==='number'?`<div class="c-big-num">${card.value}</div>`:`<div class="c-big-label">${card.name}</div>`}
      ${funny?`<div class="c-funny">${funny}</div>`:''}
    </div>
    <div class="c-strip"><span>${strip}</span></div>
  `
  return d
}

export function showColorPicker(onSelect){
  const overlay=document.getElementById('color-picker')
  const wheel=document.getElementById('color-wheel')
  wheel.innerHTML=''
  Object.values(NUM_COLORS).forEach(c=>{
    const btn=document.createElement('div')
    btn.className='color-btn'
    btn.style.background=c.bg
    btn.textContent=c.name
    btn.addEventListener('click',()=>{overlay.style.display='none';onSelect(c.name)})
    wheel.appendChild(btn)
  })
  overlay.style.display='flex'
}

export function showTargetPicker(players,selfId,title,onSelect){
  const overlay=document.getElementById('target-picker')
  document.getElementById('target-title').textContent=title||'Välj spelare'
  const list=document.getElementById('target-list')
  list.innerHTML=''
  players.filter(p=>p.id!==selfId).forEach(p=>{
    const btn=document.createElement('button')
    btn.className='target-btn'
    btn.textContent=p.name+' ('+((p.hand||[]).length)+' kort)'
    btn.addEventListener('click',()=>{overlay.style.display='none';onSelect(p.id)})
    list.appendChild(btn)
  })
  overlay.style.display='flex'
}

export function colorBgByName(name){
  const f=Object.values(NUM_COLORS).find(c=>c.name===name)
  return f?f.bg:'#888'
}

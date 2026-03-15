import './style.css'
import {supabase} from './supabase.js'
import {buildDeck,shuffle,canPlay,nextPlayerIndex,NUM_COLORS} from './cards.js'
import {renderCard,showColorPicker,showTargetPicker,colorBgByName} from './cardRender.js'
import QRCode from 'qrcode'

// ── State ─────────────────────────────────────────────────────
const S={
  gameId:null,playerId:null,playerName:null,isHost:false,
  game:null,players:[],myHand:[],selectedCard:null,
  subscription:null,maxPlayers:4,colorMode:'color',
  timerInterval:null,timerSec:60,
}

// ── Screens ───────────────────────────────────────────────────
function show(name){
  document.querySelectorAll('.screen').forEach(s=>{s.style.display='none'})
  const el=document.getElementById(name+'-screen')
  if(el)el.style.display='flex'
  if(name==='game')el.style.cssText+='flex-direction:column!important'
}

// ── Helpers ───────────────────────────────────────────────────
function genId(n){return Math.random().toString(36).substring(2,2+n).toUpperCase()}
function toast(msg){
  const c=document.getElementById('toasts')
  const t=document.createElement('div');t.className='toast';t.textContent=msg
  c.appendChild(t);setTimeout(()=>t.remove(),3200)
}
function myTurn(){
  if(!S.game||!S.players.length)return false
  return S.players[S.game.current_player_index]?.id===S.playerId
}
function isFrozen(){return((S.game?.frozen_turns||{})[S.playerId]||0)>0}
function bwMode(){return S.game?.color_mode==='bw'}

// ── Draw notification ─────────────────────────────────────────
function showDrawNotif(msg){
  const el=document.getElementById('draw-notif')
  el.textContent=msg;el.style.display='block'
  clearTimeout(el._t)
  el._t=setTimeout(()=>{el.style.display='none'},5000)
}

// ── Turn timer ────────────────────────────────────────────────
function startTimer(){
  clearInterval(S.timerInterval)
  S.timerSec=60
  updateTimerDisplay()
  S.timerInterval=setInterval(async()=>{
    S.timerSec--
    updateTimerDisplay()
    if(S.timerSec<=0){
      clearInterval(S.timerInterval)
      toast('Du tog för lång tid! Du åker ut 😬')
      await kickPlayer(S.playerId)
    }
  },1000)
}
function stopTimer(){clearInterval(S.timerInterval);document.getElementById('turn-timer').textContent=''}
function updateTimerDisplay(){
  const el=document.getElementById('turn-timer')
  el.textContent=S.timerSec+'s'
  el.className='turn-timer'+(S.timerSec<=15?' warning':'')+(S.timerSec<=5?' danger':'')
}
async function kickPlayer(pid){
  await supabase.from('players').delete().eq('id',pid)
}

// ── DB ────────────────────────────────────────────────────────
async function getGame(id){const{data}=await supabase.from('games').select('*').eq('id',id).single();return data}
async function getPlayers(gid){const{data}=await supabase.from('players').select('*').eq('game_id',gid).order('turn_order');return data||[]}
async function updateGame(gid,u){await supabase.from('games').update({...u,updated_at:new Date().toISOString()}).eq('id',gid)}
async function updatePlayer(pid,u){await supabase.from('players').update(u).eq('id',pid)}

// ── Realtime ──────────────────────────────────────────────────
function subscribe(gameId){
  if(S.subscription)supabase.removeChannel(S.subscription)
  S.subscription=supabase.channel('game:'+gameId)
    .on('postgres_changes',{event:'*',schema:'public',table:'games',filter:'id=eq.'+gameId},async()=>{
      S.game=await getGame(gameId);onUpdate()
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'players',filter:'game_id=eq.'+gameId},async()=>{
      S.players=await getPlayers(gameId)
      const me=S.players.find(p=>p.id===S.playerId)
      if(me)S.myHand=me.hand||[]
      onUpdate()
    })
    .subscribe()
}

async function onUpdate(){
  if(!S.game)return
  const status=S.game.status
  if(status==='lobby'){
    renderLobby()
    if(S.game.max_players>0&&S.players.length>=S.game.max_players&&S.isHost){
      toast('Alla är här! Startar... 🚀')
      setTimeout(()=>startGame(),800)
    }
  } else if(status==='rules'){
    renderRules()
  } else if(status==='playing'){
    show('game')
    // Check if I just got forced to draw
    const la=S.game.last_action
    if(la&&la.type==='draw'&&la.target===S.playerId&&!la.seen_by?.includes(S.playerId)){
      const actor=S.players.find(p=>p.id===la.by)
      showDrawNotif((actor?.name||'Någon')+' lade ett '+la.card+'-kort!\nDu fick '+la.count+' nya kort från kortbunten. 🃏')
      // Mark as seen
      const seen=[...(la.seen_by||[]),S.playerId]
      await updateGame(S.gameId,{last_action:{...la,seen_by:seen}})
      // Auto draw cards
      await doDraw(la.count)
      return
    }
    // Timer
    if(myTurn()&&!isFrozen()){startTimer()}else{stopTimer()}
    renderGame()
  } else if(status==='finished'){
    stopTimer();renderWinner()
  }
}

// ── HOME ──────────────────────────────────────────────────────
document.getElementById('btn-create').addEventListener('click',()=>{
  document.getElementById('setup-title').textContent='Skapa spel'
  document.getElementById('setup-mode').dataset.mode='create'
  document.getElementById('setup-code-row').style.display='none'
  document.getElementById('setup-players-row').style.display='flex'
  document.getElementById('setup-color-row').style.display='flex'
  document.getElementById('player-name').value=''
  document.getElementById('btn-enter').disabled=false
  document.getElementById('btn-enter').textContent='Kör! 🚀'
  show('setup')
})
document.getElementById('btn-join').addEventListener('click',()=>{
  document.getElementById('setup-title').textContent='Gå med i spel'
  document.getElementById('setup-mode').dataset.mode='join'
  document.getElementById('setup-code-row').style.display='flex'
  document.getElementById('setup-players-row').style.display='none'
  document.getElementById('setup-color-row').style.display='none'
  document.getElementById('player-name').value=''
  document.getElementById('game-code').value=''
  document.getElementById('btn-enter').disabled=false
  document.getElementById('btn-enter').textContent='Kör! 🚀'
  show('setup')
})

// ── SETUP ─────────────────────────────────────────────────────
let pickedPlayers=4,pickedColorMode='color'
document.getElementById('btn-back-home').addEventListener('click',()=>show('home'))
document.getElementById('count-down').addEventListener('click',()=>{if(pickedPlayers>2){pickedPlayers--;document.getElementById('count-display').textContent=pickedPlayers}})
document.getElementById('count-up').addEventListener('click',()=>{if(pickedPlayers<6){pickedPlayers++;document.getElementById('count-display').textContent=pickedPlayers}})
document.getElementById('mode-color').addEventListener('click',()=>setColorMode('color'))
document.getElementById('mode-bw').addEventListener('click',()=>setColorMode('bw'))
function setColorMode(m){
  pickedColorMode=m
  document.getElementById('mode-color').classList.toggle('active',m==='color')
  document.getElementById('mode-bw').classList.toggle('active',m==='bw')
}

document.getElementById('btn-enter').addEventListener('click',async()=>{
  const mode=document.getElementById('setup-mode').dataset.mode
  const name=document.getElementById('player-name').value.trim()
  const code=document.getElementById('game-code').value.trim().toUpperCase()
  if(!name){toast('Skriv in ditt namn! 😅');return}
  if(mode==='join'&&!code){toast('Skriv in spelkoden! 🎮');return}
  const btn=document.getElementById('btn-enter')
  btn.disabled=true;btn.textContent='Laddar...'
  try{
    if(mode==='create')await createGame(name)
    else await joinGame(name,code)
  }catch(e){console.error(e);toast('Något gick fel 😬');btn.disabled=false;btn.textContent='Kör! 🚀'}
})

async function createGame(name){
  const gameId=genId(4),playerId=genId(10)
  await supabase.from('games').insert({
    id:gameId,host_id:playerId,status:'lobby',
    current_player_index:0,direction:1,
    draw_pile:[],discard_pile:[],frozen_turns:{},pending_draw:0,
    max_players:pickedPlayers,color_mode:pickedColorMode,last_action:null,
  })
  await supabase.from('players').insert({id:playerId,game_id:gameId,name,hand:[],is_host:true,turn_order:0,kulo_called:false,rules_ok:false})
  S.playerId=playerId;S.playerName=name;S.gameId=gameId;S.isHost=true;S.myHand=[]
  S.colorMode=pickedColorMode
  S.game=await getGame(gameId);S.players=await getPlayers(gameId)
  subscribe(gameId);show('lobby');renderLobby()
}

async function joinGame(name,code){
  const game=await getGame(code)
  if(!game){toast('Hittade inget spel! 🤔');document.getElementById('btn-enter').disabled=false;document.getElementById('btn-enter').textContent='Kör! 🚀';return}
  if(game.status!=='lobby'){toast('Spelet har startat! 🎮');document.getElementById('btn-enter').disabled=false;document.getElementById('btn-enter').textContent='Kör! 🚀';return}
  const players=await getPlayers(code)
  if(players.length>=6){toast('Fullt! Max 6 spelare 😅');document.getElementById('btn-enter').disabled=false;document.getElementById('btn-enter').textContent='Kör! 🚀';return}
  const playerId=genId(10)
  await supabase.from('players').insert({id:playerId,game_id:code,name,hand:[],is_host:false,turn_order:players.length,kulo_called:false,rules_ok:false})
  S.playerId=playerId;S.playerName=name;S.gameId=code;S.isHost=false;S.myHand=[]
  S.colorMode=game.color_mode||'color'
  S.game=game;S.players=await getPlayers(code)
  subscribe(code);show('lobby');renderLobby()
}

// ── LOBBY ─────────────────────────────────────────────────────
async function renderLobby(){
  show('lobby')
  document.getElementById('lobby-code').textContent=S.gameId
  const joinUrl=window.location.origin+'?join='+S.gameId
  try{await QRCode.toCanvas(document.getElementById('qr-canvas'),joinUrl,{width:180,margin:1,color:{dark:'#000',light:'#fff'}})}catch(e){}
  const list=document.getElementById('lobby-players');list.innerHTML=''
  S.players.forEach(p=>{
    const d=document.createElement('div');d.className='player-item'
    d.innerHTML=`<span>${p.name}</span><div style="display:flex;gap:6px">${p.is_host?'<span class="host-badge">HOST</span>':''}${p.id===S.playerId?'<span class="you-badge">DU</span>':''}</div>`
    list.appendChild(d)
  })
  const max=S.game?.max_players||0,cur=S.players.length
  const pw=document.getElementById('progress-wrap')
  if(max>0){
    pw.style.display='flex'
    document.getElementById('progress-fill').style.width=Math.min(100,(cur/max)*100)+'%'
    document.getElementById('progress-text').textContent=cur+' / '+max+' spelare'
  }else{pw.style.display='none'}
  document.getElementById('lobby-waiting').textContent=max>0&&cur>=max?'Alla är här! 🚀':max>0?'Väntar på '+(max-cur)+' till...':'Väntar på spelare...'
  const sb=document.getElementById('btn-start-game')
  if(S.isHost&&cur>=2){sb.style.display='flex';sb.disabled=false;sb.textContent='🚀 Starta ändå ('+cur+' spelare)'}
  else if(S.isHost){sb.style.display='flex';sb.disabled=true;sb.textContent='Behöver minst 2 spelare'}
  else{sb.style.display='none'}
}
document.getElementById('btn-start-game').addEventListener('click',async()=>{if(S.isHost&&S.players.length>=2)await startGame()})

async function startGame(){
  let deck=shuffle(buildDeck())
  const players=shuffle([...S.players])
  const hands={}
  players.forEach(p=>{hands[p.id]=[]})
  for(let i=0;i<7;i++)players.forEach(p=>{hands[p.id].push(deck.pop())})
  let topCard=deck.pop()
  while(topCard.type!=='number'){deck.unshift(topCard);topCard=deck.pop()}
  for(let i=0;i<players.length;i++)await supabase.from('players').update({turn_order:i,hand:hands[players[i].id],kulo_called:false,rules_ok:false}).eq('id',players[i].id)
  const me=players.find(p=>p.id===S.playerId)
  if(me)S.myHand=hands[me.id]
  // Go to rules screen first
  await updateGame(S.gameId,{
    status:'rules',current_player_index:0,direction:1,
    top_card:topCard,active_color:topCard.color||null,
    draw_pile:deck,discard_pile:[topCard],
    frozen_turns:{},pending_draw:0,winner_id:null,last_action:null,
  })
}

// ── RULES SCREEN ──────────────────────────────────────────────
function renderRules(){
  show('rules')
  // Update confirmed list
  const confirmed=S.players.filter(p=>p.rules_ok)
  const total=S.players.length
  const cl=document.getElementById('rules-confirmed-list');cl.innerHTML=''
  confirmed.forEach(p=>{
    const b=document.createElement('div');b.className='confirmed-badge';b.textContent='✅ '+p.name
    cl.appendChild(b)
  })
  const wt=document.getElementById('rules-wait-text')
  wt.textContent=confirmed.length+' / '+total+' har tryckt Förstår'
  const me=S.players.find(p=>p.id===S.playerId)
  const okBtn=document.getElementById('btn-rules-ok')
  if(me?.rules_ok){okBtn.disabled=true;okBtn.textContent='✅ Klart!'}
  else{okBtn.disabled=false;okBtn.textContent='✅ Förstår!'}
  // If all confirmed and I am host → start playing
  if(confirmed.length>=total&&S.isHost){
    setTimeout(async()=>{
      await updateGame(S.gameId,{status:'playing'})
    },500)
  }
}
document.getElementById('btn-rules-ok').addEventListener('click',async()=>{
  await updatePlayer(S.playerId,{rules_ok:true})
  document.getElementById('btn-rules-ok').disabled=true
  document.getElementById('btn-rules-ok').textContent='✅ Klart!'
})

// ── GAME ──────────────────────────────────────────────────────
function renderGame(){
  const game=S.game,players=S.players
  const me=players.find(p=>p.id===S.playerId)
  if(!me)return
  S.myHand=me.hand||[]
  const isMyTurn=myTurn(),frozen=isFrozen()
  const cur=players[game.current_player_index]

  document.getElementById('game-turn-label')?.remove()
  document.getElementById('game-logo')?.setAttribute('title',isMyTurn?(frozen?'❄️ Du är fryst':'🎯 Din tur'):cur?.name+'s tur')

  // Opponents
  const othersEl=document.getElementById('game-others');othersEl.innerHTML=''
  players.filter(p=>p.id!==S.playerId).forEach(p=>{
    const isActive=players[game.current_player_index]?.id===p.id
    const fl=(game.frozen_turns||{})[p.id]||0
    const hc=(p.hand||[]).length
    const d=document.createElement('div');d.className='opp'+(isActive?' active':'')
    d.innerHTML=`
      <div class="opp-cards-viz">${Array.from({length:Math.min(hc,5)},(_,i)=>`<div class="opp-mini" style="left:${i*9}px;background:hsl(${i*40},60%,45%)"></div>`).join('')}</div>
      <div class="opp-name">${p.name}</div>
      <div class="opp-count">${hc} kort</div>
      ${p.kulo_called?'<div class="opp-kulo">KULO!</div>':''}
      ${fl>0?`<div class="opp-frozen">❄️ ${fl}t</div>`:''}
    `
    othersEl.appendChild(d)
  })

  // Top card
  const ts=document.getElementById('top-card-slot');ts.innerHTML=''
  if(game.top_card){
    const ce=renderCard(game.top_card,{large:true,bwMode:bwMode()})
    if(game.active_color&&game.active_color!==game.top_card.color){
      const t=document.createElement('div')
      t.style.cssText=`position:absolute;inset:0;border-radius:7px;background:${colorBgByName(game.active_color)};opacity:.35;pointer-events:none;z-index:5`
      ce.appendChild(t)
    }
    ts.appendChild(ce)
  }

  // Color dot
  const cd=document.getElementById('active-color-dot')
  if(game.active_color){cd.style.background=colorBgByName(game.active_color);cd.style.display='block'}
  else{cd.style.display='none'}

  // Turn label in top bar
  const tl=document.getElementById('turn-timer')
  if(!isMyTurn){tl.textContent='';tl.className='turn-timer'}

  // Status
  const banner=document.getElementById('status-banner')
  if(isMyTurn&&frozen){
    banner.className='status-banner frozen'
    const fl=(game.frozen_turns||{})[S.playerId]||0
    banner.textContent='❄️ Fryst — '+fl+' tur'+(fl>1?'er':'')+' kvar'
  }else if(isMyTurn){
    banner.className='status-banner your-turn'
    banner.textContent=game.pending_draw>0?'⚡ Dra '+game.pending_draw+' kort eller stacka!':'✨ Din tur!'
  }else{
    banner.className='status-banner waiting'
    banner.textContent='⏳ '+( cur?.name||'')+'s tur...'
  }

  // Draw pile
  const dp=document.getElementById('draw-pile-slot');dp.innerHTML='<div class="pile-label">Dra kort</div>'
  dp.appendChild(renderCard(null,{isBack:true,large:true}))

  renderHand(isMyTurn&&!frozen)

  document.getElementById('kulo-btn').style.display=(S.myHand.length===1&&!me.kulo_called)?'block':'none'
}

function renderHand(canAct){
  const he=document.getElementById('hand-cards');he.innerHTML=''
  const game=S.game
  const sorted=[...S.myHand].map((c,i)=>({c,i})).sort((a,b)=>{
    const o={number:0,special:1,wild:2}
    const d=(o[a.c.type]||0)-(o[b.c.type]||0)
    if(d!==0)return d
    if(a.c.type==='number')return(a.c.value||0)-(b.c.value||0)
    return(a.c.name||'').localeCompare(b.c.name||'')
  })
  sorted.forEach(({c:card,i:origIdx})=>{
    const playable=canAct&&canPlay(card,game.top_card,game.active_color)&&(game.pending_draw===0||card.name==='Dra 2'||card.name==='Dra 4')
    const isSel=S.selectedCard===origIdx
    const ce=renderCard(card,{selected:isSel,unplayable:!playable,bwMode:bwMode()})
    ce.addEventListener('click',()=>{
      if(!canAct){toast('Inte din tur! 😅');return}
      if(!playable){toast('Passar inte! 🚫');return}
      if(isSel){S.selectedCard=null;playCard(origIdx)}
      else{S.selectedCard=origIdx;renderHand(canAct)}
    })
    he.appendChild(ce)
  })
}

document.getElementById('draw-pile-slot').addEventListener('click',async()=>{
  if(!myTurn()||isFrozen())return
  if(S.game?.pending_draw>0){
    const hasStack=S.myHand.some(c=>c.name==='Dra 2'||c.name==='Dra 4')
    if(!hasStack){await doDraw(S.game.pending_draw);return}
    toast('Du kan stacka ett Dra-kort!')
    return
  }
  await doDraw(1,true)
})

async function doDraw(count,fromClick=false){
  const game=S.game
  let deck=[...(game.draw_pile||[])],discard=[...(game.discard_pile||[])]
  if(deck.length<count){const keep=discard.splice(discard.length-1,1);deck=shuffle(discard);discard=keep;toast('Kortleken blandas om! 🔀')}
  const drawn=deck.splice(deck.length-count,count)
  const newHand=[...S.myHand,...drawn]
  S.myHand=newHand
  await updatePlayer(S.playerId,{hand:newHand})
  await updateGame(S.gameId,{draw_pile:deck,discard_pile:discard,pending_draw:0})
  if(fromClick&&drawn.length===1){
    if(canPlay(drawn[0],game.top_card,game.active_color)){toast('Passar — tryck för att lägga!');renderHand(true);return}
    else{toast('Passar inte, passar!')}
  }
  await advanceToNext()
}

async function playCard(idx){
  const card=S.myHand[idx],game=S.game,players=S.players
  S.selectedCard=null
  if(game.pending_draw>0&&card.name!=='Dra 2'&&card.name!=='Dra 4'){toast('Dra kort eller stacka! 😬');return}
  const newHand=S.myHand.filter((_,i)=>i!==idx)
  S.myHand=newHand
  await updatePlayer(S.playerId,{hand:newHand})
  stopTimer()
  const newDiscard=[...(game.discard_pile||[]),card]
  const updates={top_card:card,discard_pile:newDiscard,active_color:card.color||game.active_color,pending_draw:0}
  let skip=0,rev=false,pd=0,needColor=false,needTarget=false,ta=null
  switch(card.name){
    case 'Hoppa Över':skip=1;break
    case 'Vänd':rev=true;break
    case 'Dra 2':pd=(game.pending_draw||0)+2;break
    case 'Dra 4':pd=(game.pending_draw||0)+4;needColor=true;break
    case 'Byt Färg':needColor=true;break
    case 'Frys':needTarget=true;ta='frys';break
    case 'Ge Bort':needTarget=true;ta='gebart';break
    case 'Stjäl':needTarget=true;ta='stjal';break
    case 'Byt Hand':needTarget=true;ta='bythand';break
  }
  updates.pending_draw=pd

  if(needColor){
    showColorPicker(async(color)=>{
      updates.active_color=color
      if(rev)updates.direction=game.direction*-1
      // If draw card, notify next player
      if(pd>0){
        const nextIdx=nextPlayerIndex(game.current_player_index,rev?game.direction*-1:game.direction,players.length,1)
        const nextPlayer=players[nextIdx]
        updates.last_action={type:'draw',by:S.playerId,target:nextPlayer?.id,count:pd,card:card.name,seen_by:[]}
      }
      await updateGame(S.gameId,updates)
      await advanceToNext(rev?game.direction*-1:game.direction,pd>0?1:skip)
      await checkWin(newHand)
    })
    return
  }

  if(needTarget){
    const others=players.filter(p=>p.id!==S.playerId)
    if(!others.length){await updateGame(S.gameId,updates);await advanceToNext();await checkWin(newHand);return}
    const titles={frys:'❄️ Välj vem som fryser',gebart:'🤝 Välj vem som får kort',stjal:'🎯 Stjäl från vem?',bythand:'🔄 Byt hand med vem?'}
    showTargetPicker(players,S.playerId,titles[ta],async(tid)=>{
      await applyTarget(ta,tid,updates,rev,skip);await checkWin(newHand)
    })
    return
  }

  if(rev){updates.direction=game.direction*-1;if(players.length===2)skip=1}
  // Notify next player for Dra 2
  if(pd>0){
    const nextIdx=nextPlayerIndex(game.current_player_index,rev?game.direction*-1:game.direction,players.length,1)
    const nextPlayer=players[nextIdx]
    updates.last_action={type:'draw',by:S.playerId,target:nextPlayer?.id,count:pd,card:card.name,seen_by:[]}
  }
  await updateGame(S.gameId,updates)
  await advanceToNext(rev?game.direction*-1:game.direction,skip)
  await checkWin(newHand)
}

async function applyTarget(action,tid,updates,rev,skip){
  const game=S.game,players=S.players
  const target=players.find(p=>p.id===tid);if(!target)return
  let th=[...(target.hand||[])],mh=[...S.myHand]
  if(action==='frys'){const fr={...(game.frozen_turns||{})};fr[tid]=(fr[tid]||0)+2;updates.frozen_turns=fr;toast('❄️ '+target.name+' är fryst i 2 turer!')}
  else if(action==='gebart'){const n=Math.min(3,mh.length),toGive=mh.splice(mh.length-n,n);th=[...th,...toGive];S.myHand=mh;await updatePlayer(S.playerId,{hand:mh});await updatePlayer(tid,{hand:th});toast('🤝 Gav '+n+' kort till '+target.name+'!')}
  else if(action==='stjal'){if(!th.length){toast(target.name+' har inga kort!')}else{const si=Math.floor(Math.random()*th.length),st=th.splice(si,1)[0];mh=[...mh,st];S.myHand=mh;await updatePlayer(S.playerId,{hand:mh});await updatePlayer(tid,{hand:th});toast('🎯 Du stal ett kort från '+target.name+'!')}}
  else if(action==='bythand'){S.myHand=th;await updatePlayer(S.playerId,{hand:th});await updatePlayer(tid,{hand:mh});toast('🔄 Bytte hand med '+target.name+'!')}
  if(rev)updates.direction=game.direction*-1
  await updateGame(S.gameId,updates)
  await advanceToNext(rev?game.direction*-1:game.direction,skip)
}

async function advanceToNext(dir,extraSkip=0){
  const game=S.game,players=S.players
  const d=dir??game.direction
  const nextIdx=nextPlayerIndex(game.current_player_index,d,players.length,1+extraSkip)
  const frozen={...(game.frozen_turns||{})}
  const next=players[nextIdx]
  if(next&&(frozen[next.id]||0)>0){
    frozen[next.id]--;toast('❄️ '+next.name+' är fryst, hoppar!')
    const si=nextPlayerIndex(nextIdx,d,players.length,1)
    await updateGame(S.gameId,{current_player_index:si,frozen_turns:frozen,direction:d})
    return
  }
  await updateGame(S.gameId,{current_player_index:nextIdx,direction:d})
}

async function checkWin(hand){if(hand.length===0)await updateGame(S.gameId,{status:'finished',winner_id:S.playerId})}

document.getElementById('kulo-btn').addEventListener('click',async()=>{await updatePlayer(S.playerId,{kulo_called:true});toast('🔔 KULO! Du är säker!')})

// ── WINNER ────────────────────────────────────────────────────
function renderWinner(){
  show('winner')
  const w=S.players.find(p=>p.id===S.game?.winner_id)
  document.getElementById('winner-name').textContent=w?.name||'???'
  document.getElementById('winner-you').style.display=S.game?.winner_id===S.playerId?'block':'none'
}
document.getElementById('btn-play-again').addEventListener('click',async()=>{
  if(!S.isHost){toast('Vänta på hosten! 😊');return}
  await updateGame(S.gameId,{status:'lobby',winner_id:null})
  for(const p of S.players)await updatePlayer(p.id,{hand:[],kulo_called:false,rules_ok:false})
})
document.getElementById('btn-leave').addEventListener('click',async()=>{
  await supabase.from('players').delete().eq('id',S.playerId)
  if(S.subscription)supabase.removeChannel(S.subscription)
  window.location.reload()
})

// ── INIT ──────────────────────────────────────────────────────
;(async()=>{
  document.querySelectorAll('.screen').forEach(s=>{s.style.display='none'})
  const params=new URLSearchParams(window.location.search)
  const joinCode=params.get('join')
  if(joinCode){
    window.history.replaceState({},'','/')
    document.getElementById('setup-title').textContent='Gå med i spel'
    document.getElementById('setup-mode').dataset.mode='join'
    document.getElementById('setup-code-row').style.display='flex'
    document.getElementById('setup-players-row').style.display='none'
    document.getElementById('setup-color-row').style.display='none'
    document.getElementById('game-code').value=joinCode
    show('setup')
    return
  }
  show('home')
})()

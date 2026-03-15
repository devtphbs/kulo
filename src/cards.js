export const NUM_COLORS = {
  1:{bg:'#e74c3c',name:'Röd'},2:{bg:'#e67e22',name:'Orange'},3:{bg:'#d4ac0d',name:'Gul'},
  4:{bg:'#27ae60',name:'Grön'},5:{bg:'#1abc9c',name:'Turkos'},6:{bg:'#2980b9',name:'Blå'},
  7:{bg:'#1a5276',name:'Marinblå'},8:{bg:'#8e44ad',name:'Lila'},9:{bg:'#e91e8c',name:'Rosa'},
}
export const FUNNY={
  1:'"Ettan. Ensam men stolt."',2:'"Tvåan. Dubbelt så bra. Typ."',3:'"Trean — magiskt!"',
  4:'"Fyran! Som årstiderna."',5:'"Femman. Halvvägs!"',6:'"Sexan. Det är allt."',
  7:'"Sjuan — tur? (Garanteras ej)"',8:'"Åttan = oändligheten liggandes."',9:'"Nian. Nästan klar."',
  'Hoppa Över':'"Ingen tur för dig!"','Vänd':'"Panik! Fel håll."',
  'Dra 2':'"Ta två. Inte gratis."','Frys':'"2 turer utan dig."',
  'Ge Bort':'"Ge 3 kort. Välj med ondska."','Stjäl':'"Ta ett. Ingen dömer dig."',
  'Byt Hand':'"Byt hand. Kaos börjar."','Byt Färg':'"Välj färg. Makt!"',
  'Dra 4':'"Näste drar 4. Förlåt inte."',
}
export function buildDeck(){
  const cards=[];let id=0;const mk=o=>({id:id++,...o})
  for(let n=1;n<=9;n++)for(let i=0;i<8;i++)cards.push(mk({type:'number',value:n,color:NUM_COLORS[n].name,bg:NUM_COLORS[n].bg}))
  const s2=['Hoppa Över','Vänd','Dra 2'],s1=['Frys','Ge Bort','Stjäl','Byt Hand']
  for(let n=1;n<=9;n++){const c=NUM_COLORS[n];s2.forEach(s=>{cards.push(mk({type:'special',name:s,color:c.name,bg:c.bg}));cards.push(mk({type:'special',name:s,color:c.name,bg:c.bg}))});s1.forEach(s=>cards.push(mk({type:'special',name:s,color:c.name,bg:c.bg})))}
  for(let i=0;i<6;i++)cards.push(mk({type:'wild',name:'Byt Färg',bg:'wild'}))
  for(let i=0;i<6;i++)cards.push(mk({type:'wild',name:'Dra 4',bg:'wild'}))
  return cards
}
export function shuffle(a){const r=[...a];for(let i=r.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[r[i],r[j]]=[r[j],r[i]]};return r}
export function canPlay(card,top,activeColor){
  if(!top)return true;if(card.type==='wild')return true
  const mc=activeColor||top.color
  if(card.color===mc)return true
  if(card.type==='number'&&top.type==='number'&&card.value===top.value)return true
  if(card.type==='special'&&top.type==='special'&&card.name===top.name)return true
  return false
}
export function nextPlayerIndex(cur,dir,count,skip=1){return((cur+dir*skip)%count+count)%count}

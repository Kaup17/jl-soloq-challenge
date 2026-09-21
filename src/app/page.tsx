import { Trophy, Radio, Swords, TrendingUp, Clock3, ExternalLink, Database } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

const players = [
  { name: 'Wati', gameName: 'PANZER KHABYL', tagLine: 'TACOS', twitch: 'wati' },
  { name: 'Kada', gameName: 'Gooner91', tagLine: 'PIED', twitch: 'kada' },
  { name: 'KobeADC', gameName: 'Pureskiled', tagLine: 'EUW', twitch: 'kobeadc' },
  { name: 'FakeMonster', gameName: 'MEGAPANZER', tagLine: '119KG', twitch: 'fakemonster' },
];

type RankedEntry = { queueType: string; tier: string; rank: string; leaguePoints: number; wins: number; losses: number };
type MatchDto = { metadata: { matchId: string }; info: { gameCreation: number; gameDuration: number; participants: Array<{ puuid:string; championName:string; kills:number; deaths:number; assists:number; win:boolean }> } };
type Player = (typeof players)[number] & { status:'ok'|'unranked'|'error'; puuid?:string; tier?:string; rank?:string; lp?:number; wins?:number; losses?:number; winrate?:number; lastGame?:{champion:string;kda:string;win:boolean;ago:string}; error?:string };
type HistoryRow = { id:number; created_at:string; player:string; riot_id:string; tier:string; division:string; lp:number; wins:number; losses:number; rank_score:number };

const tierScore: Record<string, number> = { IRON:0, BRONZE:400, SILVER:800, GOLD:1200, PLATINUM:1600, EMERALD:2000, DIAMOND:2400, MASTER:2800, GRANDMASTER:3800, CHALLENGER:4800 };
const divisionScore: Record<string, number> = { IV:0, III:100, II:200, I:300 };
const displayTier: Record<string,string> = { IRON:'Iron',BRONZE:'Bronze',SILVER:'Silver',GOLD:'Gold',PLATINUM:'Platinum',EMERALD:'Emerald',DIAMOND:'Diamond',MASTER:'Master',GRANDMASTER:'Grandmaster',CHALLENGER:'Challenger' };
function score(p:Player){ return p.status==='ok'&&p.tier ? (tierScore[p.tier]??0)+(divisionScore[p.rank??'']??0)+(p.lp??0) : -1 }
function rankLabel(p:Player){ return p.status==='ok' ? `${displayTier[p.tier!]??p.tier} ${['MASTER','GRANDMASTER','CHALLENGER'].includes(p.tier!)?'':p.rank}`.trim() : '—' }
function historyRankLabel(row:HistoryRow){ return `${displayTier[row.tier]??row.tier} ${['MASTER','GRANDMASTER','CHALLENGER'].includes(row.tier)?'':row.division} ${row.lp} LP`.replace(/\s+/g,' ').trim() }
function timeAgo(ts:number){ const m=Math.max(1,Math.floor((Date.now()-ts)/60000)); if(m<60)return `il y a ${m} min`; const h=Math.floor(m/60); if(h<24)return `il y a ${h} h`; return `il y a ${Math.floor(h/24)} j`; }
async function riotGet<T>(url:string,key:string):Promise<T>{ const r=await fetch(url,{headers:{'X-Riot-Token':key},cache:'no-store'}); if(!r.ok){const b=await r.text();throw new Error(`Riot API ${r.status}${b?`: ${b.slice(0,100)}`:''}`)} return r.json() as Promise<T> }
async function getPlayer(p:(typeof players)[number],key:string):Promise<Player>{ try { const a=await riotGet<{puuid:string}>(`https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(p.gameName)}/${encodeURIComponent(p.tagLine)}`,key); const entries=await riotGet<RankedEntry[]>(`https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(a.puuid)}`,key); const solo=entries.find(e=>e.queueType==='RANKED_SOLO_5x5'); let lastGame:Player['lastGame']; try { const ids=await riotGet<string[]>(`https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(a.puuid)}/ids?queue=420&start=0&count=1`,key); if(ids[0]){ const m=await riotGet<MatchDto>(`https://europe.api.riotgames.com/lol/match/v5/matches/${ids[0]}`,key); const me=m.info.participants.find(x=>x.puuid===a.puuid); if(me) lastGame={champion:me.championName,kda:`${me.kills}/${me.deaths}/${me.assists}`,win:me.win,ago:timeAgo(m.info.gameCreation)}; } } catch {} if(!solo)return {...p,status:'unranked',puuid:a.puuid,lastGame}; const games=solo.wins+solo.losses; return {...p,status:'ok',puuid:a.puuid,tier:solo.tier,rank:solo.rank,lp:solo.leaguePoints,wins:solo.wins,losses:solo.losses,winrate:games?Math.round(solo.wins/games*100):0,lastGame}; } catch(e){return {...p,status:'error',error:e instanceof Error?e.message:'Erreur inconnue'}} }

async function syncHistory(data:Player[]){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret=process.env.SUPABASE_SECRET_KEY;
  if(!url||!secret) return { history:[] as HistoryRow[], error:'Supabase non configuré' };
  const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const ok=data.filter((p):p is Player & {tier:string;rank:string;lp:number;wins:number;losses:number}=>p.status==='ok'&&!!p.tier&&!!p.rank&&p.lp!==undefined&&p.wins!==undefined&&p.losses!==undefined);
  for(const p of ok){
    const snapshot={player:p.name,riot_id:`${p.gameName}#${p.tagLine}`,tier:p.tier,division:p.rank,lp:p.lp,wins:p.wins,losses:p.losses,rank_score:score(p)};
    const {data:existing,error:checkError}=await supabase.from('rank_history').select('id').eq('player',snapshot.player).eq('riot_id',snapshot.riot_id).eq('tier',snapshot.tier).eq('division',snapshot.division).eq('lp',snapshot.lp).eq('wins',snapshot.wins).eq('losses',snapshot.losses).eq('rank_score',snapshot.rank_score).limit(1);
    if(checkError) return {history:[] as HistoryRow[],error:checkError.message};
    if(!existing?.length){
      const {error:insertError}=await supabase.from('rank_history').insert(snapshot);
      if(insertError) return {history:[] as HistoryRow[],error:insertError.message};
    }
  }
  const {data:history,error}=await supabase.from('rank_history').select('*').order('created_at',{ascending:true}).limit(500);
  return {history:(history??[]) as HistoryRow[],error:error?.message};
}

export default async function Home(){
  const key=process.env.RIOT_API_KEY;
  const data:Player[]=key?await Promise.all(players.map(p=>getPlayer(p,key))):players.map(p=>({...p,status:'error' as const,error:'RIOT_API_KEY absente'}));
  const ranked=[...data].sort((a,b)=>score(b)-score(a)); const leader=ranked[0];
  const {history, error:historyError}=await syncHistory(data);
  const peaks=Object.fromEntries(players.map(p=>{const rows=history.filter(h=>h.player===p.name);return [p.name,rows.length?rows.reduce((a,b)=>a.rank_score>b.rank_score?a:b):null]}));
  const updated=new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}).format(new Date());
  return <main className="gridbg min-h-screen"><div className="mx-auto max-w-6xl px-5 py-8">
  <header className="flex items-center justify-between border-b border-white/10 pb-6"><div><div className="text-xs font-black tracking-[.32em] text-lime-400">JL</div><h1 className="text-2xl font-black tracking-tight">SOLOQ CHALLENGE</h1></div><a className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/70 hover:text-white" href="https://dpm.lol/leaderboards/8cf31071-a140-46cc-8f76-32b2ce4feb4a" target="_blank">Leaderboard DPM ↗</a></header>
  <section className="py-14 text-center"><div className="mb-3 text-sm font-bold uppercase tracking-[.25em] text-lime-400">La course au plus haut Elo</div><h2 className="mx-auto max-w-4xl text-5xl font-black uppercase leading-[.92] md:text-7xl">Qui montera<br/>le plus haut ?</h2><p className="mx-auto mt-6 max-w-2xl text-white/55">4 streamers. Des comptes neufs niveau 30. Une seule mission : grimper le plus haut possible en SoloQ.</p><div className="mt-6 flex flex-wrap justify-center gap-3 text-xs"><span className="pill"><Radio size={13}/> Riot en direct</span><span className="pill"><Clock3 size={13}/> MAJ {updated}</span><span className="pill"><Database size={13}/> {history.length} snapshots</span>{leader?.status==='ok'&&<span className="pill text-lime-300"><Trophy size={13}/> Leader : {leader.name}</span>}</div></section>
  <section><div className="mb-4"><p className="text-xs font-bold uppercase tracking-[.22em] text-white/40">Classement live</p><h3 className="text-2xl font-black">Les challengers</h3></div><div className="grid gap-4 md:grid-cols-2">{ranked.map((p,i)=>{const peak=peaks[p.name] as HistoryRow|null;return <article key={p.name} className={`card rounded-2xl p-5 ${i===0?'leader':''}`}><div className="flex items-start justify-between"><div className="flex gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-lime-400 text-xl font-black text-black">{i+1}</div><div><h4 className="text-xl font-black">{p.name}</h4><p className="text-sm text-white/45">{p.gameName}#{p.tagLine}</p></div></div><span className={`rounded-full px-3 py-1 text-xs ${p.status==='ok'?'bg-lime-400/10 text-lime-300':p.status==='unranked'?'bg-white/5 text-white/45':'bg-red-500/10 text-red-300'}`}>{p.status==='ok'?'CLASSÉ':p.status==='unranked'?'PLACEMENTS':'ERREUR API'}</span></div>
  <div className="mt-7 grid grid-cols-3 gap-3"><Stat label="RANG" value={rankLabel(p)}/><Stat label="LP" value={p.status==='ok'?`${p.lp} LP`:'—'}/><Stat label="WINRATE" value={p.status==='ok'?`${p.winrate}%`:'—'}/></div>
  <div className="mt-3 flex justify-between gap-3 text-xs text-white/40"><span>{p.status==='ok'?`${p.wins} victoires • ${p.losses} défaites`:p.status==='unranked'?'Placements en cours':p.error}</span>{peak&&<span>Peak : {historyRankLabel(peak)}</span>}</div>
  {p.lastGame&&<div className="mt-4 flex items-center justify-between rounded-xl border border-white/8 bg-black/20 p-3 text-sm"><div className="flex items-center gap-2"><Swords size={15} className="text-white/45"/><span className="font-bold">{p.lastGame.champion}</span><span className="text-white/45">{p.lastGame.kda}</span></div><div className="text-right"><span className={p.lastGame.win?'text-lime-300':'text-red-300'}>{p.lastGame.win?'VICTOIRE':'DÉFAITE'}</span><div className="text-[10px] text-white/35">{p.lastGame.ago}</div></div></div>}
  <a target="_blank" href={`https://twitch.tv/${p.twitch}`} className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-[#9146ff] px-4 py-3 text-sm font-bold">Twitch <ExternalLink size={14}/></a></article>})}</div></section>
  <section className="card mt-8 rounded-2xl p-6"><div className="flex items-center gap-3"><TrendingUp className="text-lime-400"/><div><p className="text-xs font-bold uppercase tracking-[.22em] text-white/40">Progression</p><h3 className="text-2xl font-black">Évolution du challenge</h3></div></div>{historyError?<div className="mt-6 rounded-xl border border-red-400/20 bg-red-400/5 p-6 text-sm text-red-300">Supabase : {historyError}</div>:<HistoryChart history={history}/>}</section>
  <section className="mt-6 grid gap-4 md:grid-cols-3"><Mini title="Classement" text="Tri automatique par tier, division et LP."/><Mini title="Historique" text={`${history.length} snapshots enregistrés dans Supabase. Un nouveau snapshot est créé quand le classement d’un joueur change.`}/><Mini title="Twitch" text="Boutons prêts. Le badge LIVE sera activé avec les identifiants Twitch."/></section>
  <footer className="py-10 text-center text-xs leading-5 text-white/30">JL SoloQ Challenge — projet communautaire non affilié à Riot Games ni Twitch.<br/>JL SoloQ Challenge n’est pas approuvé par Riot Games et ne reflète pas les opinions ou les points de vue de Riot Games ou de toute personne officiellement impliquée dans la production ou la gestion des propriétés de Riot Games. Riot Games et toutes les propriétés associées sont des marques commerciales ou des marques déposées de Riot Games, Inc.</footer>
  </div></main>
}

function HistoryChart({history}:{history:HistoryRow[]}){
  if(history.length<2)return <div className="mt-6 rounded-xl border border-dashed border-white/10 p-8 text-center"><div className="text-lg font-bold">Premier snapshot enregistré ✓</div><p className="mx-auto mt-2 max-w-2xl text-sm text-white/40">La courbe apparaîtra dès que de nouveaux changements de rang ou de LP seront enregistrés.</p></div>;
  const minT=Math.min(...history.map(h=>+new Date(h.created_at))),maxT=Math.max(...history.map(h=>+new Date(h.created_at))); const minS=Math.min(...history.map(h=>h.rank_score))-50,maxS=Math.max(...history.map(h=>h.rank_score))+50; const W=1000,H=300,pad=28;
  const x=(t:number)=>pad+((t-minT)/Math.max(1,maxT-minT))*(W-pad*2); const y=(s:number)=>H-pad-((s-minS)/Math.max(1,maxS-minS))*(H-pad*2);
  const dash=['','8 5','3 5','12 4 3 4'];
  return <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-black/20 p-4"><svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Évolution du classement des challengers"><line x1={pad} y1={H-pad} x2={W-pad} y2={H-pad} stroke="currentColor" opacity=".15"/>{players.map((p,i)=>{const rows=history.filter(h=>h.player===p.name);if(!rows.length)return null;const points=rows.map(r=>`${x(+new Date(r.created_at))},${y(r.rank_score)}`).join(' ');return <g key={p.name}><polyline points={points} fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray={dash[i]} className={i===0?'text-lime-300':i===1?'text-white':i===2?'text-purple-300':'text-cyan-300'}/>{rows.map(r=><circle key={r.id} cx={x(+new Date(r.created_at))} cy={y(r.rank_score)} r="5" fill="currentColor" className={i===0?'text-lime-300':i===1?'text-white':i===2?'text-purple-300':'text-cyan-300'}/>)}</g>})}</svg><div className="mt-3 flex flex-wrap justify-center gap-5 text-xs text-white/60">{players.map((p,i)=><span key={p.name} className="flex items-center gap-2"><span className="inline-block w-7 border-t-2 border-current" style={{borderStyle:i===0?'solid':i===1?'dashed':i===2?'dotted':'dashed'}}/>{p.name}</span>)}</div></div>
}
function Stat({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-black/25 p-3"><div className="text-[10px] font-bold tracking-widest text-white/30">{label}</div><div className="mt-1 font-black">{value}</div></div>}
function Mini({title,text}:{title:string;text:string}){return <div className="card rounded-2xl p-5"><div className="font-black">{title}</div><p className="mt-2 text-sm text-white/40">{text}</p></div>}

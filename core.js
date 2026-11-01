(function(root){
const states={free:'가능',busy:'불가',unknown:'미정'};
function sessionAuthOptions(key,storage){return /^qa-(president|leader1|member[123])$/.test(key||'')?{auth:{storageKey:'aerock-'+key,storage,persistSession:true}}:{}}
function isoDate(d=new Date()){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(d)}
function dateAdd(date,n){let d=new Date(date+'T12:00:00+09:00');d.setUTCDate(d.getUTCDate()+n);return isoDate(d)}
function weekday(date){return new Date(date+'T12:00:00+09:00').getUTCDay()}
function clock(i){let m=360+i*30;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')}
function slotState(value){return value==='free'||value==='busy'?value:'unknown'}
function dateSlots(slots={}){return Object.fromEntries(Object.entries(slots).filter(([key])=>/^\d{4}-\d{2}-\d{2}:(?:[0-9]|[12][0-9]|3[0-5])$/.test(key)).map(([key,value])=>[key,slotState(value)]))}
function availability(slots,date,i){return slotState(slots[date+':'+i])}
// A drag has one operation, chosen from its first cell. Re-entering a cell
// during the same stroke must not toggle it a second time.
function scheduleStroke(selected,firstState){
 const state=selected===firstState?'unknown':selected,visited=new Set();
 return {state,apply(slots,key){
  if(visited.has(key))return false;visited.add(key);
  const before=slots[key];
  slots[key]=state;
  return before!==slots[key];
 }};
}
function mergeSchedule(base,local,remote){
 base=dateSlots(base);local=dateSlots(local);remote=dateSlots(remote);
 const merged={...remote},conflicts=[];
 for(const key of new Set([...Object.keys(base),...Object.keys(local)])){
  const b=slotState(base[key]),l=slotState(local[key]),r=slotState(remote[key]);
  if(l!==b){if(r!==b&&r!==l)conflicts.push(key);merged[key]=l}
 }
 return {merged,conflicts};
}
function rehearsalSegments(ids,start,minutes){return ids.map((song_id,i)=>({song_id,start:new Date(new Date(start).getTime()+i*minutes*60000).toISOString(),end:new Date(new Date(start).getTime()+(i+1)*minutes*60000).toISOString(),room:''}))}
function members(song){return [...new Set((song.entries||[]).filter(e=>e.status==='confirmed').map(e=>e.user_id))]}
function overlaps(a,b){return new Date(a.start)<new Date(b.end)&&new Date(b.start)<new Date(a.end)}
function recommendations({dates,duration,users,slots,bookings}){
 const size=Math.ceil(duration/30),out=[];
 for(const date of dates) for(let start=0;start+size<=36;start++){
  const window={start:date+'T'+clock(start)+':00+09:00',end:clock(start+size)==='24:00'?dateAdd(date,1)+'T00:00:00+09:00':date+'T'+clock(start+size)+':00+09:00'};
  const counts={free:[],busy:[],unknown:[]};
  for(const uid of users){let st='free';for(let i=start;i<start+size;i++){let s=availability(slots[uid]||{},date,i);if(s==='busy'){st='busy';break}if(s==='unknown')st='unknown'}if(bookings.some(b=>b.users.includes(uid)&&overlaps(window,b)))st='busy';counts[st].push(uid)}
  out.push({date,start,end:start+size,...counts,...window});
 }
 return out.sort((a,b)=>a.busy.length-b.busy.length||b.free.length-a.free.length||a.unknown.length-b.unknown.length||new Date(a.start)-new Date(b.start));
}
const api={sessionAuthOptions,mergeSchedule,rehearsalSegments,slotState,dateSlots,scheduleStroke,states,isoDate,dateAdd,weekday,clock,availability,members,overlaps,recommendations};root.AerockCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

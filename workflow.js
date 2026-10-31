/* Operational rehearsal workspace. Auth and existing shared records remain intact. */
let practiceRows=[],hubError='',hubLoading=false;
const oldRender=render,oldHome=home;
const manager=()=>['president','vicepresident','leader'].includes(window.AEROCK_ROLE);
const ownedPractice=p=>p.owner_id===currentProfile.id||manager();
const minePractice=p=>p.owner_id===currentProfile.id||p.song_ids.some(id=>db.songs.find(s=>s.id===id)?.members?.includes(db.current));
const dateInput=d=>new Date(new Date(d).getTime()+9*3600000).toISOString().slice(0,16);
const attendanceWords={free:'가능',maybe:'조정 필요',busy:'불가능',unknown:'미정'};
async function refreshPractices(){
 hubLoading=true;hubError='';render();
 const {data,error}=await authClient.from('aerock_practices').select('*').order('starts_at');
 hubLoading=false;if(error)hubError=error.message;else practiceRows=data||[];render();
}
function practiceCard(p){return `<article class="item"><div class="row between"><b>${esc(p.title)}</b><span class="pill">${esc(p.status)}</span></div><p>${fmt(p.starts_at)} ~ ${fmt(p.ends_at)}</p><p>${esc(p.location||'장소 미정')} · ${esc(p.rooms||'방 미정')}</p><p class="muted">${p.song_ids.map(id=>esc(db.songs.find(s=>s.id===id)?.title||'곡 정보 없음')).join(' / ')}</p><p style="white-space:pre-wrap">${esc(p.rundown)}</p><p class="muted" style="white-space:pre-wrap">${esc(p.notes)}</p>${ownedPractice(p)?`<button class="ghost" onclick="editPractice('${p.id}')">일정·예약 정보 수정</button>`:''}</article>`}
home=function(){return oldHome()+`<section class="card"><div class="row between"><h3>내 다음 합주</h3><button onclick="go('rehearsals')">합주 현황</button></div>${practiceRows.filter(p=>minePractice(p)&&p.status!=='취소'&&new Date(p.ends_at)>new Date()).slice(0,3).map(practiceCard).join('')||'<p class="muted">등록된 내 합주가 없습니다. 합주 현황에서 일정을 확인하세요.</p>'}</section>`};
render=function(){
 oldRender();
 for(const id of ['nav','mobileNav'])document.getElementById(id).insertAdjacentHTML('beforeend',`<button class="${id==='nav'?'nav':'mobile-tab'} ${page==='rehearsals'?'active':''}" onclick="go('rehearsals')">합주 현황</button>`);
 if(page==='rehearsals'){
 $('heading').textContent='합주 현황';
 $('content').innerHTML=`<section class="hero"><div class="eyebrow">REHEARSAL WORKSPACE</div><h2>곡을 모으고, 함께 맞추는 시간.</h2><p>조장·곡주인이 일정을 조율하고 운영진이 외부에서 예약한 정보를 공유합니다.</p><div class="row"><button onclick="editPractice()">합주 일정 제안</button><button class="ghost" onclick="showTimeFinder()">공통 시간 찾기</button><button class="ghost" onclick="refreshPractices()">현황 새로고침</button></div></section><div id="practiceEditor"></div><section class="card"><h3>합주·예약 현황</h3>${hubLoading?'불러오는 중…':hubError?`<p role="alert">조회 실패: ${esc(hubError)}</p>`:practiceRows.map(practiceCard).join('')||'<p class="muted">아직 등록된 일정이 없습니다. 첫 합주 일정을 제안하세요.</p>'}</section>`;
 }
};
const originalGo=go;
go=function(p){originalGo(p);if(p==='rehearsals')refreshPractices()};
function editPractice(id){
 if(page!=='rehearsals'){go('rehearsals');return}
 const p=practiceRows.find(x=>x.id===id);if(p&&!ownedPractice(p))return;
 $('practiceEditor').innerHTML=`<section class="card"><h3>${p?'합주 일정 수정':'합주 일정 제안'}</h3><form id="practiceForm"><div class="field"><label for="prTitle">합주 이름</label><input id="prTitle" name="title" required maxlength="120" value="${esc(p?.title||'')}"></div><div class="two"><div class="field"><label for="prStart">시작 (한국 시간)</label><input id="prStart" type="datetime-local" name="start" required step="1800" value="${p?dateInput(p.starts_at):''}"></div><div class="field"><label for="prEnd">종료 (한국 시간)</label><input id="prEnd" type="datetime-local" name="end" required step="1800" value="${p?dateInput(p.ends_at):''}"></div></div><div class="field"><label>함께 연습할 곡 (복수 선택)</label>${db.songs.map(s=>`<label class="row"><input style="width:auto" type="checkbox" name="song" value="${s.id}" ${p?.song_ids.includes(s.id)?'checked':''}>${esc(s.title)}</label>`).join('')||'<p>먼저 곡을 등록하세요.</p>'}</div><div class="two"><div class="field"><label for="prLocation">합주실·주소</label><input id="prLocation" name="location" value="${esc(p?.location||'')}"></div><div class="field"><label for="prRooms">방별 예약 시간</label><textarea id="prRooms" name="rooms" placeholder="A룸 19~20시 / B룸 20~22시">${esc(p?.rooms||'')}</textarea></div></div><div class="field"><label for="prRun">곡별 시간·방·도착 안내</label><textarea id="prRun" name="rundown" placeholder="19:00 히로인 A룸 / 20:30 피었습니다 B룸">${esc(p?.rundown||'')}</textarea></div><div class="field"><label for="prNotes">공지·정산 안내</label><textarea id="prNotes" name="notes">${esc(p?.notes||'')}</textarea></div><div class="field"><label for="prStatus">상태</label><select id="prStatus" name="status">${['조율 중','예약 대기',...(p?['예약 완료','취소']:[])].map(s=>`<option ${p?.status===s?'selected':''}>${s}</option>`).join('')}</select></div><p class="muted">예약 완료는 외부 예약을 실제로 마친 후 선택하세요. 이 앱에서 합주실이 예약되지는 않습니다.</p><button>저장</button><button type="button" class="ghost" onclick="document.getElementById('practiceEditor').innerHTML=''">닫기</button><p id="practiceResult" role="status"></p></form></section>`;
 $('practiceForm').onsubmit=async e=>{
 e.preventDefault();const f=new FormData(e.currentTarget),start=f.get('start'),end=f.get('end');if(start>=end)return notify('종료는 시작 이후여야 합니다.');
 const ids=f.getAll('song');if(!ids.length)return notify('합주할 곡을 선택하세요.');
 const row={title:f.get('title').trim(),starts_at:start+'+09:00',ends_at:end+'+09:00',song_ids:ids,location:f.get('location'),rooms:f.get('rooms'),rundown:f.get('rundown'),notes:f.get('notes'),status:f.get('status'),updated_at:new Date().toISOString()};
 if(!row.title)return notify('합주 이름을 입력하세요.');
 const btn=e.currentTarget.querySelector('button');btn.disabled=true;
 const query=p?authClient.from('aerock_practices').update(row).eq('id',p.id):authClient.from('aerock_practices').insert(row);
 const {error}=await query;btn.disabled=false;if(error){$('practiceResult').textContent='저장 실패: '+error.message;return}notify('합주 일정 저장 완료');await refreshPractices();
 };
}
function showTimeFinder(){
 const available=db.songs.filter(s=>s.members?.length);
 $('practiceEditor').innerHTML=`<section class="card"><h3>곡 참여자 공통 시간 찾기</h3><p class="muted">확정·참여 명단의 30분 구간 전체를 비교합니다. 미정은 가능으로 계산하지 않습니다. 외부 합주실 잔여석은 별도 확인하세요.</p><form id="finder"><div class="field"><label for="findSong">곡</label><select id="findSong" name="song">${available.map(s=>`<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select></div><div class="two"><div class="field"><label for="findDate">기준 날짜</label><input id="findDate" name="date" type="date" required></div><div class="field"><label for="findDuration">연습 길이</label><select id="findDuration" name="duration"><option value="2">2시간</option><option value="1">1시간</option><option value="1.5">1시간 30분</option><option value="3">3시간</option></select></div></div><button ${available.length?'':'disabled'}>7일 후보 찾기</button></form><div id="finderResult"></div></section>`;
 $('finder').onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget),s=db.songs.find(s=>s.id===f.get('song'));if(!s?.members?.length)return notify('참여 세션이 필요합니다.');const duration=+f.get('duration'),out=[];
 for(let d=0;d<7;d++)for(let h=6;h<=24-duration;h+=.5){const base=new Date(f.get('date')+'T00:00:00+09:00');base.setUTCDate(base.getUTCDate()+d);base.setTime(base.getTime()+h*3600000);const end=new Date(+base+duration*3600000);if(+base<Date.now())continue;
 const states=s.members.map(id=>{let worst='free';for(let t=+base;t<+end;t+=1800000){const v=stateAt(id,dateInput(t));if(({free:0,maybe:1,unknown:2,busy:3}[v])>({free:0,maybe:1,unknown:2,busy:3}[worst]))worst=v}return {id,state:worst}});
 const conflicts=practiceRows.filter(p=>p.status!=='취소'&&+new Date(p.starts_at)<+end&&+new Date(p.ends_at)>+base&&p.song_ids.some(k=>db.songs.find(x=>x.id===k)?.members?.some(id=>s.members.includes(id))));
 if(states.some(x=>x.state==='busy')||conflicts.length)continue;
 out.push({start:base,end,states,score:states.filter(x=>x.state==='free').length*10-states.filter(x=>x.state==='unknown').length*10});}
 out.sort((a,b)=>b.score-a.score||a.start-b.start);$('finderResult').innerHTML=out.slice(0,8).map(r=>`<div class="item"><b>${fmt(r.start)} ~ ${fmt(r.end)}</b><p>${r.states.every(x=>x.state==='free')?'전원 가능':'조율 필요'}</p><p class="muted">${r.states.map(x=>esc(person(x.id))+': '+attendanceWords[x.state]).join(' · ')}</p></div>`).join('')||'<p>조건에 맞는 시간이 없습니다. 부원 시간표와 날짜 예외를 확인하고 책임자가 조율해 주세요.</p>';
 };
}
const priorInit=window.initAuthenticatedAerock;
window.initAuthenticatedAerock=function(user){priorInit(user);refreshPractices()};

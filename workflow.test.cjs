const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const C=require('./core');
const ids=Object.fromEntries(['chair','lead','m1','m2','m3'].map((x,i)=>[x,`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
async function setup(){
 const db=new PGlite();await db.exec(`create role authenticated;create role anon;create schema auth;create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create table public.member_profiles(id uuid primary key,display_name text,role text,status text,updated_at timestamptz);create function public.aerock_active() returns boolean language sql security definer as $$ select exists(select 1 from public.member_profiles where id=auth.uid() and status='active') $$;`);
 await db.exec(fs.readFileSync(__dirname+'/schema.sql','utf8').replace('alter publication supabase_realtime add table public.aerock_v2;',''));
 for(const [who,id]of Object.entries(ids))await db.query('insert into member_profiles values($1,$2,$3,$4,now())',[id,who,who==='chair'?'president':who==='lead'?'leader1':'member',who==='m3'?'pending':'active']);
 await db.exec('set role authenticated');
 const row=async id=>(await db.query('select * from aerock_v2 where id=$1',[id])).rows[0];
 async function as(who,action,id,p={},revision){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[who]]);return (await db.query('select aerock_v2_write($1,$2,$3::jsonb,$4) r',[action,id,JSON.stringify(p),revision===undefined?(await row(id))?.revision??null:revision])).rows[0].r}
 return {db,row,as};
}
const event={title:'QA 공연',date:'2099-11-20T18:00:00+09:00',song_deadline:'2099-11-01T23:59:00+09:00',session_deadline:'2099-11-10T23:59:00+09:00'};
const song=(parts=['보컬','기타','드럼'])=>({event_id:'event',title:'QA 곡',artist:'QA',parts});
const practice=(sid,start='2099-11-12T18:00:00+09:00',end='2099-11-12T19:00:00+09:00',room='A')=>({location:'QA 연습실',status:'예약 완료',segments:[{song_id:sid,start,end,room}]});
test('five independent authenticated identities: approval → proposal → external selection → applications → timetable → rehearsal → response → reschedule',async()=>{
 const {db,row,as}=await setup();try{
 await assert.rejects(as('m1','event','event',event),/회장단/);
 await as('chair','event','event',event);
 await assert.rejects(as('m3','song','song',song()),/승인/);await as('chair','approve',ids.m3);
 await as('m1','song','song',song());
 await assert.rejects(as('m2','song_manage','song',{status:'공연 확정'}),/권한/);
 await as('chair','song_manage','song',{status:'공연 확정',manager_id:ids.lead});
 await as('m1','join','song',{part:'보컬'});let stale=(await row('song')).revision;
 await as('m2','join','song',{part:'기타'});
 await assert.rejects(as('m3','join','song',{part:'드럼'},stale),/다른 사람/);await as('m3','join','song',{part:'드럼'});
 for(const [who,part]of [['m1','보컬'],['m2','기타'],['m3','드럼']])await as('lead','entry','song',{user_id:ids[who],part,status:'confirmed'});
 await assert.rejects(as('m1','withdraw','song',{part:'보컬'}),/확정 후/);
 const slots=Object.fromEntries([24,25,26,27].map(i=>['2099-11-12:'+i,'free']));for(const who of ['m1','m2','m3'])await as(who,'availability','availability:'+ids[who],{slots});
 const rec=C.recommendations({dates:['2099-11-12'],duration:60,users:[ids.m1,ids.m2,ids.m3],slots:Object.fromEntries(['m1','m2','m3'].map(who=>[ids[who],slots])),bookings:[]})[0];assert.equal(rec.free.length,3);
 await as('lead','rehearsal','practice',practice('song'));
 await assert.rejects(as('m1','rehearsal','fake',practice('song')),/권한/);
 await as('m1','response','response:practice:'+ids.m1,{rehearsal_id:'practice',schedule_revision:1,status:'확인 완료'});
 await as('m2','response','response:practice:'+ids.m2,{rehearsal_id:'practice',schedule_revision:1,status:'조율 요청',reason:'한 시간 뒤가 좋아요'});
 await as('lead','rehearsal','practice',practice('song','2099-11-12T19:00:00+09:00','2099-11-12T20:00:00+09:00'));
 await assert.rejects(as('m3','response','response:practice:'+ids.m3,{rehearsal_id:'practice',schedule_revision:1,status:'확인 완료'}),/변경된/);
 for(const who of ['m1','m2','m3'])await as(who,'response','response:practice:'+ids[who],{rehearsal_id:'practice',schedule_revision:2,status:'확인 완료'});
 assert.equal((await row('song')).payload.entries.length,3);
 await assert.rejects(db.exec("update aerock_v2 set payload='{}'"),/permission/);
 }finally{await db.close()}
});
test('importing freeform excludes participants for parts removed on the performance form',async()=>{const {db,as,row}=await setup();try{
 await as('chair','event','event',event);await as('m1','song','free',{...song(['기타','보컬']),event_id:null});await as('m1','join','free',{part:'기타'});await as('m2','join','free',{part:'보컬'});
 await as('m1','song','copy',{...song(['보컬']),source_id:'free'});assert.deepEqual((await row('copy')).payload.entries.map(e=>e.part),['보컬']);
 }finally{await db.close()}});
test('different participants cannot occupy the same room inside one multi-song booking',async()=>{const {db,as}=await setup();try{
 await as('chair','event','event',event);for(const id of ['s1','s2']){await as('m1','song',id,song(['보컬']));await as('chair','song_manage',id,{status:'공연 확정',manager_id:ids.lead})}
 await as('lead','entry','s1',{part:'보컬',user_id:ids.m1,status:'confirmed'});await as('lead','entry','s2',{part:'보컬',user_id:ids.m2,status:'confirmed'});
 await assert.rejects(as('lead','rehearsal','clash',{...practice('s1'),segments:[...practice('s1').segments,...practice('s2').segments]}),/겹칩니다/);
 }finally{await db.close()}});
test('cancelled rehearsals cannot accept fresh confirmations',async()=>{const {db,as}=await setup();try{
 await as('chair','event','event',event);await as('m1','song','s',song(['보컬']));await as('chair','song_manage','s',{status:'공연 확정',manager_id:ids.lead});await as('lead','entry','s',{part:'보컬',user_id:ids.m1,status:'confirmed'});await as('lead','rehearsal','r',practice('s'));await as('lead','rehearsal','r',{...practice('s'),status:'취소'});
 await assert.rejects(as('m1','response','response:r:'+ids.m1,{rehearsal_id:'r',schedule_revision:2,status:'확인 완료'}),/취소/);
 }finally{await db.close()}});
test('adding a participant after booking rejects double booking and invalidates prior confirmations',async()=>{const {db,as,row}=await setup();try{
 await as('chair','event','event',event);for(const sid of ['s1','s2']){await as('m1','song',sid,song(['보컬','기타']));await as('chair','song_manage',sid,{status:'공연 확정',manager_id:ids.lead})}
 await as('lead','entry','s1',{part:'보컬',user_id:ids.m1,status:'confirmed'});await as('lead','entry','s2',{part:'보컬',user_id:ids.m2,status:'confirmed'});
 await as('lead','rehearsal','r1',practice('s1'));await as('lead','rehearsal','r2',practice('s2',undefined,undefined,'B'));
 await assert.rejects(as('lead','entry','s1',{part:'기타',user_id:ids.m2,status:'confirmed'}),/겹칩니다/);
 await as('m1','response','response:r1:'+ids.m1,{rehearsal_id:'r1',schedule_revision:1,status:'확인 완료'});
 await as('chair','approve',ids.m3);await as('lead','entry','s1',{part:'기타',user_id:ids.m3,status:'confirmed'});assert.equal((await row('r1')).revision,2);assert.equal((await row('response:r1:'+ids.m1)).payload.schedule_revision,1);
 }finally{await db.close()}});

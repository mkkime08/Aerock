const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();await db.exec(`create role authenticated;create role anon;create schema auth;create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create table public.member_profiles(id uuid primary key,display_name text,role text,status text,updated_at timestamptz);create function public.aerock_active() returns boolean language sql security definer as $$ select exists(select 1 from public.member_profiles where id=auth.uid() and status='active') $$;`);
let schema=fs.readFileSync(__dirname+'/schema.sql','utf8').replace('alter publication supabase_realtime add table public.aerock_v2;','');await db.exec(schema);console.log('PASS schema parsed and installed in isolated PostgreSQL');
const ids={chair:'00000000-0000-4000-8000-000000000001',lead:'00000000-0000-4000-8000-000000000002',other:'00000000-0000-4000-8000-000000000003',member:'00000000-0000-4000-8000-000000000004',pending:'00000000-0000-4000-8000-000000000005'};for(let [k,id]of Object.entries(ids))await db.query('insert into member_profiles values ($1,$2,$3,$4,now())',[id,k,{chair:'president',lead:'leader1',other:'leader2'}[k]||'member',k==='pending'?'pending':'active']);
async function as(who){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[who]||''])}
async function rev(id){return (await db.query('select revision from aerock_v2 where id=$1',[id])).rows[0]?.revision??null}
async function call(action,id,obj={},version){return (await db.query('select aerock_v2_write($1,$2,$3::jsonb,$4) as r',[action,id,JSON.stringify(obj),version===undefined?await rev(id):version])).rows[0].r}
async function denied(fn,pattern){let failed=false;try{await fn()}catch(e){failed=true;if(pattern)assert.match(e.message,pattern)}assert.ok(failed,'expected authorization/validation error')}
await as('member');await denied(()=>call('event','e',{title:'test',date:'2099-11-20',song_deadline:'2099-11-01',session_deadline:'2099-11-10'}),/회장단/);
await as('chair');await call('event','e',{title:'test',date:'2099-11-20',song_deadline:'2099-11-01',session_deadline:'2099-11-10',poster:''});
await as('pending');await denied(()=>call('song','s',{title:'test',artist:'test',parts:['보컬'],event_id:'e'}),/승인/);await call('name',ids.pending,{name:'가입 테스트'});
await as('member');await call('song','s',{title:'test',artist:'test',parts:['보컬','기타'],event_id:'e'});await denied(()=>call('song','invalid',{parts:[]}));
await as('other');await denied(()=>call('song_manage','s',{notes:'unauthorized'}),/권한/); // unassigned manager NULL must deny
await as('chair');await call('song_manage','s',{manager_id:ids.lead,status:'공연 확정'});
await as('other');await denied(()=>call('song_manage','s',{notes:'unauthorized'}),/권한/);
await as('member');await call('join','s',{part:'보컬'});let v=await rev('s');await denied(()=>call('join','s',{part:'기타'},v-1),/다른 사람/);
await as('lead');await call('entry','s',{part:'보컬',user_id:ids.member,status:'confirmed'});await denied(()=>call('song_manage','s',{status:'미선정'}),/회장단/);
await as('member');await denied(()=>call('withdraw','s',{part:'보컬'}),/확정 후/);await call('availability','availability:'+ids.member,{slots:{'w1:0':'free','2099-11-02:0':'unknown'}});await denied(()=>call('availability','availability:'+ids.lead,{slots:{}}),/본인/);
await call('song','f',{title:'Free',artist:'Artist',parts:['보컬'],event_id:null});await call('join','f',{part:'보컬'});
await as('other');await denied(()=>call('join','f',{part:'보컬'}),/이미 채워진/);await denied(()=>call('remove_song','f'),/회장단/);
await as('member');await call('withdraw','f',{part:'보컬'});
await as('lead');let practice={location:'Test Room',status:'예약 완료',segments:[{song_id:'s',start:'2099-11-12T18:00:00+09:00',end:'2099-11-12T20:00:00+09:00',room:'A'}]};await call('rehearsal','r',practice);await denied(()=>call('rehearsal','r2',practice),/겹칩니다/);
await as('other');await denied(()=>call('rehearsal','r3',{...practice,segments:[{...practice.segments[0],start:'2099-11-13T18:00:00+09:00',end:'2099-11-13T20:00:00+09:00'}]}),/담당/);
await as('member');await call('response','response:r:'+ids.member,{rehearsal_id:'r',schedule_revision:1,status:'확인 완료'});
await as('lead');await call('rehearsal','r',{...practice,location:'Changed Room'});
await as('member');await denied(()=>call('response','response:r:'+ids.member,{rehearsal_id:'r',schedule_revision:1,status:'확인 완료'}),/변경된/);await denied(()=>call('response','response:r:'+ids.member,{rehearsal_id:'r',schedule_revision:2,status:'조율 요청',reason:''}),/사유/);
await as('chair');await call('approve',ids.pending);assert.equal((await db.query('select status from member_profiles where id=$1',[ids.pending])).rows[0].status,'active');
console.log('PASS roles, deadlines, session lifecycle, freeform race guard, ownership, stale writes, schedule conflicts, response revisions, approval');
await db.exec('set role authenticated');await as('member');await denied(()=>db.exec("insert into aerock_v2 values('bypass','event','00000000-0000-4000-8000-000000000004','{}',1,now())"),/permission/);let count=(await db.query('select count(*)::int n from aerock_v2')).rows[0].n;assert.ok(count>0);await as('');assert.equal((await db.query('select count(*)::int n from aerock_v2')).rows[0].n,0);console.log('PASS direct writes denied and unauthenticated reads hidden by RLS');await db.close()})().catch(e=>{console.error(e.message);process.exitCode=1});

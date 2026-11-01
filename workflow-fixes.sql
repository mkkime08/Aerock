-- AEROCK QA fixes: preserve existing member and workspace data.
create or replace function public.aerock_v2_write(p_action text,p_id text,p_data jsonb default '{}'::jsonb,p_revision integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 me uuid := auth.uid(); role_name text; active_state text; chair boolean; leader boolean;
 old public.aerock_v2; related public.aerock_v2; obj jsonb; kind_name text;
 entry jsonb; entries jsonb; item jsonb; sid text; uid text; part text; state_name text;
 manager boolean; participant boolean; found_entry boolean; affected integer;
begin
 if p_id is null or p_id !~ '^[a-zA-Z0-9:_-]+$' or length(p_id) not between 1 and 180 or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception '잘못된 요청'; end if;
 if me is null then raise exception '로그인이 필요합니다'; end if;
 select role,status into role_name,active_state from public.member_profiles where id=me;
 chair := role_name in ('president','vicepresident');
 leader := role_name in ('leader1','leader2','leader3');
 if p_action='name' then
  if length(trim(coalesce(p_data->>'name',''))) not between 1 and 30 then raise exception '이름은 1~30자로 입력하세요'; end if;
  update public.member_profiles set display_name=trim(p_data->>'name'),updated_at=now() where id=me;
  return jsonb_build_object('ok',true);
 end if;
 if active_state is distinct from 'active' then raise exception '가입 승인 후 이용할 수 있습니다'; end if;
 if p_action='approve' then
  if not chair then raise exception '회장단만 승인할 수 있습니다'; end if;
  update public.member_profiles set status='active',updated_at=now() where id=p_id::uuid and status='pending' and role='member' and length(trim(display_name))>0;
  return jsonb_build_object('ok',true);
 end if;
 -- Lock the target even when it does not exist yet (duplicate freeform joins).
 perform pg_advisory_xact_lock(hashtextextended(p_id,0));
 if p_action in ('join','withdraw','entry','rehearsal') then perform pg_advisory_xact_lock(hashtextextended('aerock-v2-rehearsals',0)); end if;
 select * into old from public.aerock_v2 where id=p_id for update;
 if old.id is not null and p_revision is distinct from old.revision then raise exception '다른 사람이 수정했습니다. 새로고침 후 다시 시도하세요'; end if;
 if p_action='event' then
  if not chair then raise exception '회장단만 공연을 관리할 수 있습니다'; end if;
  if old.id is not null and old.kind<>'event' then raise exception '잘못된 대상'; end if;
  if length(trim(coalesce(p_data->>'title',''))) not between 1 and 100 then raise exception '공연명을 입력하세요'; end if;
  if (p_data->>'song_deadline')::timestamptz > (p_data->>'session_deadline')::timestamptz then raise exception '세션 마감은 곡 마감 이후여야 합니다'; end if;
  if (p_data->>'session_deadline')::timestamptz > (p_data->>'date')::timestamptz then raise exception '모집 마감은 공연일 이전이어야 합니다'; end if;
  if p_data->>'date' is null or p_data->>'song_deadline' is null or p_data->>'session_deadline' is null then raise exception '날짜와 마감을 입력하세요'; end if;
  if coalesce(p_data->>'poster','')<>'' and p_data->>'poster' !~ '^data:image/(jpeg|png|webp);base64,' then raise exception '지원하지 않는 포스터 형식'; end if;
  obj=p_data; kind_name='event';
 elsif p_action='song' then
  if old.id is not null then raise exception '곡 수정은 담당 관리 기능을 사용하세요'; end if;
  if length(trim(coalesce(p_data->>'title',''))) not between 1 and 100 or length(trim(coalesce(p_data->>'artist',''))) not between 1 and 100 then raise exception '곡명과 아티스트를 입력하세요'; end if;
  if jsonb_typeof(p_data->'parts') is distinct from 'array' then raise exception '파트 형식 오류'; end if;
  if jsonb_array_length(p_data->'parts') not between 1 and 12 then raise exception '필요 파트를 선택하세요'; end if;
  if coalesce(p_data->>'event_id','')<>'' then
   select * into related from public.aerock_v2 where id=p_data->>'event_id' and kind='event';
   if related.id is null or (related.payload->>'song_deadline')::timestamptz<now() then raise exception '곡 모집 기간이 아닙니다'; end if;
  end if;
  if exists(select 1 from jsonb_array_elements(p_data->'parts') x where jsonb_typeof(x)<>'string') or exists(select 1 from jsonb_array_elements_text(p_data->'parts') x where x is null or length(trim(x)) not between 1 and 40) then raise exception '파트 이름 오류'; end if;
  if (select count(*) from jsonb_array_elements_text(p_data->'parts'))<>(select count(distinct x) from jsonb_array_elements_text(p_data->'parts') x) then raise exception '중복 파트'; end if;
  entries='[]'::jsonb;
  if coalesce(p_data->>'source_id','')<>'' then
   select * into related from public.aerock_v2 where id=p_data->>'source_id' and kind='song' and coalesce(payload->>'event_id','')='' and not coalesce((payload->>'deleted')::boolean,false);
   if related.id is null then raise exception '프리폼 곡을 찾을 수 없습니다'; end if;
   select coalesce(jsonb_agg(x || '{"status":"pending"}'::jsonb),'[]') into entries from jsonb_array_elements(related.payload->'entries') x where p_data->'parts' ? (x->>'part');
  end if;
  obj=(p_data-'source_id') || jsonb_build_object('entries',entries,'manager_id',null,'status','모집 중','recruit_open',false);
  kind_name='song';
 elsif p_action in ('song_manage','join','withdraw','entry','remove_song') then
  if old.kind is distinct from 'song' or coalesce((old.payload->>'deleted')::boolean,false) then raise exception '곡을 찾을 수 없습니다'; end if;
  manager=coalesce(chair or (leader and old.payload->>'manager_id'=me::text),false);
  obj=old.payload; kind_name='song';
  if p_action='remove_song' then
   if not chair then raise exception '회장단만 곡을 삭제할 수 있습니다'; end if;
   obj=obj || '{"deleted":true}'::jsonb;
  elsif p_action='song_manage' then
   if not manager then raise exception '담당 합주부장 권한이 필요합니다'; end if;
   if coalesce(obj->>'event_id','')='' then raise exception '프리폼에는 담당자를 배정하지 않습니다'; end if;
   if p_data ? 'manager_id' then
    if not chair then raise exception '회장단만 담당자를 배정할 수 있습니다'; end if;
    if coalesce(p_data->>'manager_id','')<>'' and not exists(select 1 from public.member_profiles where id=(p_data->>'manager_id')::uuid and role in ('leader1','leader2','leader3') and status='active') then raise exception '활성 합주부장을 선택하세요'; end if;
    obj=obj||jsonb_build_object('manager_id',nullif(p_data->>'manager_id',''));
   end if;
   if p_data ? 'status' then
    if not chair or p_data->>'status' not in ('모집 중','공연 확정','보류','미선정') then raise exception '회장단의 선정 결과만 반영할 수 있습니다'; end if;
    obj=obj||jsonb_build_object('status',p_data->>'status');
   end if;
   if p_data ? 'recruit_open' then obj=obj||jsonb_build_object('recruit_open',(p_data->>'recruit_open')::boolean); end if;
   if p_data ? 'notes' then obj=obj||jsonb_build_object('notes',p_data->>'notes'); end if;
  else
   uid=case when p_action='entry' then p_data->>'user_id' else me::text end;
   part=p_data->>'part'; entries=coalesce(obj->'entries','[]'::jsonb);
   if not (obj->'parts' ? part) then raise exception '등록된 파트가 아닙니다'; end if;
   select exists(select 1 from jsonb_array_elements(entries) x where x->>'user_id'=uid and x->>'part'=part) into found_entry;
   if p_action='entry' then
    if not manager or coalesce(obj->>'event_id','')='' then raise exception '담당 합주부장 권한이 필요합니다'; end if;
    if not exists(select 1 from public.member_profiles where id=uid::uuid and status='active') then raise exception '활성 부원을 선택하세요'; end if;
   elsif p_action='join' then
    if found_entry then raise exception '이미 신청한 파트입니다'; end if;
    if coalesce(obj->>'event_id','')<>'' then
     select * into related from public.aerock_v2 where id=obj->>'event_id' and kind='event';
     if related.id is null or ((related.payload->>'session_deadline')::timestamptz<now() and not coalesce((obj->>'recruit_open')::boolean,false)) then raise exception '세션 모집이 마감되었습니다'; end if;
    end if;
   elsif p_action='withdraw' then
    if coalesce(obj->>'event_id','')<>'' and exists(select 1 from jsonb_array_elements(entries) x where x->>'user_id'=uid and x->>'part'=part and x->>'status'='confirmed') then raise exception '확정 후 취소는 담당 합주부장에게 요청하세요'; end if;
   end if;
   state_name=case when p_action='join' then case when coalesce(obj->>'event_id','')='' then 'confirmed' else 'pending' end else p_data->>'status' end;
   if p_action<>'withdraw' and coalesce(state_name,'') not in ('confirmed','pending','remove') then raise exception '잘못된 상태'; end if;
   if state_name='confirmed' and exists(select 1 from jsonb_array_elements(entries) x where x->>'part'=part and x->>'status'='confirmed' and x->>'user_id'<>uid) then raise exception '이미 채워진 파트입니다. 기존 참여자를 먼저 해제하세요'; end if;
   if state_name='confirmed' and exists(
    select 1 from public.aerock_v2 ar,jsonb_array_elements(ar.payload->'segments') with ordinality a(x,n),
    public.aerock_v2 br,jsonb_array_elements(br.payload->'segments') with ordinality b(x,n)
    where ar.kind='rehearsal' and br.kind='rehearsal' and ar.payload->>'status'='예약 완료' and br.payload->>'status'='예약 완료'
    and a.x->>'song_id'=p_id and (ar.id<>br.id or a.n<>b.n)
    and (a.x->>'start')::timestamptz<(b.x->>'end')::timestamptz and (b.x->>'start')::timestamptz<(a.x->>'end')::timestamptz
    and (b.x->>'song_id'=p_id or exists(select 1 from public.aerock_v2 bs,jsonb_array_elements(bs.payload->'entries') e where bs.id=b.x->>'song_id' and e->>'user_id'=uid and e->>'status'='confirmed'))
   ) then raise exception '추가할 참여자의 기존 합주 시간이 겹칩니다. 합주 일정을 먼저 조정하세요'; end if;
   select coalesce(jsonb_agg(x),'[]') into entries from jsonb_array_elements(entries) x where not(x->>'user_id'=uid and x->>'part'=part);
   if p_action<>'withdraw' and state_name<>'remove' then entries=entries||jsonb_build_array(jsonb_build_object('user_id',uid,'part',part,'status',state_name)); end if;
   obj=jsonb_set(obj,'{entries}',entries);
   if entries is distinct from old.payload->'entries' then
    update public.aerock_v2 r set revision=r.revision+1,updated_at=now()
    where r.kind='rehearsal' and r.payload->>'status'='예약 완료'
    and exists(select 1 from jsonb_array_elements(r.payload->'segments') seg where seg->>'song_id'=p_id);
   end if;
  end if;
 elsif p_action='availability' then
  if p_id<>'availability:'||me::text then raise exception '본인 시간표만 수정할 수 있습니다'; end if;
  if jsonb_typeof(p_data->'slots') is distinct from 'object' then raise exception '시간표 형식 오류'; end if;
  for sid,state_name in select key,value from jsonb_each_text(p_data->'slots') loop
   if sid !~ '^(w[0-6]|[0-9]{4}-[0-9]{2}-[0-9]{2}):([0-9]|[12][0-9]|3[0-5])$' or state_name not in ('free','busy','maybe','unknown') then raise exception '시간표 값 오류'; end if;
  end loop;
  obj=p_data; kind_name='availability';
 elsif p_action='rehearsal' then
  if not (chair or leader) then raise exception '합주부장 권한이 필요합니다'; end if;
  if old.id is not null and (old.kind<>'rehearsal' or not(chair or old.owner_id=me)) then raise exception '본인이 등록한 합주만 수정할 수 있습니다'; end if;
  if jsonb_typeof(p_data->'segments') is distinct from 'array' then raise exception '합주 구간 오류'; end if;
  if jsonb_array_length(p_data->'segments') not between 1 and 30 then raise exception '합주할 곡을 선택하세요'; end if;
  for item in select value from jsonb_array_elements(p_data->'segments') loop
   select * into related from public.aerock_v2 where id=item->>'song_id' and kind='song';
   if related.id is null or related.payload->>'status'<>'공연 확정' or coalesce((related.payload->>'deleted')::boolean,false) then raise exception '공연 확정 곡만 예약할 수 있습니다'; end if;
   if not chair and related.payload->>'manager_id' is distinct from me::text then raise exception '담당 곡만 예약할 수 있습니다'; end if;
   if (item->>'start')::timestamptz >= (item->>'end')::timestamptz then raise exception '종료 시간은 시작 이후여야 합니다'; end if;
   if item->>'start' is null or item->>'end' is null or length(trim(coalesce(item->>'room','')))=0 then raise exception '시간과 방을 입력하세요'; end if;
  end loop;
  if p_data->>'status'='예약 완료' and exists(
   select 1 from jsonb_array_elements(p_data->'segments') with ordinality a(x,n),jsonb_array_elements(p_data->'segments') with ordinality b(x,n)
   where a.n<b.n and a.x->>'room'=b.x->>'room'
   and (a.x->>'start')::timestamptz<(b.x->>'end')::timestamptz and (b.x->>'start')::timestamptz<(a.x->>'end')::timestamptz
  ) then raise exception '같은 합주실 방의 곡별 시간이 겹칩니다'; end if;
  if p_data->>'status'='예약 완료' and exists(
   select 1 from jsonb_array_elements(p_data->'segments') with ordinality a(x,n),jsonb_array_elements(p_data->'segments') with ordinality b(x,n)
   where a.n<b.n and (a.x->>'start')::timestamptz<(b.x->>'end')::timestamptz and (b.x->>'start')::timestamptz<(a.x->>'end')::timestamptz
   and exists(select 1 from public.aerock_v2 s1,public.aerock_v2 s2,jsonb_array_elements(s1.payload->'entries') e1,jsonb_array_elements(s2.payload->'entries') e2 where s1.id=a.x->>'song_id' and s2.id=b.x->>'song_id' and e1->>'status'='confirmed' and e2->>'status'='confirmed' and e1->>'user_id'=e2->>'user_id')
  ) then raise exception '같은 참여자의 곡별 합주 시간이 겹칩니다'; end if;
  if p_data->>'status'='예약 완료' and exists(
   select 1 from jsonb_array_elements(p_data->'segments') ns
   join public.aerock_v2 existing on existing.kind='rehearsal' and existing.id<>p_id and existing.payload->>'status'='예약 완료',
   jsonb_array_elements(existing.payload->'segments') os
   where (ns->>'start')::timestamptz<(os->>'end')::timestamptz and (os->>'start')::timestamptz<(ns->>'end')::timestamptz
   and ((p_data->>'location'=existing.payload->>'location' and ns->>'room'=os->>'room') or exists(
    select 1 from public.aerock_v2 s1,public.aerock_v2 s2,jsonb_array_elements(s1.payload->'entries') e1,jsonb_array_elements(s2.payload->'entries') e2
    where s1.id=ns->>'song_id' and s2.id=os->>'song_id' and e1->>'status'='confirmed' and e2->>'status'='confirmed' and e1->>'user_id'=e2->>'user_id'))
  ) then raise exception '참여자 또는 합주실 예약 시간이 겹칩니다'; end if;
  if length(trim(coalesce(p_data->>'location','')))=0 then raise exception '합주실을 입력하세요'; end if;
  if coalesce(p_data->>'status','') not in ('예약 완료','취소') then raise exception '예약 상태 오류'; end if;
  obj=p_data; kind_name='rehearsal';
 elsif p_action='response' then
  select * into related from public.aerock_v2 where id=p_data->>'rehearsal_id' and kind='rehearsal';
  if related.payload->>'status'='취소' then raise exception '취소된 합주에는 응답할 수 없습니다'; end if;
  if related.id is null or p_id<>'response:'||related.id||':'||me::text then raise exception '합주 응답 대상 오류'; end if;
  select exists(select 1 from jsonb_array_elements(related.payload->'segments') seg join public.aerock_v2 s on s.id=seg->>'song_id',jsonb_array_elements(s.payload->'entries') e where e->>'user_id'=me::text and e->>'status'='confirmed') into participant;
  if not participant then raise exception '참여자만 응답할 수 있습니다'; end if;
  if (p_data->>'schedule_revision')::int is distinct from related.revision then raise exception '변경된 일정을 다시 확인하세요'; end if;
  if coalesce(p_data->>'status','') not in ('확인 완료','조율 요청') then raise exception '응답 상태 오류'; end if;
  if p_data->>'status'='조율 요청' and length(trim(coalesce(p_data->>'reason','')))=0 then raise exception '조율 사유를 입력하세요'; end if;
  obj=p_data; kind_name='response';
 else raise exception '지원하지 않는 작업';
 end if;
 if old.id is not null and old.kind<>kind_name then raise exception '잘못된 대상 유형'; end if;
 insert into public.aerock_v2(id,kind,owner_id,payload) values(p_id,kind_name,me,obj)
 on conflict(id) do update set payload=excluded.payload,revision=aerock_v2.revision+1,updated_at=now();
 return (select to_jsonb(r) from public.aerock_v2 r where r.id=p_id);
end $$;
revoke all on function public.aerock_v2_write(text,text,jsonb,integer) from public,anon;
grant execute on function public.aerock_v2_write(text,text,jsonb,integer) to authenticated;

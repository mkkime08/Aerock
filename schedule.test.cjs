const vm=require('node:vm'),fs=require('node:fs'),{test}=require('node:test'),assert=require('node:assert/strict');
function harness(){
 const handlers={};const storage={getItem:()=>null,setItem:()=>{}};const status={},saveButton={},discardButton={};let pointed;
 function cell(key,state='unknown'){let attrs={'aria-label':'월요일 06:00 '+{unknown:'미정',busy:'불가',free:'가능'}[state]};return {dataset:{slot:key},className:'slot '+state,focus(){},getAttribute(k){return attrs[k]},setAttribute(k,v){attrs[k]=v}}}
 const grid={contains:()=>true,addEventListener:(event,fn)=>handlers[event]=fn,setPointerCapture(){}};
 const document={addEventListener(){},querySelector:s=>s==='.schedule'?grid:s==='#saveState'?status:s.includes('saveSchedule')?saveButton:s.includes('discardSchedule')?discardButton:null,elementFromPoint:()=>pointed};
 const context=vm.createContext({AerockCore:require('./core.js'),location:{search:''},sessionStorage:storage,window:{addEventListener(){}},document,URLSearchParams,structuredClone,console,setTimeout,clearTimeout});
 const source=fs.readFileSync(__dirname+'/app.js','utf8').replace(/boot\(\)\.catch\(e=>[\s\S]*$/,'');vm.runInContext(source,context);
 const run=code=>vm.runInContext(code,context);
 run(`var originalSave=save;me={id:'test'};editing=true;savedSlots={};draftSlots={};var writes=[];var savedSnapshot;var failSave=false;save=async(action,id,payload,revision)=>{if(failSave)throw new Error('network');writes.push({action,id,payload,revision});records=[{id,kind:'availability',payload:structuredClone(payload),revision:1}];savedSnapshot=payload};render=()=>{};toast=()=>{};bindPaint()`);
 return {run,handlers,cell,point:el=>pointed=el,down:el=>handlers.pointerdown({button:0,target:el,pointerId:1,preventDefault(){}}),up:()=>handlers.pointerup(),saveButton,status};
}
test('editing cells sends no writes; one save submits the entire checked schedule',async()=>{const h=harness();h.down(h.cell('2026-11-02:0'));h.up();h.down(h.cell('2026-11-03:1'));h.up();assert.equal(h.run('writes.length'),0);assert.equal(h.run('dirty'),true);await h.run('saveSchedule()');assert.equal(h.run('writes.length'),1);assert.deepEqual(JSON.parse(h.run('JSON.stringify(writes[0].payload.slots)')),{'2026-11-02:0':'free','2026-11-03:1':'free'});assert.equal(h.run('dirty'),false);assert.equal(h.run('brush'),'free');assert.equal(h.run('editing'),true)});
test('pointer toggle returns to unchanged state with no save required',()=>{const h=harness();const a=h.cell('2026-11-02:0');h.down(a);h.up();h.down(a);h.up();assert.equal(h.run('slotValue("2026-11-02:0")'),'unknown');assert.equal(h.run('dirty'),false);assert.equal(h.saveButton.disabled,true);assert.equal(h.run('brush'),'free')});
test('drag revisits do not cancel newly painted cells',()=>{const h=harness();const a=h.cell('2026-11-02:0'),b=h.cell('2026-11-02:1');h.down(a);h.point(b);h.handlers.pointermove({clientX:0,clientY:0});h.point(a);h.handlers.pointermove({clientX:0,clientY:0});h.up();assert.equal(h.run('slotValue("2026-11-02:0")'),'free');assert.equal(h.run('slotValue("2026-11-02:1")'),'free');assert.equal(h.run('writes.length'),0)});
test('failed save preserves draft and re-enables retry',async()=>{const h=harness();h.down(h.cell('2026-11-02:0'));h.up();h.run('failSave=true');await assert.rejects(h.run('saveSchedule()'),/network/);assert.equal(h.run('dirty'),true);assert.equal(h.run('slotValue("2026-11-02:0")'),'free');assert.equal(h.run('scheduleSaving'),false);assert.equal(h.saveButton.disabled,false)});
test('keyboard toggles once and explicit unknown matches an absent date value',()=>{const h=harness();h.run(`savedSlots={'2026-11-02:0':'unknown'};draftSlots={'2026-11-02:0':'unknown'}`);let a=h.cell('2026-11-02:0');h.handlers.keydown({key:'Enter',target:a,repeat:false,preventDefault(){}});assert.equal(h.run('slotValue("2026-11-02:0")'),'free');h.handlers.keydown({key:'Enter',target:a,repeat:false,preventDefault(){}});assert.equal(h.run('slotValue("2026-11-02:0")'),'unknown');assert.equal(h.run('dirty'),false)});
test('stale save merges other-device edits and retries once without losing local draft',async()=>{
 const h=harness();h.down(h.cell('2026-11-02:0'));h.up();h.run(`var attempts=0;load=async()=>{records=[{id:'availability:test',kind:'availability',payload:{slots:{'2026-11-02:1':'busy'}},revision:2}]};save=async(a,id,p,v)=>{attempts++;if(attempts===1)throw new Error('다른 사람이 수정했습니다.');writes.push({a,id,p,v});records=[{id,kind:'availability',payload:p,revision:3}]}`);
 await h.run('saveSchedule()');assert.equal(h.run('attempts'),2);assert.equal(h.run("writes[0].p.slots['2026-11-02:0']"),'free');assert.equal(h.run("writes[0].p.slots['2026-11-02:1']"),'busy');assert.equal(h.run('dirty'),false);
});
test('same-cell stale save waits for explicit second save and retains local input',async()=>{
 const h=harness();h.down(h.cell('2026-11-02:0'));h.up();h.run(`load=async()=>{records=[{id:'availability:test',kind:'availability',payload:{slots:{'2026-11-02:0':'busy'}},revision:2}]};save=async()=>{throw new Error('다른 사람이 수정했습니다.')}`);
 await assert.rejects(h.run('saveSchedule()'),/같은 시간 1칸/);assert.equal(h.run('dirty'),true);assert.equal(h.run('availabilityRevision'),2);assert.equal(h.run("draftSlots['2026-11-02:0']"),'free');assert.equal(h.run('scheduleSaving'),false);
});

test('acknowledged server write is retained if the follow-up read fails',async()=>{
 const h=harness();h.run(`client={rpc:async()=>({data:{id:'saved-song',kind:'song',payload:{title:'saved'},revision:1},error:null})};load=async()=>{throw new Error('offline')}`);
 await h.run("originalSave('song','saved-song',{title:'saved'})");assert.equal(h.run("data('saved-song').title"),'saved');
});

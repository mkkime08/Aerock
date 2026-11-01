const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('display-only dialogs ignore form submission and action buttons never submit a form',async()=>{
 const source=fs.readFileSync(__dirname+'/app.js','utf8').replace(/boot\(\)\.catch\(e=>[\s\S]*$/,'');
 const form={},modal={showModal(){},close(){}},storage={getItem(){return null},setItem(){}};
 const ctx=vm.createContext({AerockCore:require('./core'),URLSearchParams,location:{search:''},sessionStorage:storage,document:{querySelector:s=>s==='#modal'?modal:s==='#modalForm'?form:null,addEventListener(){}},window:{addEventListener(){}},setTimeout,clearTimeout,structuredClone});vm.runInContext(source,ctx);vm.runInContext("openModal('곡 상세','테스트')",ctx);
 let prevented=false;await form.onsubmit({preventDefault(){prevented=true}});assert.equal(prevented,true);
 for(const button of source.matchAll(/<button\b[^>]*>/g))assert.match(button[0],/\btype=['"](?:button|submit)['"]/);
});

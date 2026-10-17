import {buildPrompt,applyResult} from './model.mjs';
export class GenerationEngine {
  constructor(store,service,onChange=()=>{}) {this.store=store;this.service=service;this.onChange=onChange;this.controllers=new Map();}
  async run(key,taskId) {
    if(this.controllers.has(taskId))return;
    const controller=new AbortController();this.controllers.set(taskId,controller);
    try{
      let prompt,config;
      const started=await this.store.commit(state=>{
        const task=state.scopes[key]?.tasks.find(t=>t.id===taskId);if(!task||['done','cancelled'].includes(task.status))throw Error('任务已结束');
        config={...state.connections.text};if(!config.baseUrl||!config.model)throw Error('先在设置里连接 API，再让角色回复');
        prompt=buildPrompt(state,key,task);task.status='running';task.error='';task.sourceRefs=prompt.sourceRefs;task.trace={memoryIds:prompt.memoryIds,backgroundUsed:prompt.backgroundUsed,baseUrl:config.baseUrl,model:config.model};
      });this.onChange(started.state);
      const secret=await this.store.secret('text',config.baseUrl);
      const text=await this.service(config,secret,'chat',{messages:prompt.messages},controller.signal);
      const saved=await this.store.commit(state=>applyResult(state,key,taskId,text));this.onChange(saved.state);
    }catch(error){
      try{const failed=await this.store.commit(state=>{const task=state.scopes[key]?.tasks.find(t=>t.id===taskId);if(task&&!['done','cancelled'].includes(task.status)){task.status=controller.signal.aborted?'cancelled':'failed';task.error=controller.signal.aborted?'已停止':error.message;}});this.onChange(failed.state);}catch{this.onChange(null,Error('生成结果尚未保存，请检查本机存储'));}
    }finally{this.controllers.delete(taskId);}
  }
  async cancel(key,taskId){this.controllers.get(taskId)?.abort();const saved=await this.store.commit(s=>{const task=s.scopes[key]?.tasks.find(t=>t.id===taskId);if(task&&task.status!=='done'){task.status='cancelled';task.error='已停止';}});this.onChange(saved.state);}
  async runMany(key,ids){for(const taskId of ids)await this.run(key,taskId);}
}

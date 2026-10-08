const store=new Map();const log=[];globalThis.__sessions=globalThis.__sessions||new Map();globalThis.__users=globalThis.__users||new Set();
class Client{on(){}async connect(){}
 async query(q,p=[]){log.push(q.slice(0,34));
  if(/^\s*select value from kv/.test(q))return{rows:store.has(p[0])?[{value:JSON.parse(store.get(p[0]))}]:[]};
  if(/^insert into kv/.test(q)){store.set(p[0],p[1]);return{rows:[]}}
  if(/from "session" s join "user"/.test(q)){const e=globalThis.__sessions.get(p[0]);return{rows:e?[{email:e}]:[]}}
  if(/^delete from "session"/.test(q)){globalThis.__sessions.delete(p[0]);return{rows:[]}}
  if(/^delete from "user"/.test(q)){globalThis.__users.delete(p[0]);return{rows:[]}}
  return{rows:[]};}}
class Pool{}
module.exports={Client,Pool,__log:log,__store:store};

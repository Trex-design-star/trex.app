const m=new Map();export const getStore=()=>({get:async(k)=>m.has(k)?JSON.parse(m.get(k)):null,setJSON:async(k,v)=>{m.set(k,JSON.stringify(v))}});

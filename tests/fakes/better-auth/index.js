export const betterAuth=(cfg)=>{const users=new Map();globalThis.__baUsers=users;
 const mk=(email)=>{const token="rawtok"+Math.random().toString(16).slice(2);globalThis.__sessions.set(token,email);return token};
 return{api:{
  signUpEmail:async({body})=>{if(globalThis.__BA_MODE==="throw")throw new Error("api mismatch");if(users.has(body.email))throw new Error("USER_ALREADY_EXISTS");users.set(body.email,body.password);globalThis.__users.add(body.email);globalThis.__accts.add(body.email);const t=mk(body.email);return{token:t,user:{email:body.email}}},
  signInEmail:async({body})=>{const mode=globalThis.__BA_MODE||"both";if(mode==="throw")throw new Error("api mismatch");if(users.get(body.email)!==body.password)throw new Error("INVALID_EMAIL_OR_PASSWORD");
   const token=mk(mode==="orphan"?"someone@else":body.email);const h=new Headers(mode==="body"?{}:{"set-auth-token":token+".c2ln%3D"});return{headers:h,response:mode==="header"?{}:{token,user:{email:body.email}}}}}}};

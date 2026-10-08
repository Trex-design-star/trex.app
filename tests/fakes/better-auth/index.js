export const betterAuth=(cfg)=>{const pl=cfg.plugins.find(p=>p.id==="emailOTP").o;const otps={};
 return{api:{
  sendVerificationOTP:async({body})=>{const code="424242";otps[body.email]=code;await pl.sendVerificationOTP({email:body.email,otp:code,type:body.type});return{success:true}},
  signInEmailOTP:async({body})=>{const mode=globalThis.__BA_MODE||"both";if(mode==="throw")throw new Error("api mismatch");if(otps[body.email]!==body.otp)throw new Error("INVALID_OTP");
   const token="rawtok"+Math.random().toString(16).slice(2);globalThis.__sessions.set(token,mode==="orphan"?"someone@else":body.email);globalThis.__users.add(body.email);
   const h=new Headers(mode==="body"?{}:{"set-auth-token":token+".c2ln%3D"});return{headers:h,response:mode==="header"?{}:{token,user:{email:body.email}}}},
  signOut:async()=>({success:true})}}};

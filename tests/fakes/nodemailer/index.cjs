const sent=[];module.exports={createTransport:(o)=>({sendMail:async(m)=>{if(o.auth.pass==="BAD")throw new Error("535 auth");sent.push({...m,user:o.auth.user})}}),__sent:sent};

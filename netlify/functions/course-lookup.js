const HEADERS = {'Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(status,body)=>({statusCode:status,headers:HEADERS,body:JSON.stringify(body)});
const valid=(a)=>Array.isArray(a)&&a.length===18&&a.every(x=>Number.isInteger(x)&&x>=3&&x<=6);
const validIndexes=(a)=>Array.isArray(a)&&a.length===18&&a.every(x=>Number.isInteger(x)&&x>=1&&x<=18)&&new Set(a).size===18;
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST.'});
 if(!process.env.OPENAI_API_KEY)return reply(503,{error:'AI lookup is not configured. Set OPENAI_API_KEY in Netlify environment variables.'});
 let input;try{input=JSON.parse(event.body||'{}')}catch{return reply(400,{error:'Invalid request.'})}
 const {course,location,tees,ranking}=input;
 if(typeof course!=='string'||course.trim().length<3||course.length>120||typeof location!=='string'||location.length>120||!['men','women'].includes(ranking)||typeof tees!=='string'||tees.length>60)return reply(400,{error:'Enter a course, location, tees and handicap ranking.'});
 const prompt=`Find the official or otherwise reliable published 18-hole golf scorecard for course: ${course}; location: ${location}; tee: ${tees||'not specified'}; handicap ranking: ${ranking}. Use web search. Return ONLY JSON with keys: courseName,location,tee,ranking,pars (18 integers),strokeIndexes (18 unique integers 1-18),sourceUrl (direct public source URL),sourceTitle,notes. Do not infer, fabricate, or fill missing hole data. If tee or handicap row is ambiguous or any hole is not verifiable, return JSON with error explaining what needs confirmation, plus sourceUrl if available. Men's and women's handicap indexes can differ. Never substitute a different tee or ranking without clearly noting it.`;
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1',tools:[{type:'web_search_preview'}],input:prompt,max_output_tokens:1800})});
  const data=await response.json();
  if(!response.ok)return reply(502,{error:'AI provider returned an error. Check the model, API billing and key configuration.'});
  const txt=(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n')||data.output_text||'';
  let obj;try{obj=JSON.parse(txt.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''))}catch{return reply(422,{error:'Could not read a reliable scorecard. Try a more specific course and tee selection.'})}
  if(obj.error)return reply(422,{error:String(obj.error).slice(0,350),sourceUrl:typeof obj.sourceUrl==='string'?obj.sourceUrl:null});
  if(!valid(obj.pars)||!validIndexes(obj.strokeIndexes)||typeof obj.sourceUrl!=='string'||!/^https:\/\//i.test(obj.sourceUrl))return reply(422,{error:'Scorecard incomplete or unverified. Please enter the values manually.'});
  return reply(200,{courseName:String(obj.courseName||course).slice(0,120),location:String(obj.location||location).slice(0,120),tee:String(obj.tee||tees).slice(0,60),ranking,pars:obj.pars,strokeIndexes:obj.strokeIndexes,sourceUrl:obj.sourceUrl,sourceTitle:String(obj.sourceTitle||'Published scorecard').slice(0,140),notes:String(obj.notes||'').slice(0,350)});
 }catch{return reply(502,{error:'Course lookup is temporarily unavailable.'})}
};
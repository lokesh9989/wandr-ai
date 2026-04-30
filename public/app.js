const { useState, useEffect, useRef, Component } = React;
// Clean rewrite — guaranteed working layout, all features integrated

// ─── Config ───────────────────────────────────────────────────────
 const API = "https://wandr-ai-1mj2.onrender.com";

// ─── Security: Input Sanitizer ────────────────────────────────────
const sanitize = (str) => {
  if (typeof str !== "string") return "";
  return str
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim()
    .slice(0, 2000);
};

// ─── Security: Rate Limiter ───────────────────────────────────────
const rateLimiter = (() => {
  let lastCall = 0;
  const WINDOW = 1500;
  return {
    canCall: () => Date.now() - lastCall > WINDOW,
    record:  () => { lastCall = Date.now(); },
  };
})();

// ─── INR Currency Formatter (Indian format: ₹1,20,000) ───────────
const formatINR = (n) => {
  const v = Number(n);
  if (isNaN(v)) return "₹0";
  return "₹" + v.toLocaleString("en-IN");
};
const TK  = "wandr_jwt";

// ─── Token helpers ────────────────────────────────────────────────
const tok = {
  get: () => { try { return localStorage.getItem(TK); } catch(e){ return null; } },
  set: v  => { try { localStorage.setItem(TK, v); }    catch(e){} },
  del: () => { try { localStorage.removeItem(TK); }    catch(e){} },
};

// ─── API fetch ────────────────────────────────────────────────────
async function call(path, opts = {}) {
  const t   = tok.get();
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: "Bearer " + t } : {}),
      ...(opts.headers || {}),
    },
  });
  return res.json();
}
const api = {
  register:   d      => call("/api/auth/register",   { method:"POST", body:JSON.stringify(d) }),
  login:      d      => call("/api/auth/login",      { method:"POST", body:JSON.stringify(d) }),
  me:         ()     => call("/api/auth/me"),
  logout:     ()     => call("/api/auth/logout",     { method:"POST" }),
  aiChat:     d      => call("/api/ai/chat",         { method:"POST", body:JSON.stringify(d) }),
  chats:      ()     => call("/api/chats"),
  chat:       id     => call("/api/chats/" + id),
  saveChat:   d      => call("/api/chats",           { method:"POST", body:JSON.stringify(d) }),
  delChat:    id     => call("/api/chats/" + id,     { method:"DELETE" }),
  plans:      ()     => call("/api/plans"),
  addPlan:    d      => call("/api/plans",           { method:"POST", body:JSON.stringify(d) }),
  putPlan:    (id,d) => call("/api/plans/" + id,     { method:"PUT",  body:JSON.stringify(d) }),
  delPlan:    id     => call("/api/plans/" + id,     { method:"DELETE" }),
  budget:     ()     => call("/api/budget/summary"),
};

// ─── Local storage ────────────────────────────────────────────────
const ls = {
  get: (k,d) => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):d; } catch(e){ return d; } },
  set: (k,v) => { try { localStorage.setItem(k,JSON.stringify(v)); } catch(e){} },
};

// ─── Offline auth (SubtleCrypto) ─────────────────────────────────
async function h256(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function offReg({name,email,password}) {
  const users = ls.get("wu",[]), e = email.toLowerCase().trim();
  if (users.find(u=>u.email===e)) return {ok:false,msg:"Email already registered"};
  const salt=Math.random().toString(36)+Math.random().toString(36);
  const hash=await h256(password+salt+"w");
  const u={id:Math.random().toString(36).slice(2),name:name.trim(),email:e,hash,salt,at:new Date().toISOString()};
  ls.set("wu",[...users,u]);
  const t="off."+btoa(JSON.stringify({id:u.id,exp:Date.now()+6048e5}));
  tok.set(t);
  const {hash:_h,salt:_s,...safe}=u;
  return {ok:true,user:safe,offline:true};
}
async function offLog({email,password}) {
  const users=ls.get("wu",[]), u=users.find(x=>x.email===email.toLowerCase().trim());
  if (!u) return {ok:false,msg:"Invalid email or password"};
  const h=await h256(password+u.salt+"w");
  if (h!==u.hash) return {ok:false,msg:"Invalid email or password"};
  const t="off."+btoa(JSON.stringify({id:u.id,exp:Date.now()+6048e5}));
  tok.set(t);
  const {hash,salt,...safe}=u;
  return {ok:true,user:safe,offline:true};
}
function offMe() {
  const t=tok.get();
  if (!t||!t.startsWith("off.")) return null;
  try {
    const p=JSON.parse(atob(t.slice(4)));
    if (p.exp<Date.now()) { tok.del(); return null; }
    const u=ls.get("wu",[]).find(x=>x.id===p.id);
    if (!u) return null;
    const {hash,salt,...safe}=u;
    return safe;
  } catch(e){ return null; }
}

// ─── Helpers ──────────────────────────────────────────────────────
const uid   = () => Math.random().toString(36).slice(2,9);
const now   = () => new Date().toISOString();
const fdate = d => { if(!d) return "—"; const x=new Date(d); return isNaN(x)?"—":x.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); };
const fmoney= n => formatINR(n);

// ─── Toast ────────────────────────────────────────────────────────
let addToast;
function Toasts() {
  const [list,setList]=useState([]);
  addToast=(msg,type="info")=>{
    const id=uid();
    setList(p=>[...p.slice(-3),{id,msg,type}]);
    setTimeout(()=>setList(p=>p.filter(t=>t.id!==id)),3500);
  };
  const C={success:"#10b981",error:"#f43f5e",info:"#38bdf8",warn:"#f59e0b"};
  return (
    <div style={{position:"fixed",bottom:20,right:20,zIndex:9999,display:"flex",flexDirection:"column",gap:8}}>
      {list.map(t=>(
        <div key={t.id} className="asr" style={{background:"var(--card)",border:`1px solid ${C[t.type]}33`,borderLeft:`3px solid ${C[t.type]}`,borderRadius:12,padding:"12px 18px",fontSize:13,color:"var(--t1)",maxWidth:320,boxShadow:`0 8px 32px rgba(0,0,0,.4),0 0 0 1px ${C[t.type]}18`}}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
const toast={
  ok:  m=>addToast?.(m,"success"),
  err: m=>addToast?.(m,"error"),
  info:m=>addToast?.(m,"info"),
};

// ─── Error boundary ───────────────────────────────────────────────
class Err extends Component {
  state={e:null};
  static getDerivedStateFromError(e){return{e};}
  render(){
    if(this.state.e) return(
      <div style={{padding:40,textAlign:"center",color:"#e2e8f0"}}>
        <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
        <h3 style={{marginBottom:8}}>Page error</h3>
        <p style={{color:"#4a6285",fontSize:13,marginBottom:16}}>{this.state.e.message}</p>
        <button onClick={()=>this.setState({e:null})} style={{padding:"10px 22px",borderRadius:10,background:"var(--g1)",color:"#fff",fontWeight:600,border:"none",cursor:"pointer"}}>Retry</button>
      </div>
    );
    return this.props.children;
  }
}

// ─── Spinner ──────────────────────────────────────────────────────
const Spin=({s=15})=><span style={{width:s,height:s,border:"2px solid rgba(255,255,255,.2)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin .65s linear infinite",display:"inline-block"}}/>;

// ─── TypeWriter ───────────────────────────────────────────────────
function TW({text,speed=10,onDone}) {
  const [d,setD]=useState("");
  const ref=useRef(null);
  useEffect(()=>{
    if(ref.current)clearInterval(ref.current);
    let i=0;setD("");
    ref.current=setInterval(()=>{i++;setD(text.slice(0,i));if(i>=text.length){clearInterval(ref.current);ref.current=null;onDone?.();}},speed);
    return()=>{if(ref.current)clearInterval(ref.current);};
  },[text]);
  return<span>{d}{d.length<text.length&&<span style={{animation:"blink 1s infinite"}}>▋</span>}</span>;
}

// ─── Markdown ─────────────────────────────────────────────────────
function Md({text}) {
  const bold=s=>s.split(/(\*\*[^*]+\*\*)/g).map((p,i)=>
    p.startsWith("**")?<strong key={i} style={{color:"var(--t1)"}}>{p.slice(2,-2)}</strong>:p
  );
  return(
    <div style={{lineHeight:1.8,fontSize:13.5}}>
      {text.split("\n").map((line,i)=>{
        if(line.startsWith("## "))return<h3 key={i} style={{fontWeight:800,fontSize:14,color:"var(--blu2)",margin:"12px 0 5px",letterSpacing:"-.01em"}}>{line.slice(3)}</h3>;
        if(/^\*\*(.+)\*\*$/.test(line))return<p key={i} style={{fontWeight:700,color:"var(--t1)",margin:"10px 0 3px"}}>{line.slice(2,-2)}</p>;
        if(line.startsWith("- ")||line.startsWith("* "))return<div key={i} style={{display:"flex",gap:8,margin:"4px 0"}}><span style={{color:"var(--blue)",flexShrink:0,fontWeight:700}}>›</span><span style={{color:"var(--t2)"}}>{bold(line.slice(2))}</span></div>;
        if(line.startsWith("|"))return null;
        if(!line.trim())return<br key={i}/>;
        return<p key={i} style={{color:"var(--t2)",margin:"3px 0",lineHeight:1.75}}>{bold(line)}</p>;
      })}
    </div>
  );
}

// ─── Charts ───────────────────────────────────────────────────────
function Bar({data=[],color="#38bdf8",h=90}) {
  if(!data.length)return<div style={{height:h,display:"flex",alignItems:"center",justifyContent:"center",color:"#3d5470",fontSize:12}}>No data yet</div>;
  const max=Math.max(...data.map(d=>d.v),1);
  return(
    <div style={{display:"flex",alignItems:"flex-end",gap:5,height:h}}>
      {data.map((d,i)=>(
        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,height:"100%"}}>
          <div style={{flex:1,width:"100%",display:"flex",alignItems:"flex-end"}}>
            <div style={{width:"100%",borderRadius:"3px 3px 0 0",height:`${Math.max(d.v/max*100,4)}%`,background:color,opacity:.5+i/Math.max(data.length-1,1)*.5,transition:"height .5s"}}/>
          </div>
          <span style={{fontSize:9,color:"#3d5470",whiteSpace:"nowrap"}}>{d.l}</span>
        </div>
      ))}
    </div>
  );
}
function Donut({segs=[],size=120}) {
  const total=segs.reduce((s,d)=>s+d.v,0);
  const cx=size/2,cy=size/2,r=size*.36,sw=size*.14,dash=2*Math.PI*r;
  if(!total)return(
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--b1)" strokeWidth={sw}/>
      <text x={cx} y={cy+4} textAnchor="middle" fontSize={10} fill="#3d5470">Empty</text>
    </svg>
  );
  let cum=0;
  return(
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--b1)" strokeWidth={sw}/>
      {segs.filter(s=>s.v>0).map((s,i)=>{
        const pct=s.v/total,len=dash*pct,off=dash-(cum/total)*dash;
        cum+=s.v;
        return<circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.c} strokeWidth={sw} strokeDasharray={`${len} ${dash-len}`} strokeDashoffset={off-dash*.25} strokeLinecap="round" style={{transition:"all .5s"}}/>;
      })}
    </svg>
  );
}

// ─── GLOBAL STYLES ────────────────────────────────────────────────
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800;900&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg:    #020617;
  --bg2:   #050d1f;
  --bg3:   #091428;
  --card:  #0c1a30;
  --card2: #0f2040;
  --b1:    #162440;
  --b2:    #1e3358;
  --t1:    #e2e8f0;
  --t2:    #94a3b8;
  --t3:    #3d5470;
  --blue:  #38bdf8;
  --blu2:  #7dd3fc;
  --teal:  #06b6d4;
  --purp:  #a78bfa;
  --grn:   #10b981;
  --red:   #f43f5e;
  --amb:   #f59e0b;
  --g1:    linear-gradient(135deg,#8b5cf6,#7c3aed);
  --g2:    linear-gradient(135deg,#38bdf8,#06b6d4);
  --g3:    linear-gradient(135deg,#ec4899,#f97316);
  --font:  'DM Sans', sans-serif;
  --font-display: 'Syne', sans-serif;
  --sw:    260px;
}
.light {
  --bg: #f0f4ff; --bg2: #e8effe; --bg3: #dce8fb;
  --card: #ffffff; --card2: #f4f8ff;
  --b1: #c5d5ee; --b2: #9ab8e0;
  --t1: #08111f; --t2: #1a3a60; --t3: #4a6890;
  --blue: #0369a1; --blu2: #0284c7;
  --teal: #0891b2; --purp: #7c3aed;
  --grn: #059669; --red: #dc2626; --amb: #d97706;
}
html, body, #root {
  height: 100%;
  font-family: var(--font);
  background: var(--bg);
  color: var(--t1);
}
button { font-family: var(--font); cursor: pointer; border: none; outline: none; }
input, textarea { font-family: var(--font); outline: none; border: none; background: transparent; color: var(--t1); }
::-webkit-scrollbar { width: 3px; }
::-webkit-scrollbar-thumb { background: var(--b2); border-radius: 99px; }

/* ── Layout shell ── */
.shell {
  display: flex;
  height: 100vh;         /* KEY: fixed height, not min-height */
  width: 100vw;
  overflow: hidden;      /* KEY: prevent outer scroll */
  background: var(--bg);
  color: var(--t1);
  transition: background .3s;
}

/* ── Sidebar ── */
.sidebar {
  width: var(--sw);
  height: 100vh;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg2);
  border-right: 1px solid var(--b1);
  position: relative;
  z-index: 10;
  transition: transform .3s ease;
}

/* ── Main content ── */
.main {
  flex: 1;
  height: 100vh;         /* KEY: same height as shell */
  overflow-y: auto;      /* KEY: main scrolls, not the whole page */
  display: flex;
  flex-direction: column;
  background: var(--bg);
  min-width: 0;
}
.page-wrap {
  flex: 1;
  padding: 28px;
  max-width: 1200px;
  width: 100%;
}
.chat-wrap {
  flex: 1;
  padding: 20px;
  display: flex;
  height: calc(100vh - 0px);  /* fills the scrollable main */
  max-height: calc(100vh - 60px);
}

/* ── Cards / buttons ── */
.card { background: var(--card); border: 1px solid var(--b1); border-radius: 16px; }
.card-hover:hover { border-color: var(--b2); transform: translateY(-2px); transition: all .2s; }
.btn { padding: 11px 20px; border-radius: 11px; font-weight: 700; font-size: 13px; cursor: pointer; border: none; transition: opacity .2s, transform .15s; }
.btn:hover { opacity: .88; transform: translateY(-1px); }
.btn-p { background: var(--g1); color: #fff; }
.btn-s { background: var(--card2); border: 1px solid var(--b1); color: var(--t2); }
.btn-s:hover { border-color: var(--b2); color: var(--t1); }
.nav-btn {
  width: 100%; display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; border-radius: 10px; margin-bottom: 3px;
  font-size: 14px; font-weight: 500; cursor: pointer;
  background: transparent; color: var(--t2); border: none;
  border-left: 3px solid transparent;
  transition: all .18s ease;
  text-align: left;
}
.nav-btn:hover { background: rgba(56,189,248,.08); color: var(--t1); }
.nav-btn.active { background: rgba(56,189,248,.14); color: var(--blu2); font-weight: 700; border-left-color: var(--blue); }

/* ── Animations ── */
@keyframes up    { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
@keyframes in    { from { opacity:0; } to { opacity:1; } }
@keyframes spin  { to   { transform:rotate(360deg); } }
@keyframes blink { 0%,80%,100%{opacity:0} 40%{opacity:1} }
@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:1} }
@keyframes shimmer { 0%{background-position:-500px 0} 100%{background-position:500px 0} }
.aup { animation: up .38s ease both; }
.ain { animation: in .25s ease both; }
.skel { background: linear-gradient(90deg,var(--card) 25%,var(--card2) 50%,var(--card) 75%); background-size:500px; animation:shimmer 1.4s infinite; border-radius:8px; }

/* ── Input ── */
.inp {
  width: 100%; padding: 11px 14px; border-radius: 10px;
  background: var(--bg3); border: 1px solid var(--b1);
  color: var(--t1); font-size: 14px; font-family: var(--font);
  transition: border-color .18s;
}
.inp:focus { border-color: var(--blue) !important; outline: none; }
.inp.err { border-color: var(--red) !important; }

/* ── Mobile ── */
@media (max-width: 768px) {
  .sidebar { position: fixed; left:0; top:0; z-index:200; transform: translateX(-100%); }
  .sidebar.open { transform: translateX(0); }
  .mob-bar { display: flex !important; }
  .main { height: 100vh; }
}
`;

// ══════════════════════════════════════════════════════════════════
// AUTH PAGE
// ══════════════════════════════════════════════════════════════════
const ERX=/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
const PRX=/^(?=.*[A-Z])(?=.*[0-9]).{8,}/;

function AuthPage({onAuth}) {
  const [mode,   setMode]  = useState("login");
  const [email,  setEmail] = useState("");
  const [pw,     setPw]    = useState("");
  const [name,   setName]  = useState("");
  const [showPw, setShowPw]= useState(false);
  const [busy,   setBusy]  = useState(false);
  const [err,    setErr]   = useState("");
  const [bgIdx,  setBgIdx] = useState(0);

  const BG = [
    {url:"https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1920&q=90&fit=crop", pos:"center 55%"},
    {url:"https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=90&fit=crop", pos:"center 50%"},
    {url:"https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1920&q=90&fit=crop", pos:"center 40%"},
    {url:"https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1920&q=90&fit=crop", pos:"center 55%"},
    {url:"https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=1920&q=90&fit=crop", pos:"center 45%"},
    {url:"https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=1920&q=90&fit=crop", pos:"center 50%"},
  ];

  useEffect(()=>{
    BG.forEach(b=>{ const img=new Image(); img.src=b.url; });
    const t=setInterval(()=>setBgIdx(i=>(i+1)%BG.length), 5500);
    return ()=>clearInterval(t);
  },[]);

  const validate=()=>{
    if(mode==="register"&&name.trim().length<2) return "Please enter your full name";
    if(!email.includes("@")||!email.includes(".")) return "Please enter a valid email address";
    if(pw.length<6) return "Password must be at least 6 characters";
    return null;
  };
  const submit=async()=>{
    const e=validate(); if(e){setErr(e);return;}
    setErr(""); setBusy(true);
    await new Promise(r=>setTimeout(r,400));
    if(mode==="login"){
      const r=await offLog({email,password:pw});
      setBusy(false);
      if(!r.ok){setErr(r.msg);return;}
      onAuth(r.user,true);
    } else {
      const r=await offReg({name,email,password:pw});
      setBusy(false);
      if(!r.ok){setErr(r.msg);return;}
      onAuth(r.user,true);
    }
  };

  const HEADINGS=["Wander. Explore. Live.","The World Is Yours.","Plan Smarter. Travel Better.","Every Journey Starts Here.","Beyond Every Horizon.","Go Further. Dream Bigger."];

  return(
    <div style={{minHeight:"100vh",display:"flex",position:"relative",overflow:"hidden",background:"#020408"}}>

      {/* Photo backgrounds */}
      {BG.map((b,i)=>(
        <div key={i} style={{position:"fixed",inset:0,zIndex:0,backgroundImage:`url(${b.url})`,backgroundSize:"cover",backgroundPosition:b.pos,opacity:i===bgIdx?1:0,transition:"opacity 2.2s cubic-bezier(.4,0,.2,1)"}}/>
      ))}

      {/* Cinematic overlays */}
      <div style={{position:"fixed",inset:0,zIndex:1,pointerEvents:"none",background:"linear-gradient(180deg,rgba(2,6,23,.55) 0%,rgba(2,6,23,.15) 45%,rgba(2,6,23,.92) 100%)"}}/>
      <div style={{position:"fixed",inset:0,zIndex:1,pointerEvents:"none",background:"radial-gradient(ellipse 85% 85% at 50% 50%,transparent 25%,rgba(2,6,23,.72) 100%)"}}/>
      <div style={{position:"fixed",bottom:0,left:0,right:0,height:"40%",zIndex:1,pointerEvents:"none",background:"linear-gradient(0deg,rgba(2,6,23,.95) 0%,transparent 100%)"}}/>

      {/* LEFT — hero text */}
      <div id="auth-left" style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"flex-end",padding:"48px 56px",position:"relative",zIndex:5,minHeight:"100vh"}}>
        <div style={{marginBottom:40}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:52}}>
            <div style={{width:42,height:42,borderRadius:14,background:"var(--g5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,boxShadow:"0 4px 22px rgba(56,189,248,.5)"}}>🌍</div>
            <span style={{fontWeight:900,fontSize:18,color:"#fff",letterSpacing:"-.02em",fontFamily:"var(--font-display)"}}>Wandr AI</span>
          </div>
          <div style={{fontSize:"clamp(38px,4.8vw,66px)",fontWeight:900,color:"#fff",letterSpacing:"-.04em",lineHeight:1.06,marginBottom:20,whiteSpace:"pre-line",textShadow:"0 4px 32px rgba(0,0,0,.55)",fontFamily:"var(--font-display)"}}>
            {HEADINGS[bgIdx]}
          </div>
          <p style={{fontSize:15.5,color:"rgba(255,255,255,.52)",maxWidth:400,lineHeight:1.72,marginBottom:36}}>
            Your AI-powered travel intelligence platform. Plan smarter trips, track budgets, and explore the world — securely.
          </p>
          <div style={{display:"flex",flexWrap:"wrap",gap:9,marginBottom:48}}>
            {["✦ AI Trip Planner","💰 Budget Tracker","🌍 Explore Destinations","📜 Travel History"].map(f=>(
              <div key={f} style={{padding:"8px 16px",borderRadius:22,background:"rgba(56,189,248,.15)",border:"1px solid rgba(56,189,248,.3)",backdropFilter:"blur(12px)",fontSize:12,color:"rgba(255,255,255,.85)",fontWeight:600,letterSpacing:".01em"}}>
                {f}
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:6}}>
            {BG.map((_,i)=>(
              <div key={i} onClick={()=>setBgIdx(i)} style={{width:i===bgIdx?22:6,height:6,borderRadius:99,background:i===bgIdx?"#fff":"rgba(255,255,255,.3)",transition:"all .35s",cursor:"pointer"}}/>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT — auth card */}
      <div id="auth-right" style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"24px 36px",position:"relative",zIndex:5,minWidth:"min(430px,100vw)"}}>
        <div style={{
          width:"100%",maxWidth:420,
          background:"rgba(2,6,23,.78)",
          backdropFilter:"blur(48px) saturate(200%)",
          WebkitBackdropFilter:"blur(48px) saturate(200%)",
          border:"1px solid rgba(56,189,248,.2)",
          borderTop:"1.5px solid rgba(56,189,248,.45)",
          borderRadius:26,padding:"42px 38px",
          boxShadow:"0 60px 140px rgba(0,0,0,.8),0 24px 48px rgba(139,92,246,.15),inset 0 1px 0 rgba(255,255,255,.1)",
          position:"relative",
          animation:"authSlideUp .7s cubic-bezier(.22,1,.36,1) both",
        }}>
          <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:"55%",height:1,background:"linear-gradient(90deg,transparent,rgba(56,189,248,.6),transparent)"}}/>

          {/* Card brand */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:26}}>
            <div style={{width:40,height:40,borderRadius:13,background:"var(--g5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,boxShadow:"0 4px 20px rgba(56,189,248,.45)"}}>🌍</div>
            <div>
              <div style={{fontWeight:900,fontSize:15,color:"#fff",letterSpacing:"-.02em",fontFamily:"var(--font-display)"}}>Wandr AI</div>
              <div style={{fontSize:9.5,color:"rgba(255,255,255,.32)",letterSpacing:".1em",textTransform:"uppercase"}}>Intelligent Travel OS</div>
            </div>
            <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:4,padding:"4px 8px",borderRadius:6,background:"rgba(16,185,129,.12)",border:"1px solid rgba(16,185,129,.2)"}}>
              <span style={{fontSize:9}}>🔒</span>
              <span style={{fontSize:9,color:"#10b981",fontWeight:800,letterSpacing:".04em"}}>SECURE</span>
            </div>
          </div>

          {/* Heading */}
          <div style={{marginBottom:22}}>
            <div style={{fontSize:21,fontWeight:900,color:"#fff",letterSpacing:"-.03em",marginBottom:4}}>
              {mode==="login"?"Welcome back 👋":"Create account →"}
            </div>
            <div style={{fontSize:13,color:"rgba(226,232,240,.42)"}}>
              {mode==="login"?"Sign in to your travel workspace":"Start planning smarter trips today"}
            </div>
          </div>

          {/* Tabs */}
          <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:10,padding:4,marginBottom:20,border:"1px solid rgba(255,255,255,.07)"}}>
            {[["login","Sign In"],["register","Register"]].map(([m,l])=>(
              <button key={m} onClick={()=>{setMode(m);setErr("");}}
                style={{flex:1,padding:"9px 0",borderRadius:7,fontWeight:m===mode?700:400,fontSize:13,
                  background:m===mode?"var(--g1)":"transparent",
                  color:m===mode?"#fff":"rgba(255,255,255,.38)",
                  border:"none",cursor:"pointer",transition:"all .2s",fontFamily:"inherit"}}>
                {l}
              </button>
            ))}
          </div>

          {/* Form fields */}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {mode==="register"&&(
              <div>
                <label style={{fontSize:10.5,fontWeight:700,color:"rgba(226,232,240,.38)",textTransform:"uppercase",letterSpacing:".09em",display:"block",marginBottom:6}}>Full Name</label>
                <input className="auth-input" value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Alex Johnson" autoFocus={mode==="register"}/>
              </div>
            )}
            <div>
              <label style={{fontSize:10.5,fontWeight:700,color:"rgba(226,232,240,.38)",textTransform:"uppercase",letterSpacing:".09em",display:"block",marginBottom:6}}>Email Address</label>
              <input className="auth-input" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="you@example.com" type="email" autoFocus={mode==="login"}/>
            </div>
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <label style={{fontSize:10.5,fontWeight:700,color:"rgba(226,232,240,.38)",textTransform:"uppercase",letterSpacing:".09em"}}>Password</label>
                {mode==="login"&&<span style={{fontSize:11,color:"rgba(139,92,246,.75)",cursor:"pointer"}}>Forgot?</span>}
              </div>
              <div style={{position:"relative"}}>
                <input className="auth-input" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="••••••••" type={showPw?"text":"password"} style={{paddingRight:44}}/>
                <button onClick={()=>setShowPw(s=>!s)} style={{position:"absolute",right:13,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",fontSize:15,color:"rgba(255,255,255,.3)",cursor:"pointer",lineHeight:1}}>
                  {showPw?"🙈":"👁"}
                </button>
              </div>
              {mode==="register"&&pw&&(
                <div style={{display:"flex",gap:3,marginTop:6}}>
                  {[pw.length>=8,/[A-Z]/.test(pw),/[0-9]/.test(pw),/[^A-Za-z0-9]/.test(pw)].map((ok,i)=>(
                    <div key={i} style={{flex:1,height:2.5,borderRadius:99,background:ok?"#38bdf8":"rgba(255,255,255,.1)",transition:"background .3s"}}/>
                  ))}
                </div>
              )}
            </div>
          </div>

          {err&&<div style={{marginTop:12,padding:"10px 13px",background:"rgba(248,113,113,.1)",border:"1px solid rgba(248,113,113,.22)",borderRadius:10,color:"#fca5a5",fontSize:12.5}}>⚠️ {err}</div>}

          <button onClick={submit} disabled={busy} className="auth-btn auth-btn-p" style={{marginTop:18}}>
            {busy?<><Spin s={15}/>{mode==="login"?"Signing in…":"Creating account…"}</>:(mode==="login"?"Sign In ✈️":"Create Account →")}
          </button>

          <div style={{marginTop:14,textAlign:"center",fontSize:11.5,color:"rgba(226,232,240,.28)"}}>
            🔒 SHA-256 hashed · No server required · Data stays on your device
          </div>
        </div>
      </div>

      <style>{`
        @media(max-width:768px){
          #auth-left{display:none!important;}
          #auth-right{min-width:100vw!important;padding:16px!important;align-items:flex-start!important;padding-top:40px!important;}
        }
      `}</style>
    </div>
  );
}
// ══════════════════════════════════════════════════════════════════
// SIDEBAR NAV
// ══════════════════════════════════════════════════════════════════
const NAV=[
  {id:"dashboard", label:"Dashboard",      icon:"⊞"},
  {id:"chat",      label:"AI Planner",     icon:"✦"},
  {id:"history",   label:"Travel History", icon:"📜"},
  {id:"future",    label:"Future Plans",   icon:"🗓️"},
  {id:"budget",    label:"Budget Tracker", icon:"💰"},
  {id:"explore",   label:"Explore",        icon:"🌍"},
  {id:"settings",  label:"Settings",       icon:"⚙️"},
];

function Sidebar({page,go,user,logout,dark,setDark,open,setOpen,collapsed,setCollapsed}) {
  const NAV_ICONS = {dashboard:"⊞", chat:"✦", history:"📜", future:"🗓️", budget:"💰", explore:"🌍", settings:"⚙️"};
  const NAV_GRADS = {dashboard:"var(--g1)", chat:"var(--g2)", history:"var(--g3)", future:"var(--g5)", budget:"var(--g8)", explore:"var(--g6)", settings:"var(--g4)"};

  return(
    <div className={`sidebar${open?" open":""}`}
      style={{
        width:collapsed?"68px":"var(--sw)",
        transition:"width .28s cubic-bezier(.4,0,.2,1)",
        overflow:"hidden",flexShrink:0,
        background:"var(--bg2)",
        borderRight:"1px solid var(--b1)",
      }}>

      {/* Logo */}
      <div style={{padding:"18px 14px 14px",borderBottom:"1px solid var(--b1)",display:"flex",alignItems:"center",gap:10,minWidth:0}}>
        <div style={{
          width:40,height:40,borderRadius:14,
          background:"var(--g5)",
          display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:19,flexShrink:0,
          boxShadow:"0 4px 24px rgba(56,189,248,.4)",
        }}>🌍</div>
        {!collapsed&&<div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:900,fontSize:15,background:"var(--g9)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:"-.02em",whiteSpace:"nowrap",fontFamily:"var(--font-display)"}}>Wandr AI</div>
          <div style={{fontSize:9,color:"var(--t3)",letterSpacing:".06em",textTransform:"uppercase",marginTop:1}}>Travel OS</div>
        </div>}
        <button onClick={()=>setCollapsed(c=>!c)}
          title={collapsed?"Expand":"Collapse"}
          style={{
            marginLeft:"auto",background:"var(--bg3)",
            border:"1px solid var(--b1)",color:"var(--t2)",
            width:28,height:28,borderRadius:9,cursor:"pointer",
            flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:12,transition:"all .2s",fontWeight:700,
          }}
          onMouseEnter={e=>{e.currentTarget.style.background="var(--b1)";e.currentTarget.style.color="var(--t1)";}}
          onMouseLeave={e=>{e.currentTarget.style.background="var(--bg3)";e.currentTarget.style.color="var(--t2)";}}>
          {collapsed?"›":"‹"}
        </button>
      </div>

      {/* Nav items */}
      <nav style={{flex:1,padding:"14px 10px",overflowY:"auto",overflowX:"hidden"}}>
        {NAV.map(n=>{
          const isActive = page===n.id;
          return(
            <button key={n.id}
              className={`nav-btn${isActive?" active":""}`}
              onClick={()=>{go(n.id);setOpen(false);}}
              title={collapsed?n.label:undefined}
              style={{justifyContent:collapsed?"center":"flex-start",paddingLeft:collapsed?"0":"12px",paddingRight:collapsed?"0":"12px"}}>
              {/* Icon with gradient bg when active */}
              <div style={{
                width:30,height:30,borderRadius:9,flexShrink:0,
                display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:16,
                background:isActive?NAV_GRADS[n.id]:"transparent",
                transition:"all .18s",
                boxShadow:isActive?"0 3px 10px rgba(0,0,0,.25)":"none",
              }}>
                {n.icon}
              </div>
              {!collapsed&&<>
                <span style={{flex:1,textAlign:"left",fontSize:13}}>{n.label}</span>
                {n.id==="chat"&&<span style={{width:7,height:7,borderRadius:"50%",background:"var(--grn)",flexShrink:0,animation:"pulse 2s infinite",boxShadow:"0 0 8px var(--grn)"}}/>}
              </>}
            </button>
          );
        })}
      </nav>

      {/* Bottom user area */}
      {!collapsed&&<div style={{padding:"12px 10px",borderTop:"1px solid var(--b1)"}}>
        {/* User info */}
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 10px",marginBottom:10,borderRadius:12,background:"var(--bg3)",border:"1px solid var(--b1)"}}>
          <div style={{
            width:36,height:36,borderRadius:12,
            background:"var(--g1)",
            display:"flex",alignItems:"center",justifyContent:"center",
            fontWeight:900,fontSize:14,color:"#fff",flexShrink:0,
            boxShadow:"0 3px 14px rgba(139,92,246,.45)",
          }}>
            {(user?.name||"U")[0].toUpperCase()}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,fontWeight:700,color:"var(--t1)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{user?.name||"Traveller"}</div>
            <div style={{fontSize:10,color:"var(--t3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{user?.email||""}</div>
          </div>
        </div>
        <div style={{marginBottom:8,padding:"6px 10px",borderRadius:9,background:"rgba(16,185,129,.06)",border:"1px solid rgba(16,185,129,.15)",display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:9}}>🔒</span>
          <span style={{fontSize:9,color:"var(--grn)",fontWeight:700,letterSpacing:".04em"}}>SHA-256 SECURED SESSION</span>
        </div>
        <div style={{display:"flex",gap:7}}>
          <button onClick={()=>setDark(d=>!d)}
            style={{flex:1,padding:"9px 6px",borderRadius:11,background:"var(--bg3)",border:"1px solid var(--b1)",color:"var(--t2)",cursor:"pointer",fontSize:12,transition:"all .2s",fontFamily:"inherit",fontWeight:600}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(139,92,246,.15)";e.currentTarget.style.borderColor="var(--blue)";e.currentTarget.style.color="var(--t1)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="var(--bg3)";e.currentTarget.style.borderColor="var(--b1)";e.currentTarget.style.color="var(--t2)";}}>
            {dark?"☀️ Light":"🌙 Dark"}
          </button>
          <button onClick={logout}
            style={{flex:1,padding:"9px 6px",borderRadius:11,background:"rgba(244,63,94,.08)",border:"1px solid rgba(244,63,94,.2)",color:"var(--red)",cursor:"pointer",fontSize:12,transition:"all .2s",fontFamily:"inherit",fontWeight:600}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(244,63,94,.18)";e.currentTarget.style.boxShadow="0 4px 14px rgba(244,63,94,.2)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(244,63,94,.08)";e.currentTarget.style.boxShadow="none";}}>
            Sign Out
          </button>
        </div>
      </div>}
      {collapsed&&<div style={{padding:"8px",borderTop:"1px solid var(--b1)"}}>
        <button onClick={logout} title="Sign Out"
          style={{width:"100%",padding:"9px",borderRadius:10,background:"rgba(244,63,94,.08)",border:"1px solid rgba(244,63,94,.18)",color:"var(--red)",cursor:"pointer",fontSize:15}}>↩</button>
      </div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════
const TIPS=["Book flights Tue/Wed — 15–25% cheaper than weekends","Travel shoulder season: great weather, 30% lower prices","No-FX-fee credit card saves 3% on every purchase abroad","Overnight trains = free hotel + transit combined","Set Google Flights price alerts — free and very accurate","Pack one fewer outfit than you think you need"];

function Dashboard({user,plans,chats,go}) {
  const total    = plans.reduce((s,p)=>s+Number(p.budget||0),0);
  const upcoming = plans.filter(p=>p.status==="upcoming");
  const past     = plans.filter(p=>p.status==="past");
  const recent   = plans.slice(0,4);

  const TIPS = [
    "Book flights 6–8 weeks in advance to save up to 40% on airfare ✈️",
    "Travel in shoulder season for best prices & fewer crowds 📅",
    "Always buy travel insurance — a ₹500 policy can save ₹50,000+ 🛡️",
    "Use incognito mode when searching flights — prices rise with repeat searches 🔍",
    "Google Flights' price calendar shows the cheapest days to fly 💰",
    "IRCTC Tatkal quota opens 24hr before departure — great for last-minute travel 🚆",
  ];
  const [tip, setTip] = useState(0);
  useEffect(()=>{ const t=setInterval(()=>setTip(i=>(i+1)%TIPS.length),5000); return()=>clearInterval(t); },[]);

  const STATS = [
    {icon:"✈️", label:"Total Trips",  value:plans.length,  g:"var(--g1)", glow:"rgba(139,92,246,.45)"},
    {icon:"🗓️", label:"Upcoming",    value:upcoming.length,g:"var(--g2)", glow:"rgba(6,182,212,.35)"},
    {icon:"✅", label:"Completed",    value:past.length,    g:"var(--g7)", glow:"rgba(5,150,105,.35)"},
    {icon:"💰", label:"Total Budget", value:formatINR(total), g:"var(--g8)", glow:"rgba(245,158,11,.4)"},
  ];

  const ACTIONS = [
    {label:"Chat with AI Planner", sub:"Plan any trip instantly",      icon:"✦", g:"var(--g5)", page:"chat"},
    {label:"Add a Future Trip",    sub:"Save your upcoming travels",   icon:"🗓️",g:"var(--g2)", page:"future"},
    {label:"Explore Destinations", sub:"Discover places worldwide",    icon:"🌍",g:"var(--g3)", page:"explore"},
  ];

  // Gradient bar chart
  const barData = plans.slice(-5).map(p=>({
    label: (p.destination||"Trip").split(",")[0].slice(0,10),
    value: Number(p.budget||0)
  }));
  const maxV = Math.max(...barData.map(b=>b.value), 1);

  return(
    <div className="aup" style={{padding:"2px 0"}}>

      {/* ── Header ── */}
      <div style={{marginBottom:28,display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
        <div>
          <h1 style={{fontSize:30,fontWeight:900,letterSpacing:"-.03em",marginBottom:4,display:"flex",alignItems:"center",gap:10,fontFamily:"var(--font-display)"}}>
            Hey {(user.name||"Traveller").split(" ")[0]}
            <span style={{display:"inline-block"}}>👋</span>
          </h1>
          <p style={{color:"var(--t3)",fontSize:14}}>{new Date().toLocaleDateString("en-IN",{weekday:"long",month:"long",day:"numeric"})} · Your travel command centre</p>
        </div>
        <button onClick={()=>go("chat")} className="btn btn-p" style={{fontSize:13,padding:"11px 22px",borderRadius:13,whiteSpace:"nowrap",background:"var(--g5)",boxShadow:"0 4px 20px rgba(56,189,248,.4)"}}>
          Plan a Trip ✦
        </button>
      </div>

      {/* ── Stat cards ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:16,marginBottom:24}}>
        {STATS.map((s,i)=>(
          <div key={i} className="aup" style={{
            animationDelay:`${i*60}ms`,
            padding:"22px 20px",
            borderRadius:18,
            background:"var(--card)",
            border:"1px solid var(--b1)",
            position:"relative",overflow:"hidden",
            cursor:"default",
            transition:"transform .22s, box-shadow .22s",
          }}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-6px) scale(1.01)";e.currentTarget.style.boxShadow=`0 20px 50px ${s.glow}, 0 0 0 1px ${s.glow}`;e.currentTarget.style.borderColor="var(--b2)";}}
            onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";e.currentTarget.style.borderColor="var(--b1)";}}
          >
            {/* Gradient orb */}
            <div style={{position:"absolute",top:-30,right:-30,width:110,height:110,borderRadius:"50%",background:s.g,opacity:.14,filter:"blur(20px)"}}/>
            {/* Icon circle */}
            <div style={{width:46,height:46,borderRadius:14,background:s.g,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,marginBottom:14,boxShadow:`0 4px 16px ${s.glow}`}}>
              {s.icon}
            </div>
            <div style={{fontSize:26,fontWeight:900,letterSpacing:"-.02em",marginBottom:4,background:s.g,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
              {s.value}
            </div>
            <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em"}}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Main grid ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(290px,1fr))",gap:18}}>

        {/* Recent Plans */}
        <div className="aup card" style={{padding:22,animationDelay:"160ms"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
            <h3 style={{fontSize:15,fontWeight:800,letterSpacing:"-.01em"}}>Recent Plans</h3>
            <button onClick={()=>go("history")} style={{fontSize:12,color:"var(--blu2)",background:"none",border:"none",cursor:"pointer",fontWeight:600}}>View all →</button>
          </div>
          {recent.length===0?(
            <div style={{textAlign:"center",padding:"28px 0"}}>
              <div style={{fontSize:38,marginBottom:10}}>🗺️</div>
              <p style={{color:"var(--t3)",fontSize:13,marginBottom:14}}>No trips planned yet</p>
              <button onClick={()=>go("chat")} className="btn btn-p" style={{fontSize:12,padding:"9px 18px"}}>Plan with AI ✦</button>
            </div>
          ):recent.map((p,i)=>(
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:13,padding:"10px 0",borderBottom:i<recent.length-1?"1px solid var(--b1)":"none"}}>
              <div style={{width:38,height:38,borderRadius:12,background:p.status==="upcoming"?"var(--g1)":"var(--g7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,boxShadow:"0 4px 12px rgba(0,0,0,.25)"}}>
                {p.status==="upcoming"?"🗓️":"✅"}
              </div>
              <div style={{flex:1,overflow:"hidden"}}>
                <div style={{fontSize:13,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.destination}</div>
                <div style={{fontSize:11,color:"var(--t3)",marginTop:1}}>{fdate(p.startDate)||"—"} · {formatINR(p.budget)}</div>
              </div>
              <div style={{width:8,height:8,borderRadius:"50%",background:p.status==="upcoming"?"var(--teal)":"var(--grn)",flexShrink:0}}/>
            </div>
          ))}
        </div>

        {/* Budget chart */}
        <div className="aup card" style={{padding:22,animationDelay:"200ms"}}>
          <h3 style={{fontSize:15,fontWeight:800,marginBottom:16,letterSpacing:"-.01em"}}>Budget Overview</h3>
          {barData.length===0?(
            <div style={{textAlign:"center",padding:"28px 0",color:"var(--t3)",fontSize:13}}>Add trips to see budget chart</div>
          ):(
            <div>
              {barData.map((b,i)=>(
                <div key={i} style={{marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontSize:11,color:"var(--t2)",fontWeight:600}}>{b.label}</span>
                    <span style={{fontSize:11,color:"var(--t3)"}}>{formatINR(b.value)}</span>
                  </div>
                  <div style={{height:7,borderRadius:99,background:"var(--bg3)",overflow:"hidden"}}>
                    <div style={{
                      height:"100%",
                      width:`${(b.value/maxV)*100}%`,
                      borderRadius:99,
                      background:`linear-gradient(90deg, ${["#8b5cf6","#38bdf8","#ec4899","#d97706","#059669"][i%5]}, ${["#7c3aed","#06b6d4","#f97316","#ea580c","#38bdf8"][i%5]})`,
                      transition:"width .8s cubic-bezier(.4,0,.2,1)",
                      boxShadow:`0 0 10px ${["rgba(139,92,246,.5)","rgba(6,182,212,.4)","rgba(247,37,133,.4)","rgba(245,158,11,.4)","rgba(5,150,105,.4)"][i%5]}`,
                    }}/>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{marginTop:16,padding:"10px 14px",borderRadius:12,background:"var(--bg3)",border:"1px solid var(--b1)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,color:"var(--t3)",fontWeight:600}}>Total Budget</span>
            <span style={{fontSize:15,fontWeight:900,background:"var(--g8)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>{formatINR(total)}</span>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="aup card" style={{padding:22,animationDelay:"240ms"}}>
          <h3 style={{fontSize:15,fontWeight:800,marginBottom:16,letterSpacing:"-.01em"}}>Quick Actions</h3>
          {ACTIONS.map((a,i)=>(
            <button key={i} onClick={()=>go(a.page)}
              style={{
                width:"100%",display:"flex",alignItems:"center",gap:14,
                padding:"13px 14px",borderRadius:14,marginBottom:10,
                background:"var(--bg3)",border:"1px solid var(--b1)",
                color:"var(--t1)",textAlign:"left",cursor:"pointer",
                fontFamily:"inherit",transition:"all .2s",
              }}
              onMouseEnter={e=>{e.currentTarget.style.background=`rgba(139,92,246,.12)`;e.currentTarget.style.borderColor="var(--blue)";e.currentTarget.style.transform="translateX(5px)";e.currentTarget.style.boxShadow="0 4px 20px rgba(139,92,246,.15)";}}
              onMouseLeave={e=>{e.currentTarget.style.background="var(--bg3)";e.currentTarget.style.borderColor="var(--b1)";e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="none";}}
            >
              <div style={{width:40,height:40,borderRadius:12,background:a.g,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0,boxShadow:"0 4px 14px rgba(0,0,0,.3)"}}>
                {a.icon}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,marginBottom:1}}>{a.label}</div>
                <div style={{fontSize:11,color:"var(--t3)"}}>{a.sub}</div>
              </div>
              <span style={{color:"var(--t3)",fontSize:16,flexShrink:0}}>→</span>
            </button>
          ))}
        </div>

        {/* AI Tip card */}
        <div className="aup" style={{
          borderRadius:20,padding:24,animationDelay:"280ms",
          background:"linear-gradient(135deg, rgba(139,92,246,.14) 0%, rgba(139,92,246,.08) 100%)",
          border:"1px solid rgba(139,92,246,.25)",
          boxShadow:"inset 0 1px 0 rgba(255,255,255,.06), 0 4px 24px rgba(139,92,246,.1)",
        }}>
          <div style={{display:"flex",gap:13,alignItems:"flex-start",marginBottom:16}}>
            <div style={{width:44,height:44,borderRadius:14,background:"var(--g1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0,boxShadow:"0 4px 18px rgba(56,189,248,.4)"}}>✦</div>
            <div style={{flex:1}}>
              <div style={{fontSize:10,fontWeight:800,color:"var(--blu2)",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>Travel Tip</div>
              <div key={tip} className="ain" style={{fontSize:13,color:"var(--t2)",lineHeight:1.75}}>{TIPS[tip]}</div>
            </div>
          </div>
          {/* Tip dots */}
          <div style={{display:"flex",gap:5,marginBottom:16,paddingLeft:57}}>
            {TIPS.map((_,i)=>(
              <div key={i} style={{
                width:i===tip?20:6, height:6, borderRadius:99,
                background:i===tip?"var(--blue)":"var(--b1)",
                transition:"all .35s cubic-bezier(.4,0,.2,1)",
              }}/>
            ))}
          </div>
          <button onClick={()=>go("chat")} className="btn btn-p" style={{width:"100%",padding:12,fontSize:13,borderRadius:13}}>
            Plan a Trip with AI ✦
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// AI CHAT ENGINE
// ══════════════════════════════════════════════════════════════════

const ALFA_SYSTEM = `You are Wandr AI, a friendly and helpful travel assistant. You help users plan trips, explore destinations, find hotels, food, transport, budgets, and travel tips.

RULES:
1. Always try to help. If the user's message is unclear, ask a friendly follow-up question.
2. For any destination — city, country, region — provide helpful travel information.
3. For non-travel questions, gently redirect: "I'm best at travel planning! Ask me about any destination, hotels, food, transport, or budget."

WHEN USER ASKS ABOUT A DESTINATION:
- Generate helpful, specific travel information
- Include real places, real prices in ₹, real transport options
- Use sections: 📍 Places | 🏨 Hotels | 🍴 Food | ✈️ Transport | 💰 Budget | 🛂 Visa | 💡 Tips

OUTPUT STYLE:
- Bold for headings, bullet points for lists
- Keep paragraphs short (2-3 lines max)
- Friendly, helpful, knowledgeable tone
- Always provide actionable information

NEVER:
- Hallucinate place names, prices, or services
- Say "your destination" — use the actual name
- Respond to non-travel queries
- Generate fake travel plans`;


// ── AI via Backend (Groq) — NO API KEY IN BROWSER ───────────────
// All AI calls go to our own server: /api/ai/chat
// The server holds the GROQ_API_KEY in .env — never exposed here.

const callBackendAI = async (messages, systemPrompt, onChunk) => {
  const res = await call("/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({ messages, systemPrompt }),
  });
  if (!res.success) throw new Error(res.error || "ai_error");
  const fullText = res.text || "";
  if (!onChunk) return fullText;
  // Simulate streaming by chunking the response
  let accumulated = "";
  const chunkSize = 30;
  for (let i = 0; i < fullText.length; i += chunkSize) {
    accumulated += fullText.substring(i, i + chunkSize);
    onChunk(accumulated);
    await new Promise(r => setTimeout(r, 18));
  }
  return fullText;
};

// ── REAL DESTINATIONS VALIDATOR ──────────────────────────────────
const REAL_DESTINATIONS = new Set([
  // India
  "goa", "mumbai", "delhi", "bangalore", "hyderabad", "pune", "jaipur", "agra", "lucknow",
  "kolkata", "chennai", "kerala", "manali", "shimla", "udaipur", "jodhpur", "bikaner",
  "indore", "ahmedabad", "rajasthan", "jammu", "kashmir", "ladakh", "sikkim", "assam",
  "darjeeling", "meghalaya", "chhattisgarh", "jharkhand", "odisha", "uttarakhand",
  "himachal", "haryana", "gujarat", "maharashtra", "karnataka", "telangana", "punjab",
  // Worldwide
  "japan", "thailand", "dubai", "london", "paris", "usa", "new york", "singapore", "bali",
  "australia", "thailand", "vietnam", "cambodia", "laos", "myanmar", "nepal", "bhutan",
  "sri lanka", "maldives", "mauritius", "seychelles", "europe", "switzerland", "rome",
  "venice", "bangkok", "tokyo", "singapore", "seoul", "dubai", "abu dhabi", "oman",
  "egypt", "israel", "turkey", "greece", "spain", "portugal", "italy", "france",
  "germany", "austria", "czech", "poland", "canada", "mexico", "brazil", "peru",
  "argentina", "chile", "new zealand", "fiji", "bali", "indonesia", "malaysia", "hong kong"
]);

const isRealDestination = (dest) => {
  if (!dest) return false;
  const normalized = dest.toLowerCase().trim();
  // Check exact match
  if (REAL_DESTINATIONS.has(normalized)) return true;
  // Check partial matches for compound destinations
  const parts = normalized.split(/[\s&-]+/);
  return parts.some(p => REAL_DESTINATIONS.has(p.trim())) || parts.length > 1;
};

const callAI = async (messages, system, onChunk) => {
  return callBackendAI(messages, system, onChunk);
};

// ── EXTRACTOR PROMPT ──────────────────────────────────────────────
const EXTRACTOR_SYSTEM = `You are a travel intent extractor. Read the user's message and return ONLY valid JSON with no extra text, no markdown, no backticks.

Extract these fields:
- intent: one of ["itinerary","hotels","food","transport","budget","visa","places","tips","general"]
- source: starting city/place (null if not mentioned)
- destination: REAL place name (never null — if unclear, make best guess)
- people: number of travelers (default 1)
- days: trip duration (default 5)
- budget_level: "budget" | "mid" | "luxury" | null

Intent detection rules:
- "plan/trip/itinerary/days" → "itinerary"
- "hotel/stay/accommodation/resort/hostel" → "hotels"
- "food/eat/restaurant/cuisine/dish" → "food"
- "flight/train/bus/how to reach/transport/bike" → "transport"
- "budget/cost/how much/price/cheap/expensive" → "budget"
- "visa/passport/document" → "visa"
- "places/spots/tourist/visit/see/best" → "places"
- "tips/advice/suggest" → "tips"
- hi/hello/general conversation → "general"

Location shortcuts:
- "AP" → "Andhra Pradesh", "HP" → "Himachal Pradesh", "UP" → "Uttar Pradesh"
- "MP" → "Madhya Pradesh", "TN" → "Tamil Nadu", "WB" → "West Bengal"
- "JK" or "J&K" → "Jammu & Kashmir", "UK" (India context) → "Uttarakhand"
- "USA" → "USA", "UK" (travel) → "United Kingdom"
- Always expand abbreviations to full place names

People detection:
- "we are 5" / "5 members" / "group of 5" → people: 5
- "couple" / "2 of us" → people: 2
- "solo" / "alone" / "myself" → people: 1
- "family" (no count) → people: 4

Examples:
Input: "we are 5 members going from andhra to punjab 7 days"
Output: {"intent":"itinerary","source":"Andhra Pradesh","destination":"Punjab","people":5,"days":7,"budget_level":null}

Input: "hotels in tokyo under budget"
Output: {"intent":"hotels","source":null,"destination":"Tokyo","people":1,"days":5,"budget_level":"budget"}

Input: "best food in Bangkok"
Output: {"intent":"food","source":null,"destination":"Bangkok","people":1,"days":5,"budget_level":null}

Input: "how to reach Ladakh from Delhi"
Output: {"intent":"transport","source":"Delhi","destination":"Ladakh","people":1,"days":5,"budget_level":null}

Input: "cheap Europe trip for 2"
Output: {"intent":"budget","source":null,"destination":"Europe","people":2,"days":10,"budget_level":"budget"}`;


// ── PLANNER PROMPT ────────────────────────────────────────────────
const makePlannerSystem = (src, dest, people, days, intent, budgetLevel) => {
  const P = people || 1;
  const N = days || 5;
  const BL = budgetLevel || "mid";
  const srcStr = src ? `From: ${src}` : "";
  const intentInstructions = {
    itinerary: `Create a detailed ${N}-day day-wise itinerary for ${dest}. Include specific places, activities, food, and evening plans for each day. End with full budget table in ₹ for ${P} people.`,
    hotels: `Give hotel recommendations in ${dest} for ${P} ${P===1?"person":"people"}, ${N} nights. Organize by: Budget (₹), Mid-range (₹), Luxury (₹). Include area/location advice and booking tips.`,
    food: `Give a complete food guide for ${dest}. Include: must-try dishes, best areas for food, specific restaurant suggestions, street food spots, and price ranges in ₹.`,
    transport: `${src?`Explain how to travel from ${src} to ${dest}. Include all transport options (flight, train, bus, car) with ₹ prices and travel time. Also explain`:  `Explain`} local transport options within ${dest}: metro, auto, bike rental, taxi — with ₹ prices.`,
    budget: `Give a complete budget breakdown for a ${N}-day trip to ${dest} for ${P} ${P===1?"person":"people"}. Show Budget / Mid-range / Luxury tiers in ₹. Include flights, hotels, food, activities, local transport.`,
    visa: `Give complete visa information for Indian passport holders visiting ${dest}. Include: type of visa, fees in ₹, documents needed, processing time, application link/process.`,
    places: `List the top places to visit in ${dest}. For each place include: what it's famous for, best time to visit, entry fees in ₹, and practical tips.`,
    tips: `Give expert travel tips for ${dest} covering: best season, local customs, safety, money tips, things to avoid, hidden gems, and packing advice.`,
    general: `Be a friendly travel assistant. Answer helpfully and suggest what you can help with for ${dest || "their travel plans"}.`,
  };

  return `You are Wandr AI, a highly intelligent global travel assistant.

Request context:
- Destination: ${dest}
${srcStr ? `- ${srcStr}` : ""}
- Travelers: ${P} ${P===1?"person":"people"}
- Duration: ${N} days
- Budget level preference: ${BL}

Your task: ${intentInstructions[intent] || intentInstructions.general}

CRITICAL:
- Use REAL place name "${dest}" throughout — never say "your destination"
- All prices in ₹ (INR). Use: 1 USD≈₹83, 1 EUR≈₹90
- Be specific — real hotel names, real dishes, real transport options
- Keep it structured, clear, friendly
- End with one smart follow-up question`;
};


// ── LOCAL PLAN GENERATOR ──────────────────────────────────────────
const localPlan = (extracted, originalText) => {
  const {source, destination: dest, people, days, intent, budget_level} = extracted;
  const D = dest;
  const P = people;
  const N = days;
  const src = source;

  // Non-trip queries
  const t = originalText.toLowerCase();
  if(/^(hi|hello|hey|namaste)[\s!.,]*$/.test(t.trim()))
    return `Namaste! 🙏✈️ I'm **Wandr AI** — your intelligent travel planner!\n\nJust type any destination and I'll build a complete trip plan instantly.\n\n**Try:** "5 friends Goa 3 days" · "Family trip Rajasthan 7 days" · "Japan honeymoon 10 days"\n\nWhere shall we go? 🌍`;

  if(/^(thanks|thank you|great|awesome|perfect|ok|okay)[\s!.,]*$/.test(t.trim()))
    return `You're welcome! 😊 Want me to refine the plan or check hotels & budget for ${D}? Just ask!`;

  if(/visa|passport/.test(t)) return `🛂 **Visa Info** — For Indian passport holders visiting ${D}:\n\n• Check the official embassy website for ${D}\n• Apply 4–6 weeks before travel\n• Carry 6 months bank statements + travel insurance\n• Use VFS Global for most countries\n\nNeed the exact visa process for ${D}? Ask me!`;

  // Generate the plan
  const perPersonBudget = dest.toLowerCase().match(/usa|uk|europe|japan|australia|canada|switzerland|france|germany/) ? 80000 : dest.toLowerCase().match(/bali|thailand|singapore|dubai|maldives|malaysia|vietnam/) ? 45000 : 15000;
  const totalBudget = perPersonBudget * P;
  const flightCost = dest.toLowerCase().match(/usa|uk|europe|japan|australia|canada/) ? '₹45,000–90,000' : dest.toLowerCase().match(/bali|thailand|singapore|dubai|maldives/) ? '₹18,000–40,000' : dest.toLowerCase().match(/domestic|india|goa|rajasthan|kerala|himachal|kashmir|ladakh|andaman/) ? '₹4,000–12,000' : '₹8,000–25,000';
  const hotelCost = dest.toLowerCase().match(/usa|uk|europe|japan|australia/) ? '₹8,000–20,000' : dest.toLowerCase().match(/bali|thailand|singapore|dubai/) ? '₹4,000–12,000' : '₹1,500–6,000';

  return `🌟 **${N}-Day Trip Plan for ${D}**
👥 ${P} ${P===1?"Person":"People"} | 📅 ${N} Days${src?` | 🚀 From ${src}`:""}

---
${src?`✈️ **Getting There from ${src} to ${D}:**
• Flight: Search on Google Flights / MakeMyTrip — ${flightCost} (return per person)
• Train: IRCTC app — check Rajdhani/Vande Bharat routes
• Bus: Redbus overnight AC — ₹800–2,000

`:""}
📅 **Day-by-Day Itinerary:**

**Day 1: Arrival & Orientation**
• Morning: Arrive in ${D}, check into hotel, freshen up
• Afternoon: Explore the main market / city centre area
• Evening: Visit the most iconic landmark or viewpoint in ${D}
• 🍴 Dinner: Try the most famous local dish — ask hotel staff for the best spot!

**Day 2: Culture & Heritage**
• Morning: Top historical site, temple, fort, or museum in ${D}
• Afternoon: Local market shopping & street food exploration
• Evening: Cultural show, sunset point, or lakeside walk
• 🍴 Food: Street food tour — 4–5 local snacks

**Day 3: Nature & Adventure**
• Morning: Nature walk, beach, hill trek, or adventure activity
• Afternoon: Scenic viewpoint or short day trip to a nearby attraction
• Evening: Relaxed rooftop dinner with local ambience
• 🍴 Food: Regional specialty restaurant${N>3?`

**Day 4: Hidden Gems**
• Morning: Off-the-beaten-path neighbourhood or village
• Afternoon: Local café, artisan market, or cooking class
• Evening: Night market, rooftop bar, or cultural performance
• 🍴 Food: The restaurant locals actually go to (ask your hotel!)`:""} ${N>4?`

**Day ${N}: Departure Day**
• Morning: Last souvenirs & local breakfast
• Afternoon: Visit one final landmark before heading out
• Evening: Depart ${D} with beautiful memories ✈️`:""}

---
💰 **Budget Estimate (in ₹):**

| Category | Per Person | Total (${P} ${P===1?"person":"people"}) |
|---|---|---|
| ✈️ Transport | ${flightCost.split("–")[0]} | ${flightCost.split("–")[0].replace("₹","₹").replace(/\d+/,n=>parseInt(n)*P)} |
| 🏨 Hotel (${N} nights) | ${hotelCost.split("–")[0]}/night | ${hotelCost.split("–")[0].replace("₹","₹").replace(/\d+/,n=>parseInt(n)*P)}/night |
| 🍴 Food | ₹800–1,500/day | ₹${(800*P).toLocaleString("en-IN")}–₹${(1500*P).toLocaleString("en-IN")}/day |
| 🎫 Activities | ₹1,500 | ₹${(1500*P).toLocaleString("en-IN")} |
| 🚗 Local Transport | ₹800 | ₹${(800*P).toLocaleString("en-IN")} |
| **💵 Total** | **₹${perPersonBudget.toLocaleString("en-IN")}** | **₹${totalBudget.toLocaleString("en-IN")}** |

---
🏨 **Hotels in ${D}:**
• 🟢 Budget: Hostels / OYO / Treebo — ${hotelCost.split("–")[0]}/night
• 🟡 Mid-range: 3★ Hotels / Lemon Tree — ${hotelCost.split("–")[1] || "₹4,000"}/night
• 🔴 Luxury: 5★ Taj / Oberoi / Marriott — ₹${(parseInt(hotelCost.split("–")[1]?.replace(/[₹,]/g,"")||8000)*2).toLocaleString("en-IN")}+/night

---
💡 **Pro Tips for ${D}:**
• Book flights & hotels 3–4 weeks ahead (save 20–30%)
• Visit top attractions early morning (7–9am) — half the crowds
• Carry some local cash + backup debit card
• Download Google Maps offline for ${D} before departing

---
*Want me to refine this plan, add specific hotel names, or adjust the budget for ${D}? Just ask! ✈️*`;
};

// ── LOCAL EXTRACTOR (no API needed) ──────────────────────────────
const localExtract = (text) => {
  const t = text.toLowerCase().trim();

  // People
  const pm = t.match(/(\d+)\s*(?:people|person|member|pax|adult|passenger|travell?er|of us|friend|family member)/);
  const wm = /\b(we|us|our)\b/.test(t) && !pm;
  const people = pm ? parseInt(pm[1]) : /\bcouple\b/.test(t) ? 2 : /\bfamily\b/.test(t) && !pm ? 4 : wm ? 2 : 1;

  // Days
  const dm = t.match(/(\d+)\s*(?:day|night|week)/);
  const days = dm ? (/week/.test(t) ? parseInt(dm[1])*7 : parseInt(dm[1])) : 5;

  // Source
  const sm = text.match(/(?:from|starting from|leaving from|departing from)\s+([A-Za-z][A-Za-z\s]{1,25}?)(?:\s+to|\s+for|\s+going|\s*,|$)/i);
  const source = sm ? sm[1].trim().split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ') : null;

  // Destination patterns
  const destPats = [
    /(?:to|visit|going to|travel to|trip to|plan for|itinerary for|reach|from\s+\S+\s+to)\s+([A-Za-z][A-Za-z\s]{1,30}?)(?:\s+(?:for|\d+|trip|from)|[,.]|$)/i,
    /([A-Za-z][A-Za-z\s]{1,25}?)\s+(?:trip|travel|itinerary|plan|tour|\d+\s*day|hotel|food|visa)/i,
    /^([A-Za-z][A-Za-z\s]{1,30}?)(?:\s+\d+|\s*$)/i,
  ];
  const STOP = new Set(['plan','trip','travel','visit','itinerary','day','days','night','nights','budget','cheap','best','places','in','to','for','a','the','me','my','please','can','you','show','suggest','give','want','going','week','month','near','about','tell','around','from','of','and','or','is','are','was','with','have','will','would','should','could','also','need','find','search','top','famous','popular','hidden','good','great','nice','amazing','affordable','expensive','luxury','solo','family','couple','honeymoon','we','us','our','members','people','person','this','that','what','how','where','when','hotel','food','visa','transport','flight','train','bus','bike','car']);
  const ACRONYMS = {'usa':'USA','uk':'United Kingdom','uae':'UAE','us':'USA','nyc':'New York City','la':'Los Angeles','sf':'San Francisco','ap':'Andhra Pradesh','hp':'Himachal Pradesh','up':'Uttar Pradesh','mp':'Madhya Pradesh','tn':'Tamil Nadu','wb':'West Bengal','jk':'Jammu & Kashmir','uk':'Uttarakhand'};

  let destination = null;
  for(const pat of destPats) {
    const m = text.match(pat);
    if(m && m[1]) {
      const words = m[1].trim().split(/\s+/).filter(w=>!STOP.has(w.toLowerCase()) && w.length>1);
      if(words.length > 0) {
        destination = words.map(w=>ACRONYMS[w.toLowerCase()] || (w.charAt(0).toUpperCase()+w.slice(1))).join(' ');
        break;
      }
    }
  }
  // Fallback: find capitalized words
  if(!destination) {
    const caps = text.match(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g);
    if(caps) {
      const f = caps.filter(w=>!STOP.has(w.toLowerCase()) && w.length>3);
      if(f.length) destination = f[f.length-1];
    }
  }

  // Intent detection
  const intentMap = [
    [/hotel|stay|accommodation|resort|hostel|airbnb|oyo|lodge/, "hotels"],
    [/food|eat|restaurant|cuisine|dish|street food|taste|where to eat/, "food"],
    [/flight|train|bus|how to reach|how to go|transport|bike|car rental|local transport/, "transport"],
    [/budget|cost|how much|cheap|expensive|price|₹|inr|rupee/, "budget"],
    [/visa|passport|document|permit|immigration|entry/, "visa"],
    [/places|spots|tourist|best places|top places|famous|hidden|visit|see|attractions/, "places"],
    [/tips|advice|guide|suggest|safety|custom|what to|packing/, "tips"],
    [/plan|trip|itinerary|day|days|night|nights|schedule/, "itinerary"],
    [/^(hi|hello|hey|namaste|hii|thanks|thank you|great|ok|okay)[\s!.,]*$/, "general"],
  ];
  let intent = "itinerary";
  for(const [pat, val] of intentMap) { if(pat.test(t)) { intent = val; break; } }

  const budgetLevel = /cheap|budget|affordable|backpack|low cost/.test(t) ? "budget" : /luxury|5 star|premium|high end|expensive/.test(t) ? "luxury" : "mid";

  return {
    source: source || null,
    destination: destination || "India",
    people: Math.max(1, Math.min(people, 50)),
    days: Math.max(1, Math.min(days, 30)),
    intent,
    budget_level: budgetLevel,
  };
};


// ── MAIN AI HANDLER — Groq only, no local fallbacks ─────────────
const processWithAI = async (userText, history, onStream) => {
  // Extract structured data locally (just for context, no fallback responses)
  let extracted = localExtract(userText);

  // Always send everything to Groq AI

  // Step 2: Generate the travel plan with STREAMING
  let plan = null;
  try {
    const planSystem = makePlannerSystem(extracted.source, extracted.destination, extracted.people, extracted.days, extracted.intent, extracted.budget_level);
    const convHistory = history.slice(-8).map(m=>({role:m.role,content:m.content}));
    convHistory.push({role:"user", content: userText});
    plan = await callAI(convHistory, planSystem, onStream);
    if(extracted && extracted.destination && plan && !plan.includes(extracted.destination)) {
      plan = plan.replace(/your destination/gi, extracted.destination);
    }
  } catch(e) {
    const errorMsg = e.message || "unknown_error";
    plan = "";
    
    if (errorMsg === "request_timeout" || errorMsg === "abort") {
      plan = "⏱️ **Request Timeout**\n\nThe server took too long to respond.\n• Check your internet connection\n• Try again in a moment";
    } else if (errorMsg === "empty_response") {
      plan = "📭 **Empty Response**\n\nThe AI returned an empty response. Please try again.";
    } else if (errorMsg.startsWith("api_")) {
      const status = errorMsg.replace("api_", "");
      plan = `❌ **Server Error (${status})**\n\nThe AI backend returned an error. Try again shortly.`;
    } else {
      plan = "❌ Error generating plan. Please try again.";
    }
    console.error("AI Error:", e);
  }

  return {plan, extracted, provider: "Groq"};
};


const CHAT_PROMPTS = [
  "5 friends Goa 3 days",
  "Family of 4 Rajasthan 7 days",
  "Couple honeymoon Maldives 5 days",
  "We are going from Delhi to Manali",
  "Solo Japan trip 10 days",
  "3 people Kerala backwaters 4 days",
  "From Mumbai to Goa road trip",
  "Group of 8 Ladakh 6 days",
];

function ChatPage({user,chats,setChats,plans,setPlans}) {
  const [active,    setActive]   = useState(null);
  const [input,     setInput]    = useState("");
  const [sending,   setSending]  = useState(false);
  const [animId,    setAnimId]   = useState(null);
  const [banner,    setBanner]   = useState(null);
  const [search,    setSearch]   = useState("");
  const [provider,  setProvider] = useState("Groq");
  const [showKeys,  setShowKeys] = useState(false);
  const msgsRef  = useRef([]);
  const chatsRef = useRef(chats);
  const bottomRef= useRef(null);
  const taRef    = useRef(null);
  const requestControllerRef = useRef(null);

  const cancelRequest = () => {
    if (requestControllerRef.current) {
      requestControllerRef.current.abort();
      requestControllerRef.current = null;
      setSending(false);
      setAnimId(null);
      toast.err("Request cancelled");
    }
  };

  useEffect(()=>{chatsRef.current=chats;},[chats]);
  useEffect(()=>{ try{const s=ls.get("achats_"+(user?.id||"g"),[]); if(s.length)setChats(s);}catch(e){} },[]);
  useEffect(()=>{ ls.set("achats_"+(user?.id||"g"),chats); },[chats]);

  // Listen for prompts from Explore page
  useEffect(()=>{
    const h=(e)=>{ setInput(e.detail); taRef.current?.focus(); };
    window.addEventListener("wandr_prompt",h);
    window.addEventListener("alfa_prompt",h);
    return ()=>{ window.removeEventListener("wandr_prompt",h); window.removeEventListener("alfa_prompt",h); };
  },[]);

  const curChat = chats.find(c=>c.id===active)||null;
  const msgs    = curChat?.messages||[];
  msgsRef.current = msgs;
  const filtered = chats.filter(c=>!search||c.title.toLowerCase().includes(search.toLowerCase()));

  const newChat = () => {
    const c={id:uid(),title:"New Chat",createdAt:now(),updatedAt:now(),messages:[],messageCount:0};
    setChats(p=>[c,...p]); setActive(c.id);
  };
  const delChat = (id,e) => {
    e.stopPropagation();
    if(active===id) setActive(null);
    setChats(p=>p.filter(c=>c.id!==id));
    toast.ok("Chat deleted");
  };

  const send = async () => {
    if(!input.trim()||sending) return;
    if(!rateLimiter.canCall()){ toast.err("Please wait a moment before sending again"); return; }
    rateLimiter.record();
    const text = sanitize(input.trim()); setInput("");
    let cid = active, isNew=false;
    if(!cid){ cid=uid(); isNew=true; const c={id:cid,title:text.slice(0,46),createdAt:now(),updatedAt:now(),messages:[],messageCount:0}; setChats(p=>[c,...p]); setActive(cid); }
    const uMsg={id:uid(),role:"user",content:text,ts:now()};
    const prev = msgsRef.current;
    setChats(p=>p.map(c=>c.id===cid?{...c,title:c.messages.length===0?text.slice(0,46):c.title,messages:[...c.messages,uMsg],messageCount:(c.messages.length||0)+1,updatedAt:now()}:c));
    setSending(true);

    const aid = uid();
    // Add placeholder streaming message
    const streamMsg = {id:aid, role:"assistant", content:"", ts:now(), streaming:true, provider: "Groq"};
    setChats(p=>p.map(c=>c.id===cid?{...c,messages:[...c.messages,streamMsg],messageCount:(c.messages.length||0)+2,updatedAt:now()}:c));
    setAnimId(aid);

    // Watchdog timer - fail if no response after 35 seconds
    const watchdogId = setTimeout(() => {
      if (sending) {
        setSending(false);
        setAnimId(null);
        const errorMsg = "⏱️ **Response Timeout (35s)**\n\nThe server isn't responding.\n\n**Try again** or check your internet connection.";
        setChats(p=>p.map(c=>c.id===cid?{...c,messages:c.messages.map(m=>m.id===aid?{...m,content:errorMsg,streaming:false}:m)}:c));
        toast.err("Request timed out - try again");
      }
    }, 35000);

    try {
      let lastExtracted = null;
      const {plan: reply, extracted} = await processWithAI(text, prev, (partialText) => {
        // Update streaming message with partial content
        setChats(p=>p.map(c=>c.id===cid?{...c,messages:c.messages.map(m=>m.id===aid?{...m,content:partialText,streaming:true}:m)}:c));
      });
      clearTimeout(watchdogId);
      lastExtracted = extracted;
      // Finalize message (remove streaming flag)
      setChats(p=>p.map(c=>c.id===cid?{...c,messages:c.messages.map(m=>m.id===aid?{...m,content:reply||m.content,streaming:false,provider:"Groq"}:m),updatedAt:now()}:c));
      setAnimId(null);
      if(lastExtracted && lastExtracted.destination && lastExtracted.destination !== "India") {
        setBanner({destination:lastExtracted.destination,startDate:"",endDate:"",budget:0,activities:`${lastExtracted.people} people, ${lastExtracted.days} days`,status:"upcoming"});
      }
    } catch(e) {
      clearTimeout(watchdogId);
      let fallback = "";
      const errorMsg = e.message || "unknown";
      console.error("📛 Chat Error Details:", {errorMsg, stack: e.stack});
      
      if(false) {
        // no-op
      } else if(errorMsg === "request_timeout") {
        fallback = "⏱️ **Request Timeout**\n\nThe server didn't respond in time.\n\n**Try again** - usually works on the second attempt!";
      } else if(errorMsg === "empty_response") {
        fallback = "📭 **Empty Response**\n\nThe AI returned no data. This is usually temporary.\n\n**Try again.**";
      } else if(errorMsg.startsWith("api_")) {
        const status = errorMsg.replace("api_", "");
        if(status === "429") {
          fallback = "⏸️ **Rate Limited (429)**\n\nToo many requests. **Wait 30 seconds**, then try again.";
        } else if(status === "500" || status === "502" || status === "503") {
          fallback = "🔧 **Server Error (" + status + ")**\n\nThe backend is having issues. **Wait a few minutes and try again.**";
        } else {
          fallback = "❌ **Error (" + status + ")**\n\nThe backend returned an error. **Try again.**";
        }
      } else {
        fallback = "❌ Error: " + (e.message || "Unable to generate response. Check your internet connection.");
      }
      
      setChats(p=>p.map(c=>c.id===cid?{...c,messages:c.messages.map(m=>m.id===aid?{...m,content:fallback,streaming:false,provider:"Groq"}:m),updatedAt:now()}:c));
      setAnimId(null);
      toast.err("Request failed - " + (errorMsg === "request_timeout" ? "try again" : "check error"));
    }
    setSending(false);
  };

  const saveTrip = (trip) => {
    setPlans(p=>[{id:uid(),...trip,status:"upcoming",createdAt:now(),updatedAt:now()},...p]);
    toast.ok(`"${trip.destination}" saved to plans!`);
    setBanner(null);
  };

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[msgs.length,sending]);

  return(
    <div style={{display:"flex",gap:16,height:"100%",minHeight:0}}>
      {/* Chat list */}
      <div className="card" style={{width:215,display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden"}}>
        <div style={{padding:"12px 12px 8px"}}>
          <button onClick={newChat} className="btn btn-p" style={{width:"100%",padding:"10px",fontSize:13,borderRadius:10}}>+ New Chat</button>
        </div>
        <div style={{padding:"0 10px 8px"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search chats…" className="inp" style={{padding:"7px 12px",fontSize:12}}/>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"0 8px 8px"}}>
          {filtered.length===0
            ?<p style={{textAlign:"center",color:"var(--t3)",fontSize:12,padding:"20px 8px"}}>{search?"No results":"No chats yet"}</p>
            :filtered.map(c=>{
              const isAct=c.id===active;
              return(
                <div key={c.id} onClick={()=>setActive(c.id)}
                  style={{padding:"10px 11px",borderRadius:10,marginBottom:4,cursor:"pointer",background:isAct?"rgba(56,189,248,.12)":"transparent",border:isAct?"1px solid rgba(56,189,248,.25)":"1px solid transparent",transition:"all .18s",position:"relative"}}
                  onMouseEnter={e=>{e.currentTarget.querySelector(".xbtn").style.opacity="1"; if(!isAct)e.currentTarget.style.background="rgba(255,255,255,.03)";}}
                  onMouseLeave={e=>{e.currentTarget.querySelector(".xbtn").style.opacity="0"; if(!isAct)e.currentTarget.style.background="transparent";}}>
                  <div style={{fontSize:12,fontWeight:isAct?700:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",color:"var(--t1)",paddingRight:18}}>✦ {c.title}</div>
                  <div style={{fontSize:10,color:"var(--t3)",marginTop:2}}>{c.messages?.length??0} msgs</div>
                  <button className="xbtn" onClick={e=>delChat(c.id,e)} style={{position:"absolute",right:7,top:8,background:"none",border:"none",color:"var(--t3)",fontSize:15,opacity:0,transition:"opacity .15s",cursor:"pointer",padding:2}}>×</button>
                </div>
              );
            })
          }
        </div>
      </div>

      {/* Main chat area */}
      <div className="card" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
        {/* Header */}
        <div style={{padding:"11px 16px",borderBottom:"1px solid var(--b1)",display:"flex",alignItems:"center",gap:10,flexShrink:0,flexWrap:"wrap"}}>
          <div style={{width:38,height:38,borderRadius:11,background:"var(--g5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>✦</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:900,fontSize:14,background:"var(--g9)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:"-.01em",fontFamily:"var(--font-display)"}}>Wandr AI Travel OS</div>
            <div style={{fontSize:10,color:"var(--grn)",display:"flex",alignItems:"center",gap:5}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:"var(--grn)",display:"inline-block",animation:"pulse 1.8s infinite",boxShadow:"0 0 8px var(--grn)"}}/>
              Live · Groq AI · 🔒 Secure
            </div>
          </div>

          <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
            <div style={{padding:"6px 12px",borderRadius:10,background:"var(--card2)",color:"var(--t3)",fontSize:12,fontWeight:600,border:"1.5px solid var(--b1)"}}>
              🤖 Groq AI
            </div>
            <button onClick={()=>setShowKeys(s=>!s)} title="API Keys"
              style={{padding:"6px 10px",borderRadius:10,cursor:"pointer",fontFamily:"inherit",fontSize:12,background:showKeys?"var(--bg3)":"var(--card2)",border:"1px solid var(--b1)",color:"var(--t3)",transition:"all .18s"}}>
              🔑
            </button>
          </div>
          {curChat&&<div style={{fontSize:10,color:"var(--t3)",flexShrink:0}}>{msgs.length} msgs</div>}
        </div>

        {/* Backend AI Info Panel */}
        {showKeys&&(
          <div className="ain" style={{padding:"14px 16px",background:"var(--bg2)",borderBottom:"1px solid var(--b1)",flexShrink:0}}>
            <div style={{fontSize:12,fontWeight:700,color:"var(--t2)",marginBottom:10}}>🤖 AI Backend Info</div>
            <div style={{marginBottom:10,padding:"8px 11px",background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.2)",borderRadius:9}}>
              <div style={{fontSize:10,color:"var(--grn)",fontWeight:700,marginBottom:2}}>✅ Secure Backend</div>
              <div style={{fontSize:10,color:"rgba(16,185,129,.8)",lineHeight:1.5}}>Your Groq API key is stored in <code>.env</code> on the server only. It is never sent to the browser.</div>
            </div>
            <div style={{fontSize:10,color:"var(--t3)",lineHeight:1.6}}>
              <div>Model: <span style={{color:"var(--grn)"}}>llama3-70b-8192 (Groq)</span></div>
              <div style={{marginTop:4}}>To change the model, edit <code>GROQ_MODEL</code> in your <code>.env</code> file.</div>
              <div style={{marginTop:4}}>Get your free key at <span style={{color:"var(--blu2)"}}>console.groq.com</span></div>
            </div>
          </div>
        )}

        {/* Trip save banner */}
        {banner&&<div className="ain" style={{padding:"11px 18px",background:"rgba(34,211,238,.05)",borderBottom:"1px solid rgba(34,211,238,.14)",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <span style={{fontSize:16}}>🗓️</span>
          <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:"var(--teal)"}}>Trip detected: {banner.destination}</div><div style={{fontSize:11,color:"var(--t3)"}}>Save to your plans?</div></div>
          <button onClick={()=>saveTrip(banner)} className="btn btn-p" style={{fontSize:12,padding:"6px 14px"}}>Save Trip</button>
          <button onClick={()=>setBanner(null)} style={{background:"none",border:"none",color:"var(--t3)",fontSize:20,cursor:"pointer",lineHeight:1}}>×</button>
        </div>}

        {/* Messages */}
        <div style={{flex:1,overflowY:"auto",padding:"18px 18px 8px"}}>
          {msgs.length===0?(
            <div style={{textAlign:"center",padding:"36px 20px"}}>
              <div style={{fontSize:50,marginBottom:12}}>🌍</div>
              <h3 style={{fontWeight:900,fontSize:20,marginBottom:6,letterSpacing:"-.02em",fontFamily:"var(--font-display)"}}>Where shall we go?</h3>
              <p style={{color:"var(--t3)",fontSize:14,marginBottom:22,maxWidth:400,margin:"0 auto 22px"}}>Powered by Groq AI (backend) · Ask about any real destination · 🔒 Inputs sanitized · 🤖 AI-generated, verify details</p>
              <div style={{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center"}}>
                {CHAT_PROMPTS.map(p=>(
                  <button key={p} onClick={()=>{setInput(p);taRef.current?.focus();}}
                    style={{padding:"9px 16px",borderRadius:22,background:"var(--bg3)",border:"1px solid var(--b1)",color:"var(--t2)",fontSize:12,cursor:"pointer",transition:"all .18s",fontFamily:"inherit"}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--blue)";e.currentTarget.style.color="var(--t1)";e.currentTarget.style.background="rgba(56,189,248,.1)";e.currentTarget.style.boxShadow="0 4px 16px rgba(56,189,248,.2)";e.currentTarget.style.transform="translateY(-2px)"}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--b1)";e.currentTarget.style.color="var(--t2)";e.currentTarget.style.background="var(--bg3)";e.currentTarget.style.boxShadow="none";e.currentTarget.style.transform=""}}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ):(
            msgs.map(m=>(
              <div key={m.id} className="aup" style={{display:"flex",gap:11,marginBottom:18,flexDirection:m.role==="user"?"row-reverse":"row"}}>
                {/* Avatar */}
                <div style={{width:34,height:34,borderRadius:10,flexShrink:0,
                  background:m.role==="user"?"var(--g2)":m.provider==="Groq"?"linear-gradient(135deg,#10a37f,#1a7f64)":"var(--g1)",
                  display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:m.role==="user"?13:17,color:"#fff",marginTop:2,boxShadow:"0 2px 10px rgba(0,0,0,.3)"}}>
                  {m.role==="user"?(user.name||"U")[0].toUpperCase():m.provider==="Groq"?"🤖":"✦"}
                </div>
                <div style={{maxWidth:"82%",minWidth:0}}>
                  {/* Provider badge on AI messages */}
                  {m.role==="assistant"&&(
                    <div style={{fontSize:10,fontWeight:700,marginBottom:4,
                      color:m.provider==="Groq"?"#10b981":m.provider==="local"?"var(--amb)":"#a78bfa",
                      display:"flex",alignItems:"center",gap:4}}>
                      <span style={{width:5,height:5,borderRadius:"50%",background:m.provider==="Groq"?"#10b981":m.provider==="local"?"var(--amb)":"#a78bfa",display:"inline-block"}}/>
                      {m.provider==="Groq"?"Groq AI":m.provider==="local"?"Smart Fallback":"Claude Sonnet"}
                      {m.streaming&&<span style={{marginLeft:4,opacity:.7}}>· typing…</span>}
                    </div>
                  )}
                  <div style={{background:m.role==="user"?"var(--g1)":"var(--card2)",border:m.role==="assistant"?"1px solid var(--b1)":"none",borderRadius:m.role==="user"?"18px 4px 18px 18px":"4px 18px 18px 18px",padding:"13px 17px",boxShadow:m.role==="user"?"0 4px 20px rgba(139,92,246,.35)":"0 2px 12px rgba(0,0,0,.15)"}}>
                    {m.role==="assistant"
                      ?(m.streaming?<div><Md text={m.content}/><span style={{display:"inline-block",width:7,height:13,background:m.provider==="Groq"?"#10b981":"#a78bfa",borderRadius:2,marginLeft:2,animation:"blink 0.75s infinite",verticalAlign:"middle"}}/></div>:<Md text={m.content}/>)
                      :<p style={{fontSize:14,lineHeight:1.7,color:"#fff",margin:0}}>{m.content}</p>}
                    <div style={{fontSize:10,color:m.role==="user"?"rgba(255,255,255,.4)":"var(--t3)",marginTop:6,textAlign:"right"}}>{fdate(m.ts)}</div>
                  </div>
                </div>
              </div>
            ))
          )}
          {sending && msgs.length > 0 && msgs[msgs.length-1]?.role === "user" &&(
            <div style={{display:"flex",gap:11,marginBottom:18}}>
              <div style={{width:34,height:34,borderRadius:10,background:provider==="Groq"?"linear-gradient(135deg,#10a37f,#1a7f64)":"var(--g1)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:17,flexShrink:0}}>
                {provider==="Groq"?"🤖":"✦"}
              </div>
              <div style={{padding:"13px 18px",background:"var(--card2)",border:"1px solid var(--b1)",borderRadius:"3px 16px 16px 16px"}}>
                <div style={{display:"flex",gap:5,alignItems:"center"}}>
                  {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:provider==="chatgpt"?"#10b981":"#a78bfa",animation:`blink 1.4s ${i*.22}s infinite`,boxShadow:`0 0 6px ${provider==="chatgpt"?"#10b981":"#a78bfa"}`}}/>)}
                  <span style={{fontSize:11,color:"var(--t3)",marginLeft:8}}>
                    {provider==="chatgpt"?"ChatGPT":"Claude"} is thinking…
                  </span>
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>

        {/* Input */}
        <div style={{padding:"12px 14px",borderTop:"1px solid var(--b1)",flexShrink:0}}>
          <div style={{display:"flex",gap:9,alignItems:"flex-end",background:"var(--card)",border:"1.5px solid var(--b1)",borderRadius:18,padding:"8px 8px 8px 18px",transition:"border-color .25s,box-shadow .25s",boxShadow:"0 2px 16px rgba(0,0,0,.15)"}}
            onFocusCapture={e=>{ e.currentTarget.style.borderColor="var(--blue)"; e.currentTarget.style.boxShadow="0 0 0 3px rgba(139,92,246,.15),0 4px 20px rgba(0,0,0,.2)"; }}
            onBlurCapture={e=>{ e.currentTarget.style.borderColor="var(--b1)"; e.currentTarget.style.boxShadow="0 2px 16px rgba(0,0,0,.15)"; }}>
            <textarea ref={taRef} value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
              placeholder="Ask anything about travel — '5 friends Goa 3 days', visa for Japan, hotels in Bali…"
              style={{flex:1,resize:"none",fontSize:14,lineHeight:1.55,maxHeight:130,minHeight:24,background:"transparent",border:"none",outline:"none",color:"var(--t1)",fontFamily:"inherit",padding:0}}
              rows={1}
              onInput={e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,130)+"px";}}
            />
            <button onClick={send} disabled={!input.trim()||sending}
              style={{width:40,height:40,borderRadius:13,background:input.trim()&&!sending?"var(--g1)":"var(--bg3)",border:input.trim()&&!sending?"none":"1px solid var(--b1)",cursor:input.trim()&&!sending?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .22s",boxShadow:input.trim()&&!sending?"0 4px 16px rgba(139,92,246,.5)":"none"}}>
              {sending?<Spin s={14}/>:<span style={{color:"#fff",fontSize:16,fontWeight:700}}>→</span>}
            </button>
          </div>
          <p style={{textAlign:"center",fontSize:10,color:"var(--t3)",marginTop:7}}>Enter to send · Shift+Enter for new line · 🔒 Inputs sanitized · Rate limited · Powered by Wandr AI</p>
        </div>
      </div>
    </div>
  );
}

function History({plans,setPlans}) {
  const [sel,setSel]=useState(null);
  const past=plans.filter(p=>p.status==="past");

  const restore=async id=>{
    try{const r=await api.putPlan(id,{status:"upcoming"});if(r.success){setPlans(p=>p.map(pl=>pl.id===id?r.plan:pl));toast.ok("Restored to Future Plans!");return;}}catch(e){}
    setPlans(p=>p.map(pl=>pl.id===id?{...pl,status:"upcoming"}:pl));toast.ok("Restored!");
  };
  const del=async id=>{
    try{await api.delPlan(id);}catch(e){}
    setPlans(p=>p.filter(pl=>pl.id!==id));setSel(null);toast.info("Trip removed");
  };

  if(sel){
    const p=past.find(pl=>pl.id===sel);
    if(!p){setSel(null);return null;}
    return(
      <div>
        <button onClick={()=>setSel(null)} className="btn btn-s" style={{marginBottom:18}}>← Back</button>
        <div className="ain card" style={{overflow:"hidden"}}>
          <div style={{height:220,background:"linear-gradient(135deg,rgba(139,92,246,.22),rgba(139,92,246,.18))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:80}}>🌍</div>
          <div style={{padding:28}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:12}}>
              <div>
                <h2 style={{fontSize:24,fontWeight:900,letterSpacing:"-.02em"}}>{p.destination}</h2>
                <p style={{color:"var(--t3)",fontSize:13,marginTop:4}}>{fdate(p.startDate)} → {fdate(p.endDate)}</p>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>restore(p.id)} className="btn btn-s">🔄 Restore</button>
                <button onClick={()=>del(p.id)} style={{padding:"10px 16px",borderRadius:10,background:"rgba(248,113,113,.1)",border:"1px solid rgba(248,113,113,.18)",color:"var(--red)",fontWeight:700,fontSize:12,cursor:"pointer"}}>🗑 Delete</button>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12,marginBottom:18}}>
              {[["Budget",fmoney(p.budget),"var(--teal)"],["Status","Completed ✓","var(--grn)"],["Activities",p.activities||"—","var(--purp)"]].map(([l,v,c])=>(
                <div key={l} style={{padding:14,background:"var(--bg3)",borderRadius:12,border:"1px solid var(--b1)"}}>
                  <div style={{fontSize:11,color:"var(--t3)",marginBottom:4,textTransform:"uppercase",letterSpacing:".04em"}}>{l}</div>
                  <div style={{fontSize:14,fontWeight:700,color:c,wordBreak:"break-word"}}>{v}</div>
                </div>
              ))}
            </div>
            {p.notes&&<div style={{padding:14,background:"var(--bg3)",borderRadius:12,border:"1px solid var(--b1)"}}>
              <div style={{fontSize:11,color:"var(--t3)",marginBottom:6,textTransform:"uppercase",letterSpacing:".04em"}}>Notes</div>
              <p style={{fontSize:14,lineHeight:1.75,color:"var(--t2)"}}>{p.notes}</p>
            </div>}
          </div>
        </div>
      </div>
    );
  }

  return(
    <div>
      <div className="aup" style={{marginBottom:22}}>
        <h1 style={{fontSize:24,fontWeight:900,letterSpacing:"-.02em",marginBottom:4,fontFamily:"var(--font-display)"}}>Travel History</h1>
        <p style={{color:"var(--t3)",fontSize:14}}>{past.length} trip{past.length!==1?"s":""} completed</p>
      </div>
      {past.length===0?(
        <div className="card" style={{textAlign:"center",padding:"70px 20px"}}>
          <div style={{fontSize:50,marginBottom:14}}>📜</div>
          <h3 style={{fontWeight:700,marginBottom:8}}>No completed trips yet</h3>
          <p style={{color:"var(--t3)",fontSize:14}}>Mark a Future Plan as done to see it here</p>
        </div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:15}}>
          {past.map((p,i)=>(
            <div key={p.id} className="aup card card-hover" onClick={()=>setSel(p.id)} style={{animationDelay:`${i*55}ms`,padding:20,cursor:"pointer",transition:"all .2s"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div style={{fontSize:26}}>🌍</div>
                <span style={{padding:"4px 12px",borderRadius:20,fontSize:10,fontWeight:700,background:"rgba(5,150,105,.15)",color:"var(--grn)",letterSpacing:".04em"}}>DONE ✓</span>
              </div>
              <h3 style={{fontWeight:700,fontSize:14,marginBottom:5}}>{p.destination}</h3>
              <p style={{fontSize:12,color:"var(--t3)",marginBottom:10}}>{fdate(p.startDate)} → {fdate(p.endDate)}</p>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{color:"var(--teal)",fontWeight:800,fontSize:14}}>{fmoney(p.budget)}</span>
                <span style={{fontSize:12,color:"var(--blu2)"}}>Details →</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// FUTURE PLANS
// ══════════════════════════════════════════════════════════════════
function Future({plans,setPlans}) {
  const [modal,setModal]=useState(false);
  const [editId,setEditId]=useState(null);
  const [saving,setSaving]=useState(false);
  const [f,setF]=useState({dest:"",sd:"",ed:"",budget:"",acts:"",notes:""});
  const upcoming=plans.filter(p=>p.status==="upcoming");

  const open=(plan=null)=>{
    setEditId(plan?.id||null);
    setF(plan?{dest:plan.destination||"",sd:(plan.startDate||"").slice(0,10),ed:(plan.endDate||"").slice(0,10),budget:plan.budget||"",acts:plan.activities||"",notes:plan.notes||""}:{dest:"",sd:"",ed:"",budget:"",acts:"",notes:""});
    setModal(true);
  };
  const sf=k=>e=>setF(p=>({...p,[k]:e.target.value}));

  const save=async()=>{
    if(!f.dest.trim()||!f.sd||!f.budget){toast.err("Destination, start date and budget are required");return;}
    setSaving(true);
    const data={destination:f.dest,startDate:f.sd,endDate:f.ed,budget:Number(f.budget)||0,activities:f.acts,notes:f.notes};
    try{
      if(editId){
        const r=await api.putPlan(editId,data);
        setPlans(p=>p.map(pl=>pl.id===editId?(r.success?r.plan:{...pl,...data}):pl));
        toast.ok("Updated ✓");
      } else {
        const r=await api.addPlan(data);
        setPlans(p=>[r.success?r.plan:{id:uid(),...data,status:"upcoming",createdAt:now(),updatedAt:now()},...p]);
        toast.ok("Trip added! 🗓️");
      }
      setModal(false);
    }catch(e){
      if(editId)setPlans(p=>p.map(pl=>pl.id===editId?{...pl,...data}:pl));
      else setPlans(p=>[{id:uid(),...data,status:"upcoming",createdAt:now(),updatedAt:now()},...p]);
      setModal(false);toast.info("Saved offline");
    }
    setSaving(false);
  };

  const del=async id=>{try{await api.delPlan(id);}catch(e){}setPlans(p=>p.filter(pl=>pl.id!==id));toast.info("Removed");};
  const done=async id=>{
    try{const r=await api.putPlan(id,{status:"past"});if(r.success){setPlans(p=>p.map(pl=>pl.id===id?r.plan:pl));toast.ok("Completed! ✅");return;}}catch(e){}
    setPlans(p=>p.map(pl=>pl.id===id?{...pl,status:"past"}:pl));toast.ok("Done ✅");
  };

  const fi=k=>({value:f[k],onChange:sf(k),className:"inp"});

  return(
    <div style={{position:"relative"}}>
      <div className="aup" style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:900,letterSpacing:"-.02em",marginBottom:4,fontFamily:"var(--font-display)"}}>Future Plans</h1>
          <p style={{color:"var(--t3)",fontSize:14}}>{upcoming.length} upcoming</p>
        </div>
        <button onClick={()=>open()} className="btn btn-p">+ Add Trip</button>
      </div>

      {/* Modal */}
      {modal&&<div style={{position:"absolute",inset:0,minHeight:560,background:"rgba(5,8,15,.9)",backdropFilter:"blur(10px)",zIndex:50,display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:20,borderRadius:16}}>
        <div className="aup card" style={{width:"100%",maxWidth:490,padding:28}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
            <h3 style={{fontWeight:800,fontSize:17,letterSpacing:"-.01em"}}>{editId?"Edit Trip":"New Trip"}</h3>
            <button onClick={()=>setModal(false)} style={{background:"var(--bg3)",border:"1px solid var(--b1)",color:"var(--t3)",width:30,height:30,borderRadius:8,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:13}}>
            <div><label style={{fontSize:11,color:"var(--t3)",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",display:"block",marginBottom:5}}>Destination *</label><input {...fi("dest")} placeholder="e.g. Kyoto, Japan"/></div>
            <div><label style={{fontSize:11,color:"var(--t3)",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",display:"block",marginBottom:5}}>Budget (₹ INR) *</label><input {...fi("budget")} type="number" placeholder="25000"/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div><label style={{fontSize:11,color:"var(--t3)",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",display:"block",marginBottom:5}}>Start Date *</label><input {...fi("sd")} type="date"/></div>
              <div><label style={{fontSize:11,color:"var(--t3)",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",display:"block",marginBottom:5}}>End Date</label><input {...fi("ed")} type="date"/></div>
            </div>
            <div><label style={{fontSize:11,color:"var(--t3)",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",display:"block",marginBottom:5}}>Activities</label><input {...fi("acts")} placeholder="Hiking, temples, food tours…"/></div>
            <div><label style={{fontSize:11,color:"var(--t3)",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",display:"block",marginBottom:5}}>Notes</label><textarea value={f.notes} onChange={sf("notes")} rows={3} className="inp" placeholder="Visa reminder, packing notes…" style={{resize:"vertical"}}/></div>
          </div>
          <div style={{display:"flex",gap:10,marginTop:20}}>
            <button onClick={()=>setModal(false)} className="btn btn-s" style={{flex:1}}>Cancel</button>
            <button onClick={save} disabled={saving} className="btn btn-p" style={{flex:2,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              {saving?<><Spin/>Saving…</>:(editId?"Save Changes":"Add Trip")}
            </button>
          </div>
        </div>
      </div>}

      {upcoming.length===0?(
        <div className="card" style={{textAlign:"center",padding:"70px 20px"}}>
          <div style={{fontSize:50,marginBottom:14}}>🗓️</div>
          <h3 style={{fontWeight:700,marginBottom:8}}>No upcoming trips</h3>
          <p style={{color:"var(--t3)",fontSize:14,marginBottom:18}}>Plan your next adventure or ask AI to create one</p>
          <button onClick={()=>open()} className="btn btn-p">+ Add Trip</button>
        </div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(275px,1fr))",gap:15}}>
          {upcoming.map((p,i)=>(
            <div key={p.id} className="aup card" style={{animationDelay:`${i*55}ms`,padding:20}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div style={{fontSize:24}}>🗓️</div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  <button onClick={()=>open(p)} className="btn btn-s" style={{padding:"5px 10px",fontSize:11}}>Edit</button>
                  <button onClick={()=>done(p.id)} style={{padding:"5px 10px",borderRadius:8,background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.18)",color:"var(--grn)",fontSize:11,fontWeight:700,cursor:"pointer"}}>Done ✓</button>
                  <button onClick={()=>del(p.id)} style={{padding:"5px 10px",borderRadius:8,background:"rgba(248,113,113,.1)",border:"1px solid rgba(248,113,113,.15)",color:"var(--red)",fontSize:11,fontWeight:700,cursor:"pointer"}}>✕</button>
                </div>
              </div>
              <h3 style={{fontWeight:700,fontSize:14,marginBottom:5}}>{p.destination}</h3>
              <p style={{fontSize:12,color:"var(--t3)",marginBottom:10}}>{fdate(p.startDate)} → {fdate(p.endDate)}</p>
              {p.activities&&<p style={{fontSize:12,color:"var(--t2)",marginBottom:12}}>🎯 {p.activities.slice(0,60)}{p.activities.length>60?"…":""}</p>}
              <div style={{padding:"8px 13px",borderRadius:10,background:"rgba(56,189,248,.08)",border:"1px solid rgba(56,189,248,.16)",display:"inline-block"}}>
                <span style={{fontSize:14,fontWeight:800,color:"var(--blu2)"}}>{fmoney(p.budget)}</span>
              </div>
              {p.notes&&<p style={{fontSize:11,color:"var(--t3)",marginTop:10,fontStyle:"italic"}}>📝 {p.notes.slice(0,60)}{p.notes.length>60?"…":""}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// BUDGET PAGE
// ══════════════════════════════════════════════════════════════════
function Budget({plans}) {
  const total=plans.reduce((s,p)=>s+Number(p.budget||0),0);
  const spent=plans.filter(p=>p.status==="past").reduce((s,p)=>s+Number(p.budget||0),0);
  const planned=plans.filter(p=>p.status==="upcoming").reduce((s,p)=>s+Number(p.budget||0),0);
  const avg=plans.length?Math.round(total/plans.length):0;
  const byDest=plans.reduce((a,p)=>{const k=(p.destination||"Other").split(",")[0];a[k]=(a[k]||0)+Number(p.budget||0);return a;},{});
  const barData=Object.entries(byDest).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([l,v])=>({l:l.slice(0,9),v}));
  const donut=[{l:"Completed",v:spent,c:"#10b981"},{l:"Upcoming",v:planned,c:"#38bdf8"}];

  return(
    <div>
      <div className="aup" style={{marginBottom:22}}>
        <h1 style={{fontSize:24,fontWeight:900,letterSpacing:"-.02em",marginBottom:4,fontFamily:"var(--font-display)"}}>Budget Tracker</h1>
        <p style={{color:"var(--t3)",fontSize:14}}>Monitor your travel spending</p>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:13,marginBottom:20}}>
        {[["Total",fmoney(total),"var(--blue)"],["Spent",fmoney(spent),"var(--grn)"],["Planned",fmoney(planned),"var(--purp)"],["Avg/Trip",fmoney(avg),"var(--teal)"]].map(([l,v,c])=>(
          <div key={l} className="aup card" style={{padding:18}}>
            <div style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".05em",marginBottom:6}}>{l}</div>
            <div style={{fontSize:22,fontWeight:900,color:c,letterSpacing:"-.02em"}}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(265px,1fr))",gap:16}}>
        <div className="aup card" style={{padding:22,animationDelay:"80ms"}}>
          <h3 style={{fontSize:14,fontWeight:700,marginBottom:16}}>Spending Split</h3>
          <div style={{display:"flex",alignItems:"center",gap:22}}>
            <Donut segs={donut} size={120}/>
            <div>
              {donut.map(s=>(
                <div key={s.l} style={{display:"flex",alignItems:"center",gap:9,marginBottom:11}}>
                  <div style={{width:10,height:10,borderRadius:3,background:s.c,flexShrink:0}}/>
                  <div><div style={{fontSize:13,fontWeight:600}}>{s.l}</div><div style={{fontSize:12,color:"var(--t3)"}}>{fmoney(s.v)}</div></div>
                </div>
              ))}
              <div style={{fontSize:11,color:"var(--t3)",marginTop:4}}>{plans.length} trips</div>
            </div>
          </div>
        </div>

        <div className="aup card" style={{padding:22,animationDelay:"150ms"}}>
          <h3 style={{fontSize:14,fontWeight:700,marginBottom:4}}>By Destination</h3>
          <p style={{fontSize:11,color:"var(--t3)",marginBottom:14}}>Top spend</p>
          <Bar data={barData} color="var(--purp)" h={100}/>
        </div>

        <div className="aup card" style={{padding:22,gridColumn:"1 / -1",animationDelay:"220ms"}}>
          <h3 style={{fontSize:14,fontWeight:700,marginBottom:16}}>Trip Breakdown</h3>
          {plans.length===0?<p style={{color:"var(--t3)",fontSize:13,textAlign:"center",padding:"22px 0"}}>No trips yet</p>:(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {[...plans].sort((a,b)=>Number(b.budget||0)-Number(a.budget||0)).map(p=>{
                const pct=total>0?Math.min(Number(p.budget||0)/total*100,100):0;
                return(
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 15px",background:"var(--bg3)",borderRadius:12,border:"1px solid var(--b1)",flexWrap:"wrap"}}>
                    <span style={{fontSize:17}}>{p.status==="upcoming"?"🗓️":"✅"}</span>
                    <div style={{flex:1,minWidth:90}}>
                      <div style={{fontSize:13,fontWeight:600}}>{p.destination}</div>
                      <div style={{fontSize:11,color:"var(--t3)"}}>{fdate(p.startDate)}</div>
                    </div>
                    <span style={{fontSize:10,padding:"3px 9px",borderRadius:20,background:p.status==="upcoming"?"rgba(56,189,248,.1)":"rgba(16,185,129,.1)",color:p.status==="upcoming"?"var(--blu2)":"var(--grn)",fontWeight:700}}>{p.status.toUpperCase()}</span>
                    <span style={{fontSize:14,fontWeight:800,color:"var(--teal)",minWidth:72,textAlign:"right"}}>{fmoney(p.budget)}</span>
                    <div style={{width:100,height:5,background:"var(--b1)",borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${pct}%`,background:"var(--g1)",borderRadius:3,transition:"width .6s"}}/>
                    </div>
                    <span style={{fontSize:11,color:"var(--t3)",minWidth:30,textAlign:"right"}}>{Math.round(pct)}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// EXPLORE PAGE — Real-time AI + Wikipedia data + AI provider selector
// ══════════════════════════════════════════════════════════════════

function Explore({go}) {
  const [query,      setQuery]    = useState("");
  const [cards,      setCards]    = useState([]);
  const [loading,    setLoading]  = useState(false);
  const [searched,   setSearched] = useState("");
  const [showKeys,   setShowKeys] = useState(false);
  const [destInfo,   setDestInfo] = useState(null);
  const inputRef = useRef(null);

  // ── Curated Unsplash images keyed by destination/place (unique per place) ──
  const PLACE_IMAGES = {
    // ── Ladakh ──
    "pangong lake":         "https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?w=900&q=85",
    "nubra valley":         "https://images.unsplash.com/photo-1601439678777-b2b3c56fa627?w=900&q=85",
    "leh palace":           "https://images.unsplash.com/photo-1568454537842-d933259bb258?w=900&q=85",
    "hemis monastery":      "https://images.unsplash.com/photo-1612214069370-4e52f9de12e5?w=900&q=85",
    "khardung la":          "https://images.unsplash.com/photo-1504270997636-07ddfbd48945?w=900&q=85",
    "tso moriri":           "https://images.unsplash.com/photo-1589308454676-22a53dbca5f8?w=900&q=85",
    "magnetic hill":        "https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=900&q=85",
    "zanskar":              "https://images.unsplash.com/photo-1558618047-f4e20f9f2a2b?w=900&q=85",
    "shanti stupa":         "https://images.unsplash.com/photo-1548013146-72479768bada?w=900&q=85",
    // ── Goa ──
    "baga beach":           "https://images.unsplash.com/photo-1586699253884-e199770f63b9?w=900&q=85",
    "anjuna":               "https://images.unsplash.com/photo-1571401835393-8c5f35328320?w=900&q=85",
    "palolem beach":        "https://images.unsplash.com/photo-1527631746610-bca00a040d60?w=900&q=85",
    "dudhsagar falls":      "https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=900&q=85",
    "calangute":            "https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=900&q=85",
    "vagator":              "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=900&q=85",
    "panaji":               "https://images.unsplash.com/photo-1590050752117-238cb0fb12b1?w=900&q=85",
    "old goa":              "https://images.unsplash.com/photo-1548013146-72479768bada?w=900&q=85",
    "old goa churches":     "https://images.unsplash.com/photo-1548013146-72479768bada?w=900&q=85",
    "colva beach":          "https://images.unsplash.com/photo-1571401835393-8c5f35328320?w=900&q=85",
    // ── Rajasthan ──
    "jaipur":               "https://images.unsplash.com/photo-1477587458883-47145ed94245?w=900&q=85",
    "hawa mahal":           "https://images.unsplash.com/photo-1477587458883-47145ed94245?w=900&q=85",
    "udaipur":              "https://images.unsplash.com/photo-1600100397608-c9de3ab8c622?w=900&q=85",
    "city palace":          "https://images.unsplash.com/photo-1600100397608-c9de3ab8c622?w=900&q=85",
    "jodhpur":              "https://images.unsplash.com/photo-1578307985848-c79f8bb00b66?w=900&q=85",
    "mehrangarh fort":      "https://images.unsplash.com/photo-1578307985848-c79f8bb00b66?w=900&q=85",
    "jaisalmer":            "https://images.unsplash.com/photo-1551009175-8a68da93d5f9?w=900&q=85",
    "jaisalmer fort":       "https://images.unsplash.com/photo-1551009175-8a68da93d5f9?w=900&q=85",
    "pushkar":              "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=900&q=85",
    "ranthambore":          "https://images.unsplash.com/photo-1564760290292-23341e4df6ec?w=900&q=85",
    "bikaner":              "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=900&q=85",
    "chittorgarh":          "https://images.unsplash.com/photo-1548013146-72479768bada?w=900&q=85",
    "amber fort":           "https://images.unsplash.com/photo-1477587458883-47145ed94245?w=900&q=85",
    "lake pichola":         "https://images.unsplash.com/photo-1600100397608-c9de3ab8c622?w=900&q=85",
    // ── Kerala ──
    "munnar":               "https://images.unsplash.com/photo-1602301100977-c4e4e1e07af4?w=900&q=85",
    "alleppey":             "https://images.unsplash.com/photo-1570458436416-b8fcccfe883f?w=900&q=85",
    "alappuzha":            "https://images.unsplash.com/photo-1570458436416-b8fcccfe883f?w=900&q=85",
    "thekkady":             "https://images.unsplash.com/photo-1518005020951-eccb494ad742?w=900&q=85",
    "kovalam":              "https://images.unsplash.com/photo-1527631746610-bca00a040d60?w=900&q=85",
    "wayanad":              "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=85",
    "fort kochi":           "https://images.unsplash.com/photo-1566294231428-7a5f4bd51c20?w=900&q=85",
    "varkala":              "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=900&q=85",
    "kumarakom":            "https://images.unsplash.com/photo-1570458436416-b8fcccfe883f?w=900&q=85",
    "periyar":              "https://images.unsplash.com/photo-1518005020951-eccb494ad742?w=900&q=85",
    "athirappilly":         "https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=900&q=85",
    // ── Manali / Himachal ──
    "rohtang pass":         "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=85",
    "solang valley":        "https://images.unsplash.com/photo-1573415564374-11c97c0e2068?w=900&q=85",
    "hadimba temple":       "https://images.unsplash.com/photo-1564760290292-23341e4df6ec?w=900&q=85",
    "old manali":           "https://images.unsplash.com/photo-1473223272430-e63b9f0e27ec?w=900&q=85",
    "sissu":                "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=85",
    "naggar castle":        "https://images.unsplash.com/photo-1548013146-72479768bada?w=900&q=85",
    "jogini falls":         "https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=900&q=85",
    "beas kund":            "https://images.unsplash.com/photo-1458442310124-dde6edb43d10?w=900&q=85",
    "kasol":                "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=85",
    "spiti valley":         "https://images.unsplash.com/photo-1558618047-f4e20f9f2a2b?w=900&q=85",
    "shimla":               "https://images.unsplash.com/photo-1571994460744-8a4d5c2f9c8f?w=900&q=85",
    "dharamshala":          "https://images.unsplash.com/photo-1558618047-f4e20f9f2a2b?w=900&q=85",
    // ── Kashmir ──
    "dal lake":             "https://images.unsplash.com/photo-1567157577867-05ccb1388e66?w=900&q=85",
    "gulmarg":              "https://images.unsplash.com/photo-1458442310124-dde6edb43d10?w=900&q=85",
    "pahalgam":             "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=85",
    "sonamarg":             "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=85",
    "betaab valley":        "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=85",
    "shalimar bagh":        "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=900&q=85",
    "nishat bagh":          "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=900&q=85",
    "doodhpathri":          "https://images.unsplash.com/photo-1458442310124-dde6edb43d10?w=900&q=85",
    // ── Andaman ──
    "radhanagar beach":     "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=900&q=85",
    "havelock island":      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=900&q=85",
    "neil island":          "https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=900&q=85",
    "cellular jail":        "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=900&q=85",
    "ross island":          "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=900&q=85",
    "north bay island":     "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=900&q=85",
    "baratang island":      "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=85",
    // ── Hampi ──
    "hampi":                "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=900&q=85",
    "virupaksha temple":    "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=900&q=85",
    "vittala temple":       "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=900&q=85",
    "lotus mahal":          "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=900&q=85",
    "elephant stables":     "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=900&q=85",
    // ── Varanasi ──
    "varanasi":             "https://images.unsplash.com/photo-1561361058-c24e02d84ed4?w=900&q=85",
    "dashashwamedh ghat":   "https://images.unsplash.com/photo-1561361058-c24e02d84ed4?w=900&q=85",
    "kashi vishwanath":     "https://images.unsplash.com/photo-1548013146-72479768bada?w=900&q=85",
    "sarnath":              "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=900&q=85",
    "manikarnika ghat":     "https://images.unsplash.com/photo-1561361058-c24e02d84ed4?w=900&q=85",
    // ── Bali ──
    "ubud":                 "https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=900&q=85",
    "seminyak beach":       "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=900&q=85",
    "nusa penida":          "https://images.unsplash.com/photo-1570533396055-a5e31d9f3d51?w=900&q=85",
    "uluwatu temple":       "https://images.unsplash.com/photo-1555400038-63f5ba517a47?w=900&q=85",
    "tegalalang":           "https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=900&q=85",
    "tegalalang rice terraces": "https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=900&q=85",
    "tanah lot":            "https://images.unsplash.com/photo-1555400038-63f5ba517a47?w=900&q=85",
    "kuta beach":           "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=900&q=85",
    "canggu":               "https://images.unsplash.com/photo-1584464491033-06628f3a6b7b?w=900&q=85",
    "mount batur":          "https://images.unsplash.com/photo-1558618047-f4e20f9f2a2b?w=900&q=85",
    "besakih temple":       "https://images.unsplash.com/photo-1548013146-72479768bada?w=900&q=85",
    "seminyak":             "https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=900&q=85",
    // ── Bangkok / Thailand ──
    "bangkok":              "https://images.unsplash.com/photo-1508009603885-50cf7c8dd0d5?w=900&q=85",
    "grand palace":         "https://images.unsplash.com/photo-1508009603885-50cf7c8dd0d5?w=900&q=85",
    "wat pho":              "https://images.unsplash.com/photo-1528181304800-259b08848526?w=900&q=85",
    "wat arun":             "https://images.unsplash.com/photo-1528181304800-259b08848526?w=900&q=85",
    "chatuchak market":     "https://images.unsplash.com/photo-1508009603885-50cf7c8dd0d5?w=900&q=85",
    "khao san road":        "https://images.unsplash.com/photo-1508009603885-50cf7c8dd0d5?w=900&q=85",
    "phi phi islands":      "https://images.unsplash.com/photo-1552465011-b4e21bf6e79a?w=900&q=85",
    "chiang mai":           "https://images.unsplash.com/photo-1528181304800-259b08848526?w=900&q=85",
    "phuket":               "https://images.unsplash.com/photo-1552465011-b4e21bf6e79a?w=900&q=85",
    "patong beach":         "https://images.unsplash.com/photo-1552465011-b4e21bf6e79a?w=900&q=85",
    "koh samui":            "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=900&q=85",
    // ── Tokyo ──
    "shibuya crossing":     "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=900&q=85",
    "senso-ji temple":      "https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=900&q=85",
    "shinjuku":             "https://images.unsplash.com/photo-1513407030348-c983a97b98d8?w=900&q=85",
    "akihabara":            "https://images.unsplash.com/photo-1601042879364-f3947d3f9c16?w=900&q=85",
    "harajuku":             "https://images.unsplash.com/photo-1570734520929-ed8a77c2d825?w=900&q=85",
    "ueno park":            "https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=900&q=85",
    "teamlab planets":      "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=900&q=85",
    "odaiba":               "https://images.unsplash.com/photo-1513407030348-c983a97b98d8?w=900&q=85",
    "asakusa":              "https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=900&q=85",
    "mount fuji":           "https://images.unsplash.com/photo-1548615661-bd6e6b1e2282?w=900&q=85",
    "tokyo tower":          "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=900&q=85",
    "shibuya":              "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=900&q=85",
    // ── Paris ──
    "eiffel tower":         "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=900&q=85",
    "louvre museum":        "https://images.unsplash.com/photo-1541324264782-4ab32b5a6fde?w=900&q=85",
    "montmartre":           "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=900&q=85",
    "champs-élysées":       "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=900&q=85",
    "notre-dame":           "https://images.unsplash.com/photo-1478391679764-b2d8b3cd1e94?w=900&q=85",
    "versailles":           "https://images.unsplash.com/photo-1559570278-7c9cfb9401e4?w=900&q=85",
    "musée d'orsay":        "https://images.unsplash.com/photo-1541324264782-4ab32b5a6fde?w=900&q=85",
    "musee d'orsay":        "https://images.unsplash.com/photo-1541324264782-4ab32b5a6fde?w=900&q=85",
    "sainte-chapelle":      "https://images.unsplash.com/photo-1478391679764-b2d8b3cd1e94?w=900&q=85",
    "arc de triomphe":      "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=900&q=85",
    "seine river":          "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=900&q=85",
    // ── Dubai ──
    "burj khalifa":         "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=900&q=85",
    "dubai mall":           "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=900&q=85",
    "palm jumeirah":        "https://images.unsplash.com/photo-1580674684081-7617fbf3d745?w=900&q=85",
    "desert safari":        "https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=900&q=85",
    "gold souk":            "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=900&q=85",
    "dubai frame":          "https://images.unsplash.com/photo-1580674684081-7617fbf3d745?w=900&q=85",
    "bluewaters island":    "https://images.unsplash.com/photo-1580674684081-7617fbf3d745?w=900&q=85",
    "miracle garden":       "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=85",
    "burj al arab":         "https://images.unsplash.com/photo-1580674684081-7617fbf3d745?w=900&q=85",
    "jumeirah beach":       "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=900&q=85",
    "dubai creek":          "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=900&q=85",
    // ── Singapore ──
    "gardens by the bay":   "https://images.unsplash.com/photo-1525625293386-3f8f99389edd?w=900&q=85",
    "marina bay sands":     "https://images.unsplash.com/photo-1565967511849-76a60a516170?w=900&q=85",
    "sentosa island":       "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=900&q=85",
    "orchard road":         "https://images.unsplash.com/photo-1525625293386-3f8f99389edd?w=900&q=85",
    "chinatown":            "https://images.unsplash.com/photo-1565967511849-76a60a516170?w=900&q=85",
    "clarke quay":          "https://images.unsplash.com/photo-1565967511849-76a60a516170?w=900&q=85",
    "universal studios":    "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=900&q=85",
    "hawker centres":       "https://images.unsplash.com/photo-1565967511849-76a60a516170?w=900&q=85",
    "little india":         "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=900&q=85",
    "singapore zoo":        "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=85",
    // ── London ──
    "tower of london":      "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=900&q=85",
    "buckingham palace":    "https://images.unsplash.com/photo-1541324264782-4ab32b5a6fde?w=900&q=85",
    "british museum":       "https://images.unsplash.com/photo-1478391679764-b2d8b3cd1e94?w=900&q=85",
    "hyde park":            "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=85",
    "covent garden":        "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=900&q=85",
    "greenwich":            "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=900&q=85",
    "camden market":        "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=900&q=85",
    "tate modern":          "https://images.unsplash.com/photo-1541324264782-4ab32b5a6fde?w=900&q=85",
    "tower bridge":         "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=900&q=85",
    "big ben":              "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=900&q=85",
    "london eye":           "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=900&q=85",
    // ── New York ──
    "times square":         "https://images.unsplash.com/photo-1534430480872-3498386e7856?w=900&q=85",
    "central park":         "https://images.unsplash.com/photo-1534430480872-3498386e7856?w=900&q=85",
    "statue of liberty":    "https://images.unsplash.com/photo-1534430480872-3498386e7856?w=900&q=85",
    "brooklyn bridge":      "https://images.unsplash.com/photo-1534430480872-3498386e7856?w=900&q=85",
    "metropolitan museum":  "https://images.unsplash.com/photo-1541324264782-4ab32b5a6fde?w=900&q=85",
    "empire state building":"https://images.unsplash.com/photo-1534430480872-3498386e7856?w=900&q=85",
    "high line":            "https://images.unsplash.com/photo-1534430480872-3498386e7856?w=900&q=85",
    "one world trade":      "https://images.unsplash.com/photo-1534430480872-3498386e7856?w=900&q=85",
    // ── Switzerland ──
    "swiss alps":           "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=900&q=85",
    "interlaken":           "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=900&q=85",
    "lucerne":              "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=900&q=85",
    "zurich":               "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=900&q=85",
    "jungfrau":             "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=900&q=85",
    "grindelwald":          "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=900&q=85",
    "zermatt":              "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=900&q=85",
    "geneva":               "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=900&q=85",
    // ── Santorini / Greece ──
    "santorini":            "https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?w=900&q=85",
    "oia":                  "https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?w=900&q=85",
    "fira":                 "https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?w=900&q=85",
    "athens":               "https://images.unsplash.com/photo-1603565816030-6b389eeb23cb?w=900&q=85",
    "acropolis":            "https://images.unsplash.com/photo-1603565816030-6b389eeb23cb?w=900&q=85",
    "mykonos":              "https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?w=900&q=85",
    // ── Istanbul / Turkey ──
    "istanbul":             "https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=900&q=85",
    "hagia sophia":         "https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=900&q=85",
    "blue mosque":          "https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=900&q=85",
    "grand bazaar":         "https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=900&q=85",
    "cappadocia":           "https://images.unsplash.com/photo-1534443862631-f4dc9e3e1adb?w=900&q=85",
    "pamukkale":            "https://images.unsplash.com/photo-1586348943529-beaae6c28db9?w=900&q=85",
    // ── Barcelona / Spain ──
    "barcelona":            "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=900&q=85",
    "sagrada familia":      "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=900&q=85",
    "park güell":           "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=900&q=85",
    "la boqueria":          "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=900&q=85",
    "madrid":               "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=900&q=85",
    "prado museum":         "https://images.unsplash.com/photo-1541324264782-4ab32b5a6fde?w=900&q=85",
    // ── Maldives ──
    "maldives":             "https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=900&q=85",
    "malé":                 "https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=900&q=85",
    "male":                 "https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=900&q=85",
    "baa atoll":            "https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=900&q=85",
    "ari atoll":            "https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=900&q=85",
    "vaadhoo island":       "https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=900&q=85",
    // ── Vietnam ──
    "vietnam":              "https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=900&q=85",
    "ha long bay":          "https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=900&q=85",
    "hoi an":               "https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=900&q=85",
    "hanoi":                "https://images.unsplash.com/photo-1508009603885-50cf7c8dd0d5?w=900&q=85",
    "ho chi minh city":     "https://images.unsplash.com/photo-1508009603885-50cf7c8dd0d5?w=900&q=85",
    "da nang":              "https://images.unsplash.com/photo-1552465011-b4e21bf6e79a?w=900&q=85",
    // ── Sri Lanka ──
    "sri lanka":            "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=900&q=85",
    "sigiriya":             "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=900&q=85",
    "kandy":                "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=900&q=85",
    "colombo":              "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=900&q=85",
    "ella":                 "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=900&q=85",
    // ── Nepal ──
    "nepal":                "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=900&q=85",
    "kathmandu":            "https://images.unsplash.com/photo-1548015146-b6f0c63f45c3?w=900&q=85",
    "pokhara":              "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=900&q=85",
    "everest base camp":    "https://images.unsplash.com/photo-1536427824649-fbafb9f74c67?w=900&q=85",
    "annapurna":            "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=900&q=85",
    "pashupatinath":        "https://images.unsplash.com/photo-1548015146-b6f0c63f45c3?w=900&q=85",
    "boudhanath":           "https://images.unsplash.com/photo-1548015146-b6f0c63f45c3?w=900&q=85",
    // ── Meghalaya ──
    "meghalaya":            "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=85",
    "cherrapunji":          "https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=900&q=85",
    "living root bridges":  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=85",
    "dawki":                "https://images.unsplash.com/photo-1567157577867-05ccb1388e66?w=900&q=85",
    "shillong":             "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=85",
    "mawsynram":            "https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=900&q=85",
    // ── Coorg ──
    "coorg":                "https://images.unsplash.com/photo-1602301100977-c4e4e1e07af4?w=900&q=85",
    "abbey falls":          "https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=900&q=85",
    "raja's seat":          "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=85",
    "dubare":               "https://images.unsplash.com/photo-1518005020951-eccb494ad742?w=900&q=85",
    // ── Auli ──
    "auli":                 "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=85",
    "nanda devi":           "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=85",
    "joshimath":            "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=85",
    // Generic fallbacks by type
    "beach":   "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=900&q=85",
    "temple":  "https://images.unsplash.com/photo-1564760290292-23341e4df6ec?w=900&q=85",
    "mountain":"https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=85",
    "city":    "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=900&q=85",
    "nature":  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=85",
    "heritage":"https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=900&q=85",
    "lake":    "https://images.unsplash.com/photo-1567157577867-05ccb1388e66?w=900&q=85",
    "desert":  "https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=900&q=85",
    "forest":  "https://images.unsplash.com/photo-1518005020951-eccb494ad742?w=900&q=85",
    "museum":  "https://images.unsplash.com/photo-1541324264782-4ab32b5a6fde?w=900&q=85",
    "market":  "https://images.unsplash.com/photo-1508009603885-50cf7c8dd0d5?w=900&q=85",
  };

  const FALLBACK_IMGS = [
    "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=85",
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=900&q=85",
    "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=900&q=85",
    "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=900&q=85",
    "https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=900&q=85",
    "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=85",
    "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=900&q=85",
    "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=900&q=85",
  ];

  const getPlaceImage = (name, type, idx) => {
    const key = name.toLowerCase();
    // Exact match
    if(PLACE_IMAGES[key]) return PLACE_IMAGES[key];
    // Partial match on place name
    for(const [k,v] of Object.entries(PLACE_IMAGES)){
      if(key.includes(k) || k.includes(key.split(' ')[0])) return v;
    }
    // Type match
    if(type){
      const tkey = type.toLowerCase();
      for(const [k,v] of Object.entries(PLACE_IMAGES)){
        if(tkey.includes(k)) return v;
      }
    }
    return FALLBACK_IMGS[idx % FALLBACK_IMGS.length];
  };

  // ── Trending sets ────────────────────────────────────────────────
  const TRENDING_SETS = [
    {label:"🔥 India Top Picks",  places:["Ladakh","Goa","Kerala","Rajasthan","Manali","Andaman","Hampi","Varanasi"]},
    {label:"🌏 Asia Favourites",  places:["Bali","Bangkok","Tokyo","Singapore","Maldives","Vietnam","Sri Lanka","Nepal"]},
    {label:"✈️ International",    places:["Paris","Dubai","London","Switzerland","New York","Santorini","Istanbul","Barcelona"]},
    {label:"🏔️ Adventure",       places:["Spiti Valley","Zanskar","Meghalaya","Coorg","Auli","Munnar","Leh","Kasol"]},
  ];

  const TAGS = [
    {label:"🔥 Trending",       color:"#F97316", bg:"rgba(249,115,22,.15)"},
    {label:"⭐ Top Rated",      color:"#FACC15", bg:"rgba(250,204,21,.15)"},
    {label:"💎 Hidden Gem",     color:"#06B6D4", bg:"rgba(6,182,212,.15)"},
    {label:"🎒 Budget Friendly",color:"#10b981", bg:"rgba(16,185,129,.15)"},
    {label:"👑 Luxury",         color:"#a78bfa", bg:"rgba(167,139,250,.15)"},
    {label:"📸 Must Visit",     color:"#38bdf8", bg:"rgba(56,189,248,.15)"},
    {label:"🌿 Nature",         color:"#4ade80", bg:"rgba(74,222,128,.15)"},
    {label:"🏛️ Heritage",      color:"#fb923c", bg:"rgba(251,146,60,.15)"},
  ];

  // ── Destination-aware INR price tiers ────────────────────────────
  const DEST_PRICE_TIER = (() => {
    const ultra   = ["maldives","dubai","switzerland","paris","london","new york","santorini","bali luxury"];
    const high    = ["singapore","tokyo","london","barcelona","istanbul","new york","bali","paris"];
    const mid     = ["goa","rajasthan","kerala","manali","ladakh","kashmir","andaman","bangkok","thailand","vietnam","nepal","sri lanka"];
    const budget  = ["varanasi","hampi","meghalaya","coorg","auli","kasol","spiti"];
    return (dest) => {
      const d = (dest||"").toLowerCase();
      if(ultra.some(k=>d.includes(k)))  return "ultra";
      if(high.some(k=>d.includes(k)))   return "high";
      if(budget.some(k=>d.includes(k))) return "budget";
      return "mid";
    };
  })();
  const PRICE_TIERS = {
    ultra:  [{hotel:"₹22,000/night",budget:"₹55,000/day"},{hotel:"₹35,000/night",budget:"₹80,000/day"},{hotel:"₹18,000/night",budget:"₹45,000/day"},{hotel:"₹50,000/night",budget:"₹1,20,000/day"},{hotel:"₹28,000/night",budget:"₹65,000/day"},{hotel:"₹15,000/night",budget:"₹40,000/day"},{hotel:"₹42,000/night",budget:"₹95,000/day"},{hotel:"₹25,000/night",budget:"₹60,000/day"}],
    high:   [{hotel:"₹8,500/night", budget:"₹22,000/day"},{hotel:"₹12,000/night",budget:"₹30,000/day"},{hotel:"₹6,800/night", budget:"₹18,000/day"},{hotel:"₹15,000/night",budget:"₹38,000/day"},{hotel:"₹9,500/night", budget:"₹25,000/day"},{hotel:"₹7,200/night", budget:"₹19,500/day"},{hotel:"₹18,000/night",budget:"₹45,000/day"},{hotel:"₹11,000/night",budget:"₹28,000/day"}],
    mid:    [{hotel:"₹3,500/night", budget:"₹9,000/day"}, {hotel:"₹5,200/night", budget:"₹13,500/day"},{hotel:"₹2,800/night", budget:"₹7,500/day"},{hotel:"₹7,000/night", budget:"₹18,000/day"},{hotel:"₹4,200/night", budget:"₹11,000/day"},{hotel:"₹2,400/night", budget:"₹6,500/day"},{hotel:"₹8,500/night", budget:"₹22,000/day"},{hotel:"₹5,800/night", budget:"₹15,000/day"}],
    budget: [{hotel:"₹1,200/night", budget:"₹3,500/day"}, {hotel:"₹1,800/night", budget:"₹4,800/day"},{hotel:"₹900/night",  budget:"₹2,800/day"},{hotel:"₹2,200/night", budget:"₹5,500/day"},{hotel:"₹1,500/night", budget:"₹4,000/day"},{hotel:"₹800/night",  budget:"₹2,200/day"},{hotel:"₹2,500/night", budget:"₹6,000/day"},{hotel:"₹1,600/night", budget:"₹4,200/day"}],
  };
  // Determine prices based on current search destination
  const getPrices = (dest, idx) => {
    const tier = DEST_PRICE_TIER(dest || searched);
    const pool = PRICE_TIERS[tier];
    return pool[idx % pool.length];
  };

  // ── Wikipedia ───────────────────────────────────────────────────
  const fetchWikiSummary = async (place) => {
    try {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(place)}`);
      if(!r.ok) return null;
      const d = await r.json();
      return {
        summary: d.extract ? d.extract.slice(0,190)+"…" : null,
        thumbnail: d.thumbnail?.source || null,
        url: d.content_urls?.desktop?.page || null,
      };
    } catch(e){ return null; }
  };

  // ── AI generate places via backend (Groq) ──────────────────────
  const aiGeneratePlaces = async (destination) => {
    const res = await call("/api/ai/places", {
      method: "POST",
      body: JSON.stringify({ destination }),
    });
    if (!res.success) throw new Error(res.error || "ai_error");
    return res.places;
  };

  // ── Local fallback ──────────────────────────────────────────────
  const localPlaces = (dest) => {
    const d = dest.toLowerCase();
    const MAP = {
      bali:       [{n:"Ubud",t:"Nature"},{n:"Seminyak Beach",t:"Beach"},{n:"Nusa Penida",t:"Nature"},{n:"Uluwatu Temple",t:"Temple"},{n:"Tegalalang Rice Terraces",t:"Nature"},{n:"Tanah Lot",t:"Temple"},{n:"Kuta Beach",t:"Beach"},{n:"Canggu",t:"Beach"}],
      goa:        [{n:"Baga Beach",t:"Beach"},{n:"Anjuna",t:"Beach"},{n:"Palolem Beach",t:"Beach"},{n:"Old Goa Churches",t:"Heritage"},{n:"Vagator",t:"Beach"},{n:"Calangute",t:"Beach"},{n:"Dudhsagar Falls",t:"Nature"},{n:"Panaji",t:"City"}],
      rajasthan:  [{n:"Jaipur",t:"Heritage"},{n:"Udaipur",t:"Heritage"},{n:"Jodhpur",t:"Heritage"},{n:"Jaisalmer",t:"Desert"},{n:"Pushkar",t:"Temple"},{n:"Ranthambore",t:"Nature"},{n:"Bikaner",t:"Heritage"},{n:"Chittorgarh",t:"Heritage"}],
      kerala:     [{n:"Munnar",t:"Nature"},{n:"Alleppey",t:"Nature"},{n:"Thekkady",t:"Nature"},{n:"Kovalam",t:"Beach"},{n:"Wayanad",t:"Nature"},{n:"Fort Kochi",t:"Heritage"},{n:"Varkala",t:"Beach"},{n:"Kumarakom",t:"Nature"}],
      manali:     [{n:"Rohtang Pass",t:"Mountain"},{n:"Solang Valley",t:"Mountain"},{n:"Hadimba Temple",t:"Temple"},{n:"Old Manali",t:"City"},{n:"Sissu",t:"Nature"},{n:"Naggar Castle",t:"Heritage"},{n:"Jogini Falls",t:"Nature"},{n:"Beas Kund",t:"Mountain"}],
      ladakh:     [{n:"Pangong Lake",t:"Lake"},{n:"Nubra Valley",t:"Desert"},{n:"Leh Palace",t:"Heritage"},{n:"Hemis Monastery",t:"Temple"},{n:"Tso Moriri",t:"Lake"},{n:"Magnetic Hill",t:"Nature"},{n:"Khardung La",t:"Mountain"},{n:"Zanskar",t:"Mountain"}],
      kashmir:    [{n:"Dal Lake",t:"Lake"},{n:"Gulmarg",t:"Mountain"},{n:"Pahalgam",t:"Nature"},{n:"Sonamarg",t:"Mountain"},{n:"Betaab Valley",t:"Nature"},{n:"Shalimar Bagh",t:"Heritage"},{n:"Nishat Bagh",t:"Heritage"},{n:"Doodhpathri",t:"Nature"}],
      tokyo:      [{n:"Shibuya Crossing",t:"City"},{n:"Senso-ji Temple",t:"Temple"},{n:"Shinjuku",t:"City"},{n:"Akihabara",t:"City"},{n:"teamLab Planets",t:"Museum"},{n:"Harajuku",t:"City"},{n:"Ueno Park",t:"Nature"},{n:"Odaiba",t:"City"}],
      paris:      [{n:"Eiffel Tower",t:"Heritage"},{n:"Louvre Museum",t:"Museum"},{n:"Montmartre",t:"City"},{n:"Champs-Élysées",t:"City"},{n:"Notre-Dame",t:"Heritage"},{n:"Versailles",t:"Heritage"},{n:"Musée d'Orsay",t:"Museum"},{n:"Sainte-Chapelle",t:"Heritage"}],
      dubai:      [{n:"Burj Khalifa",t:"City"},{n:"Dubai Mall",t:"City"},{n:"Palm Jumeirah",t:"City"},{n:"Desert Safari",t:"Desert"},{n:"Gold Souk",t:"Market"},{n:"Dubai Frame",t:"Heritage"},{n:"Bluewaters Island",t:"City"},{n:"Miracle Garden",t:"Nature"}],
      singapore:  [{n:"Gardens by the Bay",t:"Nature"},{n:"Marina Bay Sands",t:"City"},{n:"Sentosa Island",t:"Beach"},{n:"Orchard Road",t:"City"},{n:"Chinatown",t:"Heritage"},{n:"Clarke Quay",t:"City"},{n:"Universal Studios",t:"City"},{n:"Hawker Centres",t:"Market"}],
      london:     [{n:"Tower of London",t:"Heritage"},{n:"Buckingham Palace",t:"Heritage"},{n:"British Museum",t:"Museum"},{n:"Hyde Park",t:"Nature"},{n:"Covent Garden",t:"City"},{n:"Greenwich",t:"Heritage"},{n:"Camden Market",t:"Market"},{n:"Tate Modern",t:"Museum"}],
    };
    const key = Object.keys(MAP).find(k=>d.includes(k));
    const base = key ? MAP[key] : [{n:dest+" Old Town",t:"Heritage"},{n:dest+" Waterfront",t:"City"},{n:dest+" Heritage Site",t:"Heritage"},{n:dest+" Central Park",t:"Nature"},{n:dest+" Night Market",t:"Market"},{n:dest+" Viewpoint",t:"Mountain"},{n:dest+" Local Market",t:"Market"},{n:dest+" Famous Beach",t:"Beach"}];
    const ratings = ["4.8","4.7","4.6","4.9","4.5","4.7","4.4","4.8"];
    const DESCS = {
      // Ladakh
      "Pangong Lake":"A stunning high-altitude lake at 4,350m, famous for its vivid blue waters and dramatic Himalayan backdrop — immortalised in Bollywood cinema.",
      "Nubra Valley":"A cold-desert valley flanked by the Karakoram Range, known for its double-humped Bactrian camels and sand dunes framed by snowy peaks.",
      "Leh Palace":"A 17th-century nine-storey palace dominating the Leh skyline, offering sweeping panoramas of the Indus Valley from its rooftop.",
      "Hemis Monastery":"Ladakh's largest monastery, home to rare thangka paintings and host to the vibrant Hemis Festival celebrating Guru Padmasambhava.",
      "Khardung La":"One of the world's highest motorable passes at 5,359m, gateway to the Nubra Valley with breathtaking views of the Himalayas.",
      "Tso Moriri":"A pristine high-altitude lake set amid rolling hills, home to rare wildlife including bar-headed geese and Tibetan wild ass.",
      "Magnetic Hill":"A mysterious gravity hill where vehicles appear to move uphill on their own — a fascinating optical illusion on the Leh–Kargil highway.",
      "Zanskar":"A remote, high-altitude valley accessible by the spectacular frozen Chadar river trek in winter, ringed by towering peaks.",
      // Goa
      "Baga Beach":"North Goa's liveliest beach strip, buzzing with beach shacks, water sports, and famous nightlife along the Baga–Calangute stretch.",
      "Anjuna":"An iconic bohemian beach known for its Wednesday flea market, rocky shoreline, and legendary trance party heritage.",
      "Palolem Beach":"South Goa's most picturesque crescent-shaped beach, with calm waters ideal for kayaking and a laid-back, unspoiled atmosphere.",
      "Old Goa Churches":"A UNESCO World Heritage Site cluster including the Basilica of Bom Jesus, housing the relics of St. Francis Xavier.",
      "Vagator":"A dramatic cliff-top beach with Chapora Fort ruins above, offering spectacular sunset views over the Arabian Sea.",
      "Calangute":"Goa's most visited and busiest beach, lined with restaurants and water sports operators just a short drive from Panaji.",
      "Dudhsagar Falls":"A spectacular four-tiered waterfall plunging 310m through the Western Ghats, accessible by jeep safari through the Bhagwan Mahavir Wildlife Sanctuary.",
      "Panaji":"Goa's charming capital with its Latin Quarter of colourful Portuguese-era houses, heritage churches, and riverside promenades.",
      // Kerala
      "Munnar":"A scenic hill station at 1,600m elevation, famous for vast carpets of emerald tea plantations and misty valleys.",
      "Alleppey":"The 'Venice of the East', best explored aboard traditional Kerala houseboats through its tranquil backwater network.",
      "Thekkady":"Home to Periyar Tiger Reserve, offering boat safaris on Periyar Lake to spot elephants, bison, and diverse birdlife.",
      "Kovalam":"A crescent of three beautiful beaches with towering sea cliffs, lighthouse viewpoints, and Ayurvedic wellness resorts.",
      "Wayanad":"A lush, forested district with ancient tribal heritage, misty waterfalls, caves with Edakkal petroglyphs, and rich biodiversity.",
      "Fort Kochi":"A historic port town with Dutch, Portuguese, and British colonial layers, iconic Chinese fishing nets, and vibrant art galleries.",
      "Varkala":"A clifftop beach destination with natural mineral water springs, relaxed cafes perched above the Arabian Sea, and excellent surfing.",
      "Kumarakom":"A cluster of tranquil islands on Vembanad Lake, famous for its bird sanctuary and luxury backwater resort experience.",
      // Rajasthan
      "Jaipur":"The 'Pink City', home to the Amber Fort, Hawa Mahal, and City Palace — a living museum of Rajput grandeur and Mughal architecture.",
      "Udaipur":"The 'City of Lakes', with the magnificent City Palace reflected in Pichola Lake and romantic boat rides to the Lake Palace hotel.",
      "Jodhpur":"The 'Blue City', dominated by the massive Mehrangarh Fort towering 122m above a maze of indigo-painted old city lanes.",
      "Jaisalmer":"The 'Golden City', a living fort rising from the Thar Desert, with intricately carved sandstone havelis and thrilling dune safaris.",
      "Pushkar":"One of India's oldest cities and a sacred pilgrimage site, home to the only Brahma temple in the world and the famous Pushkar Camel Fair.",
      "Ranthambore":"One of India's finest tiger reserves set among 10th-century fort ruins — offering some of India's best big cat sightings.",
      "Bikaner":"A desert city famed for its magnificent Junagarh Fort, elaborate havelis, and the eccentric Karni Mata 'Rat Temple'.",
      "Chittorgarh":"India's largest fort complex, carrying the legendary tales of Rajput valour, the Jauhar of Padmini, and soaring victory towers.",
      // Manali
      "Rohtang Pass":"A high mountain pass at 3,978m offering dramatic snow views and access to the Lahaul–Spiti Valley beyond.",
      "Solang Valley":"A picturesque valley near Manali offering skiing in winter, zorbing and paragliding in summer, with the Beas River below.",
      "Hadimba Temple":"A unique 16th-century wooden temple dedicated to goddess Hadimba, nestled within a cedar forest on the valley floor.",
      "Old Manali":"The original village above the main town, lined with backpacker cafes, apple orchards, and bohemian guesthouses.",
      "Sissu":"A scenic village in the Lahaul Valley with a pristine lake reflecting snow-covered peaks — far quieter than Manali itself.",
      "Naggar Castle":"A medieval castle and heritage hotel overlooking the Kullu Valley, blending European and Himalayan architectural styles.",
      "Jogini Falls":"A cascading waterfall above Old Manali reached by a rewarding two-hour trek through pine forests and apple groves.",
      "Beas Kund":"A glacial alpine lake at 3,700m that is the source of the Beas River, reached by a popular two-day trek.",
      // Bali
      "Ubud":"Bali's cultural heart, surrounded by terraced rice fields, home to traditional dance, wood carving workshops, and the Sacred Monkey Forest.",
      "Seminyak Beach":"Bali's most upscale beachside neighbourhood, lined with chic beach clubs, designer boutiques, and world-class restaurants.",
      "Nusa Penida":"A rugged island off Bali's southeast coast, famous for Kelingking Beach cliff views, Crystal Bay, and manta ray diving.",
      "Uluwatu Temple":"A dramatic sea temple perched on a 70m cliff at Bali's southern tip, setting for the traditional Kecak fire dance at sunset.",
      "Tegalalang Rice Terraces":"Iconic UNESCO-listed Subak terraces carved into the hillside north of Ubud, best explored at dawn before the crowds arrive.",
      "Tanah Lot":"Bali's most photographed temple, perched on a rocky islet just offshore, framed by crashing waves at sunset.",
      "Kuta Beach":"Bali's original tourist beach, famous for consistent surf breaks, vivid sunsets, and the buzz of the island's main tourist hub.",
      "Canggu":"A trendy coastal village that has evolved from a surfers' hideout into Bali's hippest neighbourhood, packed with coffee shops and yoga studios.",
      // Tokyo
      "Shibuya Crossing":"The world's busiest pedestrian scramble crossing, with up to 3,000 people crossing simultaneously — a defining image of modern Tokyo.",
      "Senso-ji Temple":"Tokyo's oldest and most visited Buddhist temple in Asakusa, famous for its Nakamise shopping lane and giant paper lantern gate.",
      "Shinjuku":"Tokyo's electric entertainment and business hub, encompassing the neon-lit Kabukicho district and peaceful Shinjuku Gyoen garden.",
      "Akihabara":"The global capital of anime, manga, and electronics culture, packed with multi-storey gaming arcades and maid cafes.",
      "Harajuku":"The epicentre of Tokyo's outrageous youth fashion and street culture, anchored by Takeshita Street and the serene Meiji Shrine.",
      "Ueno Park":"Tokyo's largest public park containing seven major museums, a zoo, Shinobazu Pond, and stunning cherry blossom in spring.",
      "teamLab Planets":"An immersive digital art museum in Toyosu where visitors wade through water and are surrounded by breathtaking interactive installations.",
      "Odaiba":"A futuristic man-made island in Tokyo Bay with life-size Gundam statues, digital art museums, and sweeping Rainbow Bridge views.",
      // Paris
      "Eiffel Tower":"The world's most visited monument, Gustave Eiffel's 330m iron lattice tower offering three observation levels over Paris.",
      "Louvre Museum":"The world's largest and most visited art museum, home to 35,000 works including the Mona Lisa and Venus de Milo.",
      "Montmartre":"A charming hilltop village crowned by the white-domed Sacré-Cœur basilica, with cobblestone streets, artist studios, and sweeping city views.",
      "Champs-Élysées":"Paris's most famous avenue, stretching 1.9km from the Place de la Concorde to the Arc de Triomphe, lined with luxury brands.",
      "Notre-Dame":"The medieval Gothic masterpiece on the Île de la Cité, undergoing painstaking restoration after the 2019 fire, set to reopen.",
      "Versailles":"Louis XIV's spectacular palace 20km from Paris, with 700 rooms, the Hall of Mirrors, and 800 hectares of formal gardens.",
      "Musée d'Orsay":"Housed in a Beaux-Arts railway station, containing the world's finest collection of Impressionist and Post-Impressionist art.",
      "Sainte-Chapelle":"A breathtaking 13th-century royal chapel famous for its extraordinary 15m stained-glass windows depicting 1,113 biblical scenes.",
      // Dubai
      "Burj Khalifa":"The world's tallest building at 828m, with observation decks on floors 124 and 148 offering views extending 95km on clear days.",
      "Dubai Mall":"The world's largest shopping mall by total area, containing over 1,200 stores, an indoor ice rink, and a 10 million litre aquarium.",
      "Palm Jumeirah":"Dubai's iconic palm-shaped artificial island, home to the Atlantis resort, luxury villas, and the Palm Monorail.",
      "Desert Safari":"An exhilarating experience of dune bashing in 4x4s, followed by a traditional Bedouin camp dinner, camel riding, and stargazing.",
      "Gold Souk":"A traditional souk in Deira with over 300 retailers selling 10 tonnes of gold jewellery daily — the world's largest gold market.",
      "Dubai Frame":"A 150m picture-frame structure offering panoramic views of old Dubai on one side and the gleaming modern skyline on the other.",
      "Burj Al Arab":"Arguably the world's most recognisable hotel, built on its own artificial island in the shape of a billowing dhow sail.",
      // Singapore
      "Gardens by the Bay":"A futuristic 101-hectare nature park featuring 18 solar-powered Supertrees and two iconic climate-controlled glass conservatories.",
      "Marina Bay Sands":"Singapore's iconic three-tower integrated resort crowned by the sky-park infinity pool with panoramic views over the city.",
      "Sentosa Island":"Singapore's leisure island with Universal Studios, S.E.A. Aquarium, cable cars, and pristine beaches minutes from the city centre.",
      "Orchard Road":"Singapore's premier 2.2km shopping boulevard, lined with over 22 major malls and 300 restaurants.",
      "Chinatown":"Singapore's most colourful heritage district, packed with clan houses, temples, hawker stalls, and traditional medicine shops.",
      "Clarke Quay":"A bustling waterfront quay with restored 19th-century warehouses converted into bars, restaurants, and entertainment venues.",
      "Universal Studios":"South-East Asia's first Universal Studios theme park, with 28 rides across seven themed zones on Sentosa Island.",
      "Hawker Centres":"Singapore's legendary UNESCO-recognised street food culture, where Michelin-starred dishes cost under S$10 at open-air food centres.",
      // London
      "Tower of London":"A UNESCO World Heritage Site and 900-year-old royal fortress housing the Crown Jewels and patrolled by the famous Beefeaters.",
      "Buckingham Palace":"The official London residence of the British monarch, with the Changing of the Guard ceremony drawing thousands daily.",
      "British Museum":"One of the world's greatest museums, with 8 million objects spanning human history — including the Rosetta Stone and Elgin Marbles.",
      "Hyde Park":"London's largest royal park, covering 142 hectares with the Serpentine lake, Speaker's Corner, and the Diana Memorial Fountain.",
      "Covent Garden":"A vibrant Victorian market piazza packed with street performers, independent restaurants, and boutique shops in London's West End.",
      "Greenwich":"Home to the Prime Meridian of the World, Royal Observatory, Cutty Sark clipper ship, and sweeping views over the Thames.",
      "Camden Market":"An eclectic collection of market stalls, independent music venues, and international street food spread across north London's canal-side.",
      "Tate Modern":"One of the world's most visited modern art museums, housed in a converted Bankside power station with free permanent collections.",
    };
    return base.map((b,i)=>({name:b.n, desc:DESCS[b.n]||("Discover the remarkable "+b.t.toLowerCase()+" experiences and local culture of "+b.n+" in "+dest+"."), type:b.t, rating:ratings[i%8]}));
  };

  // ── Build cards ─────────────────────────────────────────────────
  const buildCards = async (destination, places) => {
    const results = [];
    for(let i=0; i<places.length; i++){
      const p = places[i];
      const tag = TAGS[i % TAGS.length];
      const price = getPrices(destination, i);
      // Fetch wiki summary for description
      let wiki = null;
      try { wiki = await fetchWikiSummary(p.name); } catch(e){}
      const imgUrl = getPlaceImage(p.name, p.type, i);
      results.push({
        id:i, name:p.name,
        desc: wiki?.summary || p.desc || "Discover the magic of "+p.name,
        type: p.type||"Attraction",
        rating: p.rating || (4.3 + Math.random()*0.6).toFixed(1),
        imgUrl, wikiUrl:wiki?.url||null,
        tag, destination, price,
      });
    }
    return results;
  };

  const fetchDestInfo = async (dest) => {
    const wiki = await fetchWikiSummary(dest);
    if(wiki) setDestInfo(wiki);
  };

  // ── Main search — Groq AI only ──────────────────────────────────
  const doSearch = async (term) => {
    const q = sanitize((term || query).trim());
    if(!q) return;
    setLoading(true); setCards([]); setSearched(q); setDestInfo(null);
    fetchDestInfo(q);
    try {
      const places = await aiGeneratePlaces(q);
      if(!Array.isArray(places) || places.length === 0) throw new Error("empty");
      setCards(await buildCards(q, places));
    } catch(e){
      setCards([]);
    }
    setLoading(false);
  };

  const planTrip = (place, dest) => {
    go("chat");
    setTimeout(()=>window.dispatchEvent(new CustomEvent("alfa_prompt",{
      detail:`Plan a detailed trip to ${place}${dest&&dest.toLowerCase()!==place.toLowerCase()?" in "+dest:""} with day-wise itinerary, best hotels, food guide, and complete budget in ₹`
    })),350);
  };

  // ── Provider info (backend Groq only) ──────────────────────────
  const prov = {name:"Groq AI", color:"#10b981", bg:"rgba(16,185,129,.15)", icon:"🤖"};

  // ══════════════════════════════════════════════════════════════════
  // PLACE CARD — Airbnb-quality design
  // ══════════════════════════════════════════════════════════════════
  const PlaceCard = ({card, idx}) => {
    const [imgLoaded, setImgLoaded] = useState(false);
    const [imgError,  setImgError]  = useState(false);
    const [hovered,   setHovered]   = useState(false);
    const src = imgError ? FALLBACK_IMGS[idx%FALLBACK_IMGS.length] : card.imgUrl;

    return(
      <div
        onMouseEnter={()=>setHovered(true)}
        onMouseLeave={()=>setHovered(false)}
        style={{
          borderRadius:18, overflow:"hidden", cursor:"pointer",
          background:"#ffffff",
          border:"1px solid rgba(0,0,0,.06)",
          transition:"all .32s cubic-bezier(.4,0,.2,1)",
          transform: hovered ? "translateY(-10px) scale(1.01)" : "translateY(0) scale(1)",
          boxShadow: hovered
            ? "0 32px 64px rgba(0,0,0,.18), 0 8px 24px rgba(99,102,241,.12)"
            : "0 2px 16px rgba(0,0,0,.07), 0 1px 4px rgba(0,0,0,.04)",
          animationDelay:`${idx*60}ms`,
        }}
        className="aup"
      >
        {/* ── Image Area ── */}
        <div style={{height:220, position:"relative", overflow:"hidden", background:"#f1f5f9"}}>
          {/* Skeleton while loading */}
          {!imgLoaded && (
            <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%)",backgroundSize:"600px 100%",animation:"shimmer 1.6s infinite"}}/>
          )}
          {/* Main image */}
          <img
            src={src} alt={card.name}
            onLoad={()=>setImgLoaded(true)}
            onError={()=>{setImgError(true);setImgLoaded(true);}}
            style={{
              width:"100%", height:"100%", objectFit:"cover",
              opacity: imgLoaded ? 1 : 0,
              transition:"opacity .5s ease, transform .5s ease",
              transform: hovered ? "scale(1.08)" : "scale(1)",
            }}
          />
          {/* Dark gradient overlay for text readability */}
          <div style={{
            position:"absolute", inset:0,
            background:"linear-gradient(to top, rgba(0,0,0,.75) 0%, rgba(0,0,0,.25) 45%, rgba(0,0,0,.05) 100%)",
            pointerEvents:"none",
          }}/>
          {/* Top-left: Tag pill */}
          <div style={{
            position:"absolute", top:13, left:13,
            padding:"5px 12px", borderRadius:30,
            background: card.tag.bg,
            border:`1px solid ${card.tag.color}44`,
            backdropFilter:"blur(10px)",
            fontSize:11, fontWeight:800, color:card.tag.color,
            letterSpacing:".02em", lineHeight:1,
          }}>
            {card.tag.label}
          </div>
          {/* Top-right: Type badge */}
          <div style={{
            position:"absolute", top:13, right:13,
            padding:"5px 11px", borderRadius:20,
            background:"rgba(0,0,0,.48)",
            backdropFilter:"blur(10px)",
            fontSize:10, fontWeight:600,
            color:"rgba(255,255,255,.9)",
            letterSpacing:".03em",
          }}>
            {card.type}
          </div>
          {/* Bottom: Place name + location */}
          <div style={{position:"absolute", bottom:0, left:0, right:0, padding:"12px 15px 14px"}}>
            <div style={{
              fontSize:19, fontWeight:900, color:"#fff",
              letterSpacing:"-.02em", lineHeight:1.2, marginBottom:3,
              textShadow:"0 2px 10px rgba(0,0,0,.8)",
            }}>{card.name}</div>
            <div style={{display:"flex", alignItems:"center", gap:5}}>
              <span style={{fontSize:11, color:"rgba(255,255,255,.65)"}}>📍</span>
              <span style={{fontSize:11, color:"rgba(255,255,255,.7)", fontWeight:500}}>{card.destination}</span>
            </div>
          </div>
          {/* Rating badge — bottom right */}
          <div style={{
            position:"absolute", bottom:14, right:14,
            display:"flex", alignItems:"center", gap:4,
            background:"rgba(0,0,0,.55)",
            backdropFilter:"blur(10px)",
            borderRadius:20, padding:"4px 10px",
          }}>
            <span style={{fontSize:12}}>⭐</span>
            <span style={{fontSize:12, fontWeight:800, color:"#facc15"}}>{card.rating}</span>
          </div>
        </div>

        {/* ── Card Body ── */}
        <div style={{padding:"16px 16px 18px", background:"#ffffff"}}>
          {/* Description */}
          <p style={{
            fontSize:12.5, color:"#475569", lineHeight:1.65,
            marginBottom:12, minHeight:40,
            display:"-webkit-box", WebkitLineClamp:2,
            WebkitBoxOrient:"vertical", overflow:"hidden",
          }}>
            {card.desc}
          </p>

          {/* Price row */}
          <div style={{
            display:"flex", alignItems:"center", justifyContent:"space-between",
            marginBottom:14, padding:"9px 12px",
            background:"#f8fafc", borderRadius:10,
            border:"1px solid #e2e8f0",
          }}>
            <div>
              <div style={{fontSize:10, color:"#94a3b8", fontWeight:600, marginBottom:1, textTransform:"uppercase", letterSpacing:".04em"}}>From</div>
              <div style={{fontSize:14, fontWeight:800, color:"#0f172a"}}>{card.price.hotel}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:10, color:"#94a3b8", fontWeight:600, marginBottom:1, textTransform:"uppercase", letterSpacing:".04em"}}>Budget</div>
              <div style={{fontSize:13, fontWeight:700, color:"#334155"}}>{card.price.budget}</div>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{display:"flex", gap:9}}>
            {/* Plan Trip */}
            <button
              onClick={()=>planTrip(card.name, card.destination)}
              style={{
                flex:1, padding:"11px 14px",
                borderRadius:12, border:"none", cursor:"pointer",
                background:"linear-gradient(135deg, #6366F1, #3B82F6)",
                color:"#fff", fontSize:12.5, fontWeight:800,
                fontFamily:"inherit", letterSpacing:".01em",
                transition:"all .22s",
                boxShadow: hovered
                  ? "0 8px 24px rgba(99,102,241,.5)"
                  : "0 3px 12px rgba(99,102,241,.3)",
              }}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow="0 10px 28px rgba(99,102,241,.55)";}}
              onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 3px 12px rgba(99,102,241,.3)";}}
            >
              ✦ Plan Trip
            </button>
            {/* Wiki or More */}
            {card.wikiUrl ? (
              <a href={card.wikiUrl} target="_blank" rel="noopener noreferrer"
                style={{
                  padding:"11px 15px", borderRadius:12, cursor:"pointer",
                  background:"#f8fafc", border:"1.5px solid #e2e8f0",
                  color:"#64748b", fontSize:12, fontWeight:700,
                  fontFamily:"inherit", transition:"all .2s",
                  textDecoration:"none", display:"flex", alignItems:"center", gap:4,
                  whiteSpace:"nowrap",
                }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="#6366F1";e.currentTarget.style.color="#6366F1";e.currentTarget.style.background="#f5f3ff";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#64748b";e.currentTarget.style.background="#f8fafc";}}
              >
                📖 Wiki
              </a>
            ) : (
              <button
                onClick={()=>{go("chat");setTimeout(()=>window.dispatchEvent(new CustomEvent("alfa_prompt",{detail:`Tell me about ${card.name}: top things to do, local food, best time to visit, and travel tips`})),350);}}
                style={{
                  padding:"11px 15px", borderRadius:12, cursor:"pointer",
                  background:"#f8fafc", border:"1.5px solid #e2e8f0",
                  color:"#64748b", fontSize:12, fontWeight:700,
                  fontFamily:"inherit", transition:"all .2s", whiteSpace:"nowrap",
                }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="#6366F1";e.currentTarget.style.color="#6366F1";e.currentTarget.style.background="#f5f3ff";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#64748b";e.currentTarget.style.background="#f8fafc";}}
              >
                More →
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Skeleton Card ────────────────────────────────────────────────
  const SkeletonCard = () => (
    <div style={{borderRadius:18,overflow:"hidden",background:"#ffffff",border:"1px solid rgba(0,0,0,.06)",boxShadow:"0 2px 12px rgba(0,0,0,.06)"}}>
      <div style={{height:220,background:"linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%)",backgroundSize:"600px 100%",animation:"shimmer 1.6s infinite"}}/>
      <div style={{padding:"16px 16px 18px"}}>
        <div style={{height:13,width:"70%",background:"linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%)",backgroundSize:"600px 100%",animation:"shimmer 1.6s infinite",borderRadius:8,marginBottom:8}}/>
        <div style={{height:11,width:"90%",background:"linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%)",backgroundSize:"600px 100%",animation:"shimmer 1.6s infinite",borderRadius:8,marginBottom:6}}/>
        <div style={{height:11,width:"55%",background:"linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%)",backgroundSize:"600px 100%",animation:"shimmer 1.6s infinite",borderRadius:8,marginBottom:16}}/>
        <div style={{display:"flex",gap:9}}>
          <div style={{flex:1,height:40,background:"linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%)",backgroundSize:"600px 100%",animation:"shimmer 1.6s infinite",borderRadius:12}}/>
          <div style={{width:72,height:40,background:"linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%)",backgroundSize:"600px 100%",animation:"shimmer 1.6s infinite",borderRadius:12}}/>
        </div>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════
  return(
    <div className="aup" style={{
      minHeight:"100vh",
      background:"linear-gradient(160deg, #F8FAFC 0%, #EFF6FF 50%, #F5F3FF 100%)",
      padding:"28px 28px 40px",
    }}>

      {/* ── Page Header ── */}
      <div style={{marginBottom:28,display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:16}}>
        <div>
          <h1 style={{
            fontSize:30, fontWeight:900, letterSpacing:"-.04em",
            marginBottom:6, color:"#0F172A", lineHeight:1.1,
            fontFamily:"var(--font-display)",
          }}>
            🌍 Explore Destinations
          </h1>
          <p style={{color:"#64748b", fontSize:14, fontWeight:500}}>
            Wikipedia photos & data · AI-powered recommendations · 🤖 AI-generated, verify details
          </p>
        </div>

        {/* ── AI Provider Badge ── */}
        <div style={{display:"flex",flexDirection:"column",gap:8,alignItems:"flex-end"}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <div style={{
              padding:"9px 18px", borderRadius:12,
              fontFamily:"inherit", fontWeight:700, fontSize:13,
              background: prov.bg,
              border:`1.5px solid ${prov.color}`,
              color: prov.color,
              boxShadow: `0 0 16px ${prov.color}33`,
            }}>
              {prov.icon} {prov.name}
            </div>
          </div>
        </div>
      </div>

      {/* ── Plan Full Trip with AI Banner ── */}
      {searched && !loading && (
        <div className="ain" style={{
          marginBottom:24,
          background:"linear-gradient(135deg, #6366F1 0%, #3B82F6 100%)",
          borderRadius:16, padding:"18px 22px",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          flexWrap:"wrap", gap:14,
          boxShadow:"0 8px 32px rgba(99,102,241,.3)",
        }}>
          <div>
            <div style={{fontWeight:800,fontSize:15,color:"#fff",marginBottom:3}}>
              ✨ Ready to explore <span style={{color:"#bfdbfe"}}>{searched}</span>?
            </div>
            <div style={{fontSize:12,color:"rgba(255,255,255,.7)"}}>
              Let AI build your perfect itinerary with hotels, food & complete ₹ budget
            </div>
          </div>
          <button
            onClick={()=>{go("chat");setTimeout(()=>window.dispatchEvent(new CustomEvent("alfa_prompt",{detail:`Plan a complete trip to ${searched} with day-wise itinerary, top places, food guide, hotels, and full budget in ₹`})),350);}}
            style={{
              padding:"12px 24px", borderRadius:12,
              background:"#fff", border:"none", cursor:"pointer",
              color:"#6366F1", fontWeight:900, fontSize:13,
              fontFamily:"inherit", whiteSpace:"nowrap",
              boxShadow:"0 4px 14px rgba(0,0,0,.15)",
              transition:"all .2s",
            }}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(0,0,0,.2)";}}
            onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 4px 14px rgba(0,0,0,.15)";}}
          >
            ✦ Plan Full Trip with AI →
          </button>
        </div>
      )}

      {/* ── Search Bar ── */}
      <div style={{marginBottom:28, maxWidth:680}}>
        <form onSubmit={e=>{e.preventDefault();doSearch();}}>
          <div style={{
            display:"flex", gap:10, alignItems:"center",
            background:"#ffffff",
            border:"2px solid #e2e8f0",
            borderRadius:18, padding:"8px 8px 8px 20px",
            transition:"border-color .25s, box-shadow .25s",
            boxShadow:"0 4px 20px rgba(0,0,0,.06)",
          }}
            onFocusCapture={e=>{e.currentTarget.style.borderColor="#6366F1";e.currentTarget.style.boxShadow="0 0 0 4px rgba(99,102,241,.12),0 4px 20px rgba(0,0,0,.08)";}}
            onBlurCapture={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.boxShadow="0 4px 20px rgba(0,0,0,.06)";}}>
            <span style={{fontSize:20,opacity:.5,flexShrink:0}}>🔍</span>
            <input ref={inputRef} value={query} onChange={e=>setQuery(e.target.value)}
              placeholder="Search destination — Bali, Ladakh, Paris, Tokyo…"
              style={{flex:1,background:"transparent",border:"none",outline:"none",color:"#0F172A",fontSize:15,fontFamily:"inherit",padding:"7px 0"}}
            />
            <button type="submit" disabled={loading||!query.trim()}
              style={{
                padding:"12px 24px", borderRadius:12, border:"none", cursor:loading||!query.trim()?"default":"pointer",
                background: loading||!query.trim()
                  ? "#e2e8f0"
                  : "linear-gradient(135deg, #6366F1, #3B82F6)",
                color: loading||!query.trim() ? "#94a3b8" : "#fff",
                fontWeight:800, fontSize:13, fontFamily:"inherit",
                transition:"all .2s", whiteSpace:"nowrap",
                boxShadow: !loading&&query.trim() ? "0 4px 16px rgba(99,102,241,.4)" : "none",
              }}>
              {loading
                ? <span style={{display:"flex",alignItems:"center",gap:7}}>
                    <span style={{width:13,height:13,borderRadius:"50%",border:"2px solid rgba(255,255,255,.3)",borderTopColor:"#fff",animation:"spin .7s linear infinite",display:"inline-block"}}/>
                    Searching…
                  </span>
                : "Search ✦"}
            </button>
          </div>
        </form>
      </div>

      {/* ── Trending chips (default state) ── */}
      {!cards.length&&!loading&&(
        <div>
          {TRENDING_SETS.map((set,si)=>(
            <div key={si} style={{marginBottom:22}}>
              <div style={{fontSize:11,fontWeight:800,color:"#94a3b8",letterSpacing:".07em",textTransform:"uppercase",marginBottom:10}}>{set.label}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:9}}>
                {set.places.map(p=>(
                  <button key={p} onClick={()=>{setQuery(p);doSearch(p);}}
                    style={{
                      padding:"9px 18px", borderRadius:24,
                      background:"#ffffff", border:"1.5px solid #e2e8f0",
                      color:"#475569", fontSize:13, cursor:"pointer",
                      transition:"all .2s", fontFamily:"inherit",
                      fontWeight:600, boxShadow:"0 2px 8px rgba(0,0,0,.05)",
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.background="#f5f3ff";e.currentTarget.style.borderColor="#6366F1";e.currentTarget.style.color="#6366F1";e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 8px 20px rgba(99,102,241,.18)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="#ffffff";e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#475569";e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,.05)";}}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {/* Bottom CTA */}
          <div style={{marginTop:10,padding:"22px",background:"#ffffff",borderRadius:16,border:"1.5px solid #e2e8f0",textAlign:"center",boxShadow:"0 4px 20px rgba(0,0,0,.05)"}}>
            <div style={{fontSize:28,marginBottom:10}}>🗺️</div>
            <div style={{fontWeight:800,fontSize:15,color:"#0F172A",marginBottom:6}}>Or chat with AI directly</div>
            <div style={{color:"#64748b",fontSize:13,marginBottom:16}}>Describe your dream trip and let AI plan everything</div>
            <button onClick={()=>go("chat")}
              style={{padding:"12px 28px",borderRadius:12,background:"linear-gradient(135deg,#6366F1,#3B82F6)",border:"none",color:"#fff",fontWeight:800,fontSize:13,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 20px rgba(99,102,241,.4)",transition:"all .22s"}}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 28px rgba(99,102,241,.55)";}}
              onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 4px 20px rgba(99,102,241,.4)";}}>
              ✦ Chat with AI Planner
            </button>
          </div>
        </div>
      )}

      {/* ── Loading state ── */}
      {loading&&(
        <div>
          <div style={{
            display:"flex",alignItems:"center",gap:12,marginBottom:22,
            padding:"16px 20px",background:"#ffffff",borderRadius:14,
            border:"1.5px solid #e2e8f0",boxShadow:"0 4px 16px rgba(0,0,0,.06)",
          }}>
            <div style={{display:"flex",gap:5}}>
              {[0,1,2].map(i=>(
                <div key={i} style={{width:7,height:7,borderRadius:"50%",background:i===0?"#6366F1":i===1?"#3B82F6":"#06B6D4",animation:`blink 1.3s ${i*.2}s infinite`}}/>
              ))}
            </div>
            <span style={{fontSize:13,color:"#475569",fontWeight:500}}>
              {prov.icon} {prov.name} is finding the best places in{" "}
              <strong style={{color:"#0F172A"}}>{query}</strong>…
            </span>
            <span style={{marginLeft:"auto",fontSize:11,color:"#94a3b8"}}>Fetching photos & data…</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:22}}>
            {[1,2,3,4,5,6,7,8].map(i=><SkeletonCard key={i}/>)}
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {!loading&&cards.length>0&&(
        <div>
          {/* Destination overview card */}
          {destInfo?.summary&&(
            <div className="ain" style={{
              marginBottom:24, padding:"20px 22px",
              background:"#ffffff", border:"1.5px solid #e2e8f0",
              borderRadius:16, display:"flex", gap:16, alignItems:"flex-start",
              boxShadow:"0 4px 20px rgba(0,0,0,.07)",
            }}>
              {destInfo.thumbnail&&(
                <img src={destInfo.thumbnail} alt={searched}
                  style={{width:76,height:76,borderRadius:14,objectFit:"cover",flexShrink:0,border:"1px solid #e2e8f0"}}
                />
              )}
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:7}}>
                  <span style={{fontWeight:900,fontSize:16,color:"#0F172A"}}>{searched}</span>
                  <span style={{padding:"3px 10px",borderRadius:20,background:"#f5f3ff",color:"#6366F1",fontSize:10,fontWeight:800,letterSpacing:".04em"}}>Wikipedia</span>
                </div>
                <p style={{fontSize:13,color:"#475569",lineHeight:1.75,margin:0}}>{destInfo.summary}</p>
                {destInfo.url&&(
                  <a href={destInfo.url} target="_blank" rel="noopener noreferrer"
                    style={{fontSize:12,color:"#6366F1",marginTop:7,display:"inline-block",textDecoration:"none",fontWeight:700}}>
                    Read more on Wikipedia →
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Results bar */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:14,color:"#64748b"}}>Showing </span>
              <strong style={{fontSize:14,color:"#0F172A"}}>{cards.length} places</strong>
              <span style={{fontSize:14,color:"#64748b"}}> in </span>
              <strong style={{fontSize:14,color:"#6366F1"}}>{searched}</strong>
              <span style={{padding:"3px 10px",borderRadius:20,background:prov.bg,color:prov.color,fontSize:11,fontWeight:700}}>
                {prov.icon} {prov.name}
              </span>
            </div>
            <button
              onClick={()=>{go("chat");setTimeout(()=>window.dispatchEvent(new CustomEvent("alfa_prompt",{detail:`Plan a complete trip to ${searched} with day-wise itinerary, top places, food guide, hotels, and full budget in ₹`})),350);}}
              style={{
                padding:"11px 22px", borderRadius:13, border:"none",
                background:"linear-gradient(135deg, #6366F1, #3B82F6)",
                color:"#fff", fontSize:13, fontWeight:800,
                cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap",
                boxShadow:"0 4px 18px rgba(99,102,241,.4)", transition:"all .22s",
              }}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 28px rgba(99,102,241,.55)";}}
              onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 4px 18px rgba(99,102,241,.4)";}}>
              ✦ Plan Full {searched} Trip with AI
            </button>
          </div>

          {/* Cards grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:22}}>
            {cards.map((card,i)=><PlaceCard key={card.id} card={card} idx={i}/>)}
          </div>

          {/* Bottom CTA */}
          <div style={{
            textAlign:"center", marginTop:32, padding:"28px 24px",
            background:"linear-gradient(135deg, #6366F1 0%, #3B82F6 100%)",
            borderRadius:18, boxShadow:"0 12px 40px rgba(99,102,241,.35)",
          }}>
            <div style={{fontSize:15,color:"rgba(255,255,255,.9)",marginBottom:5,fontWeight:700}}>
              Want a personalised itinerary for <strong style={{color:"#bfdbfe"}}>{searched}</strong>?
            </div>
            <div style={{fontSize:12,color:"rgba(255,255,255,.6)",marginBottom:18}}>
              Hotels, restaurants, day-wise plan & complete ₹ budget — all in one message
            </div>
            <button
              onClick={()=>{go("chat");setTimeout(()=>window.dispatchEvent(new CustomEvent("alfa_prompt",{detail:`Create a detailed ${searched} trip itinerary with specific places, restaurants, hotels and complete budget in ₹`})),350);}}
              style={{
                padding:"13px 32px", borderRadius:13,
                background:"#fff", border:"none", cursor:"pointer",
                color:"#6366F1", fontWeight:900, fontSize:14,
                fontFamily:"inherit", boxShadow:"0 4px 16px rgba(0,0,0,.15)",
                transition:"all .22s",
              }}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(0,0,0,.2)";}}
              onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,.15)";}}>
              ✦ Build My Perfect {searched} Trip
            </button>
          </div>
        </div>
      )}

      {/* ── No results ── */}
      {!loading&&searched&&cards.length===0&&(
        <div style={{textAlign:"center",padding:"70px 20px"}}>
          <div style={{fontSize:52,marginBottom:18}}>🔍</div>
          <h3 style={{fontWeight:900,fontSize:20,color:"#0F172A",marginBottom:8}}>No results found</h3>
          <p style={{color:"#64748b",fontSize:14,marginBottom:24}}>Try another destination or ask the AI directly</p>
          <button onClick={()=>doSearch()} style={{marginRight:12,padding:"12px 24px",borderRadius:12,background:"linear-gradient(135deg,#6366F1,#3B82F6)",border:"none",color:"#fff",fontWeight:800,fontSize:13,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 16px rgba(99,102,241,.4)"}}>Retry</button>
          <button onClick={()=>{go("chat");setTimeout(()=>window.dispatchEvent(new CustomEvent("alfa_prompt",{detail:`Tell me about ${searched} travel`})),350);}} style={{padding:"12px 24px",borderRadius:12,background:"#ffffff",border:"1.5px solid #e2e8f0",color:"#475569",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",transition:"all .2s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor="#6366F1";e.currentTarget.style.color="#6366F1";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#475569";}}>Ask AI →</button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// SETTINGS PAGE — API Keys & Preferences
// ══════════════════════════════════════════════════════════════════

function Settings({go}) {

  return(
    <div className="aup" style={{
      minHeight:"100vh",
      background:"linear-gradient(160deg, #F8FAFC 0%, #EFF6FF 50%, #F5F3FF 100%)",
      padding:"28px 28px 40px",
    }}>
      <div style={{maxWidth:800,margin:"0 auto"}}>

        {/* Header */}
        <div style={{marginBottom:32}}>
          <h1 style={{
            fontSize:32, fontWeight:900, color:"#0F172A",
            marginBottom:6, background:"var(--g4)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            letterSpacing:"-.02em",
          }}>⚙️ Settings</h1>
          <p style={{color:"#64748b",fontSize:15}}>Manage your preferences</p>
        </div>

        {/* AI Backend Section */}
        <div className="ain" style={{
          background:"#ffffff", border:"1.5px solid #e2e8f0",
          borderRadius:18, padding:"24px", marginBottom:24,
          boxShadow:"0 8px 32px rgba(0,0,0,.08)",
        }}>
          <div style={{fontSize:18,fontWeight:800,color:"#0F172A",marginBottom:16}}>🤖 AI Backend (Groq)</div>
          <div style={{fontSize:13,color:"#64748b",marginBottom:20,lineHeight:1.5}}>
            All AI features are powered by the Groq API running on the backend server. Your API key is stored in <code>.env</code> and is never sent to the browser.
          </div>
          <div style={{padding:"16px",background:"rgba(16,185,129,.06)",borderRadius:10,border:"1px solid rgba(16,185,129,.15)"}}>
            <div style={{fontSize:13,color:"#10b981",fontWeight:700,marginBottom:6}}>✅ Secure Architecture</div>
            <div style={{fontSize:12,color:"#64748b",lineHeight:1.6}}>
              <div>• <strong>GROQ_API_KEY</strong> lives in <code>.env</code> on the server only</div>
              <div>• The browser never sees the API key</div>
              <div>• To change the model, set <code>GROQ_MODEL</code> in <code>.env</code></div>
              <div style={{marginTop:8}}>Get a free key at <a href="https://console.groq.com" target="_blank" style={{color:"#6366F1"}}>console.groq.com</a></div>
            </div>
          </div>
        </div>

        {/* Other Settings Placeholder */}
        <div className="ain" style={{
          background:"#ffffff", border:"1.5px solid #e2e8f0",
          borderRadius:18, padding:"24px",
          boxShadow:"0 8px 32px rgba(0,0,0,.08)",
        }}>
          <div style={{fontSize:18,fontWeight:800,color:"#0F172A",marginBottom:16}}>🎨 Preferences</div>
          <div style={{color:"#64748b",fontSize:14}}>More settings coming soon...</div>
        </div>

      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════════════════════════════
function Page({id, props}) {
  switch(id) {
    case "dashboard": return <Dashboard {...props}/>;
    case "chat":      return <ChatPage  {...props}/>;
    case "history":   return <History   {...props}/>;
    case "future":    return <Future    {...props}/>;
    case "budget":    return <Budget    {...props}/>;
    case "explore":   return <Explore   {...props}/>;
    case "settings":  return <Settings  {...props}/>;
    default:          return <Dashboard {...props}/>;
  }
}

// ══════════════════════════════════════════════════════════════════
// SEED DATA (stable IDs per user)
// ══════════════════════════════════════════════════════════════════
const seeds = uid => [
  {id:`s_${uid}_1`,destination:"Bali, Indonesia",startDate:"2024-06-15",endDate:"2024-06-22",budget:232400,activities:"Temples, Surfing, Rice Terraces",status:"past",notes:"Amazing trip!",createdAt:"2024-05-01T00:00:00Z",updatedAt:"2024-05-01T00:00:00Z"},
  {id:`s_${uid}_2`,destination:"Tokyo, Japan",startDate:"2026-05-10",endDate:"2026-05-18",budget:348600,activities:"Food tours, Temples, Tech",status:"upcoming",notes:"",createdAt:"2026-01-10T00:00:00Z",updatedAt:"2026-01-10T00:00:00Z"},
];

// ══════════════════════════════════════════════════════════════════
// ROOT APP
// ══════════════════════════════════════════════════════════════════
function App() {
  const [dark,      setDark]    = useState(true);
  const [user,      setUser]    = useState(null);
  const [page,      setPage]    = useState("dashboard");
  const [mobOpen,   setMobOpen] = useState(false);
  const [collapsed, setCollapsed]= useState(false);
  const [plans,    setPlans]   = useState([]);
  const [chats,    setChats]   = useState([]);
  const [loaded,   setLoaded]  = useState(false);
  const [booting,  setBooting] = useState(true);
  const [offline,  setOffline] = useState(false);

  // ── Restore session on mount ──────────────────────────────────
  useEffect(()=>{
    (async()=>{
      const t=tok.get();
      if(!t){setBooting(false);return;}
      if(t.startsWith("off.")){
        const u=offMe();
        if(u){setUser(u);setOffline(true);}else tok.del();
        setBooting(false);return;
      }
      try{
        const r=await api.me();
        if(r.success){setUser(r.user);setOffline(false);}
        else tok.del();
      }catch(e){
        const u=offMe();
        if(u){setUser(u);setOffline(true);}else tok.del();
      }
      setBooting(false);
    })();
  },[]);

  // ── Load data after login ─────────────────────────────────────
  useEffect(()=>{
    if(!user)return;
    (async()=>{
      try{
        const r=await api.plans();
        if(r.success){setPlans(r.plans);ls.set("ap_"+user.id,r.plans);}
        else throw new Error();
      }catch(e){
        const saved=ls.get("ap_"+user.id,null);
        setPlans(saved!==null?saved:seeds(user.id));
      }
      setLoaded(true);
    })();
  },[user?.id]);

  // ── Persist plans ─────────────────────────────────────────────
  useEffect(()=>{if(user&&loaded)ls.set("ap_"+user.id,plans);},[plans,user,loaded]);

  // ── Logout ────────────────────────────────────────────────────
  const logout=async()=>{
    if(!tok.get()?.startsWith("off."))try{await api.logout();}catch(e){}
    tok.del();setUser(null);setPage("dashboard");setPlans([]);setChats([]);setLoaded(false);setOffline(false);
    toast.info("Logged out");
  };

  const [userLocation, setUserLocation] = useState(null);
  const [locBanner, setLocBanner] = useState(false);

  const askLocation=()=>{
    if(!navigator.geolocation){return;}
    navigator.geolocation.getCurrentPosition(async(pos)=>{
      const {latitude:lat,longitude:lng}=pos.coords;
      try{
        const r=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
        const d=await r.json();
        const city=d.address?.city||d.address?.town||d.address?.state||"your location";
        setUserLocation({lat,lng,city});
        ls.set("alfa_loc",{lat,lng,city});
        toast.ok("📍 Location detected: "+city);
        setLocBanner(false);
      }catch(e){setUserLocation({lat,lng,city:"your area"});}
    },()=>{setLocBanner(false);});
  };

  const onAuth=(u,isOff=false)=>{
    setUser(u);setOffline(isOff);
    // Ask location after login
    const savedLoc=ls.get("alfa_loc",null);
    if(savedLoc){setUserLocation(savedLoc);}
    else{setTimeout(()=>setLocBanner(true),1200);}
  };

  // ── Page props ────────────────────────────────────────────────
  const props={user,plans,setPlans,chats,setChats,go:setPage};

  // ── Loading splash ────────────────────────────────────────────
  if(booting) return(
    <div className={dark?"":"light"} style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:24,background:"var(--bg)",position:"relative",overflow:"hidden"}}>
      <div className="bg-orbs"><div className="bg-orb3"/></div>
      <div style={{position:"relative",zIndex:2,display:"flex",flexDirection:"column",alignItems:"center",gap:20}}>
        <div style={{width:68,height:68,borderRadius:22,background:"var(--g5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,boxShadow:"0 8px 40px rgba(56,189,248,.4),0 0 60px rgba(139,92,246,.3)",animation:"glowPulse 2s ease-in-out infinite"}}>🌍</div>
        <div>
          <div style={{fontSize:22,fontWeight:900,letterSpacing:"-.03em",background:"var(--g9)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",textAlign:"center",marginBottom:6,fontFamily:"var(--font-display)"}}>Wandr AI</div>
          <div style={{fontSize:12,color:"var(--t3)",textAlign:"center",letterSpacing:".08em",textTransform:"uppercase"}}>Intelligent Travel OS</div>
        </div>
        <div style={{display:"flex",gap:8}}>{[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:i===0?"#8b5cf6":i===1?"#38bdf8":"#06b6d4",animation:`blink 1.4s ${i*.3}s infinite`,boxShadow:`0 0 8px ${i===0?"#8b5cf6":i===1?"#38bdf8":"#06b6d4"}`}}/>)}</div>
      </div>
    </div>
  );

  // ── Auth gate ─────────────────────────────────────────────────
  if(!user) return <AuthPage onAuth={onAuth}/>;

  // ── Main app shell ────────────────────────────────────────────
  // KEY LAYOUT: shell = fixed 100vh flex container
  // sidebar = fixed-width flex child (doesn't scroll)
  // main = flex:1, overflowY:auto (this is what scrolls)
  return(
    <div className={`shell${dark?"":" light"}`}>
      {/* Animated background orbs */}
      <div className="bg-orbs"><div className="bg-orb3"/></div>
      <Toasts/>

      {/* Mobile backdrop */}
      {mobOpen&&<div onClick={()=>setMobOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:199}}/>}

      <Sidebar page={page} go={p=>{setPage(p);setMobOpen(false);}} user={user} logout={logout} dark={dark} setDark={setDark} open={mobOpen} setOpen={setMobOpen} collapsed={collapsed} setCollapsed={setCollapsed}/>

      <div className="main">
        {/* Offline bar */}
        {offline&&<div style={{background:"rgba(245,158,11,.05)",borderBottom:"1px solid rgba(245,158,11,.15)",padding:"4px 20px",display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <span style={{width:5,height:5,borderRadius:"50%",background:"var(--amb)",display:"inline-block",animation:"pulse 3s infinite",boxShadow:"0 0 6px var(--amb)"}}/>
          <span style={{fontSize:10,color:"rgba(245,158,11,.55)",fontWeight:600,letterSpacing:".03em",textTransform:"uppercase"}}>Local mode</span>
          {userLocation&&<span style={{marginLeft:"auto",fontSize:11,color:"rgba(245,158,11,.5)"}}>📍 {userLocation.city}</span>}
        </div>}

        {/* Location permission banner */}
        {locBanner&&!offline&&<div className="ain" style={{background:"rgba(34,211,238,.06)",borderBottom:"1px solid rgba(34,211,238,.18)",padding:"10px 22px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <span style={{fontSize:20}}>📍</span>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:700,color:"var(--teal)"}}>Enable Location for Personalised Trips</div>
            <div style={{fontSize:11,color:"var(--t3)"}}>Discover nearby tourist spots & get custom suggestions</div>
          </div>
          <button onClick={askLocation} className="btn btn-p" style={{fontSize:12,padding:"7px 16px"}}>Allow 📍</button>
          <button onClick={()=>setLocBanner(false)} style={{background:"none",border:"none",color:"var(--t3)",fontSize:18,cursor:"pointer",padding:"0 4px"}}>×</button>
        </div>}
        {userLocation&&!locBanner&&<div style={{background:"rgba(16,185,129,.05)",borderBottom:"1px solid rgba(16,185,129,.12)",padding:"5px 22px",display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <span style={{fontSize:12}}>📍</span><span style={{fontSize:11,color:"var(--grn)"}}>Nearby trips based on <strong>{userLocation.city}</strong></span>
          <button onClick={()=>setUserLocation(null)} style={{marginLeft:"auto",background:"none",border:"none",color:"var(--t3)",fontSize:11,cursor:"pointer"}}>✕</button>
        </div>}

        {/* Mobile header */}
        <div className="mob-bar" style={{display:"none",padding:"12px 16px",background:"var(--card)",borderBottom:"1px solid var(--b1)",alignItems:"center",gap:12,flexShrink:0,position:"sticky",top:0,zIndex:90}}>
          <button onClick={()=>setMobOpen(true)} style={{background:"var(--bg3)",border:"1px solid var(--b1)",color:"var(--t1)",width:37,height:37,borderRadius:9,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>☰</button>
          <span style={{fontWeight:900,fontSize:17,background:"var(--g9)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:"-.02em",fontFamily:"var(--font-display)"}}>Wandr AI</span>
          <button onClick={()=>setDark(d=>!d)} style={{marginLeft:"auto",background:"var(--bg3)",border:"1px solid var(--b1)",color:"var(--t1)",width:37,height:37,borderRadius:9,cursor:"pointer",fontSize:17,display:"flex",alignItems:"center",justifyContent:"center"}}>{dark?"☀️":"🌙"}</button>
        </div>

        {/* Page content */}
        {page==="chat"?(
          <div className="chat-wrap">
            <Err key="chat"><ChatPage {...props}/></Err>
          </div>
        ):(
          <div className="page-wrap">
            <Err key={page}><Page id={page} props={props}/></Err>
          </div>
        )}
      </div>
    </div>
  );
}


ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));

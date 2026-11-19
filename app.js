(function(){
  // Self-update: phones (and the home-screen app) keep old copies of the page. When the published
  // version differs from this code's version, reload once with a fresh URL.
  const APP_VERSION = "20261120d";
  async function checkVersion(){
    try{
      const v=(await (await fetch("version.txt?t="+Date.now(),{cache:"no-store"})).text()).trim();
      if(v && v!==APP_VERSION && sessionStorage.getItem("reloadedFor")!==v){
        sessionStorage.setItem("reloadedFor", v);
        const q=new URLSearchParams(location.search); q.set("u", v);
        location.replace(location.pathname+"?"+q.toString()+location.hash);
      }
    }catch(e){}
  }
  checkVersion();
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) checkVersion(); });

  const SUPABASE_URL = "https://xcjbwctlnjybabrfkvcn.supabase.co";
  const SUPABASE_KEY = "sb_publishable_XqMv4nZHVi_xN28fWNX_UQ_QJC8JueZ"; // public publishable key; access is enforced by RLS
  const SITE_URL = location.origin + location.pathname.replace(/index\.html$/, "");
  const COURTS = ["יבנה","רחובות","ראשון לציון","מזכרת בתיה"];
  const OTHER = "אחר"; // any court outside the list; its name is typed in
  const SPORTS = [
    {id:"tennis", name:"טניס", emoji:"🎾", color:"#1f6b45"},
    {id:"padel", name:"פאדל", emoji:"🎾", color:"#1d4f91"},
    {id:"football", name:"כדורגל", emoji:"⚽", color:"#111111"},
    {id:"basketball", name:"כדורסל", emoji:"🏀", color:"#e8590c"},
    {id:"pickleball", name:"פיקלבול", emoji:"🏓", color:"#0f766e"},
    {id:"squash", name:"סקווש", emoji:"🎾", color:"#7f1d3a"},
    {id:"volleyball", name:"כדורעף", emoji:"🏐", color:"#6d28d9"},
  ];
  const sportOf = id => SPORTS.find(x=>x.id===id) || SPORTS[0];
  const ROLE_HE = {owner:"בעל הקבוצה", admin:"מנהל", member:"שחקן"};
  const ERR_HE = {not_admin:"רק מנהל הקבוצה יכול לעשות את זה.", not_owner:"רק בעל הקבוצה יכול לעשות את זה.", is_owner:"אי אפשר לשנות או להסיר את בעל הקבוצה.",
    bad_name:"כתבו שם של 2 עד 40 תווים.", exists:"השם כבר קיים בקבוצה.", not_found:"לא נמצא.", confirm_mismatch:"השם שהוקלד לא תואם.", same:"אתם כבר בעלי הקבוצה.",
    no_account:"לשחקן הזה אין עדיין חשבון. רק מי שנרשם לאפליקציה יכול להיות מנהל.", linked:"השחקן הזה כבר מחובר לחשבון אחר.", wrong_pin:"הקוד שגוי.",
    bad_code:"קישור ההצטרפות לא תקף. בקשו קישור חדש ממנהל הקבוצה.", no_name:"הוסיפו שם מלא בפרופיל שלכם קודם.", bad_sport:"בחרו ענף ספורט.", not_signed_in:"צריך להתחבר קודם."};
  const errText = e => ERR_HE[e] || "משהו השתבש. נסו שוב.";
  const $ = id => document.getElementById(id);
  const store = { get:k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } }, set:(k,v)=>{ try{ if(v==null||v==="") localStorage.removeItem(k); else localStorage.setItem(k,v); }catch(e){} } };
  const esc = t => String(t).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const roleTag = r => '<span class="role-tag '+r+'">'+ROLE_HE[r]+'</span>';
  const say = (id,t,err)=>{ const m=$(id); if(!m) return; m.textContent=t||""; m.className="msg"+(err?" err":""); };

  // state
  let sb=null, user=null, profile=null, groups=[], group=null; // group = {id,name,sport,description,role,status,members}
  let court = COURTS[0], filter = "הכל", rows = [], members = [], players = [], rotation = [], roundStarts = [];
  let allPaid = false, pendingDel = null, ready = false, editingId = null, draft = null, me = "", channel = null;
  let sport = SPORTS[0];
  const myRole = () => group ? group.role : "member";
  const isAdmin = () => !!group && group.status==="active" && (group.role==="owner" || group.role==="admin");
  const roleOf = n => (members.find(m=>m.name===n)||{}).role || "member";

  const todayISO = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
  const dmy = iso => { const [y,m,d]=iso.split("-"); return d+"/"+m+"/"+y.slice(2); };
  const dayName = iso => { const [y,m,d]=iso.split("-"); return new Date(+y,+m-1,+d).toLocaleDateString("he-IL",{weekday:"long"}); };
  const daysFrom = iso => { const [y,m,d]=iso.split("-"); const [ty,tm,td]=todayISO().split("-");
    return Math.round((Date.UTC(ty,tm-1,td)-Date.UTC(y,m-1,d))/864e5); };
  const agoText = iso => { const n=daysFrom(iso);
    if(n===0) return "היום"; if(n===1) return "אתמול"; if(n===-1) return "מחר";
    if(n<0) return "בעוד "+(-n)+" ימים"; return "לפני "+n+" ימים"; };
  const isActive = r => r.status!=="cancelled";
  const byNewest = (a,b)=> b.date.localeCompare(a.date) || String(b.created_at||"").localeCompare(String(a.created_at||""));
  async function rpc(fn, args){ const {data,error} = await sb.rpc(fn, args||{}); if(error) return {ok:false,error:"network"}; return data; }

  $("date").value = todayISO();

  // ---------- screens ----------
  const SCREENS=["authScreen","recoveryScreen","groupsScreen","createScreen","joinScreen","profileScreen","securityScreen"];
  function showScreen(id){
    SCREENS.forEach(s=>{ $(s).hidden = s!==id; });
    $("settingsBtn").hidden = !!id || !user;
    if(id) window.scrollTo(0,0);
  }

  // ---------- theme follows the group's sport ----------
  function applySport(){
    sport = sportOf(group ? group.sport : "tennis");
    document.documentElement.setAttribute("data-sport", sport.id);
    const t = group ? group.name : "MatchPoint";
    $("sportTitle").textContent = group ? group.name+" · "+sport.emoji+" "+sport.name : t;
    $("miniTitle").textContent = t; document.title = group ? group.name+" · MatchPoint" : "MatchPoint";
    const tc=document.querySelector('meta[name="theme-color"]'); if(tc) tc.setAttribute("content", sport.color);
  }

  function makeBtns(el, list, get, set){
    el.innerHTML="";
    list.forEach(c=>{ const b=document.createElement("button"); b.type="button"; b.textContent=c;
      b.setAttribute("aria-pressed", String(get()===c));
      b.onclick=()=>{ set(c); makeBtns(el,list,get,set); render(); }; el.appendChild(b); });
  }
  makeBtns($("courtBtns"), [...COURTS, OTHER], ()=>court, v=>{ court=v; $("otherWrap").hidden = v!==OTHER; if(v===OTHER) setTimeout(()=>$("otherCourt").focus(),0); });
  makeBtns($("filterBtns"), ["הכל",...COURTS,OTHER], ()=>filter, v=>{filter=v;});
  const isOther = c => !COURTS.includes(c);

  function setMsg(t, err){ say("msg", t, err); }

  // ---------- menu ----------
  function openSettings(open){
    $("settings").hidden=!open; $("scrim").hidden=!open; $("settingsBtn").setAttribute("aria-expanded", String(open));
    if(open) $("settingsClose").focus();
  }
  $("settingsBtn").onclick=()=>{ renderMenu(); openSettings(true); };
  $("settingsClose").onclick=()=>openSettings(false);
  $("scrim").onclick=()=>openSettings(false);
  document.addEventListener("keydown",e=>{ if(e.key==="Escape"){ if(!$("settings").hidden) openSettings(false); if(!$("playersModal").hidden) closeManage(); } });
  function renderMenu(){
    $("meName").textContent = (profile && profile.full_name) || "—";
    $("meEmail").textContent = user ? user.email : "";
    $("groupBlock").hidden = !group;
    if(group) $("groupNow").innerHTML = esc(group.name)+" · "+sportOf(group.sport).name+" "+roleTag(group.role);
    $("menuManage").hidden = !isAdmin();
  }
  document.querySelectorAll(".menu button").forEach(b=>b.onclick=()=>{
    const m=b.dataset.menu; openSettings(false);
    if(m==="profile") openProfile();
    else if(m==="groups"||m==="switch") openGroups(true);
    else if(m==="create") openCreate();
    else if(m==="manage") openManage();
    else if(m==="security"){ $("secPass").value=""; $("secPass2").value=""; say("secMsg",""); showScreen("securityScreen"); }
    else if(m==="signout") signOut();
  });

  // ---------- auth ----------
  let authMode="in";
  function setAuthMode(m){
    authMode=m; $("authTabIn").setAttribute("aria-selected", String(m==="in")); $("authTabUp").setAttribute("aria-selected", String(m==="up"));
    $("authNameWrap").hidden = m!=="up"; $("authPassHint").hidden = m!=="up"; $("authForgot").hidden = m!=="in";
    $("authTitle").textContent = m==="up" ? "הרשמה" : "כניסה"; $("authGo").textContent = m==="up" ? "יצירת חשבון" : "כניסה";
    $("authPass").setAttribute("autocomplete", m==="up" ? "new-password" : "current-password"); say("authMsg","");
  }
  $("authTabIn").onclick=()=>setAuthMode("in"); $("authTabUp").onclick=()=>setAuthMode("up");
  $("authForm").addEventListener("submit", async e=>{
    e.preventDefault();
    const email=$("authEmail").value.trim(), pass=$("authPass").value;
    if(!/^\S+@\S+\.\S+$/.test(email)){ say("authMsg","כתבו כתובת אימייל תקינה.",true); return; }
    $("authGo").disabled=true;
    if(authMode==="up"){
      const name=$("authName").value.trim().replace(/\s+/g," ");
      if(name.length<2){ $("authGo").disabled=false; say("authMsg","כתבו שם מלא.",true); return; }
      if(pass.length<8){ $("authGo").disabled=false; say("authMsg","סיסמה צריכה להיות לפחות 8 תווים.",true); return; }
      const {data,error} = await sb.auth.signUp({email, password:pass, options:{data:{full_name:name}, emailRedirectTo: SITE_URL+location.search}});
      $("authGo").disabled=false;
      if(error){ say("authMsg", /registered/i.test(error.message) ? "כבר יש חשבון עם האימייל הזה. היכנסו או אפסו סיסמה." : "ההרשמה נכשלה: "+error.message, true); return; }
      if(!data.session){ say("authMsg","שלחנו לכם מייל לאימות הכתובת. לחצו על הקישור במייל, והחשבון יופעל."); return; }
    } else {
      const {error} = await sb.auth.signInWithPassword({email, password:pass});
      $("authGo").disabled=false;
      if(error){ say("authMsg", /confirm/i.test(error.message) ? "עדיין לא אימתתם את האימייל. בדקו את תיבת הדואר." : "האימייל או הסיסמה שגויים.", true); return; }
    }
  });
  $("authForgot").onclick=async()=>{
    const email=$("authEmail").value.trim();
    if(!/^\S+@\S+\.\S+$/.test(email)){ say("authMsg","כתבו את האימייל שלכם בשדה למעלה, ואז לחצו שוב.",true); return; }
    const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: SITE_URL});
    say("authMsg", error ? "לא הצלחנו לשלוח: "+error.message : "אם יש חשבון עם האימייל הזה, נשלח אליו קישור לאיפוס סיסמה.", !!error);
  };
  $("recGo").onclick=async()=>{
    const p=$("recPass").value; if(p.length<8){ say("recMsg","לפחות 8 תווים.",true); return; }
    const {error} = await sb.auth.updateUser({password:p});
    if(error){ say("recMsg","לא נשמר: "+error.message,true); return; }
    say("recMsg","הסיסמה עודכנה."); setTimeout(()=>afterSignIn(),800);
  };
  $("secGo").onclick=async()=>{
    const p=$("secPass").value, p2=$("secPass2").value;
    if(p.length<8){ say("secMsg","לפחות 8 תווים.",true); return; } if(p!==p2){ say("secMsg","הסיסמאות לא זהות.",true); return; }
    const {error} = await sb.auth.updateUser({password:p});
    say("secMsg", error ? "לא נשמר: "+error.message : "הסיסמה שונתה.", !!error);
  };
  $("securityClose").onclick=()=>showScreen(group?null:"groupsScreen");
  async function signOut(){ await sb.auth.signOut(); }

  // ---------- profile ----------
  async function openProfile(){
    $("pfName").value = (profile&&profile.full_name)||""; $("pfEmail").textContent = user.email; say("pfMsg","");
    const ul=$("pfRoles"); ul.innerHTML="";
    groups.forEach(g=>{ const li=document.createElement("li"); li.innerHTML='<span>'+esc(g.name)+' · '+sportOf(g.sport).name+'</span>'+(g.status==="pending"?'<span class="role-tag">ממתין לאישור</span>':roleTag(g.role)); ul.appendChild(li); });
    if(!groups.length) ul.innerHTML='<li>עדיין לא הצטרפתם לקבוצה.</li>';
    showScreen("profileScreen");
  }
  $("pfSave").onclick=async()=>{
    const n=$("pfName").value.trim().replace(/\s+/g," "); if(n.length<2){ say("pfMsg","כתבו שם מלא.",true); return; }
    const {error} = await sb.from("profiles").update({full_name:n}).eq("id", user.id);
    if(error){ say("pfMsg","לא נשמר.",true); return; } profile.full_name=n; say("pfMsg","נשמר.");
  };
  $("profileClose").onclick=()=>showScreen(group?null:"groupsScreen");

  // ---------- my groups ----------
  async function loadGroups(){
    const {data,error} = await sb.rpc("my_groups"); groups = error ? [] : (data||[]);
    return groups;
  }
  async function openGroups(closable){
    await loadGroups(); renderGroups(); $("groupsClose").hidden = !closable || !group; showScreen("groupsScreen");
  }
  function renderGroups(){
    const ul=$("groupCards"); ul.innerHTML="";
    if(!groups.length) ul.innerHTML='<li style="display:block">עדיין אין לכם קבוצות. צרו קבוצה חדשה, או פתחו קישור הצטרפות שקיבלתם.</li>';
    groups.forEach(g=>{
      const sp=sportOf(g.sport); const li=document.createElement("li"); if(group && g.id===group.id) li.className="current";
      li.innerHTML='<span class="gc-emoji" style="background:'+sp.color+'22">'+sp.emoji+'</span>'
        +'<span><span class="gc-name">'+esc(g.name)+'</span><br><span class="gc-meta">'+sp.name+' · '+g.members+' חברים · '+(g.status==="pending"?"ממתין לאישור מנהל":ROLE_HE[g.role])+'</span></span>';
      const b=document.createElement("button"); b.type="button"; b.className="btn"+(g.status==="pending"?"":" solid");
      b.textContent = g.status==="pending" ? "ממתין" : "כניסה"; b.disabled = g.status==="pending";
      b.onclick=()=>enterGroup(g.id); li.appendChild(b); ul.appendChild(li);
    });
    renderLegacy();
  }
  $("groupsClose").onclick=()=>showScreen(null);
  $("groupsCreate").onclick=()=>openCreate();

  // players from the old system (personal code) can link their new account
  async function renderLegacy(){
    const box=$("legacyBox"); box.innerHTML="";
    const {data} = await sb.rpc("legacy_groups"); if(!data || !data.length) return;
    data.forEach(l=>{
      const d=document.createElement("div"); d.className="legacy";
      d.innerHTML='<strong>היה לכם קוד אישי במערכת הקודמת?</strong><span class="set-note">'+esc(l.player)+' בקבוצת '+esc(l.name)+': הקלידו את הקוד כדי לחבר את החשבון ולשמור את התפקיד וההיסטוריה.</span>'
        +'<div class="join-row"><input type="password" inputmode="numeric" class="pin" maxlength="8" aria-label="הקוד הישן"><button type="button">חבר</button></div>';
      d.querySelector("button").onclick=async()=>{ const pin=d.querySelector("input").value.trim();
        const r=await rpc("group_link_legacy",{p_group:l.id,p_name:l.player,p_pin:pin});
        if(!r.ok){ say("groupsMsg",errText(r.error),true); return; } say("groupsMsg","החשבון חובר ל"+l.player+"."); await loadGroups(); renderGroups(); };
      box.appendChild(d);
    });
  }

  // ---------- create group ----------
  let cgSport="tennis";
  function openCreate(){
    $("cgName").value=""; $("cgDesc").value=""; say("cgMsg","");
    const box=$("cgSports"); box.innerHTML="";
    SPORTS.forEach(sp=>{ const b=document.createElement("button"); b.type="button"; b.setAttribute("aria-pressed", String(sp.id===cgSport));
      b.innerHTML='<span class="sw" style="background:'+sp.color+'"></span><span>'+sp.emoji+' '+sp.name+'</span>';
      b.onclick=()=>{ cgSport=sp.id; box.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed","false")); b.setAttribute("aria-pressed","true"); }; box.appendChild(b); });
    showScreen("createScreen"); setTimeout(()=>$("cgName").focus(),0);
  }
  $("createClose").onclick=()=>openGroups(true);
  $("cgGo").onclick=async()=>{
    const r=await rpc("group_create",{p_name:$("cgName").value, p_sport:cgSport, p_description:$("cgDesc").value});
    if(!r.ok){ say("cgMsg",errText(r.error),true); return; }
    await loadGroups(); enterGroup(r.id);
  };

  // ---------- join with an invite link ----------
  let joinCode = new URLSearchParams(location.search).get("join");
  async function openJoin(){
    const r=await rpc("group_by_code",{p_code:joinCode});
    say("joinMsg","");
    if(!r.ok){ $("joinTitle").textContent="הצטרפות לקבוצה"; $("joinInfo").textContent=errText(r.error); $("joinGo").hidden=true; showScreen("joinScreen"); return; }
    const sp=sportOf(r.sport);
    $("joinTitle").textContent=sp.emoji+" "+r.name;
    if(r.mine==="active"){ joinCode=null; clearJoinParam(); await loadGroups(); enterGroup(r.id); return; }
    $("joinInfo").textContent = r.mine==="pending" ? "הבקשה שלכם להצטרף כבר נשלחה. מנהל הקבוצה צריך לאשר אותה." : "קבוצת "+sp.name+" עם "+r.members+" חברים. שלחו בקשה, ומנהל הקבוצה יאשר אותה.";
    $("joinGo").hidden = r.mine==="pending"; showScreen("joinScreen");
  }
  function clearJoinParam(){ const q=new URLSearchParams(location.search); q.delete("join"); try{ history.replaceState(null,"",location.pathname+(q.toString()?"?"+q:"")); }catch(e){} }
  $("joinGo").onclick=async()=>{
    const r=await rpc("group_join_request",{p_code:joinCode});
    if(!r.ok){ say("joinMsg",errText(r.error),true); return; }
    if(r.status==="active"){ joinCode=null; clearJoinParam(); await loadGroups(); enterGroup(r.id); return; }
    $("joinGo").hidden=true; $("joinInfo").textContent="הבקשה נשלחה. כשמנהל הקבוצה יאשר, הקבוצה תופיע אצלכם ב\"הקבוצות שלי\".";
  };
  $("joinSkip").onclick=()=>{ joinCode=null; clearJoinParam(); openGroups(false); };

  // ---------- enter a group ----------
  async function enterGroup(id){
    const g = groups.find(x=>x.id===id && x.status==="active"); if(!g){ openGroups(false); return; }
    group=g; store.set("group", g.id);
    rows=[]; members=[]; players=[]; rotation=[]; roundStarts=[]; ready=false; editingId=null; draft=null; filter="הכל";
    applySport(); showScreen(null); render(); await load(); subscribe();
  }
  function subscribe(){
    if(channel) sb.removeChannel(channel);
    const f="group_id=eq."+group.id;
    channel = sb.channel("g-"+group.id)
      .on("postgres_changes",{event:"*",schema:"public",table:"bookings",filter:f},()=>load())
      .on("postgres_changes",{event:"*",schema:"public",table:"rounds",filter:f},()=>load())
      .on("postgres_changes",{event:"*",schema:"public",table:"rotation",filter:f},()=>load())
      .on("postgres_changes",{event:"*",schema:"public",table:"group_members",filter:f},()=>refreshGroupAndLoad())
      .subscribe();
  }
  async function refreshGroupAndLoad(){
    await loadGroups(); const g=groups.find(x=>group && x.id===group.id && x.status==="active");
    if(!g){ group=null; store.set("group",""); openGroups(false); say("groupsMsg","כבר אין לכם גישה לקבוצה הזו.",true); return; }
    group=g; applySport(); await load();
  }

  // ---------- group data ----------
  async function load(){
    if(!group) return;
    const gid=group.id;
    const [b,p,r,ro] = await Promise.all([
      sb.from("bookings").select("id,name,date,court,notes,created_at,status").eq("group_id", gid).order("date",{ascending:false}).limit(2000),
      sb.from("group_members").select("name,role,user_id,status").eq("group_id", gid),
      sb.from("rounds").select("started_at").eq("group_id", gid).order("started_at",{ascending:false}).limit(2),
      sb.from("rotation").select("name,sort_order").eq("group_id", gid).order("sort_order")
    ]);
    if(!group || group.id!==gid) return; // switched group while loading
    if(b.error){ setMsg("לא הצלחנו לטעון את ההזמנות. בדקו את החיבור ונסו לרענן.", true); return; }
    rows = b.data || [];
    members = (p.data||[]);
    players = members.filter(m=>m.status==="active").map(m=>m.name);
    me = (members.find(m=>m.user_id===user.id && m.status==="active")||{}).name || "";
    rotation = (ro.data||[]).map(x=>x.name); roundStarts = (r.data||[]).map(x=>Date.parse(x.started_at));
    if(!ready){ ready=true; $("submit").disabled=false; if($("msg").textContent==="מתחבר לרשימה המשותפת…") setMsg(""); }
    render(); updateRoundControls(); if(!$("playersModal").hidden) renderManage();
  }

  function itemEl(r, isFirst){
    const cancelled = !isActive(r);
    const div=document.createElement("div"); div.className="item"+(isFirst&&!cancelled?" first":"")+(cancelled?" cancelled":"");
    const dt=document.createElement("span"); dt.className="date"; dt.textContent=dmy(r.date);
    const who=document.createElement("span"); who.className="who"; who.textContent=r.name;
    if(cancelled){ const c=document.createElement("span"); c.className="tag cancel"; c.textContent="בוטל – ממתין לתאריך חדש"; who.appendChild(c); }
    else if(r.date>todayISO()){ const f=document.createElement("span"); f.className="tag future"; f.textContent="עתידי"; who.appendChild(f); }
    if(r.notes){ const n=document.createElement("span"); n.className="note"; n.textContent=r.notes; who.appendChild(n); }
    const tag=document.createElement("span"); tag.className="tag"; tag.textContent=r.court;
    const acts=document.createElement("span"); acts.className="acts";
    const ed=document.createElement("button"); ed.type="button"; ed.className="del"; ed.textContent="ערוך";
    ed.setAttribute("aria-label","עריכת ההזמנה של "+r.name);
    ed.onclick=()=>{ editingId=r.id; draft={date:r.date, court:r.court, notes:r.notes||"", cancelled:cancelled}; pendingDel=null; render(); setTimeout(()=>{ const e=$("edDate"); if(e) e.focus(); },0); };
    const del=document.createElement("button"); del.type="button"; del.className="del";
    const armed = pendingDel===r.id;
    del.textContent = armed ? "בטוח? מחק" : "מחק"; if(armed) del.classList.add("confirm");
    del.setAttribute("aria-label", armed ? "אישור מחיקת ההזמנה של "+r.name : "מחיקת ההזמנה של "+r.name);
    del.onclick=async()=>{
      if(pendingDel!==r.id){ pendingDel=r.id; render(); setTimeout(()=>{ if(pendingDel===r.id){pendingDel=null;render();} },4000); return; }
      pendingDel=null;
      const {error} = await sb.from("bookings").delete().eq("id", r.id);
      if(error) setMsg("לא הצלחנו למחוק. נסו שוב.", true); else { setMsg("ההזמנה נמחקה"); await load(); }
    };
    acts.append(ed, del);
    div.append(dt, who, tag, acts);
    if(editingId===r.id) div.appendChild(editEl(r));
    return div;
  }

  // inline edit: change date / court / notes, or mark the booking cancelled until a new date is set
  function editEl(r){
    const f=document.createElement("div"); f.className="edit";
    const known = COURTS.includes(draft.court);
    f.innerHTML='<div class="row"><div><label for="edDate">תאריך</label><input type="date" id="edDate"></div>'
      +'<div><label for="edCourt">מגרש</label><select id="edCourt"></select></div></div>'
      +'<div id="edOtherWrap"><label for="edOther">שם המגרש</label><input type="text" id="edOther" maxlength="40"></div>'
      +'<div><label for="edNotes">מתחם / הערות</label><input type="text" id="edNotes" maxlength="80"></div>'
      +'<label class="check"><input type="checkbox" id="edCancel"> ההזמנה בוטלה, צריך לתאם תאריך חדש (הסבב ממתין)</label>'
      +'<div class="share"><button type="button" class="round-yes" id="edSave">שמור</button><button type="button" id="edClose">ביטול</button></div>';
    const sel=f.querySelector("#edCourt");
    [...COURTS, OTHER].forEach(c=>{ const o=document.createElement("option"); o.value=c; o.textContent=c; sel.appendChild(o); });
    sel.value = known ? draft.court : OTHER;
    f.querySelector("#edDate").value=draft.date;
    f.querySelector("#edOther").value = known ? "" : draft.court;
    f.querySelector("#edOtherWrap").hidden = known;
    f.querySelector("#edNotes").value=draft.notes;
    f.querySelector("#edCancel").checked=draft.cancelled;
    f.querySelector("#edDate").oninput=e=>{ draft.date=e.target.value; };
    sel.onchange=e=>{ const o=e.target.value===OTHER; f.querySelector("#edOtherWrap").hidden=!o; draft.court = o ? f.querySelector("#edOther").value.trim() : e.target.value; };
    f.querySelector("#edOther").oninput=e=>{ draft.court=e.target.value.trim(); };
    f.querySelector("#edNotes").oninput=e=>{ draft.notes=e.target.value; };
    f.querySelector("#edCancel").onchange=e=>{ draft.cancelled=e.target.checked; };
    f.querySelector("#edClose").onclick=()=>{ editingId=null; draft=null; render(); };
    f.querySelector("#edSave").onclick=async()=>{
      if(!draft.date){ setMsg("בחרו תאריך", true); return; }
      if(!draft.court){ setMsg("כתבו את שם המגרש", true); return; }
      const btn=f.querySelector("#edSave"); btn.disabled=true;
      const {error} = await sb.from("bookings").update({date:draft.date, court:draft.court, notes:draft.notes.trim(), status: draft.cancelled?"cancelled":"active"}).eq("id", r.id);
      btn.disabled=false;
      if(error){ setMsg("השינוי לא נשמר. נסו שוב.", true); return; }
      const was=draft.cancelled; editingId=null; draft=null;
      setMsg(was ? "ההזמנה של "+r.name+" סומנה כבוטלה. הסבב ממתין לתאריך חדש." : "ההזמנה של "+r.name+" עודכנה.");
      await load();
    };
    f.addEventListener("click", e=>e.stopPropagation());
    return f;
  }

  function render(){
    const sorted = rows.slice().sort(byNewest);
    const active = sorted.filter(isActive);
    const last = active[0];

    const meta=$("lastMeta"); meta.innerHTML="";
    if(last){
      $("lastName").textContent=last.name;
      const p=document.createElement("span"); p.className="pill"; p.textContent=last.court;
      const d=document.createElement("span"); d.textContent=dayName(last.date)+" "+dmy(last.date)+(last.notes?" · "+last.notes:"");
      const a=document.createElement("span"); a.className="ago"; a.textContent="("+agoText(last.date)+")";
      meta.append(p,d,a);
    } else {
      $("lastName").textContent = ready ? "עדיין אין הזמנות" : "טוען…";
      const a=document.createElement("span"); a.className="ago"; a.textContent="רשמו את ההזמנה הראשונה בלשונית \"הזמנה\""; meta.appendChild(a);
    }

    const shown = sorted.filter(r=>filter==="הכל"||(filter===OTHER ? isOther(r.court) : r.court===filter));
    const h=$("history"); h.innerHTML="";
    if(!shown.length) h.innerHTML='<p class="empty">'+(rows.length?"אין הזמנות ב"+filter+".":"ההזמנות של הקבוצה יופיעו כאן, מהחדשה לישנה.")+'</p>';
    shown.forEach((r,i)=>h.appendChild(itemEl(r, i===0)));
    fitHistory();

    // per player: last booking
    const stats={}; active.forEach(r=>{ const p=stats[r.name]; if(!p) stats[r.name]={last:r,t:1}; else p.t++; });
    const names=[...players, ...Object.keys(stats).filter(n=>!players.includes(n))];
    // "who booked" dropdown: the group's players, alphabetical; defaults to me
    const sel=$("name"); let keep=sel.value || me;
    sel.innerHTML='<option value="">בחרו שם…</option>';
    players.slice().sort((a,b)=>a.localeCompare(b,"he")).forEach(n=>{const o=document.createElement("option"); o.value=n; o.textContent=n; sel.appendChild(o);});
    if(players.includes(keep)) sel.value=keep;
    names.sort((a,b)=>{ const A=stats[a], B=stats[b]; if(!A&&!B) return 0; if(!A) return -1; if(!B) return 1; return byNewest(B.last,A.last); });
    const tb=$("sumBody"); tb.innerHTML="";
    if(!names.length) tb.innerHTML='<tr><td colspan="4" class="empty">אין עדיין נתונים</td></tr>';
    names.forEach((n,i)=>{ const p=stats[n], tr=document.createElement("tr");
      const a=document.createElement("td"); a.textContent=n;
      if(i===0 && p && names.length>1){ const s=document.createElement("span"); s.className="long"; s.textContent="הכי מזמן"; a.appendChild(s); }
      const b=document.createElement("td");
      if(p){ b.textContent=dmy(p.last.date); const ago=document.createElement("span"); ago.className="sub"; ago.textContent=agoText(p.last.date); b.appendChild(ago); }
      else b.textContent="עדיין לא הזמין";
      const c=document.createElement("td"); c.textContent= p ? p.last.court : "—";
      const d=document.createElement("td"); d.className="n"; d.textContent= p ? p.t : 0;
      tr.append(a,b,c,d); tb.appendChild(tr); });

    // Rounds are started by an admin. A booking belongs to the round in which it was recorded.
    // Everyone in the rotation (fixed order, joiners appended) is in every round; next = first who hasn't paid.
    const curStart = roundStarts[0] ?? -Infinity;
    const inRound = rows.filter(r=>Date.parse(r.created_at)>=curStart);
    const paidNow = new Set(inRound.filter(isActive).map(r=>r.name));
    const waitingNewDate = new Set(inRound.filter(r=>!isActive(r)).map(r=>r.name).filter(n=>!paidNow.has(n)));
    const paid = rotation.filter(n=>paidNow.has(n));
    const notYet = rotation.filter(n=>!paidNow.has(n));
    const next = notYet[0] || null;
    allPaid = rotation.length>0 && !next;
    renderRound(paid, next, waitingNewDate);
    $("allPaidHint").hidden = !allPaid;
    let txt=sport.emoji+" מי הזמין אחרון\n";
    txt+= last ? last.name+" – "+last.court+(last.notes?" ("+last.notes+")":"")+", "+dmy(last.date)+"\n" : "עדיין אין הזמנות.\n";
    if(paid.length){ txt+="\n✅ שילמו בסבב:\n"; paid.forEach(n=>{ txt+="• "+n+"\n"; }); }
    if(notYet.length){ txt+="\n⏳ טרם שילמו בסבב:\n"; notYet.forEach(n=>{ txt+="• "+n+"\n"; }); }
    txt+= next ? "\nמי מזמין הבא?\n👉 "+next+(waitingNewDate.has(next)?" (ההזמנה בוטלה – מתאמים תאריך חדש)":"") : (rotation.length ? "\n🎉 כולם שילמו בסבב! פותחים סבב חדש." : "\nמי מזמין ראשון? הסבב מתחיל בהזמנה הראשונה.");
    txt+="\n\nלהזמנת מגרש באפליקציית לזוז:\nhttps://lazuz.co.il/app/";
    $("shareText").value=txt.trim();
    $("waLink").href="https://wa.me/?text="+encodeURIComponent(txt.trim());
  }

  // current round: rotation order with each player's status, and who books next
  function renderRound(paid, next, waiting){
    const box=$("nextUp"), list=$("rotation");
    list.innerHTML="";
    if(!rotation.length){ box.textContent= ready ? "עדיין אין סבב בקבוצה. מי שירשום את ההזמנה הראשונה יפתח אותו, וכל מזמין חדש יצטרף לסוף התור." : "טוען…"; box.classList.remove("done"); return; }
    box.innerHTML="";
    if(next){ const l=document.createElement("span"); l.className="next-label"; l.textContent="הבא בתור להזמין"; const n=document.createElement("strong"); n.className="next-name"; n.textContent=next; box.append(l,n);
      if(waiting.has(next)){ const w=document.createElement("span"); w.className="next-label"; w.textContent="ההזמנה בוטלה – מתאמים תאריך חדש"; box.appendChild(w); }
      box.classList.remove("done"); }
    else { box.textContent="🎉 כולם שילמו בסבב. מנהל הקבוצה יכול לפתוח סבב חדש."; box.classList.add("done"); }
    rotation.forEach(n=>{
      const li=document.createElement("li"); const nm=document.createElement("span"); nm.textContent=n;
      const st=document.createElement("span"); st.className="st";
      if(paid.includes(n)){ st.textContent="שילם ✓"; li.className="paid"; }
      else if(n===next){ st.textContent= waiting.has(n) ? "ממתין לתאריך חדש" : "הבא בתור"; li.className="next"; }
      else { st.textContent="ממתין"; }
      if(n===me) li.classList.add("me");
      li.append(nm,st); list.appendChild(li);
    });
  }

  // history box shows 4 rows; the rest scroll inside it
  function fitHistory(){
    const h=$("history"), items=h.querySelectorAll(".item");
    h.style.maxHeight="";
    $("scrollHint").hidden = items.length<=4;
    if(items.length>4){ const top=h.getBoundingClientRect().top; const b=items[3].getBoundingClientRect().bottom; if(b>top) h.style.maxHeight=Math.ceil(b-top+3)+"px"; }
  }
  window.addEventListener("resize", fitHistory);
  function copyFrom(input, btn, label){
    const done=()=>{ btn.textContent="הועתק ✓"; setTimeout(()=>btn.textContent=label,2000); };
    try{ navigator.clipboard.writeText(input.value).then(done,()=>{ input.select(); }); }catch(e){ input.select(); }
  }
  $("copyBtn").onclick=()=>copyFrom($("shareText"), $("copyBtn"), "העתק טקסט");

  // ---------- tabs (phones) ----------
  const TABS=["round","add","history","share"];
  let tab = TABS.includes(store.get("tab")) ? store.get("tab") : "round";
  function setTab(t, keepScroll){
    tab=t; store.set("tab", t);
    document.querySelectorAll(".wrap [data-tab]").forEach(el=>el.classList.toggle("on", el.dataset.tab.split(" ").includes(t)));
    document.querySelectorAll("#tabbar button").forEach(b=>{ if(b.dataset.go===t) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current"); });
    if(!keepScroll) window.scrollTo(0,0);
    if(t==="history") fitHistory();
  }
  document.querySelectorAll("#tabbar button").forEach(b=>b.onclick=()=>setTab(b.dataset.go));
  $("goShare").onclick=()=>setTab("share");
  setTab(tab, true);

  // ---------- new round (admins) ----------
  function updateRoundControls(){
    const a=isAdmin();
    $("newRoundBtn").hidden = !a || !$("newRoundConfirm").hidden;
    $("roundAdminNote").hidden = a;
  }
  $("newRoundBtn").onclick=()=>{ $("newRoundConfirm").hidden=false; $("newRoundBtn").hidden=true; $("roundMsg").textContent=""; };
  $("newRoundCancel").onclick=()=>{ $("newRoundConfirm").hidden=true; updateRoundControls(); };
  $("newRoundYes").onclick=async()=>{
    $("newRoundYes").disabled=true;
    const r=await rpc("group_start_round",{p_group:group.id});
    $("newRoundYes").disabled=false; $("newRoundConfirm").hidden=true; updateRoundControls();
    if(!r.ok){ $("roundMsg").textContent=errText(r.error); return; }
    await load();
    $("roundMsg").textContent="סבב חדש התחיל. ההודעה לוואטסאפ עודכנה, שלחו אותה לקבוצה.";
    $("shareText").scrollIntoView({behavior:"smooth", block:"center"});
  };

  // ---------- booking ----------
  $("form").addEventListener("submit", async e=>{
    e.preventDefault();
    const name=$("name").value.trim(), date=$("date").value, notes=$("notes").value.trim();
    if(!name){ setMsg("בחרו מי הזמין", true); $("name").focus(); return; }
    if(!date){ setMsg("בחרו תאריך", true); $("date").focus(); return; }
    const courtName = court===OTHER ? $("otherCourt").value.trim() : court;
    if(!courtName){ setMsg("כתבו את שם המגרש", true); $("otherCourt").focus(); return; }
    if(!group) return;
    $("submit").disabled=true;
    const {error} = await sb.from("bookings").insert({group_id:group.id, name, date, court: courtName, notes});
    if(error) setMsg("ההזמנה לא נשמרה. נסו שוב.", true);
    else {
      $("notes").value=""; setMsg("נרשם: "+name+" · "+courtName+" · "+dmy(date));
      await load(); setTab("round");
    }
    $("submit").disabled=false;
  });

  // ---------- manage group (owner / admins) ----------
  const pmsg = (t,err)=>say("pmMsg",t,err);
  async function openManage(){
    if(!isAdmin()) return;
    $("playersModal").hidden=false; $("modalScrim").hidden=false; pmsg(""); $("roleDialog").hidden=true;
    $("gsName").value=group.name; $("gsDesc").value=group.description||"";
    const r=await rpc("group_invite_code",{p_group:group.id,p_renew:false});
    $("inviteLink").value = r.ok ? SITE_URL+"?join="+r.code : "";
    renderManage(); loadAudit(); $("pmClose").focus();
  }
  function closeManage(){ $("playersModal").hidden=true; $("modalScrim").hidden=true; }
  $("pmClose").onclick=closeManage; $("modalScrim").onclick=closeManage;
  $("inviteCopy").onclick=()=>copyFrom($("inviteLink"), $("inviteCopy"), "העתק");
  $("inviteRenew").onclick=()=>confirmBox("ליצור קישור הצטרפות חדש? הקישור הישן יפסיק לעבוד.", "כן, צור חדש", async()=>{
    const r=await rpc("group_invite_code",{p_group:group.id,p_renew:true});
    if(r.ok){ $("inviteLink").value=SITE_URL+"?join="+r.code; $("roleDialog").hidden=true; pmsg("נוצר קישור חדש. עדכנו את הקישור הנעוץ בוואטסאפ."); loadAudit(); } else pmsg(errText(r.error),true); });
  $("gsSave").onclick=async()=>{ const r=await rpc("group_update",{p_group:group.id,p_name:$("gsName").value,p_description:$("gsDesc").value});
    if(!r.ok){ pmsg(errText(r.error),true); return; } pmsg("הגדרות הקבוצה נשמרו."); await refreshGroupAndLoad(); };
  const ORDER={owner:0,admin:1,member:2};
  function renderManage(){
    if(!isAdmin()){ closeManage(); return; }
    // join requests
    const reqs=members.filter(m=>m.status==="pending");
    $("requestsBlock").hidden=!reqs.length;
    const rl=$("requestsList"); rl.innerHTML="";
    const unlinked = members.filter(m=>m.status==="active" && !m.user_id).map(m=>m.name).sort((a,b)=>a.localeCompare(b,"he"));
    reqs.forEach(m=>{
      const li=document.createElement("li");
      li.innerHTML='<span class="nm">'+esc(m.name)+'</span>'
        +(unlinked.length?'<select aria-label="לחבר לשחקן קיים"><option value="">שחקן חדש</option>'+unlinked.map(n=>'<option>'+esc(n)+'</option>').join("")+'</select>':'');
      const ok=document.createElement("button"); ok.type="button"; ok.textContent="אשר";
      ok.onclick=async()=>{ const link=li.querySelector("select")?li.querySelector("select").value:"";
        const r=await rpc("group_approve",{p_group:group.id,p_user:m.user_id,p_link_name:link||null}); afterAction(r, link? m.name+" אושר וחובר ל"+link+"." : m.name+" אושר והצטרף לקבוצה."); };
      const no=document.createElement("button"); no.type="button"; no.className="rm"; no.textContent="דחה";
      no.onclick=()=>confirmBox("לדחות את הבקשה של "+m.name+"?", "כן, דחה", async()=>{ const r=await rpc("group_reject",{p_group:group.id,p_user:m.user_id}); afterAction(r, "הבקשה נדחתה."); });
      li.append(ok,no); rl.appendChild(li);
    });
    // members
    const ul=$("pmList"); ul.innerHTML="";
    members.filter(m=>m.status==="active").sort((a,b)=>ORDER[a.role]-ORDER[b.role]||a.name.localeCompare(b.name,"he")).forEach(m=>{
      const li=document.createElement("li");
      li.innerHTML='<span class="nm">'+esc(m.name)+'<span class="reg-state">'+(m.user_id?" · יש חשבון ✓":" · בלי חשבון")+'</span></span>'+roleTag(m.role);
      const mine = m.user_id===user.id;
      if(!mine && (m.role!=="owner")){
        const b=document.createElement("button"); b.type="button"; b.textContent="ניהול הרשאות"; b.onclick=()=>openRole(m); li.appendChild(b);
        const rm=document.createElement("button"); rm.type="button"; rm.className="rm"; rm.textContent="הסר";
        rm.onclick=()=>confirmBox("להסיר את "+m.name+" מהקבוצה? ההזמנות שלו נשארות בהיסטוריה.", "כן, הסר", async()=>{
          const r=await rpc("group_remove_member",{p_group:group.id,p_name:m.name}); afterAction(r, m.name+" הוסר מהקבוצה."); });
        li.appendChild(rm);
      }
      ul.appendChild(li);
    });
    if(myRole()!=="owner"){
      const li=document.createElement("li"); const lv=document.createElement("button"); lv.type="button"; lv.className="rm"; lv.textContent="עזיבת הקבוצה";
      lv.onclick=()=>confirmBox("לעזוב את הקבוצה? ההזמנות שלך נשארות בהיסטוריה.", "כן, עזוב", async()=>{ const r=await rpc("group_leave",{p_group:group.id}); if(r.ok){ closeManage(); group=null; store.set("group",""); openGroups(false); } else pmsg(errText(r.error),true); });
      li.appendChild(lv); ul.appendChild(li);
    }
  }
  $("pmAdd").onclick=async()=>{ const n=$("pmAddName").value.trim(); if(!n) return;
    const r=await rpc("group_add_member",{p_group:group.id,p_name:n}); if(r.ok) $("pmAddName").value=""; afterAction(r, n+" נוסף לקבוצה."); };
  $("pmAddName").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); $("pmAdd").click(); } });
  async function afterAction(r, okText){
    if(!r.ok){ pmsg(errText(r.error),true); return; }
    $("roleDialog").hidden=true; pmsg(okText); await refreshGroupAndLoad(); loadAudit();
  }
  function confirmBox(text, yes, onYes){
    const d=$("roleDialog"); d.hidden=false;
    d.innerHTML='<h3>אישור</h3><p class="set-note" style="font-size:.95rem;color:var(--fg)">'+esc(text)+'</p><div class="share"><button type="button" class="btn solid" id="cfYes">'+esc(yes)+'</button><button type="button" class="btn" id="cfNo">ביטול</button></div>';
    $("cfNo").onclick=()=>{ d.hidden=true; }; $("cfYes").onclick=async()=>{ $("cfYes").disabled=true; await onYes(); };
    d.scrollIntoView({block:"nearest"});
  }
  function openRole(m){
    const d=$("roleDialog"); d.hidden=false;
    let html='<h3>הרשאות: '+esc(m.name)+' '+roleTag(m.role)+'</h3>'
      +'<div class="role-opts"><label><input type="radio" name="rl" value="admin"'+(m.role==="admin"?" checked":"")+(m.user_id?"":" disabled")+'> מנהל: מנהל שחקנים, בקשות, הרשאות וסבבים</label>'
      +'<label><input type="radio" name="rl" value="member"'+(m.role==="member"?" checked":"")+'> שחקן רגיל</label></div>'
      +(m.user_id?'':'<p class="set-note">ל'+esc(m.name)+' אין חשבון, ולכן אי אפשר למנות אותו למנהל. כשיירשם ויצטרף מהקישור, אשרו את הבקשה וחברו אותה לשם שלו.</p>')
      +'<div class="share"><button type="button" class="btn solid" id="rlSave">שמור</button><button type="button" class="btn" id="rlCancel">ביטול</button></div>';
    if(myRole()==="owner" && m.user_id){
      html+='<details><summary>העברת בעלות ל-'+esc(m.name)+'</summary><div class="admin-row" style="margin-top:8px"><p class="set-note">אחרי ההעברה '+esc(m.name)+' יהיה בעל הקבוצה, ואתם תהיו מנהלים.</p>'
        +'<label for="trConfirm">לאישור, הקלידו את השם: '+esc(m.name)+'</label><input type="text" id="trConfirm">'
        +'<button type="button" class="btn danger" id="trGo">העבר בעלות</button></div></details>';
    }
    d.innerHTML=html; d.scrollIntoView({block:"nearest"});
    $("rlCancel").onclick=()=>{ d.hidden=true; };
    $("rlSave").onclick=()=>{ const v=d.querySelector('input[name="rl"]:checked').value; if(v===m.role){ d.hidden=true; return; }
      confirmBox(v==="admin" ? "להעניק ל"+m.name+" הרשאת מנהל?" : "לבטל ל"+m.name+" את הרשאת המנהל ולהחזיר אותו לשחקן רגיל?", "כן, אשר", async()=>{
        const r=await rpc("group_set_role",{p_group:group.id,p_name:m.name,p_role:v});
        afterAction(r, v==="admin" ? m.name+" מונה למנהל." : m.name+" חזר להיות שחקן."); }); };
    if($("trGo")) $("trGo").onclick=()=>{ const c=$("trConfirm").value.trim();
      confirmBox("להעביר את הבעלות על "+group.name+" ל"+m.name+"? זו פעולה סופית.", "כן, העבר בעלות", async()=>{
        const r=await rpc("group_transfer_owner",{p_group:group.id,p_name:m.name,p_confirm:c}); afterAction(r, "הבעלות הועברה ל"+m.name+"."); }); };
  }
  const ACTION_HE={create_group:"יצר את הקבוצה",join_request:"ביקש להצטרף",approve:"אישר הצטרפות",approve_link:"אישר וחיבר חשבון",reject:"דחה בקשה",
    add_member:"הוסיף שחקן",remove_member:"הסיר שחקן",make_admin:"מינה למנהל",make_member:"ביטל הרשאת מנהל",transfer_owner:"העביר בעלות",
    new_round:"פתח סבב חדש",update_group:"עדכן את הקבוצה",new_invite:"יצר קישור הצטרפות חדש",leave:"עזב",link_legacy:"חיבר חשבון",
    set_owner:"הוגדר כבעלים",claim:"פתח את הקבוצה",set_pin:"עדכן קוד",register:"נרשם",unregister:"התנתק",reset_registration:"איפס הרשמה"};
  async function loadAudit(){
    const {data} = await sb.from("audit_log").select("actor,action,target,at").eq("group_id", group.id).order("at",{ascending:false}).limit(40);
    const ul=$("auditList"); ul.innerHTML="";
    (data||[]).forEach(a=>{ const li=document.createElement("li"); const d=new Date(a.at);
      li.textContent=d.toLocaleDateString("he-IL")+" "+d.toLocaleTimeString("he-IL",{hour:"2-digit",minute:"2-digit"})+" · "+a.actor+" "+(ACTION_HE[a.action]||a.action)+(a.target&&a.target!==a.actor?": "+a.target:""); ul.appendChild(li); });
    if(!ul.children.length) ul.innerHTML="<li>אין עדיין שינויים.</li>";
  }

  // ---------- boot ----------
  async function afterSignIn(){
    const {data} = await sb.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    profile = data || {full_name: (user.user_metadata||{}).full_name || ""};
    await loadGroups();
    if(joinCode){ openJoin(); return; }
    const saved = store.get("group");
    const actives = groups.filter(g=>g.status==="active");
    const pick = actives.find(g=>g.id===saved) || (actives.length===1 ? actives[0] : null);
    if(pick) enterGroup(pick.id); else openGroups(false);
  }
  function signedOutUI(){
    user=null; profile=null; groups=[]; group=null; if(channel){ sb.removeChannel(channel); channel=null; }
    applySport(); setAuthMode(joinCode ? "up" : "in");
    if(joinCode) say("authMsg","כדי להצטרף לקבוצה, צרו חשבון או היכנסו.");
    showScreen("authScreen");
  }

  applySport(); render();
  if(!window.supabase){ setMsg("לא הצלחנו להתחבר. בדקו את החיבור לאינטרנט ורעננו.", true); return; }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}});
  let booted=false;
  sb.auth.onAuthStateChange((event, session)=>{
    if(event==="PASSWORD_RECOVERY"){ user=session.user; $("recPass").value=""; say("recMsg",""); showScreen("recoveryScreen"); return; }
    if(event==="SIGNED_OUT"){ booted=false; signedOutUI(); return; }
    if(session && session.user && (!booted || (user && user.id!==session.user.id))){ booted=true; user=session.user; setTimeout(afterSignIn,0); }
    else if(session && session.user){ user=session.user; }
    else if(!session && !booted){ signedOutUI(); }
  });
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden && group) load(); });
})();

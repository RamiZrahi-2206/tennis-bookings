(function(){
  // Self-update: phones (and the home-screen app) keep old copies of the page. When the published
  // version differs from this code's version, reload once with a fresh URL.
  const APP_VERSION = "20261119e";
  async function checkVersion(){
    try{
      const v=(await (await fetch("version.txt?t="+Date.now(),{cache:"no-store"})).text()).trim();
      if(v && v!==APP_VERSION && sessionStorage.getItem("reloadedFor")!==v){
        sessionStorage.setItem("reloadedFor", v);
        location.replace(location.pathname+"?u="+encodeURIComponent(v));
      }
    }catch(e){}
  }
  checkVersion();
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) checkVersion(); });
  const SUPABASE_URL = "https://xcjbwctlnjybabrfkvcn.supabase.co";
  const SUPABASE_KEY = "sb_publishable_XqMv4nZHVi_xN28fWNX_UQ_QJC8JueZ"; // public publishable key, protected by RLS
  const COURTS = ["יבנה","רחובות","ראשון לציון","מזכרת בתיה"];
  const OTHER = "אחר"; // any court outside the three; its name is typed in
  const $ = id => document.getElementById(id);

  // ---- settings: who I am + sport theme (saved on this device only) ----
  const SPORTS = [
    {id:"tennis", name:"טניס", emoji:"🎾", color:"#1f6b45"},
    {id:"padel", name:"פאדל", emoji:"🎾", color:"#1d4f91"},
    {id:"football", name:"כדורגל", emoji:"⚽", color:"#166534"},
    {id:"basketball", name:"כדורסל", emoji:"🏀", color:"#b4531c"},
    {id:"pickleball", name:"פיקלבול", emoji:"🏓", color:"#0f766e"},
    {id:"squash", name:"סקווש", emoji:"🎾", color:"#7f1d3a"},
    {id:"volleyball", name:"כדורעף", emoji:"🏐", color:"#9a5b0b"},
  ];
  const store = { get:k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } }, set:(k,v)=>{ try{ localStorage.setItem(k,v); }catch(e){} } };
  const linkSport = new URLSearchParams(location.search).get("sport");
  if(SPORTS.some(x=>x.id===linkSport)) store.set("sport", linkSport);
  let sport = SPORTS.find(x=>x.id===store.get("sport")) || SPORTS[0];
  let me = ""; // the registered member on this device, for the current group
  function applySport(){
    document.documentElement.setAttribute("data-sport", sport.id);
    const t="הזמנות מגרשי "+sport.name;
    $("sportTitle").textContent=t; document.title=t;
    const tc=document.querySelector('meta[name="theme-color"]'); if(tc) tc.setAttribute("content", sport.color);
    const box=$("sportBtns"); box.innerHTML="";
    SPORTS.forEach(sp=>{ const b=document.createElement("button"); b.type="button"; b.setAttribute("aria-pressed", String(sp.id===sport.id));
      const sw=document.createElement("span"); sw.className="sw"; sw.style.background=sp.color;
      const l=document.createElement("span"); l.textContent=sp.emoji+" "+sp.name;
      b.append(sw,l); b.onclick=()=>switchSport(sp); box.appendChild(b); });
  }
  function switchSport(sp){
    if(sport.id===sp.id) return; sport=sp; store.set("sport", sp.id);
    editingId=null; draft=null; rows=[]; members=[]; players=[]; rotation=[]; roundStarts=[]; ready=false;
    loadAuth(); loadReg(); $("regScreen").hidden=true; applySport(); render(); if(sb) load();
  }
  function openSettings(open){
    $("settings").hidden=!open; $("scrim").hidden=!open; $("settingsBtn").setAttribute("aria-expanded", String(open));
    if(open) $("settingsClose").focus(); else $("settingsBtn").focus();
  }
  $("settingsBtn").onclick=()=>openSettings(true);
  $("settingsClose").onclick=()=>openSettings(false);
  $("scrim").onclick=()=>openSettings(false);
  document.addEventListener("keydown",e=>{ if(e.key==="Escape" && !$("settings").hidden) openSettings(false); });
  applySport();
  let court = COURTS[0], filter = "הכל", rows = [], players = [], members = [], rotation = [], roundStarts = [], allPaid = false, sb = null, pendingDel = null, ready = false, editingId = null, draft = null;

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

  $("date").value = todayISO();

  function makeBtns(el, list, get, set){
    el.innerHTML="";
    list.forEach(c=>{ const b=document.createElement("button"); b.type="button"; b.textContent=c;
      b.setAttribute("aria-pressed", String(get()===c));
      b.onclick=()=>{ set(c); makeBtns(el,list,get,set); render(); }; el.appendChild(b); });
  }
  makeBtns($("courtBtns"), [...COURTS, OTHER], ()=>court, v=>{ court=v; $("otherWrap").hidden = v!==OTHER; if(v===OTHER) setTimeout(()=>$("otherCourt").focus(),0); });
  makeBtns($("filterBtns"), ["הכל",...COURTS,OTHER], ()=>filter, v=>{filter=v;});
  const isOther = c => !COURTS.includes(c);

  function setMsg(t, err){ const m=$("msg"); m.textContent=t; m.className="msg"+(err?" err":""); }

  async function load(){
    const loadedFor = sport.id;
    const [b,p,r,ro] = await Promise.all([
      sb.from("bookings").select("id,name,date,court,notes,created_at,status").eq("sport", sport.id).order("date",{ascending:false}).limit(2000),
      sb.from("group_members").select("name,role,registered_at").eq("sport", sport.id),
      sb.from("rounds").select("started_at").eq("sport", sport.id).order("started_at",{ascending:false}).limit(2),
      sb.from("rotation").select("name,sort_order").eq("sport", sport.id).order("sort_order")
    ]);
    if(loadedFor!==sport.id) return; // the sport changed while loading
    if(b.error){ setMsg("לא הצלחנו לטעון את ההזמנות. בדקו את החיבור ונסו לרענן.", true); return; }
    rows = b.data || []; members = p.data||[]; loadReg(); players = members.map(x=>x.name); rotation = (ro.data||[]).map(x=>x.name); roundStarts = (r.data||[]).map(x=>Date.parse(x.started_at));
    if(!ready){ ready=true; $("submit").disabled=false; if($("msg").textContent==="מתחבר לרשימה המשותפת…") setMsg(""); }
    render(); renderAdmin(); if(!$("playersModal").hidden) renderPlayers(); checkRegistration();
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
      const a=document.createElement("span"); a.className="ago"; a.textContent="רשמו את ההזמנה הראשונה בטופס למטה"; meta.appendChild(a);
    }

    const shown = sorted.filter(r=>filter==="הכל"||(filter===OTHER ? isOther(r.court) : r.court===filter));
    const h=$("history"); h.innerHTML="";
    if(!shown.length) h.innerHTML='<p class="empty">'+(rows.length?"אין הזמנות ב"+filter+".":"ההזמנות של הקבוצה יופיעו כאן, מהחדשה לישנה.")+'</p>';
    shown.forEach((r,i)=>h.appendChild(itemEl(r, i===0)));
    fitHistory();

    // per player: last booking — the group's players first, plus anyone else who booked
    const stats={}; active.forEach(r=>{ const p=stats[r.name]; if(!p) stats[r.name]={last:r,t:1}; else p.t++; });
    const names=[...players, ...Object.keys(stats).filter(n=>!players.includes(n))];
    // "who booked" dropdown: the group's players, alphabetical
    const sel=$("name"); let keep=sel.value;
    if(!keep) keep=me;
    sel.innerHTML='<option value="">בחרו שם…</option>';
    players.slice().sort((a,b)=>a.localeCompare(b,"he")).forEach(n=>{const o=document.createElement("option"); o.value=n; o.textContent=n; sel.appendChild(o);});
    if(players.includes(keep)) sel.value=keep;
    // never booked first, then whoever booked longest ago
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

    // Rounds are started explicitly ("סבב חדש"). A booking belongs to the round in which it was recorded.
    // Every player in the rotation (fixed order, joiners appended at the end) is in every round.
    // The next to book is the first player in rotation order who has not paid in this round.
    const curStart = roundStarts[0] ?? -Infinity;
    const inRound = rows.filter(r=>Date.parse(r.created_at)>=curStart);
    const paidNow = new Set(inRound.filter(isActive).map(r=>r.name));
    // a player whose booking was cancelled is not paid: the round waits on them until a new date is set
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
    $("sportLink").value = location.origin+location.pathname.replace(/index\.html$/,"")+"?sport="+sport.id;
    $("shareText").value=txt.trim();
    $("waLink").href="https://wa.me/?text="+encodeURIComponent(txt.trim());
  }

  // current round: rotation order with each player's status, and who books next
  function renderRound(paid, next, waiting){
    const box=$("nextUp"), list=$("rotation");
    list.innerHTML="";
    if(!rotation.length){ box.textContent= ready ? "עדיין אין סבב ב"+sport.name+". מי שירשום את ההזמנה הראשונה יפתח אותו, וכל מזמין חדש יצטרף לסוף התור." : "טוען…"; box.classList.remove("done"); return; }
    box.innerHTML="";
    if(next){ const l=document.createElement("span"); l.className="next-label"; l.textContent="הבא בתור להזמין"; const n=document.createElement("strong"); n.className="next-name"; n.textContent=next; box.append(l,n);
      if(waiting.has(next)){ const w=document.createElement("span"); w.className="next-label"; w.textContent="ההזמנה בוטלה – מתאמים תאריך חדש"; box.appendChild(w); } box.classList.remove("done"); }
    else { box.textContent="🎉 כולם שילמו בסבב. לחצו על \"סבב חדש\" כדי להתחיל מחדש."; box.classList.add("done"); }
    rotation.forEach(n=>{
      const li=document.createElement("li"); const nm=document.createElement("span"); nm.textContent=n;
      const st=document.createElement("span"); st.className="st";
      if(paid.includes(n)){ st.textContent="שילם ✓"; li.className="paid"; }
      else if(n===next){ st.textContent= waiting.has(n) ? "ממתין לתאריך חדש" : "הבא בתור"; li.className="next"; }
      else { st.textContent="ממתין"; }
      if(n===me) li.classList.add("me");
      const rl=roleOf(n); if(rl!=="member"){ const t=document.createElement("span"); t.className="role-tag "+rl; t.textContent=ROLE_HE[rl]; nm.append(" ", t); }
      li.append(nm,st); list.appendChild(li);
    });
  }

  // history box shows 4 rows; the rest scroll inside it
  function fitHistory(){
    const h=$("history"), items=h.querySelectorAll(".item");
    h.style.maxHeight="";
    $("scrollHint").hidden = items.length<=4;
    if(items.length>4){ const top=h.getBoundingClientRect().top; h.style.maxHeight=Math.ceil(items[3].getBoundingClientRect().bottom-top+3)+"px"; }
  }
  window.addEventListener("resize", fitHistory);
  $("copyLink").onclick=()=>{
    const i=$("sportLink"), b=$("copyLink");
    const done=()=>{ b.textContent="הועתק ✓"; setTimeout(()=>b.textContent="העתק",2000); };
    try{ navigator.clipboard.writeText(i.value).then(done,()=>{ i.select(); }); }catch(e){ i.select(); }
  };
  $("copyBtn").onclick=()=>{
    const ta=$("shareText");
    const done=()=>{ $("copyBtn").textContent="הועתק ✓"; setTimeout(()=>$("copyBtn").textContent="העתק טקסט",2000); };
    try{ navigator.clipboard.writeText(ta.value).then(done,()=>{ta.select();}); }catch(e){ ta.select(); }
  };

  // start a new round: everyone who paid in the round that just ended moves to "not yet paid"
  $("newRoundBtn").onclick=()=>{ $("newRoundConfirm").hidden=false; $("newRoundBtn").hidden=true; $("roundMsg").textContent=""; };
  $("newRoundCancel").onclick=()=>{ $("newRoundConfirm").hidden=true; $("newRoundBtn").hidden=false; };
  $("newRoundYes").onclick=async()=>{
    if(!sb) return;
    $("newRoundYes").disabled=true;
    if(!auth){ $("newRoundYes").disabled=false; $("newRoundConfirm").hidden=true; updateRoundControls(); return; }
    const r = await rpc("group_start_round",{p_sport:sport.id,p_actor:auth.name,p_pin:auth.pin});
    $("newRoundYes").disabled=false;
    $("newRoundConfirm").hidden=true; updateRoundControls();
    if(!r.ok){ if(r.error==="wrong_pin"||r.error==="locked"||r.error==="not_admin"){ saveAuth(null); renderAdmin(); }
      $("roundMsg").textContent=errText(r.error)+(r.error==="network"?"":" רק מנהל יכול לפתוח סבב חדש."); return; }
    await load();
    $("roundMsg").textContent="סבב חדש התחיל. ההודעה לוואטסאפ עודכנה, שלחו אותה לקבוצה.";
    $("shareText").scrollIntoView({behavior:"smooth", block:"center"});
  };

  $("form").addEventListener("submit", async e=>{
    e.preventDefault();
    const name=$("name").value.trim(), date=$("date").value, notes=$("notes").value.trim();
    if(!name){ setMsg("בחרו מי הזמין", true); $("name").focus(); return; }
    if(!date){ setMsg("בחרו תאריך", true); $("date").focus(); return; }
    const courtName = court===OTHER ? $("otherCourt").value.trim() : court;
    if(!courtName){ setMsg("כתבו את שם המגרש", true); $("otherCourt").focus(); return; }
    if(!sb) return;
    $("submit").disabled=true;
    const {error} = await sb.from("bookings").insert({name, date, court: courtName, notes, sport: sport.id});
    if(error) setMsg("ההזמנה לא נשמרה. נסו שוב.", true);
    else {
      $("notes").value=""; setMsg("נרשם: "+name+" · "+courtName+" · "+dmy(date));
      await load();
    }
    $("submit").disabled=false;
  });


  // ---- group roles: owner / admin / member. Every change is checked on the server with the caller's code. ----
  const ROLE_HE = {owner:"בעל הקבוצה", admin:"מנהל", member:"שחקן"};
  const ERR_HE = {wrong_pin:"הקוד שגוי.", locked:"יותר מדי ניסיונות. נסו שוב בעוד 15 דקות.", needs_pin:"עדיין לא הוגדר לך קוד.", not_admin:"רק מנהל יכול לעשות את זה.",
    not_owner:"רק בעל הקבוצה יכול לעשות את זה.", is_owner:"אי אפשר לשנות או להסיר את בעל הקבוצה.", bad_pin:"קוד צריך להיות 4 עד 8 ספרות.", bad_name:"כתבו שם מלא (2-40 תווים).",
    exists:"השחקן כבר בקבוצה.", not_found:"השחקן לא נמצא בקבוצה.", has_owner:"לקבוצה כבר יש בעלים.", confirm_mismatch:"השם שהוקלד לא תואם.", same:"אתם כבר בעלי הקבוצה."};
  const errText = e => ERR_HE[e] || "משהו השתבש. נסו שוב.";
  const roleOf = n => (members.find(m=>m.name===n)||{}).role || "member";
  const authKey = () => "auth:"+sport.id;
  let auth = null; // {name, pin, role}
  function loadAuth(){ try{ auth = JSON.parse(store.get(authKey())||"null"); }catch(e){ auth=null; } }
  function saveAuth(a){ auth=a; store.set(authKey(), a?JSON.stringify(a):""); }
  loadAuth();
  const roleTag = r => '<span class="role-tag '+r+'">'+ROLE_HE[r]+'</span>';
  const esc = t => String(t).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const amsg = (t,err)=>{ const m=$("adminMsg"); m.textContent=t||""; m.className="msg"+(err?" err":""); };
  const pmsg = (t,err)=>{ const m=$("pmMsg"); m.textContent=t||""; m.className="msg"+(err?" err":""); };
  async function rpc(fn, args){ const {data,error} = await sb.rpc(fn, args); if(error) return {ok:false,error:"network"}; return data; }

  function updateRoundControls(){
    const isAdmin = !!auth && auth.role!=="member";
    $("newRoundBtn").hidden = !isAdmin || !$("newRoundConfirm").hidden;
    $("roundAdminNote").hidden = isAdmin;
  }
  function renderAdmin(){
    updateRoundControls();
    // my role, next to "my name"
    $("meName").textContent = me || "עדיין לא נרשמתם";
    const mr=$("myRole"); if(me){ mr.hidden=false; mr.innerHTML="התפקיד שלי בקבוצה: "+roleTag(roleOf(me)); } else mr.hidden=true;
    $("regOut").hidden = !me;
    if(auth && auth.name!==me) saveAuth(null); // admin sign-in belongs to the registered member only
    if(auth && !members.some(m=>m.name===auth.name && m.role!=="member")) saveAuth(null); // lost admin rights
    if(auth){ const r=roleOf(auth.name); if(r!==auth.role) saveAuth({...auth, role:r}); }
    const body=$("adminBody"); const hasOwner = members.some(m=>m.role==="owner");
    if(!ready){ body.innerHTML=""; return; }
    if(!hasOwner){
      body.innerHTML='<div class="admin-row"><p class="set-note">לקבוצת '+esc(sport.name)+' אין עדיין בעלים. מי שפותח אותה הופך לבעל הקבוצה ויכול לנהל שחקנים ומנהלים.</p>'
        +'<label for="clName">השם שלכם</label><input type="text" id="clName" maxlength="40" value="'+esc(me||"")+'">'
        +'<label for="clPin">בחרו קוד אישי (4-8 ספרות)</label><input type="password" inputmode="numeric" id="clPin" class="pin" maxlength="8" autocomplete="new-password">'
        +'<button type="button" class="btn solid" id="clGo">פתח את הקבוצה כבעלים</button></div>';
      $("clGo").onclick=async()=>{ const n=$("clName").value.trim(), pin=$("clPin").value.trim();
        const r=await rpc("group_claim",{p_sport:sport.id,p_name:n,p_pin:pin}); if(!r.ok){ amsg(errText(r.error),true); return; }
        saveReg({name:r.name, token:r.token}); saveAuth({name:r.name,pin,role:"owner"}); amsg("הקבוצה נפתחה. אתם בעלי הקבוצה."); await load(); };
      return;
    }
    if(auth){
      body.innerHTML='<div class="admin-row"><p class="set-note">מחוברים כ-'+esc(auth.name)+' '+roleTag(auth.role)+'</p>'
        +'<div class="share"><button type="button" class="btn solid" id="openPlayers">ניהול שחקנים</button><button type="button" class="btn" id="chPinBtn">שינוי קוד</button><button type="button" class="btn" id="signOut">יציאה</button></div>'
        +'<div id="chPinWrap" hidden class="admin-row"><label for="chPinNew">קוד חדש (4-8 ספרות)</label><input type="password" inputmode="numeric" id="chPinNew" class="pin" maxlength="8" autocomplete="new-password"><button type="button" class="btn solid" id="chPinGo">שמור קוד</button></div></div>';
      $("openPlayers").onclick=openPlayers;
      $("signOut").onclick=()=>{ saveAuth(null); amsg("יצאתם מחשבון המנהל."); renderAdmin(); };
      $("chPinBtn").onclick=()=>{ $("chPinWrap").hidden=!$("chPinWrap").hidden; };
      $("chPinGo").onclick=async()=>{ const np=$("chPinNew").value.trim(); const r=await rpc("group_set_pin",{p_sport:sport.id,p_name:auth.name,p_old:auth.pin,p_new:np});
        if(!r.ok){ amsg(errText(r.error),true); return; } saveAuth({...auth,pin:np}); amsg("הקוד עודכן."); renderAdmin(); };
      return;
    }
    if(!me){ body.innerHTML='<p class="set-note">הירשמו קודם, ואז מנהלים יוכלו להיכנס עם הקוד.</p>'; return; }
    if(roleOf(me)==="member"){ body.innerHTML='<p class="set-note">אין לך הרשאות ניהול בקבוצה הזו. מנהל יכול למנות אותך מ"ניהול שחקנים".</p>'; return; }
    body.innerHTML='<div class="admin-row"><p class="set-note">כניסת מנהל: '+esc(me)+' '+roleTag(roleOf(me))+'</p>'
      +'<label for="siPin">קוד אישי</label><input type="password" inputmode="numeric" id="siPin" class="pin" maxlength="8" autocomplete="current-password">'
      +'<button type="button" class="btn solid" id="siGo">כניסת מנהל</button>'
      +'<div id="firstPin" hidden class="admin-row"><p class="set-note">עדיין לא הוגדר לך קוד. בחרו קוד אישי חדש:</p><input type="password" inputmode="numeric" id="fpPin" class="pin" maxlength="8" autocomplete="new-password" aria-label="קוד חדש"><button type="button" class="btn solid" id="fpGo">הגדר קוד והיכנס</button></div></div>';
    $("siGo").onclick=async()=>{ const pin=$("siPin").value.trim();
      const r=await rpc("group_signin",{p_sport:sport.id,p_name:me,p_pin:pin});
      if(!r.ok){ if(r.error==="needs_pin"){ $("firstPin").hidden=false; amsg(""); return; } amsg(errText(r.error),true); return; }
      saveAuth({name:me,pin,role:r.role}); amsg("נכנסתם כ"+ROLE_HE[r.role]+"."); render(); renderAdmin(); };
    $("fpGo").onclick=async()=>{ const np=$("fpPin").value.trim();
      const r=await rpc("group_set_pin",{p_sport:sport.id,p_name:me,p_old:null,p_new:np}); if(!r.ok){ amsg(errText(r.error),true); return; }
      saveAuth({name:me,pin:np,role:r.role}); amsg("הקוד נשמר ונכנסתם."); renderAdmin(); };
  }

  // ---- registration: each member registers once per device; the name then comes from the registration ----
  const regKey = () => "reg:"+sport.id;
  let reg = null, regChecked = "";
  function loadReg(){ try{ reg = JSON.parse(store.get(regKey())||"null"); }catch(e){ reg=null; } me = reg ? reg.name : ""; }
  function saveReg(x){ reg=x; store.set(regKey(), x?JSON.stringify(x):""); me = x ? x.name : ""; regChecked = x ? sport.id : ""; }
  const rmsg = (t,err)=>{ const m=$("regMsg"); m.textContent=t||""; m.className="msg"+(err?" err":""); };
  async function checkRegistration(){
    if(!ready) return;
    if(reg && regChecked!==sport.id){
      regChecked=sport.id;
      const r=await rpc("group_whoami",{p_sport:sport.id,p_name:reg.name,p_token:reg.token});
      if(!r.ok && r.error==="not_registered"){ saveReg(null); saveAuth(null); showReg("ההרשמה במכשיר הזה בוטלה. הירשמו שוב."); render(); renderAdmin(); return; }
    }
    if(!reg) showReg(); else $("regScreen").hidden=true;
  }
  function showReg(note){
    const hasOwner = members.some(m=>m.role==="owner");
    $("regTitle").textContent = "ברוכים הבאים לקבוצת "+sport.name;
    $("regJoin").hidden = !hasOwner; $("regClaim").hidden = hasOwner;
    $("regSport").value = sport.id;
    rmsg(note||""); $("regScreen").hidden=false;
  }
  $("regGo").onclick=async()=>{ const n=$("regName").value.trim(); if(n.length<2){ rmsg("כתבו את השם המלא שלכם.",true); return; }
    $("regGo").disabled=true; const r=await rpc("group_register",{p_sport:sport.id,p_name:n}); $("regGo").disabled=false;
    if(!r.ok){ rmsg(r.error==="not_member" ? "השם \""+n+"\" לא נמצא ברשימת הקבוצה. בדקו את האיות, או בקשו ממנהל הקבוצה להוסיף אתכם."
      : r.error==="taken" ? "השם הזה כבר רשום במכשיר אחר. אם זה אתם, בקשו ממנהל לאפס את ההרשמה." : errText(r.error), true); return; }
    saveReg({name:r.name, token:r.token}); $("regScreen").hidden=true; $("name").value=r.name; setMsg("נרשמתם בהצלחה, "+r.name+"."); render(); renderAdmin(); };
  $("regName").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); $("regGo").click(); } });
  $("regClaimGo").onclick=async()=>{ const n=$("regClaimName").value.trim(), pin=$("regClaimPin").value.trim();
    const r=await rpc("group_claim",{p_sport:sport.id,p_name:n,p_pin:pin}); if(!r.ok){ rmsg(errText(r.error),true); return; }
    saveReg({name:r.name, token:r.token}); saveAuth({name:r.name,pin,role:"owner"}); $("regScreen").hidden=true; await load(); };
  $("regSport").onchange=e=>{ const sp=SPORTS.find(x=>x.id===e.target.value); if(sp && sp.id!==sport.id) switchSport(sp); };
  $("regOut").onclick=()=>{ $("regOutConfirm").hidden=false; $("regOut").hidden=true; };
  $("regOutNo").onclick=()=>{ $("regOutConfirm").hidden=true; $("regOut").hidden=false; };
  $("regOutYes").onclick=async()=>{ if(reg) await rpc("group_unregister",{p_sport:sport.id,p_name:reg.name,p_token:reg.token});
    saveReg(null); saveAuth(null); $("regOutConfirm").hidden=true; openSettings(false); render(); renderAdmin(); showReg("התנתקתם מהמכשיר הזה."); };

  // "manage players" window
  function openPlayers(){ if(!$("settings").hidden) openSettings(false); $("playersModal").hidden=false; $("modalScrim").hidden=false; pmsg(""); $("roleDialog").hidden=true; renderPlayers(); loadAudit(); $("pmClose").focus(); }
  function closePlayers(){ $("playersModal").hidden=true; $("modalScrim").hidden=true; }
  $("pmClose").onclick=closePlayers; $("modalScrim").onclick=closePlayers;
  document.addEventListener("keydown",e=>{ if(e.key==="Escape" && !$("playersModal").hidden) closePlayers(); });
  const ORDER={owner:0,admin:1,member:2};
  function renderPlayers(){
    if(!auth){ closePlayers(); return; }
    const ul=$("pmList"); ul.innerHTML="";
    members.slice().sort((a,b)=>ORDER[a.role]-ORDER[b.role]||a.name.localeCompare(b.name,"he")).forEach(m=>{
      const li=document.createElement("li");
      li.innerHTML='<span class="nm">'+esc(m.name)+'<span class="reg-state">'+(m.registered_at?" · רשום ✓":" · טרם נרשם")+'</span></span>'+roleTag(m.role);
      const canManage = m.role!=="owner" || false;
      if(m.name!==auth.name && (canManage || auth.role==="owner")){
        const b=document.createElement("button"); b.type="button"; b.textContent="ניהול הרשאות"; b.onclick=()=>openRole(m); li.appendChild(b);
      }
      if(m.registered_at && m.name!==auth.name && (m.role!=="owner" || auth.role==="owner")){
        const rs=document.createElement("button"); rs.type="button"; rs.className="rm"; rs.textContent="אפס הרשמה";
        rs.onclick=()=>confirmBox("לאפס את ההרשמה של "+m.name+"? הוא יצטרך להירשם מחדש במכשיר שלו.", "כן, אפס", async()=>{
          const r=await rpc("group_reset_registration",{p_sport:sport.id,p_actor:auth.name,p_pin:auth.pin,p_target:m.name}); afterAction(r, "ההרשמה של "+m.name+" אופסה."); });
        li.appendChild(rs);
      }
      if(m.role!=="owner" && m.name!==auth.name){
        const rm=document.createElement("button"); rm.type="button"; rm.className="rm"; rm.textContent="הסר";
        rm.onclick=()=>confirmBox("להסיר את "+m.name+" מהקבוצה? ההזמנות שלו נשארות בהיסטוריה.", "כן, הסר", async()=>{
          const r=await rpc("group_remove_member",{p_sport:sport.id,p_actor:auth.name,p_pin:auth.pin,p_target:m.name}); afterAction(r, m.name+" הוסר מהקבוצה."); });
        li.appendChild(rm);
      }
      ul.appendChild(li);
    });
  }
  $("pmAdd").onclick=async()=>{ const n=$("pmAddName").value.trim(); if(!n) return;
    const r=await rpc("group_add_member",{p_sport:sport.id,p_actor:auth.name,p_pin:auth.pin,p_name:n}); if(r.ok) $("pmAddName").value=""; afterAction(r, n+" נוסף לקבוצה."); };
  $("pmAddName").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); $("pmAdd").click(); } });
  async function afterAction(r, okText){
    if(!r.ok){ if(r.error==="wrong_pin"||r.error==="locked"||r.error==="not_admin"){ saveAuth(null); closePlayers(); renderAdmin(); amsg(errText(r.error)+" היכנסו שוב.",true); return; }
      pmsg(errText(r.error),true); return; }
    $("roleDialog").hidden=true; pmsg(okText); await load(); loadAudit();
  }
  function confirmBox(text, yes, onYes){
    const d=$("roleDialog"); d.hidden=false;
    d.innerHTML='<h3>אישור</h3><p class="set-note" style="font-size:.95rem;color:var(--fg)">'+esc(text)+'</p><div class="share"><button type="button" class="btn solid" id="cfYes">'+esc(yes)+'</button><button type="button" class="btn" id="cfNo">ביטול</button></div>';
    $("cfNo").onclick=()=>{ d.hidden=true; }; $("cfYes").onclick=async()=>{ $("cfYes").disabled=true; await onYes(); };
    d.scrollIntoView({block:"nearest"});
  }
  function openRole(m){
    const d=$("roleDialog"); d.hidden=false;
    const isOwnerActor = auth.role==="owner";
    let html='<h3>הרשאות: '+esc(m.name)+' '+roleTag(m.role)+'</h3>';
    if(m.role!=="owner"){
      html+='<div class="role-opts"><label><input type="radio" name="rl" value="admin"'+(m.role==="admin"?" checked":"")+'> מנהל: מנהל שחקנים והרשאות</label>'
        +'<label><input type="radio" name="rl" value="member"'+(m.role==="member"?" checked":"")+'> שחקן רגיל</label></div>'
        +'<div id="newAdminPin" hidden class="admin-row"><label for="napPin">קוד ראשון למנהל החדש (4-8 ספרות). מסרו לו אותו, והוא יוכל לשנות אותו.</label><input type="text" inputmode="numeric" id="napPin" class="pin" maxlength="8"></div>'
        +'<div class="share"><button type="button" class="btn solid" id="rlSave">שמור</button><button type="button" class="btn" id="rlCancel">ביטול</button></div>';
    }
    if(isOwnerActor){
      html+='<details><summary>העברת בעלות ל-'+esc(m.name)+'</summary><div class="admin-row" style="margin-top:8px"><p class="set-note">אחרי ההעברה '+esc(m.name)+' יהיה בעל הקבוצה, ואתם תהיו מנהלים. אי אפשר לבטל את זה בלי שהבעלים החדש יחזיר את הבעלות.</p>'
        +'<label for="trConfirm">לאישור, הקלידו את השם: '+esc(m.name)+'</label><input type="text" id="trConfirm">'
        +(m.role==="member"?'<label for="trPin">קוד ראשון לבעלים החדש (4-8 ספרות)</label><input type="text" inputmode="numeric" id="trPin" class="pin" maxlength="8">':'')
        +'<button type="button" class="btn danger" id="trGo">העבר בעלות</button></div></details>';
    }
    d.innerHTML=html; d.scrollIntoView({block:"nearest"});
    if(m.role!=="owner"){
      const sync=()=>{ const v=d.querySelector('input[name="rl"]:checked').value; $("newAdminPin").hidden = !(v==="admin" && m.role!=="admin"); };
      d.querySelectorAll('input[name="rl"]').forEach(i=>i.onchange=sync); sync();
      $("rlCancel").onclick=()=>{ d.hidden=true; };
      $("rlSave").onclick=()=>{ const v=d.querySelector('input[name="rl"]:checked').value; if(v===m.role){ d.hidden=true; return; }
        const pinNew = v==="admin" ? $("napPin").value.trim() : null;
        if(v==="admin" && !/^[0-9]{4,8}$/.test(pinNew)){ pmsg(errText("bad_pin"),true); return; }
        confirmBox(v==="admin" ? "להעניק ל"+m.name+" הרשאת מנהל?" : "לבטל ל"+m.name+" את הרשאת המנהל ולהחזיר אותו לשחקן רגיל?", "כן, אשר", async()=>{
          const r=await rpc("group_set_role",{p_sport:sport.id,p_actor:auth.name,p_pin:auth.pin,p_target:m.name,p_role:v,p_target_pin:pinNew});
          afterAction(r, v==="admin" ? m.name+" מונה למנהל." : m.name+" חזר להיות שחקן."); }); };
    }
    if(isOwnerActor) $("trGo").onclick=()=>{ const c=$("trConfirm").value.trim(), tp=$("trPin")?$("trPin").value.trim():null;
      confirmBox("להעביר את הבעלות על קבוצת "+sport.name+" ל"+m.name+"? זו פעולה סופית.", "כן, העבר בעלות", async()=>{
        const r=await rpc("group_transfer_owner",{p_sport:sport.id,p_actor:auth.name,p_pin:auth.pin,p_target:m.name,p_confirm:c,p_target_pin:tp});
        if(r.ok) saveAuth({...auth, role:"admin"}); afterAction(r, "הבעלות הועברה ל"+m.name+"."); }); };
  }
  const ACTION_HE={set_owner:"הוגדר כבעלים",claim:"פתח את הקבוצה",set_pin:"עדכן קוד",add_member:"הוסיף שחקן",remove_member:"הסיר שחקן",make_admin:"מינה למנהל",make_member:"ביטל הרשאת מנהל",transfer_owner:"העביר בעלות",new_round:"פתח סבב חדש",register:"נרשם",unregister:"התנתק מהמכשיר",reset_registration:"איפס הרשמה"};
  async function loadAudit(){
    const {data} = await sb.from("audit_log").select("actor,action,target,at").eq("sport", sport.id).order("at",{ascending:false}).limit(40);
    const ul=$("auditList"); ul.innerHTML="";
    (data||[]).forEach(a=>{ const li=document.createElement("li"); const d=new Date(a.at);
      li.textContent=d.toLocaleDateString("he-IL")+" "+d.toLocaleTimeString("he-IL",{hour:"2-digit",minute:"2-digit"})+" · "+a.actor+" "+(ACTION_HE[a.action]||a.action)+(a.target&&a.target!==a.actor?": "+a.target:""); ul.appendChild(li); });
    if(!ul.children.length) ul.innerHTML="<li>אין עדיין שינויים.</li>";
  }

  render();
  if(!window.supabase){ setMsg("לא הצלחנו להתחבר. בדקו את החיבור לאינטרנט ורעננו.", true); return; }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  load();
  sb.channel("bookings-live").on("postgres_changes",{event:"*",schema:"public",table:"bookings"},()=>load()).on("postgres_changes",{event:"INSERT",schema:"public",table:"rounds"},()=>load()).on("postgres_changes",{event:"*",schema:"public",table:"rotation"},()=>load()).on("postgres_changes",{event:"*",schema:"public",table:"group_members"},()=>load()).subscribe();
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) load(); });
})();

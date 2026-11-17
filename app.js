(function(){
  // Self-update: phones (and the home-screen app) keep old copies of the page. When the published
  // version differs from this code's version, reload once with a fresh URL.
  const APP_VERSION = "20261117a";
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
  let court = COURTS[0], filter = "הכל", rows = [], players = [], rotation = [], roundStarts = [], allPaid = false, sb = null, pendingDel = null, ready = false, editingId = null, draft = null;

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
    const [b,p,r] = await Promise.all([
      sb.from("bookings").select("id,name,date,court,notes,created_at,status").order("date",{ascending:false}).limit(2000),
      sb.from("players").select("name,sort_order").order("sort_order"),
      sb.from("rounds").select("started_at").order("started_at",{ascending:false}).limit(2)
    ]);
    if(b.error){ setMsg("לא הצלחנו לטעון את ההזמנות. בדקו את החיבור ונסו לרענן.", true); return; }
    rows = b.data || []; players = (p.data||[]).map(x=>x.name); rotation = (p.data||[]).filter(x=>x.sort_order>0).sort((a,b)=>a.sort_order-b.sort_order).map(x=>x.name); roundStarts = (r.data||[]).map(x=>Date.parse(x.started_at));
    if(!ready){ ready=true; $("submit").disabled=false; if($("msg").textContent==="מתחבר לרשימה המשותפת…") setMsg(""); }
    render();
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
    if(!keep){ try{ keep=localStorage.getItem("tennis-name")||""; }catch(e){} }
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
    let txt="🎾 מי הזמין אחרון\n";
    txt+= last ? last.name+" – "+last.court+(last.notes?" ("+last.notes+")":"")+", "+dmy(last.date)+"\n" : "עדיין אין הזמנות.\n";
    if(paid.length){ txt+="\n✅ שילמו בסבב:\n"; paid.forEach(n=>{ txt+="• "+n+"\n"; }); }
    if(notYet.length){ txt+="\n⏳ טרם שילמו בסבב:\n"; notYet.forEach(n=>{ txt+="• "+n+"\n"; }); }
    txt+= next ? "\nמי מזמין הבא?\n👉 "+next+(waitingNewDate.has(next)?" (ההזמנה בוטלה – מתאמים תאריך חדש)":"") : "\n🎉 כולם שילמו בסבב! פותחים סבב חדש.";
    txt+="\n\nלהזמנת מגרש באפליקציית לזוז:\nhttps://lazuz.co.il/app/";
    $("shareText").value=txt.trim();
    $("waLink").href="https://wa.me/?text="+encodeURIComponent(txt.trim());
  }

  // current round: rotation order with each player's status, and who books next
  function renderRound(paid, next, waiting){
    const box=$("nextUp"), list=$("rotation");
    list.innerHTML="";
    if(!rotation.length){ box.textContent= ready ? "עדיין אין שחקנים בסבב." : "טוען…"; return; }
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
    const {error} = await sb.from("rounds").insert({started_at:new Date().toISOString()});
    $("newRoundYes").disabled=false;
    $("newRoundConfirm").hidden=true; $("newRoundBtn").hidden=false;
    if(error){ $("roundMsg").textContent="לא הצלחנו להתחיל סבב חדש. נסו שוב."; return; }
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
    const {error} = await sb.from("bookings").insert({name, date, court: courtName, notes});
    if(error) setMsg("ההזמנה לא נשמרה. נסו שוב.", true);
    else {
      try{ localStorage.setItem("tennis-name", name); }catch(_){}
      $("notes").value=""; setMsg("נרשם: "+name+" · "+courtName+" · "+dmy(date));
      await load();
    }
    $("submit").disabled=false;
  });

  render();
  if(!window.supabase){ setMsg("לא הצלחנו להתחבר. בדקו את החיבור לאינטרנט ורעננו.", true); return; }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  load();
  sb.channel("bookings-live").on("postgres_changes",{event:"*",schema:"public",table:"bookings"},()=>load()).on("postgres_changes",{event:"INSERT",schema:"public",table:"rounds"},()=>load()).subscribe();
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) load(); });
})();

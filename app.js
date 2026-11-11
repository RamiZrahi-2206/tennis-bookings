(function(){
  const SUPABASE_URL = "https://xcjbwctlnjybabrfkvcn.supabase.co";
  const SUPABASE_KEY = "sb_publishable_XqMv4nZHVi_xN28fWNX_UQ_QJC8JueZ"; // public publishable key, protected by RLS
  const COURTS = ["יבנה","רחובות","ראשון לציון"];
  const $ = id => document.getElementById(id);
  let court = COURTS[0], filter = "הכל", rows = [], players = [], sb = null, pendingDel = null, showAll = false, ready = false;
  const PAGE = 15;

  const todayISO = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
  const dmy = iso => { const [y,m,d]=iso.split("-"); return d+"/"+m+"/"+y.slice(2); };
  const dayName = iso => { const [y,m,d]=iso.split("-"); return new Date(+y,+m-1,+d).toLocaleDateString("he-IL",{weekday:"long"}); };
  const daysFrom = iso => { const [y,m,d]=iso.split("-"); const [ty,tm,td]=todayISO().split("-");
    return Math.round((Date.UTC(ty,tm-1,td)-Date.UTC(y,m-1,d))/864e5); };
  const agoText = iso => { const n=daysFrom(iso);
    if(n===0) return "היום"; if(n===1) return "אתמול"; if(n===-1) return "מחר";
    if(n<0) return "בעוד "+(-n)+" ימים"; return "לפני "+n+" ימים"; };
  const byNewest = (a,b)=> b.date.localeCompare(a.date) || String(b.created_at||"").localeCompare(String(a.created_at||""));

  $("date").value = todayISO();
  try{ const n=localStorage.getItem("tennis-name"); if(n) $("name").value=n; }catch(e){}

  function makeBtns(el, list, get, set){
    el.innerHTML="";
    list.forEach(c=>{ const b=document.createElement("button"); b.type="button"; b.textContent=c;
      b.setAttribute("aria-pressed", String(get()===c));
      b.onclick=()=>{ set(c); makeBtns(el,list,get,set); render(); }; el.appendChild(b); });
  }
  makeBtns($("courtBtns"), COURTS, ()=>court, v=>court=v);
  makeBtns($("filterBtns"), ["הכל",...COURTS], ()=>filter, v=>{filter=v; showAll=false;});

  function setMsg(t, err){ const m=$("msg"); m.textContent=t; m.className="msg"+(err?" err":""); }

  async function load(){
    const [b,p] = await Promise.all([
      sb.from("bookings").select("id,name,date,court,notes,created_at").order("date",{ascending:false}).limit(2000),
      sb.from("players").select("name,sort_order").order("sort_order")
    ]);
    if(b.error){ setMsg("לא הצלחנו לטעון את ההזמנות. בדקו את החיבור ונסו לרענן.", true); return; }
    rows = b.data || []; players = (p.data||[]).map(x=>x.name);
    if(!ready){ ready=true; $("submit").disabled=false; if($("msg").textContent==="מתחבר לרשימה המשותפת…") setMsg(""); }
    render();
  }

  function itemEl(r, isFirst){
    const div=document.createElement("div"); div.className="item"+(isFirst?" first":"");
    const dt=document.createElement("span"); dt.className="date"; dt.textContent=dmy(r.date);
    const who=document.createElement("span"); who.className="who"; who.textContent=r.name;
    if(r.date>todayISO()){ const f=document.createElement("span"); f.className="tag future"; f.textContent="עתידי"; who.appendChild(f); }
    if(r.notes){ const n=document.createElement("span"); n.className="note"; n.textContent=r.notes; who.appendChild(n); }
    const tag=document.createElement("span"); tag.className="tag"; tag.textContent=r.court;
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
    div.append(dt, who, tag, del);
    return div;
  }

  function render(){
    const sorted = rows.slice().sort(byNewest);
    const last = sorted[0];

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

    const shown = sorted.filter(r=>filter==="הכל"||r.court===filter);
    const h=$("history"); h.innerHTML="";
    if(!shown.length) h.innerHTML='<p class="empty">'+(rows.length?"אין הזמנות ב"+filter+".":"ההזמנות של הקבוצה יופיעו כאן, מהחדשה לישנה.")+'</p>';
    (showAll?shown:shown.slice(0,PAGE)).forEach((r,i)=>h.appendChild(itemEl(r, i===0)));
    $("moreBtn").hidden = showAll || shown.length<=PAGE;
    $("moreBtn").textContent = "הצג את כל "+shown.length+" ההזמנות";

    // per player: last booking — the group's players first, plus anyone else who booked
    const stats={}; sorted.forEach(r=>{ const p=stats[r.name]; if(!p) stats[r.name]={last:r,t:1}; else p.t++; });
    const names=[...players, ...Object.keys(stats).filter(n=>!players.includes(n))];
    $("names").innerHTML=""; names.forEach(n=>{const o=document.createElement("option"); o.value=n; $("names").appendChild(o);});
    // never booked first, then whoever booked longest ago
    names.sort((a,b)=>{ const A=stats[a], B=stats[b]; if(!A&&!B) return 0; if(!A) return -1; if(!B) return 1; return byNewest(B.last,A.last); });
    const tb=$("sumBody"); tb.innerHTML="";
    if(!names.length) tb.innerHTML='<tr><td colspan="4" class="empty">אין עדיין נתונים</td></tr>';
    names.forEach((n,i)=>{ const p=stats[n], tr=document.createElement("tr");
      const a=document.createElement("td"); a.textContent=n;
      if(i===0 && p && names.length>1){ const s=document.createElement("span"); s.className="long"; s.textContent="הכי מזמן"; a.appendChild(s); }
      const b=document.createElement("td"); b.textContent= p ? dmy(p.last.date)+" · "+agoText(p.last.date) : "עדיין לא הזמין";
      const c=document.createElement("td"); c.textContent= p ? p.last.court : "—";
      const d=document.createElement("td"); d.className="n"; d.textContent= p ? p.t : 0;
      tr.append(a,b,c,d); tb.appendChild(tr); });

    let txt="🎾 מי הזמין אחרון\n";
    if(!last) txt+="\nעדיין אין הזמנות.";
    else {
      txt+="\n"+last.name+" – "+last.court+(last.notes?" ("+last.notes+")":"")+", "+dmy(last.date)+"\n\nלפי מגרש:\n";
      COURTS.forEach(c=>{ const r=sorted.find(x=>x.court===c); txt+="• "+c+": "+(r? r.name+" – "+dmy(r.date) : "אין הזמנות")+"\n"; });
    }
    txt+="\n"+location.href.split("#")[0];
    $("shareText").value=txt.trim();
    $("waLink").href="https://wa.me/?text="+encodeURIComponent(txt.trim());
  }

  $("moreBtn").onclick=()=>{ showAll=true; render(); };
  $("copyBtn").onclick=()=>{
    const ta=$("shareText");
    const done=()=>{ $("copyBtn").textContent="הועתק ✓"; setTimeout(()=>$("copyBtn").textContent="העתק טקסט",2000); };
    try{ navigator.clipboard.writeText(ta.value).then(done,()=>{ta.select();}); }catch(e){ ta.select(); }
  };

  $("form").addEventListener("submit", async e=>{
    e.preventDefault();
    const name=$("name").value.trim(), date=$("date").value, notes=$("notes").value.trim();
    if(!name){ setMsg("כתבו מי הזמין", true); $("name").focus(); return; }
    if(!date){ setMsg("בחרו תאריך", true); $("date").focus(); return; }
    if(!sb) return;
    $("submit").disabled=true;
    const {error} = await sb.from("bookings").insert({name, date, court, notes});
    if(error) setMsg("ההזמנה לא נשמרה. נסו שוב.", true);
    else {
      try{ localStorage.setItem("tennis-name", name); }catch(_){}
      $("notes").value=""; setMsg("נרשם: "+name+" · "+court+" · "+dmy(date));
      await load();
    }
    $("submit").disabled=false;
  });

  render();
  if(!window.supabase){ setMsg("לא הצלחנו להתחבר. בדקו את החיבור לאינטרנט ורעננו.", true); return; }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  load();
  sb.channel("bookings-live").on("postgres_changes",{event:"*",schema:"public",table:"bookings"},()=>load()).subscribe();
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) load(); });
})();

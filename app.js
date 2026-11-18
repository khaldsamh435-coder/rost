(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const authView = $("#authView"), appView = $("#appView"), area = $("#contentArea");
  let db = null, currentUser = null, profile = null, activePage = "home", cachedItems = [];

  const labels = { announcement:"إعلان", lesson:"حصة", assignment:"واجب", assessment:"تقييم / امتحان" };
  const navItems = [
    ["home","⌂","الرئيسية"],["announcements","▤","الأخبار والإعلانات"],
    ["lessons","▣","الحصص"],["assignments","✓","الواجبات"],
    ["assessments","✎","التقييمات والامتحانات"],["profile","♙","ملفي الشخصي"]
  ];
  const isStaff = () => profile && ["teacher","admin"].includes(profile.role);
  const isAdmin = () => profile?.role === "admin";

  function toast(message, bad=false) {
    const el=$("#toast"); el.textContent=message; el.style.background=bad?"#ffe0e5":"#e7f9c7";
    el.style.color=bad?"#6f1425":"#1a2b0b"; el.classList.add("show");
    setTimeout(()=>el.classList.remove("show"),3500);
  }
  function escapeHTML(v="") {
    return String(v).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function dateText(v) {
    if(!v) return "غير محدد";
    return new Date(v).toLocaleString("ar-EG",{dateStyle:"medium",timeStyle:"short"});
  }
  function showAuth(tab="login") {
    authView.classList.remove("hidden"); appView.classList.add("hidden");
    $$("[data-auth-tab]").forEach(b=>b.classList.toggle("active",b.dataset.authTab===tab));
    $("#loginForm").classList.toggle("hidden",tab!=="login");
    $("#registerForm").classList.toggle("hidden",tab!=="register");
  }
  function showApp() {
    authView.classList.add("hidden"); appView.classList.remove("hidden");
    $("#sideName").textContent=profile.full_name; $("#sideRole").textContent=roleName(profile.role);
    $("#avatarLetter").textContent=(profile.full_name||"ط")[0];
    $("#welcomeName").textContent=`أهلًا، ${profile.full_name}`;
    $("#welcomeMeta").textContent=profile.role==="student" ? `طالب • ${profile.grade||"لم يحدد الصف"}` : roleName(profile.role);
    $("#todayLabel").textContent=new Date().toLocaleDateString("ar-EG",{dateStyle:"full"});
    renderNav(); loadPage("home");
  }
  function roleName(role){return ({student:"طالب",teacher:"مدرس",admin:"مدير النظام"})[role]||"مستخدم";}
  function renderNav(){
    const items = isStaff()? [...navItems,["manage","＋","إدارة المحتوى"]]:navItems;
    if(isAdmin()) items.push(["admin","⚙","الإدارة"]);
    $("#navigation").innerHTML=items.map(([id,icon,label])=>`<button class="nav-btn ${activePage===id?"active":""}" data-page="${id}">${icon}　${label}</button>`).join("");
    $$("#navigation [data-page]").forEach(b=>b.addEventListener("click",()=>loadPage(b.dataset.page)));
  }
  async function loadItems(){
    let q=db.from("content_items").select("id,title,body,kind,grade,subject,due_at,pinned,created_at,attachment_path,author_id").order("pinned",{ascending:false}).order("created_at",{ascending:false});
    const {data,error}=await q;
    if(error) throw error;
    cachedItems=data||[];
  }
  function visibleItems(kind){
    return cachedItems.filter(x=>(!kind||x.kind===kind) && (profile.role!=="student" || x.grade==="الكل" || x.grade===profile.grade));
  }
  function card(item){
    return `<article class="content-card"><div class="card-top"><span class="pill ${item.pinned?"green":""}">${item.pinned?"📌 مثبت":labels[item.kind]||"محتوى"}</span><span class="card-date">${dateText(item.created_at)}</span></div><h3>${escapeHTML(item.title)}</h3>${item.subject?`<span class="pill">${escapeHTML(item.subject)}</span>`:""}<p>${escapeHTML(item.body||"لا توجد تفاصيل إضافية.")}</p><div class="card-meta"><span class="pill">${escapeHTML(item.grade)}</span>${item.due_at?`<span class="pill">آخر موعد: ${dateText(item.due_at)}</span>`:""}</div>${item.attachment_path?`<div class="inline-actions"><button class="secondary" data-file="${escapeHTML(item.attachment_path)}">عرض / تحميل المرفق</button></div>`:""}</article>`;
  }
  function listSection(title,kind){
    const items=visibleItems(kind);
    return `<div class="section-head"><h2>${title}</h2><span class="muted">${items.length} عنصر</span></div>${items.length?`<div class="cards">${items.map(card).join("")}</div>`:`<div class="empty-state"><b>لا يوجد محتوى حتى الآن</b>سيظهر هنا كل جديد يتم نشره.</div>`}`;
  }
  async function loadPage(page){
    activePage=page; renderNav();
    const titles={home:"الرئيسية",announcements:"الأخبار والإعلانات",lessons:"الحصص الدراسية",assignments:"الواجبات المدرسية",assessments:"التقييمات والامتحانات",profile:"ملفي الشخصي",manage:"إدارة المحتوى",admin:"لوحة الإدارة"};
    $("#pageTitle").textContent=titles[page]||"المنصة"; $("#pageEyebrow").textContent=roleName(profile.role);
    $("#welcomePanel").classList.toggle("hidden",page!=="home");
    try{
      if(["home","announcements","lessons","assignments","assessments"].includes(page)){
        await loadItems();
        const map={announcements:"announcement",lessons:"lesson",assignments:"assignment",assessments:"assessment"};
        if(page==="home"){
          const items=visibleItems();
          const count=k=>items.filter(x=>x.kind===k).length;
          area.innerHTML=`<div class="stats"><div class="stat-card"><span>الإعلانات</span><strong>${count("announcement")}</strong></div><div class="stat-card"><span>الواجبات</span><strong>${count("assignment")}</strong></div><div class="stat-card"><span>التقييمات</span><strong>${count("assessment")}</strong></div></div>${listSection("أحدث المستجدات",null)}`;
        }else area.innerHTML=listSection(titles[page],map[page]);
        bindFiles();
      } else if(page==="profile") renderProfile();
      else if(page==="manage") renderManage();
      else if(page==="admin") renderAdmin();
    }catch(e){area.innerHTML=`<div class="empty-state danger-text">تعذر تحميل البيانات: ${escapeHTML(e.message)}</div>`;}
  }
  async function bindFiles(){
    $$("[data-file]").forEach(b=>b.addEventListener("click",async()=>{
      const {data,error}=await db.storage.from("school-files").createSignedUrl(b.dataset.file,90);
      if(error)return toast("تعذر فتح الملف",true);
      window.open(data.signedUrl,"_blank","noopener");
    }));
  }
  function renderProfile(){
    area.innerHTML=`<div class="info-card"><div class="section-head"><h2>بيانات الحساب</h2></div><p><span class="muted">الاسم:</span> ${escapeHTML(profile.full_name)}</p><p><span class="muted">الدور:</span> ${roleName(profile.role)}</p><p><span class="muted">الصف:</span> ${escapeHTML(profile.grade||"—")}</p>${profile.role==="student"?`<p class="muted">الكود التعريفي لا يظهر إلا لصاحب الحساب. لا تستخدمه بدل كلمة المرور ولا تشاركه مع أحد.</p><div class="code-box" id="studentCode">••••••••</div><button class="secondary" id="revealCode">إظهار الكود بعد التحقق</button> <button class="secondary" id="copyCode" disabled>نسخ الكود</button><p class="muted">«تم إنشاء كودك التعريفي الخاص بنجاح. هذا الكود مرتبط بحسابك، فاحتفظ به في مكان آمن ولا تشاركه مع أي شخص. قد تحتاج إليه للتعرّف على حسابك أو استعادة الوصول إليه وفقًا لنظام التطبيق.»</p>`:""}<p class="muted">البريد الإلكتروني: ${escapeHTML(currentUser.email||"—")}</p></div>`;
    if(profile.role==="student"){
      $("#revealCode").addEventListener("click",async()=>{
        const {data,error}=await db.rpc("get_my_student_code");
        if(error)return toast("تعذر التحقق من الكود. راجع إعدادات قاعدة البيانات.",true);
        $("#studentCode").textContent=data; $("#copyCode").disabled=false; toast("تم عرض كود حسابك.");
      });
      $("#copyCode").addEventListener("click",async()=>{await navigator.clipboard.writeText($("#studentCode").textContent);toast("تم نسخ الكود.");});
    }
  }
  function renderManage(){
    if(!isStaff()){area.innerHTML='<div class="empty-state">لا تملك صلاحية الوصول.</div>';return;}
    area.innerHTML=`<div class="section-head"><h2>نشر محتوى جديد</h2><button class="primary" id="newContent">＋ إضافة محتوى</button></div><div class="info-card"><b>ملاحظة الصلاحيات</b><p class="muted">يمكن للمدرس إدارة منشوراته فقط. تثبيت الإعلانات متاح للإدارة فقط. تظهر المواد للصف المستهدف وفق سياسات قاعدة البيانات.</p></div>${listSection("المحتوى المنشور",null)}`;
    $("#newContent").addEventListener("click",()=>$("#contentDialog").showModal());
  }
  async function renderAdmin(){
    if(!isAdmin()){area.innerHTML='<div class="empty-state">هذه الصفحة مخصصة للإدارة.</div>';return;}
    const {data,error}=await db.from("profiles").select("id,full_name,role,grade,approved,created_at").order("created_at",{ascending:false}).limit(100);
    if(error){area.innerHTML=`<div class="empty-state">${escapeHTML(error.message)}</div>`;return;}
    area.innerHTML=`<div class="section-head"><h2>المستخدمون</h2><span class="muted">آخر 100 حساب</span></div><div class="cards">${(data||[]).map(u=>`<article class="content-card"><h3>${escapeHTML(u.full_name)}</h3><p>${roleName(u.role)} • ${escapeHTML(u.grade||"—")}</p><span class="pill ${u.approved?"green":""}">${u.approved?"معتمد":"بانتظار الاعتماد"}</span>${u.role==="teacher"&&!u.approved?`<div class="inline-actions"><button class="primary" data-approve="${u.id}">اعتماد المدرس</button></div>`:""}</article>`).join("")||'<div class="empty-state">لا يوجد مستخدمون.</div>'}</div>`;
    $$("[data-approve]").forEach(b=>b.addEventListener("click",async()=>{const {error}=await db.from("profiles").update({approved:true}).eq("id",b.dataset.approve);if(error)toast(error.message,true);else{toast("تم اعتماد المدرس.");renderAdmin();}}));
  }
  $("#contentForm").addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    const kind=f.get("kind"); const file=f.get("attachment");let path=null;
    if(file&&file.size){
      if(file.size>10*1024*1024)return toast("الحد الأقصى لحجم الملف 10 ميجابايت.",true);
      const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
      path=`${currentUser.id}/${crypto.randomUUID()}-${safeName}`;
      const up=await db.storage.from("school-files").upload(path,file,{upsert:false});
      if(up.error)return toast(up.error.message,true);
    }
    const payload={title:f.get("title"),kind,grade:f.get("grade"),subject:f.get("subject")||null,body:f.get("body")||"",due_at:f.get("due_at")?new Date(f.get("due_at")).toISOString():null,attachment_path:path,pinned:isAdmin()&&f.get("pinned")==="on",author_id:currentUser.id};
    const {error}=await db.from("content_items").insert(payload);
    if(error){toast(error.message,true);return;}
    $("#contentDialog").close();e.currentTarget.reset();toast("تم نشر المحتوى بنجاح.");loadPage("manage");
  });
  $("#closeDialog").addEventListener("click",()=>$("#contentDialog").close());
  $("#refreshBtn").addEventListener("click",()=>loadPage(activePage));
  $("#logoutBtn").addEventListener("click",async()=>{await db.auth.signOut();profile=null;currentUser=null;showAuth();});
  $$("[data-auth-tab]").forEach(b=>b.addEventListener("click",()=>showAuth(b.dataset.authTab)));
  $("#loginForm").addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    const {data,error}=await db.auth.signInWithPassword({email:f.get("email"),password:f.get("password")});
    if(error)return toast(error.message,true);
    await startSession(data.user);
  });
  $("#registerForm").addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    const {data,error}=await db.auth.signUp({email:f.get("email"),password:f.get("password"),options:{data:{full_name:f.get("full_name"),grade:f.get("grade")}}});
    if(error)return toast(error.message,true);
    if(data.session) await startSession(data.user);
    else toast("تم إنشاء الحساب. افتح بريدك الإلكتروني لتأكيد الحساب ثم سجّل الدخول.");
    e.currentTarget.reset();
  });
  async function startSession(user){
    currentUser=user;
    const {data,error}=await db.from("profiles").select("*").eq("id",user.id).single();
    if(error){toast("لم نتمكن من تحميل ملف الحساب: "+error.message,true);return;}
    profile=data;
    if(profile.role==="teacher"&&!profile.approved){await db.auth.signOut();return toast("حساب المدرس بانتظار اعتماد الإدارة.",true);}
    showApp();
  }
  async function init(){
    if(!window.supabase||!window.SUPABASE_URL||!window.SUPABASE_ANON_KEY||window.SUPABASE_URL.includes("YOUR-PROJECT")){
      toast("أضف بيانات Supabase داخل config.js أولًا.",true);return;
    }
    db=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY);
    const {data}=await db.auth.getSession();
    if(data.session)await startSession(data.session.user);
  }
  init();
})();
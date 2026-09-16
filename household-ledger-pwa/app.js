(() => {
  'use strict';

  const STORAGE_KEY = 'household-ledger:v1';
  const accentPresets = {
    slate:'#315d73', teal:'#2f746d', green:'#477252', olive:'#73713d', amber:'#9b692f',
    orange:'#a15836', red:'#a94b43', rose:'#9b526a', purple:'#6d568e', indigo:'#4d6192'
  };
  const categoryIcons = {
    '식비':'fork-knife','외식':'bowl-food','장보기':'shopping-cart','쇼핑':'bag','생활':'house-line',
    '교통':'train','차량':'car','주거':'buildings','교육':'student','의료':'first-aid-kit',
    '보험':'shield-check','구독':'arrows-clockwise','경조사':'gift','여행':'airplane-tilt','기타':'dots-three-circle',
    '급여':'wallet','상여':'gift','성과급':'chart-donut','환급':'arrows-clockwise','용돈':'wallet'
  };
  const currency = new Intl.NumberFormat('ko-KR');
  const today = new Date();
  const isoToday = toISO(today);
  const publicDemoHost = 'kangj-collab.github.io';
  const publicDemoMode = window.location.hostname === publicDemoHost;
  const systemThemeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  const els = {
    main: document.getElementById('mainContent'),
    pageTitle: document.getElementById('pageTitle'),
    householdLabel: document.getElementById('householdLabel'),
    settingsBtn: document.getElementById('settingsBtn'),
    privacyQuickBtn: document.getElementById('privacyQuickBtn'),
    quickAddBtn: document.getElementById('quickAddBtn'),
    navItems: [...document.querySelectorAll('.nav-item')],
    backdrop: document.getElementById('backdrop'),
    sheet: document.getElementById('sheet'),
    sheetTitle: document.getElementById('sheetTitle'),
    sheetEyebrow: document.getElementById('sheetEyebrow'),
    sheetBody: document.getElementById('sheetBody'),
    sheetBackBtn: document.getElementById('sheetBackBtn'),
    sheetCloseBtn: document.getElementById('sheetCloseBtn'),
    toast: document.getElementById('toast')
  };

  let state = null;
  let route = 'home';
  let monthCursor = new Date(today.getFullYear(), today.getMonth(), 1);
  let txView = 'list';
  let statsView = 'overview';
  let manageView = 'recurring';
  let selectedCalendarDate = isoToday;
  let toastTimer = null;
  let currentUser = null;
  let remoteRevision = 0;
  let remoteReady = false;
  let pendingRemotePayload = null;
  let syncInFlight = false;
  let sheetBackAction = null;

  void boot();

  async function boot(){
    try {
      if (publicDemoMode) {
        startLocalDemo();
        return;
      }
      const session = await apiRequest('/api/session');
      if (!session.authenticated) {
        localStorage.removeItem(STORAGE_KEY);
        window.location.replace('./');
        return;
      }
      currentUser = session.user;
      const remote = await apiRequest('/api/state');
      state = remote.state || {};
      remoteRevision = Number(remote.revision) || 1;
      normalizeState();
      remoteReady = true;
      save(false);
      processRecurring();
      save();
      startApp();
    } catch (error) {
      if (error?.status === 401) {
        window.location.replace('./');
        return;
      }
      document.body.innerHTML = `<main class="auth-shell"><section class="auth-card"><p class="eyebrow">우리집 가계부</p><h1>연결할 수 없습니다</h1><p class="auth-copy">잠시 후 다시 열어주세요.</p><button class="primary-button" onclick="location.reload()">다시 시도</button></section></main>`;
    }
  }

  function startLocalDemo(){
    state = loadState();
    normalizeState();
    save(false);
    processRecurring();
    startApp();
  }

  function startApp(){
    applyTheme();
    bindAppEvents();
    render();
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}), {once:true});
    }
  }

  function bindAppEvents(){
    els.navItems.forEach(btn => btn.addEventListener('click', () => {
      route = btn.dataset.route;
      render();
      window.scrollTo({top:0, behavior:'smooth'});
    }));
    els.quickAddBtn.addEventListener('click', () => openTransactionSheet());
    els.settingsBtn.addEventListener('click', openSettingsSheet);
    els.privacyQuickBtn.addEventListener('click', showPrivateInfo);
    els.sheetCloseBtn.addEventListener('click', closeSheet);
    els.sheetBackBtn.addEventListener('click',()=>{const action=sheetBackAction; if(action)action();});
    els.backdrop.addEventListener('click', closeSheet);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeSheet(); });
    const handleSystemThemeChange = () => {
      if ((state.preferences?.theme || 'system') === 'system') applyTheme();
    };
    if (systemThemeQuery) {
      if (typeof systemThemeQuery.addEventListener === 'function') systemThemeQuery.addEventListener('change', handleSystemThemeChange);
      else if (typeof systemThemeQuery.addListener === 'function') systemThemeQuery.addListener(handleSystemThemeChange);
    }
  }

  function defaultState(){
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = today.getDate();
    const date = offset => toISO(new Date(y,m,Math.max(1,d-offset)));
    return {
      version:2,
      profile:{ householdName:'우리집', mode:'couple', defaultShared:true, memberName:'나', partnerName:'배우자' },
      preferences:{ style:'compact', theme:'system', accent:'slate', customAccent:'#315d73' },
      budget:{ monthly:2000000, byCategory:{'식비':600000,'외식':250000,'쇼핑':200000,'차량':300000} },
      expenseCategories:['식비','외식','장보기','쇼핑','생활','교통','차량','주거','교육','의료','보험','구독','경조사','여행','기타'],
      incomeCategories:['급여','상여','성과급','환급','용돈','기타'],
      paymentMethods:['생활비카드','내 카드','배우자 카드','현금','계좌이체'],
      transactions:[
        tx('expense',83200,'장보기','이마트','생활비카드',date(0),true),
        tx('expense',12000,'외식','점심','생활비카드',date(0),true),
        tx('expense',70000,'차량','주유','내 카드',date(1),true),
        tx('expense',31900,'쇼핑','쿠팡','내 카드',date(2),true),
        tx('expense',5800,'외식','카페','내 카드',date(3),false),
        tx('income',4850000,'급여','급여','계좌이체',toISO(new Date(y,m,Math.min(5,d))),true)
      ],
      recurring:[
        {id:uid(),type:'expense',amount:183000,category:'보험',note:'보험료',paymentMethod:'생활비카드',day:25,autoPost:true,shared:true,active:true},
        {id:uid(),type:'expense',amount:55000,category:'구독',note:'정기 구독',paymentMethod:'생활비카드',day:12,autoPost:true,shared:true,active:true}
      ],
      vehicles:[{
        id:uid(), name:'내 자동차', currentKm:68420,
        items:[{id:uid(),name:'엔진오일',lastDate:toISO(new Date(y,m-1,8)),lastKm:63600,minKm:8000,maxKm:10000,lastCost:87000}]
      }],
      customManage:[],
      metadata:{sample:true,recurringPosted:{}}
    };
  }

  function tx(type,amount,category,note,paymentMethod,date,shared=true){
    return {id:uid(),type,amount,category,note,paymentMethod,date,shared,createdAt:Date.now()};
  }

  function categoriesForType(type){
    return type==='income'?state.incomeCategories:state.expenseCategories;
  }

  function loadState(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : defaultState();
    } catch (_) { return defaultState(); }
  }

  function normalizeState(){
    state.profile ||= {householdName:'우리집',mode:'couple',defaultShared:true,memberName:'나',partnerName:'배우자'};
    state.preferences ||= {style:'compact',theme:'system',accent:'slate',customAccent:'#315d73'};
    state.budget ||= {monthly:0,byCategory:{}};
    const legacyCategories=Array.isArray(state.categories)?state.categories:null;
    state.expenseCategories ||= legacyCategories||['식비','외식','장보기','쇼핑','생활','교통','차량','주거','교육','의료','보험','구독','경조사','여행','기타'];
    state.incomeCategories ||= ['급여','상여','성과급','환급','용돈','기타'];
    if(state.metadata?.sample){
      state.transactions?.forEach(t=>{if(t.type==='income'&&t.note==='급여'&&t.category==='기타')t.category='급여';});
    }
    delete state.categories;
    state.version=2;
    state.paymentMethods ||= ['현금','계좌이체'];
    state.transactions ||= [];
    state.recurring ||= [];
    state.vehicles ||= [];
    state.customManage ||= [];
    state.metadata ||= {sample:false,recurringPosted:{}};
    state.metadata.recurringPosted ||= {};
  }

  async function apiRequest(path, options={}){
    const response = await fetch(path, {credentials:'same-origin', cache:'no-store', ...options, headers:{'content-type':'application/json', ...(options.headers||{})}});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `요청 실패 (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function save(sync=true){
    if (!state) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!sync || !remoteReady) return;
    pendingRemotePayload = {baseRevision:remoteRevision, state:JSON.parse(JSON.stringify(state))};
    void flushRemoteState();
  }

  async function flushRemoteState(){
    if (syncInFlight || !pendingRemotePayload) return;
    const payload = pendingRemotePayload;
    pendingRemotePayload = null;
    syncInFlight = true;
    try {
      const result = await apiRequest('/api/state', {method:'PUT', body:JSON.stringify(payload)});
      remoteRevision = Number(result.revision) || remoteRevision + 1;
    } catch (error) {
      if (error?.status === 401) {
        window.location.replace('./');
        return;
      }
      if (error?.status === 409 && error.data?.state) {
        state = error.data.state;
        remoteRevision = Number(error.data.revision) || remoteRevision;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        render();
        showToast('다른 기기에서 먼저 수정되어 최신 내용으로 맞췄습니다.');
      } else {
        showToast('서버 저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      syncInFlight = false;
      if (pendingRemotePayload) {
        pendingRemotePayload.baseRevision = remoteRevision;
        void flushRemoteState();
      }
    }
  }

  async function logout(){
    if (publicDemoMode) {
      localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
      return;
    }
    try { await apiRequest('/api/logout', {method:'POST'}); }
    finally {
      localStorage.removeItem(STORAGE_KEY);
      window.location.replace('./');
    }
  }

  async function issueInvite(backAction=null){
    try {
      const result = await apiRequest('/api/invites', {method:'POST', body:JSON.stringify({displayName:'배우자'})});
      openSheet('배우자 초대코드','10분 동안 1회 사용',`<div class="subtle-box"><strong style="display:block;font-size:25px;letter-spacing:.08em;text-align:center;margin:10px 0 16px">${esc(result.inviteCode)}</strong><p style="margin:0;color:var(--text-2);font-size:12px;line-height:1.5;text-align:center">이 코드를 배우자 휴대폰의 전용 접속 화면에 입력해주세요.<br>만료 시 새 코드를 발급하면 이전 코드는 사용할 수 없습니다.</p></div><div style="height:12px"></div><button class="primary-button" id="copyInviteCode">초대코드 복사</button>`,backAction);
      document.getElementById('copyInviteCode').addEventListener('click', async event => {
        try { await navigator.clipboard.writeText(result.inviteCode); event.currentTarget.textContent='복사 완료'; showToast('초대코드를 복사했습니다.'); }
        catch (_) { window.prompt('초대코드를 복사하세요.', result.inviteCode); }
      });
    } catch (error) {
      showToast(error?.message || '초대코드를 발급하지 못했습니다.');
    }
  }

  function uid(){ return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-4); }
  function toISO(date){
    const y=date.getFullYear(), m=String(date.getMonth()+1).padStart(2,'0'), d=String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  function parseISO(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
  function fmtMoney(n){ return `${currency.format(Math.round(Number(n)||0))}원`; }
  function fmtShortMoney(n){
    n = Number(n)||0;
    if (Math.abs(n)>=100000000) return `${(n/100000000).toFixed(n%100000000?1:0)}억`;
    if (Math.abs(n)>=10000) return `${Math.round(n/10000)}만`;
    return currency.format(n);
  }
  function fmtDate(dateStr){
    const d=parseISO(dateStr); return `${d.getMonth()+1}.${d.getDate()} ${['일','월','화','수','목','금','토'][d.getDay()]}`;
  }
  function monthKey(date=monthCursor){ return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`; }
  function monthTransactions(date=monthCursor){
    const key=monthKey(date); return state.transactions.filter(t=>t.date?.startsWith(key));
  }
  function sums(date=monthCursor){
    const list=monthTransactions(date);
    return {
      income:list.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount||0),0),
      expense:list.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount||0),0)
    };
  }
  function upcomingRecurring(date=monthCursor){
    const y=date.getFullYear(), m=date.getMonth();
    return state.recurring.filter(r=>r.active).map(r=>({
      ...r,date:toISO(new Date(y,m,Math.min(r.day,new Date(y,m+1,0).getDate())))
    })).sort((a,b)=>a.day-b.day);
  }

  function processRecurring(){
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    state.recurring.filter(r=>r.active && r.autoPost && now.getDate()>=r.day).forEach(r=>{
      const postKey=`${key}:${r.id}`;
      if (state.metadata.recurringPosted[postKey]) return;
      const date=toISO(new Date(now.getFullYear(),now.getMonth(),Math.min(r.day,new Date(now.getFullYear(),now.getMonth()+1,0).getDate())));
      state.transactions.push({id:uid(),type:r.type,amount:r.amount,category:r.category,note:r.note,paymentMethod:r.paymentMethod,date,shared:r.shared,recurringId:r.id,createdAt:Date.now()});
      state.metadata.recurringPosted[postKey]=true;
    });
    save();
  }

  function render(){
    applyTheme();
    const household=state.profile.householdName||'우리집';
    const titles={home:`${monthCursor.getMonth()+1}월`,transactions:'사용내역',stats:'통계',manage:'관리'};
    const eyebrows={home:household,transactions:`${household} · 기록`,stats:`${household} · 월간 분석`,manage:household};
    els.pageTitle.textContent=titles[route]||'홈';
    els.householdLabel.textContent=eyebrows[route]||household;
    els.privacyQuickBtn.hidden=!(route==='home'||route==='transactions');
    els.main.dataset.route=route;
    els.navItems.forEach(btn=>{
      const active=btn.dataset.route===route;
      btn.classList.toggle('active',active);
      if(active)btn.setAttribute('aria-current','page');
      else btn.removeAttribute('aria-current');
    });
    if (route==='home') renderHome();
    if (route==='transactions') renderTransactions();
    if (route==='stats') renderStats();
    if (route==='manage') renderManage();
  }

  function renderHome(){
    const {income,expense}=sums();
    const budget=Number(state.budget.monthly)||0;
    const remaining=budget-expense;
    const pct=budget?Math.round(expense/budget*100):0;
    const isCurrentMonth=monthKey()===monthKey(today);
    const spendLabel=isCurrentMonth?'이번 달 지출':`${monthCursor.getFullYear()}년 ${monthCursor.getMonth()+1}월 지출`;
    const secondaryLabel=budget?(remaining<0?'예산 초과':'남은 예산'):'수입 - 지출';
    const secondaryValue=budget?Math.abs(remaining):income-expense;
    const recurring=upcomingRecurring().filter(r=>r.date>=isoToday).slice(0,3);
    const recent=[...monthTransactions()].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt).slice(0,6);
    els.main.innerHTML=`
      <section class="home-overview" aria-labelledby="homeExpenseLabel">
        <div class="home-overview-head">
          <p class="home-overview-kicker" id="homeExpenseLabel">${spendLabel}</p>
          <div class="month-switch">
            <button data-month="-1" aria-label="이전 달"><i class="ph ph-caret-left"></i></button>
            <button data-month="1" aria-label="다음 달"><i class="ph ph-caret-right"></i></button>
          </div>
        </div>
        <p class="home-overview-amount">${fmtMoney(expense)}</p>
        <div class="home-budget">
          <div class="home-budget-track ${pct>100?'over':''}" aria-hidden="true"><span style="width:${Math.min(pct,100)}%"></span></div>
          <div class="home-budget-meta">
            <span>${budget?`예산 ${fmtMoney(budget)}`:'이번 달 예산을 설정해보세요'}</span>
            ${budget?`<strong class="${pct>100?'negative':''}">${pct}% 사용</strong>`:''}
          </div>
        </div>
        <dl class="home-metrics" aria-label="이번 달 요약">
          <div class="home-metric">
            <dt>수입</dt>
            <dd class="income">${fmtMoney(income)}</dd>
          </div>
          <div class="home-metric">
            <dt>${secondaryLabel}</dt>
            <dd class="${secondaryValue<0||remaining<0&&budget?'negative':''}">${fmtMoney(secondaryValue)}</dd>
          </div>
        </dl>
      </section>

      ${recurring.length?`<section class="section home-section">
        <div class="section-head"><div><h2>예정</h2><p>자동 반영되는 고정지출</p></div><button class="text-button" data-action="recurring-settings">관리</button></div>
        <div class="home-group">${recurring.map(r=>transactionRow({...r,id:`up-${r.id}`},true)).join('')}</div>
      </section>`:''}

      <section class="section home-section">
        <div class="section-head"><div><h2>최근 내역</h2><p>${monthCursor.getMonth()+1}월 기록</p></div><button class="text-button" data-action="go-transactions">전체보기</button></div>
        ${recent.length?`<div class="home-group">${recent.map(t=>transactionRow(t)).join('')}</div>`:`<div class="home-empty"><i class="ph-duotone ph-receipt"></i><strong>아직 기록이 없습니다</strong><p>가운데 + 버튼으로 첫 지출을 기록해보세요.</p></div>`}
      </section>

      ${state.metadata.sample?`<p class="home-sample-note"><i class="ph ph-info"></i><span>현재 예시 내역이 들어 있습니다. 설정에서 지우고 실제 가계부로 시작할 수 있습니다.</span></p>`:''}
    `;
    els.main.querySelectorAll('[data-month]').forEach(btn=>btn.addEventListener('click',()=>{ monthCursor=new Date(monthCursor.getFullYear(),monthCursor.getMonth()+Number(btn.dataset.month),1); render(); }));
    els.main.querySelector('[data-action="go-transactions"]')?.addEventListener('click',()=>{route='transactions';render();});
    els.main.querySelector('[data-action="recurring-settings"]')?.addEventListener('click',openRecurringSheet);
    wireTransactionRows();
  }

  function transactionRow(t,upcoming=false){
    const icon=categoryIcons[t.category]||'dots-three-circle';
    const sign=t.type==='income'?'+':'-';
    return `<button class="list-row" data-txid="${upcoming?'':t.id}" ${upcoming?'disabled':''} style="width:100%;border-left:0;border-right:0;border-top:0;text-align:left;color:inherit;background:transparent">
      <span class="row-icon"><i class="ph-duotone ph-${icon}"></i></span>
      <span class="row-main">
        <span class="row-title">${esc(t.note||t.category)}${t.shared===false?'<span class="private-dot" title="비공개"></span>':''}</span>
        <span class="row-meta">${upcoming?`${Number(t.day)}일 예정`:fmtDate(t.date)} · ${esc(t.category)}${t.paymentMethod?` · ${esc(t.paymentMethod)}`:''}</span>
      </span>
      <span class="row-amount ${t.type}">${sign}${fmtMoney(t.amount)}</span>
    </button>`;
  }

  function wireTransactionRows(){
    els.main.querySelectorAll('[data-txid]').forEach(btn=>{
      if (!btn.dataset.txid) return;
      btn.addEventListener('click',()=>openTransactionDetail(btn.dataset.txid));
    });
  }

  function renderTransactions(){
    const list=[...monthTransactions()].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt);
    const {income,expense}=sums();
    els.main.innerHTML=`
      <section class="screen-nav-panel" aria-label="사용내역 탐색">
        <div class="screen-month-nav">
          <button class="screen-month-button" data-month="-1" aria-label="이전 달"><i class="ph ph-caret-left"></i></button>
          <div class="screen-month-copy">
            <span>기록을 보는 달</span>
            <strong>${monthCursor.getFullYear()}년 ${monthCursor.getMonth()+1}월</strong>
          </div>
          <button class="screen-month-button" data-month="1" aria-label="다음 달"><i class="ph ph-caret-right"></i></button>
        </div>
        <div class="screen-view-switch" role="tablist" aria-label="내역 표시 방식">
          <button type="button" role="tab" aria-selected="${txView==='list'}" data-view="list" class="${txView==='list'?'active':''}"><i class="ph ph-list-bullets"></i><span>목록</span></button>
          <button type="button" role="tab" aria-selected="${txView==='calendar'}" data-view="calendar" class="${txView==='calendar'?'active':''}"><i class="ph ph-calendar-blank"></i><span>달력</span></button>
        </div>
      </section>

      <dl class="screen-metrics screen-metrics-three" aria-label="선택한 달 요약">
        <div><dt>지출</dt><dd>${fmtShortMoney(expense)}원</dd></div>
        <div><dt>수입</dt><dd class="income">${fmtShortMoney(income)}원</dd></div>
        <div><dt>기록</dt><dd>${list.length}건</dd></div>
      </dl>

      ${txView==='calendar'?`<section class="section calendar-section">${renderCalendar()}</section>`:''}
      <section class="section screen-result-section">
        <div class="section-head"><div><h2>${txView==='calendar'&&selectedCalendarDate?.startsWith(monthKey())?fmtDate(selectedCalendarDate):`${monthCursor.getMonth()+1}월 내역`}</h2><p>${txView==='calendar'?'선택한 날짜의 기록':'최근 날짜부터 표시'}</p></div></div>
        ${renderTransactionList(txView==='calendar'?list.filter(t=>t.date===selectedCalendarDate):list)}
      </section>`;
    els.main.querySelectorAll('[data-month]').forEach(btn=>btn.addEventListener('click',()=>{
      monthCursor=new Date(monthCursor.getFullYear(),monthCursor.getMonth()+Number(btn.dataset.month),1);
      selectedCalendarDate=toISO(new Date(monthCursor.getFullYear(),monthCursor.getMonth(),1)); render();
    }));
    els.main.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>{txView=btn.dataset.view;render();}));
    els.main.querySelectorAll('[data-caldate]').forEach(btn=>btn.addEventListener('click',()=>{selectedCalendarDate=btn.dataset.caldate;render();}));
    wireTransactionRows();
  }

  function renderCalendar(){
    const y=monthCursor.getFullYear(), m=monthCursor.getMonth();
    const first=new Date(y,m,1); const start=new Date(y,m,1-first.getDay());
    const daily={};
    monthTransactions().filter(t=>t.type==='expense').forEach(t=>daily[t.date]=(daily[t.date]||0)+Number(t.amount));
    let cells='';
    for(let i=0;i<42;i++){
      const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i); const iso=toISO(d);
      cells+=`<button class="cal-cell ${d.getMonth()!==m?'other':''} ${iso===isoToday?'today':''} ${iso===selectedCalendarDate?'selected':''}" data-caldate="${iso}">
        <span class="cal-date">${d.getDate()}</span>${daily[iso]?`<span class="cal-spend">${fmtShortMoney(daily[iso])}</span>`:''}
      </button>`;
    }
    return `<div class="calendar-card"><div class="calendar-head">${['일','월','화','수','목','금','토'].map(x=>`<span>${x}</span>`).join('')}</div><div class="calendar-grid">${cells}</div></div>`;
  }

  function renderTransactionList(list){
    if (!list.length) return empty('receipt','해당 내역이 없습니다','가운데 + 버튼으로 기록할 수 있습니다.');
    const groups={};
    list.forEach(t=>(groups[t.date] ||= []).push(t));
    return Object.keys(groups).sort((a,b)=>b.localeCompare(a)).map(date=>`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;padding:0 3px 6px;color:var(--text-2);font-size:11px;font-weight:750"><span>${fmtDate(date)}</span><span>${fmtMoney(groups[date].filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount),0))}</span></div><div class="list">${groups[date].map(transactionRow).join('')}</div></div>`).join('');
  }

  function renderStats(){
    const list=monthTransactions().filter(t=>t.type==='expense');
    const total=list.reduce((s,t)=>s+Number(t.amount),0);
    const byCat={}; list.forEach(t=>byCat[t.category]=(byCat[t.category]||0)+Number(t.amount));
    const cats=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
    const history=[];
    for(let i=5;i>=0;i--){ const d=new Date(monthCursor.getFullYear(),monthCursor.getMonth()-i,1); history.push({d,total:sums(d).expense}); }
    const max=Math.max(...history.map(x=>x.total),1);
    const top=cats[0];
    const monthlyBudget=Number(state.budget.monthly)||0;
    const budgetRemaining=monthlyBudget-total;
    const budgetPct=monthlyBudget?Math.round(total/monthlyBudget*100):0;
    els.main.innerHTML=`
      <section class="screen-nav-panel" aria-label="통계 탐색">
        <div class="screen-month-nav">
          <button class="screen-month-button" data-month="-1" aria-label="이전 달"><i class="ph ph-caret-left"></i></button>
          <div class="screen-month-copy">
            <span>분석할 달</span>
            <strong>${monthCursor.getFullYear()}년 ${monthCursor.getMonth()+1}월</strong>
          </div>
          <button class="screen-month-button" data-month="1" aria-label="다음 달"><i class="ph ph-caret-right"></i></button>
        </div>
        <div class="screen-view-switch" role="tablist" aria-label="통계 종류">
          <button type="button" role="tab" aria-selected="${statsView==='overview'}" data-stats-view="overview" class="${statsView==='overview'?'active':''}"><i class="ph ph-chart-donut"></i><span>지출 분석</span></button>
          <button type="button" role="tab" aria-selected="${statsView==='budget'}" data-stats-view="budget" class="${statsView==='budget'?'active':''}"><i class="ph ph-wallet"></i><span>예산</span></button>
        </div>
      </section>

      ${statsView==='overview'?`
        <section class="stats-lead" aria-label="월 지출 요약">
          <div><span>${monthCursor.getMonth()+1}월 총 지출</span><strong>${fmtMoney(total)}</strong></div>
          ${top?`<div class="stats-lead-side"><span>가장 큰 카테고리</span><strong>${esc(top[0])}</strong></div>`:''}
        </section>
        <section class="section"><div class="section-head"><div><h2>어디에 썼나요</h2><p>카테고리별 지출 비중</p></div></div>
          ${cats.length?`<div class="card category-stats">${cats.map(([name,val])=>`<div class="stat-row"><span class="stat-label">${esc(name)}</span><span class="bar"><span style="width:${total?val/total*100:0}%"></span></span><span class="stat-value">${Math.round(val/Math.max(total,1)*100)}%</span></div>`).join('')}</div>`:empty('chart-donut','통계가 없습니다','지출을 기록하면 카테고리별로 자동 집계됩니다.')}
        </section>
        <section class="section"><div class="section-head"><div><h2>6개월 흐름</h2><p>월별 지출 변화</p></div></div>
          <div class="card month-bars">${history.map((x,i)=>`<div class="month-bar ${i===history.length-1?'current':''}"><div class="column" title="${fmtMoney(x.total)}" style="height:${Math.max(4,x.total/max*115)}px"></div><small>${x.d.getMonth()+1}월</small></div>`).join('')}</div>
        </section>`:`
        <section class="stats-lead budget-lead" aria-label="월 예산 요약">
          <div><span>${monthCursor.getMonth()+1}월 예산 사용</span><strong>${monthlyBudget?`${budgetPct}%`:'미설정'}</strong></div>
          <div class="stats-lead-side"><span>${monthlyBudget?(budgetRemaining>=0?'남은 예산':'예산 초과'):'사용 금액'}</span><strong class="${budgetRemaining<0&&monthlyBudget?'negative':''}">${monthlyBudget?fmtMoney(Math.abs(budgetRemaining)):fmtMoney(total)}</strong></div>
          ${monthlyBudget?`<div class="budget-lead-track ${budgetPct>100?'over':''}"><span style="width:${Math.min(budgetPct,100)}%"></span></div>`:''}
        </section>
        <section class="section"><div class="section-head"><div><h2>카테고리 예산</h2><p>항목별 사용 현황</p></div><button class="text-button" data-action="budget">예산 설정</button></div>${renderBudgetStats(byCat)}</section>`}
    `;
    els.main.querySelectorAll('[data-month]').forEach(btn=>btn.addEventListener('click',()=>{
      monthCursor=new Date(monthCursor.getFullYear(),monthCursor.getMonth()+Number(btn.dataset.month),1);
      render();
    }));
    els.main.querySelectorAll('[data-stats-view]').forEach(btn=>btn.addEventListener('click',()=>{statsView=btn.dataset.statsView;render();}));
    els.main.querySelector('[data-action="budget"]')?.addEventListener('click',openBudgetSheet);
  }

  function renderBudgetStats(byCat){
    const entries=Object.entries(state.budget.byCategory||{}).filter(([,v])=>Number(v)>0);
    if (!entries.length) return empty('wallet','세부 예산이 없습니다','필요한 카테고리만 예산을 정할 수 있습니다.');
    return `<div class="card category-stats">${entries.map(([cat,b])=>{const spent=byCat[cat]||0,p=Math.round(spent/Number(b)*100);return `<div><div style="display:flex;justify-content:space-between;gap:10px;font-size:11px;margin-bottom:5px"><strong>${esc(cat)}</strong><span style="color:var(--text-2)">${fmtMoney(spent)} / ${fmtMoney(b)}</span></div><div class="bar"><span style="width:${Math.min(p,100)}%;background:${p>100?'var(--expense)':'var(--accent)'}"></span></div></div>`}).join('')}</div>`;
  }

  function renderManage(){
    const vehicles=state.vehicles;
    const activeRecurring=state.recurring.filter(item=>item.active!==false);
    let content='';
    if(manageView==='recurring'){
      content=`<section class="section manage-screen-section">
        <div class="section-head"><div><h2>고정지출과 반복수입</h2><p>매월 입력하지 않아도 자동으로 기록</p></div><button class="text-button" data-action="add-recurring">추가</button></div>
        ${state.recurring.length?`<div class="list">${state.recurring.map(item=>{
          const sign=item.type==='income'?'+':'-';
          const status=item.active===false?'일시정지':(item.autoPost?'자동 기록':'직접 확인');
          return `<button class="list-row screen-list-action ${item.active===false?'is-paused':''}" data-recurring="${escAttr(item.id)}"><span class="row-icon"><i class="ph-duotone ph-arrows-clockwise"></i></span><span class="row-main"><span class="row-title">${esc(item.note||item.category)}</span><span class="row-meta">매월 ${Number(item.day)||1}일 · ${status}</span></span><span class="row-trailing"><span class="row-amount ${item.type}">${sign}${fmtMoney(item.amount)}</span><i class="ph ph-caret-right"></i></span></button>`;
        }).join('')}</div>`:empty('arrows-clockwise','등록된 고정지출이 없습니다','이자·학원비·보험료 등을 한 번만 등록하세요.')}
      </section>`;
    }
    if(manageView==='vehicles'){
      content=`<section class="section manage-screen-section">
        <div class="section-head"><div><h2>자동차</h2><p>주행거리와 교체 항목을 차량별로 관리</p></div><button class="text-button" data-action="add-vehicle">차량 추가</button></div>
        ${vehicles.length?vehicles.map(renderVehicleCard).join('<div style="height:10px"></div>'):empty('car','등록된 차량이 없습니다','차량을 추가하면 교체거리 기준으로 관리할 수 있습니다.')}
      </section>`;
    }
    if(manageView==='custom'){
      content=`<section class="section manage-screen-section">
        <div class="section-head"><div><h2>직접 관리</h2><p>가족에게 필요한 항목만 따로 기록</p></div><button class="text-button" data-action="add-custom">추가</button></div>
        ${state.customManage.length?`<div class="list">${state.customManage.map(item=>`<button class="list-row screen-list-action" data-custom="${item.id}"><span class="row-icon"><i class="ph-duotone ph-notebook"></i></span><span class="row-main"><span class="row-title">${esc(item.name)}</span><span class="row-meta">${esc(item.note||'직접 관리 항목')}</span></span><i class="ph ph-caret-right"></i></button>`).join('')}</div>`:empty('plus-circle','직접 관리 항목이 없습니다','필요할 때만 추가하면 됩니다.')}
      </section>`;
    }
    els.main.innerHTML=`
      <nav class="manage-destinations" aria-label="관리 항목">
        <button type="button" class="manage-destination ${manageView==='recurring'?'active':''}" data-manage-view="recurring" aria-current="${manageView==='recurring'?'page':'false'}"><i class="ph-duotone ph-arrows-clockwise"></i><span>고정지출</span><small>${activeRecurring.length}개</small></button>
        <button type="button" class="manage-destination ${manageView==='vehicles'?'active':''}" data-manage-view="vehicles" aria-current="${manageView==='vehicles'?'page':'false'}"><i class="ph-duotone ph-car"></i><span>자동차</span><small>${vehicles.length}대</small></button>
        <button type="button" class="manage-destination ${manageView==='custom'?'active':''}" data-manage-view="custom" aria-current="${manageView==='custom'?'page':'false'}"><i class="ph-duotone ph-notebook"></i><span>직접 관리</span><small>${state.customManage.length}개</small></button>
      </nav>
      ${content}`;
    els.main.querySelectorAll('[data-manage-view]').forEach(btn=>btn.addEventListener('click',()=>{manageView=btn.dataset.manageView;render();}));
    els.main.querySelector('[data-action="add-recurring"]')?.addEventListener('click',()=>openRecurringEditSheet());
    els.main.querySelector('[data-action="add-vehicle"]')?.addEventListener('click',()=>openVehicleSheet());
    els.main.querySelector('[data-action="add-custom"]')?.addEventListener('click',openCustomManageSheet);
    els.main.querySelectorAll('[data-recurring]').forEach(btn=>btn.addEventListener('click',()=>openRecurringEditSheet(btn.dataset.recurring)));
    els.main.querySelectorAll('[data-vehicle]').forEach(btn=>btn.addEventListener('click',()=>openVehicleDetail(btn.dataset.vehicle)));
    els.main.querySelectorAll('[data-custom]').forEach(btn=>btn.addEventListener('click',()=>openCustomDetail(btn.dataset.custom)));
  }

  function renderVehicleCard(v){
    const oil=v.items.find(i=>i.name==='엔진오일')||v.items[0];
    let oilHtml='';
    if (oil && oil.lastKm!=null){
      const driven=Math.max(0,Number(v.currentKm)-Number(oil.lastKm));
      const leftMin=Math.max(0,Number(oil.minKm||0)-driven); const leftMax=Math.max(0,Number(oil.maxKm||0)-driven);
      const pct=oil.maxKm?Math.min(100,driven/Number(oil.maxKm)*100):0;
      oilHtml=`<div class="maintenance-row"><div class="maintenance-top"><strong>${esc(oil.name)}</strong><span>최근 ${currency.format(oil.lastKm)}km</span></div><div class="progress"><span style="width:${pct}%"></span></div><div class="maintenance-note">교체 후 ${currency.format(driven)}km 주행${oil.minKm&&oil.maxKm?` · 내 기준까지 ${currency.format(leftMin)}~${currency.format(leftMax)}km`:''}</div></div>`;
    }
    return `<button class="card manage-card" data-vehicle="${v.id}" style="width:100%;text-align:left;color:inherit;background:var(--surface)">
      <div class="manage-title"><span class="row-icon"><i class="ph-duotone ph-car"></i></span><div><h3>${esc(v.name)}</h3><p>${v.items.length}개 관리항목</p></div><i class="ph ph-caret-right" style="margin-left:auto;color:var(--text-2)"></i></div>
      <div class="odometer"><strong>${currency.format(v.currentKm||0)}</strong><span>km</span></div>${oilHtml}
    </button>`;
  }

  function openTransactionSheet(existingId=null){
    const existing=existingId?state.transactions.find(t=>t.id===existingId):null;
    const data=existing||{type:'expense',amount:'',category:state.expenseCategories[0],note:'',paymentMethod:state.paymentMethods[0],date:isoToday,shared:state.profile.defaultShared!==false};
    openSheet(existing?'내역 수정':'빠른 입력','가계부',transactionForm(data,!!existing));
    wireTransactionForm(existingId);
  }

  function transactionForm(data,isEdit){
    return `<form id="txForm">
      <div class="form-section"><div class="segmented"><button type="button" data-txtype="expense" class="${data.type==='expense'?'active':''}">지출</button><button type="button" data-txtype="income" class="${data.type==='income'?'active':''}">수입</button></div></div>
      <div class="form-section"><label class="form-label">금액 <span>금액만 입력해도 저장 가능</span></label><input id="txAmount" class="input amount-input" inputmode="numeric" pattern="[0-9]*" placeholder="0" value="${data.amount||''}" autofocus></div>
      <div class="form-section"><div class="form-label"><span>카테고리</span><button type="button" class="text-button" id="addCategoryInline">+ 추가</button></div><div class="chip-grid" id="categoryChips">${categoriesForType(data.type).map(c=>`<button type="button" class="chip ${c===data.category?'active':''}" data-category="${escAttr(c)}">${esc(c)}</button>`).join('')}</div></div>
      <div class="form-section inline-grid inline-grid-stack-mobile"><div><label class="form-label">날짜</label><input id="txDate" type="date" class="input" value="${data.date||isoToday}"></div><div><label class="form-label">결제수단</label><select id="txPayment" class="select">${state.paymentMethods.map(p=>`<option ${p===data.paymentMethod?'selected':''}>${esc(p)}</option>`).join('')}</select></div></div>
      <div class="form-section"><label class="form-label">내용 <span>선택</span></label><input id="txNote" class="input" placeholder="이마트, 점심, 쿠팡 등" value="${escAttr(data.note||'')}"></div>
      ${state.profile.mode!=='solo'?`<div class="form-section"><div class="switch-row"><div class="switch-copy"><strong>공동 내역으로 공유</strong><span>끄면 이 거래만 비공개로 저장됩니다.</span></div><input id="txShared" class="toggle" type="checkbox" ${data.shared!==false?'checked':''}></div></div>`:''}
      ${!isEdit?`<div class="form-section"><div class="switch-row"><div class="switch-copy"><strong>매달 반복</strong><span>날짜가 되면 자동으로 지출/수입에 반영합니다.</span></div><input id="txRecurring" class="toggle" type="checkbox"></div></div>`:''}
      <div class="button-row"><button type="button" class="secondary-button" id="txCancel">취소</button><button class="primary-button" type="submit">${isEdit?'수정':'저장'}</button></div>
      ${isEdit?`<div style="height:9px"></div><button type="button" class="danger-button" id="txDelete">이 내역 삭제</button>`:''}
    </form>`;
  }

  function wireTransactionForm(existingId){
    const existing=existingId?state.transactions.find(t=>t.id===existingId):null;
    let type=existing?.type||els.sheetBody.querySelector('[data-txtype].active')?.dataset.txtype||'expense';
    let category=existing?.category||els.sheetBody.querySelector('[data-category].active')?.dataset.category||categoriesForType(type)[0];

    const renderCategoryChips=()=>{
      const list=categoriesForType(type);
      if(!list.includes(category)) category=list[0];
      const wrap=document.getElementById('categoryChips');
      if(!wrap)return;
      wrap.innerHTML=list.map(c=>`<button type="button" class="chip ${c===category?'active':''}" data-category="${escAttr(c)}">${esc(c)}</button>`).join('');
      wrap.querySelectorAll('[data-category]').forEach(btn=>btn.addEventListener('click',()=>{
        category=btn.dataset.category;
        wrap.querySelectorAll('[data-category]').forEach(b=>b.classList.toggle('active',b===btn));
      }));
    };

    els.sheetBody.querySelectorAll('[data-txtype]').forEach(btn=>btn.addEventListener('click',()=>{
      type=btn.dataset.txtype;
      els.sheetBody.querySelectorAll('[data-txtype]').forEach(b=>b.classList.toggle('active',b===btn));
      category=categoriesForType(type)[0];
      renderCategoryChips();
    }));
    renderCategoryChips();

    document.getElementById('addCategoryInline')?.addEventListener('click',()=>{
      const draft={
        type,
        amount:document.getElementById('txAmount')?.value||'',
        category,
        note:document.getElementById('txNote')?.value||'',
        paymentMethod:document.getElementById('txPayment')?.value||state.paymentMethods[0],
        date:document.getElementById('txDate')?.value||isoToday,
        shared:state.profile.mode==='solo'?true:document.getElementById('txShared')?.checked!==false
      };
      openMiniAdd(`${type==='income'?'수입':'지출'} 카테고리 추가`,'새 카테고리 이름',name=>{
        const list=categoriesForType(type);
        if(!list.includes(name)){list.push(name);save();}
        closeSheet();
        openSheet(existing?'내역 수정':'빠른 입력','가계부',transactionForm({...draft,category:name},!!existing));
        wireTransactionForm(existingId);
        showToast('카테고리를 추가했습니다.');
      });
    });
    document.getElementById('txCancel').addEventListener('click',closeSheet);
    document.getElementById('txDelete')?.addEventListener('click',()=>{state.transactions=state.transactions.filter(t=>t.id!==existingId);save();closeSheet();render();showToast('내역을 삭제했습니다.');});
    document.getElementById('txForm').addEventListener('submit',e=>{
      e.preventDefault();
      const amount=Number(String(document.getElementById('txAmount').value).replace(/[^0-9.-]/g,''));
      if (!(amount>0)){showToast('금액을 입력해주세요.');return;}
      const item={id:existingId||uid(),type,amount,category,note:document.getElementById('txNote').value.trim(),paymentMethod:document.getElementById('txPayment').value,date:document.getElementById('txDate').value||isoToday,shared:state.profile.mode==='solo'?true:document.getElementById('txShared').checked,createdAt:existingId?(state.transactions.find(t=>t.id===existingId)?.createdAt||Date.now()):Date.now()};
      if(existingId){const idx=state.transactions.findIndex(t=>t.id===existingId);state.transactions[idx]=item;}else{state.transactions.push(item);}
      const recurring=document.getElementById('txRecurring');
      if(recurring?.checked){state.recurring.push({id:uid(),type,amount,category,note:item.note,paymentMethod:item.paymentMethod,day:parseISO(item.date).getDate(),autoPost:true,shared:item.shared,active:true});}
      save();closeSheet();render();showToast(existingId?'수정했습니다.':'저장했습니다.');
    });
  }

  function openTransactionDetail(id){ openTransactionSheet(id); }

  function openBudgetSheet(backAction=null){
    openSheet('예산 설정','이번 달',`<form id="budgetForm"><div class="form-section"><label class="form-label">전체 생활예산</label><input id="monthlyBudget" class="input" inputmode="numeric" value="${state.budget.monthly||''}" placeholder="2000000"></div><div class="form-section"><div class="form-label"><span>카테고리별 예산</span><span>필요한 것만</span></div>${state.expenseCategories.map(c=>`<div class="setting-row" style="padding-left:0;padding-right:0"><strong style="font-size:12px">${esc(c)}</strong><input class="input cat-budget" data-cat="${escAttr(c)}" inputmode="numeric" value="${state.budget.byCategory[c]||''}" placeholder="설정 안 함" style="width:150px;min-height:40px;text-align:right"></div>`).join('')}</div><button class="primary-button">저장</button></form>`,backAction);
    document.getElementById('budgetForm').addEventListener('submit',e=>{e.preventDefault();state.budget.monthly=Number(document.getElementById('monthlyBudget').value)||0;const next={};els.sheetBody.querySelectorAll('.cat-budget').forEach(i=>{const v=Number(i.value)||0;if(v>0)next[i.dataset.cat]=v;});state.budget.byCategory=next;save();render();if(backAction)backAction();else closeSheet();showToast('예산을 저장했습니다.');});
  }

  function openRecurringSheet(backAction=null){
    const entries=state.recurring;
    openSheet('고정지출 관리','매월 자동 반영',`
      <div class="subtle-box" style="margin-bottom:12px">이자, 학원비, 보험료처럼 매월 같은 금액이 나가는 항목을 등록하세요. 등록한 날짜가 되면 해당 월 내역으로 자동 기록됩니다.</div>
      <button class="primary-button" id="addRecurringBtn" style="margin-bottom:13px">+ 고정지출 추가</button>
      ${entries.length?`<div class="list">${entries.map(r=>{
        const kind=r.type==='income'?'반복수입':'고정지출';
        const status=r.active===false?'일시정지':(r.autoPost?'자동 반영':'확인 후 반영');
        const sign=r.type==='income'?'+':'-';
        return `<div class="list-row recurring-row" style="grid-template-columns:44px minmax(0,1fr) auto auto">
          <span class="row-icon"><i class="ph-duotone ph-arrows-clockwise"></i></span>
          <button class="recurring-main" data-recurring-edit="${escAttr(r.id)}" aria-label="${escAttr(r.note||r.category)} 수정"><span class="row-main"><span class="row-title">${esc(r.note||r.category)}</span><span class="row-meta">${kind} · 매월 ${Number(r.day)||1}일 · ${status}</span></span></button>
          <span class="row-amount ${r.type}">${sign}${fmtMoney(r.amount)}</span>
          <button class="icon-button" data-recurring-delete="${escAttr(r.id)}" aria-label="${escAttr(r.note||r.category)} 삭제" style="width:34px;height:34px"><i class="ph ph-trash"></i></button>
        </div>`;
        }).join('')}</div>`:empty('arrows-clockwise','등록된 고정지출이 없습니다','위의 추가 버튼에서 이자·학원비 등을 등록해보세요.')}`,backAction);
    document.getElementById('addRecurringBtn').addEventListener('click',()=>openRecurringEditSheet(null,()=>openRecurringSheet(backAction)));
    els.sheetBody.querySelectorAll('[data-recurring-edit]').forEach(btn=>btn.addEventListener('click',()=>openRecurringEditSheet(btn.dataset.recurringEdit,()=>openRecurringSheet(backAction))));
    els.sheetBody.querySelectorAll('[data-recurring-delete]').forEach(btn=>btn.addEventListener('click',()=>{state.recurring=state.recurring.filter(r=>r.id!==btn.dataset.recurringDelete);save();openRecurringSheet(backAction);showToast('반복내역을 삭제했습니다.');}));
  }

  function openRecurringEditSheet(existingId=null,backAction=null){
    const existing=existingId?state.recurring.find(item=>item.id===existingId):null;
    const data=existing||{type:'expense',amount:'',category:state.expenseCategories.includes('주거')?'주거':state.expenseCategories[0],note:'',paymentMethod:state.paymentMethods[0],day:1,autoPost:true,shared:state.profile.defaultShared!==false,active:true};
    openSheet(existing?'고정지출 수정':'고정지출 추가','매월 자동 반영',recurringForm(data,!!existing),backAction);
    wireRecurringForm(existingId,backAction);
  }

  function recurringForm(data,isEdit){
    const categories=categoriesForType(data.type);
    return `<form id="recurringForm">
      <div class="form-section"><div class="segmented"><button type="button" data-recurring-type="expense" class="${data.type==='expense'?'active':''}">고정지출</button><button type="button" data-recurring-type="income" class="${data.type==='income'?'active':''}">반복수입</button></div></div>
      <div class="form-section"><label class="form-label">매월 금액</label><input id="recurringAmount" class="input amount-input" inputmode="numeric" pattern="[0-9]*" placeholder="0" value="${data.amount||''}" autofocus></div>
      <div class="form-section"><div class="form-label"><span>카테고리</span><span>카테고리 설정에서 추가 가능</span></div><select id="recurringCategory" class="select">${categories.map(c=>`<option value="${escAttr(c)}" ${c===data.category?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="form-section inline-grid inline-grid-stack-mobile"><div><label class="form-label">매월 반영일</label><input id="recurringDay" class="input" type="number" min="1" max="31" inputmode="numeric" value="${Number(data.day)||1}"></div><div><label class="form-label">결제수단</label><select id="recurringPayment" class="select">${state.paymentMethods.map(p=>`<option ${p===data.paymentMethod?'selected':''}>${esc(p)}</option>`).join('')}</select></div></div>
      <div class="form-section"><label class="form-label">내용 <span>선택</span></label><input id="recurringNote" class="input" placeholder="예: 아파트 대출이자, 아이 학원비" value="${escAttr(data.note||'')}"></div>
      ${state.profile.mode!=='solo'?`<div class="form-section"><div class="switch-row"><div class="switch-copy"><strong>공동 내역으로 공유</strong><span>끄면 이 고정지출만 비공개로 저장됩니다.</span></div><input id="recurringShared" class="toggle" type="checkbox" ${data.shared!==false?'checked':''}></div></div>`:''}
      <div class="form-section"><div class="switch-row"><div class="switch-copy"><strong>매월 자동 기록</strong><span>반영일이 지나 앱을 열면 해당 월 내역을 자동으로 만듭니다.</span></div><input id="recurringAutoPost" class="toggle" type="checkbox" ${data.autoPost!==false?'checked':''}></div><div class="switch-row"><div class="switch-copy"><strong>사용 중</strong><span>잠시 멈출 때는 삭제하지 않고 꺼둘 수 있습니다.</span></div><input id="recurringActive" class="toggle" type="checkbox" ${data.active!==false?'checked':''}></div></div>
      <div class="button-row"><button type="button" class="secondary-button" id="recurringCancel">취소</button><button class="primary-button" type="submit">${isEdit?'수정':'등록'}</button></div>
      ${isEdit?`<div style="height:9px"></div><button type="button" class="danger-button" id="recurringDelete">고정지출 삭제</button>`:''}
    </form>`;
  }

  function wireRecurringForm(existingId,backAction=null){
    const existing=existingId?state.recurring.find(item=>item.id===existingId):null;
    let type=existing?.type||'expense';
    els.sheetBody.querySelectorAll('[data-recurring-type]').forEach(btn=>btn.addEventListener('click',()=>{
      type=btn.dataset.recurringType;
      els.sheetBody.querySelectorAll('[data-recurring-type]').forEach(item=>item.classList.toggle('active',item===btn));
      const category=document.getElementById('recurringCategory');
      const list=categoriesForType(type);
      category.innerHTML=list.map(item=>`<option value="${escAttr(item)}">${esc(item)}</option>`).join('');
    }));
    document.getElementById('recurringCancel').addEventListener('click',()=>backAction?backAction():closeSheet());
    document.getElementById('recurringDelete')?.addEventListener('click',()=>{
      state.recurring=state.recurring.filter(item=>item.id!==existingId);
      save();render();if(backAction)backAction();else closeSheet();showToast('고정지출을 삭제했습니다.');
    });
    document.getElementById('recurringForm').addEventListener('submit',event=>{
      event.preventDefault();
      const amount=Number(String(document.getElementById('recurringAmount').value).replace(/[^0-9.-]/g,''));
      const day=Number(document.getElementById('recurringDay').value);
      if (!(amount>0)){showToast('금액을 입력해주세요.');return;}
      if (!Number.isInteger(day)||day<1||day>31){showToast('매월 반영일은 1~31일로 입력해주세요.');return;}
      const item={
        id:existingId||uid(),type,amount,category:document.getElementById('recurringCategory').value,
        note:document.getElementById('recurringNote').value.trim(),paymentMethod:document.getElementById('recurringPayment').value,
        day,autoPost:document.getElementById('recurringAutoPost').checked,
        shared:state.profile.mode==='solo'?true:document.getElementById('recurringShared').checked,
        active:document.getElementById('recurringActive').checked
      };
      if(existingId){const index=state.recurring.findIndex(entry=>entry.id===existingId);if(index>=0)state.recurring[index]=item;}
      else state.recurring.push(item);
      save();processRecurring();render();if(backAction)backAction();else closeSheet();showToast(existingId?'고정지출을 수정했습니다.':'고정지출을 등록했습니다.');
    });
  }

  function openSettingsSheet(){
    const pref=state.preferences;
    const memberRole=currentUser?.role==='OWNER'?'관리자':'배우자';
    openSheet('설정','우리집 가계부',`
      <div class="settings-group"><p class="settings-title">사용 방식</p><div class="option-grid" id="modeOptions">${[['solo','나 혼자'],['couple','부부 공동'],['group','여러 명']].map(([v,l])=>`<button class="option ${state.profile.mode===v?'active':''}" data-mode="${v}">${l}</button>`).join('')}</div></div>
      <div class="settings-group"><p class="settings-title">화면 스타일</p><div class="option-grid" id="styleOptions">${[['default','기본'],['compact','컴팩트'],['classic','클래식']].map(([v,l])=>`<button class="option ${pref.style===v?'active':''}" data-style="${v}">${l}</button>`).join('')}</div></div>
      <div class="settings-group"><p class="settings-title">화면 테마</p><div class="option-grid" id="themeOptions">${[['system','시스템'],['light','라이트'],['dark','다크'],['ivory','아이보리'],['warm-ivory','웜 아이보리'],['mist','미스트'],['leaf','리프'],['rose','로즈']].map(([v,l])=>`<button class="option ${pref.theme===v?'active':''}" data-theme="${v}">${l}</button>`).join('')}</div></div>
      <div class="settings-group"><p class="settings-title">강조색</p><div class="accent-grid">${Object.entries(accentPresets).map(([name,color])=>`<button class="accent-swatch ${pref.accent===name?'active':''}" data-accent="${name}" aria-label="${name}" style="background:${color}"></button>`).join('')}<label class="accent-swatch ${pref.accent==='custom'?'active':''}" style="overflow:hidden;position:relative;background:${pref.customAccent||'#315d73'}"><input id="customAccent" type="color" value="${pref.customAccent||'#315d73'}" style="position:absolute;inset:-15px;width:80px;height:80px;opacity:0;cursor:pointer"></label></div></div>
      <div class="settings-group"><p class="settings-title">가계부</p><div class="settings-card">
        <button class="setting-row" id="budgetSetting" style="width:100%;border-top:0;border-left:0;border-right:0;background:transparent;text-align:left"><span class="setting-copy"><strong>예산</strong><span>${fmtMoney(state.budget.monthly||0)}</span></span><i class="ph ph-caret-right"></i></button>
        <button class="setting-row" id="recurringSetting" style="width:100%;border-top:0;border-left:0;border-right:0;background:transparent;text-align:left"><span class="setting-copy"><strong>고정지출 관리</strong><span>${state.recurring.filter(item=>item.active!==false).length}개 · 이자·학원비 매월 자동 기록</span></span><i class="ph ph-caret-right"></i></button>
        <button class="setting-row" id="categorySetting" style="width:100%;border-top:0;border-left:0;border-right:0;background:transparent;text-align:left"><span class="setting-copy"><strong>카테고리</strong><span>지출 ${state.expenseCategories.length}개 · 수입 ${state.incomeCategories.length}개</span></span><i class="ph ph-caret-right"></i></button>
        <button class="setting-row" id="paymentSetting" style="width:100%;border:0;background:transparent;text-align:left"><span class="setting-copy"><strong>결제수단</strong><span>${state.paymentMethods.length}개</span></span><i class="ph ph-caret-right"></i></button>
      </div></div>
      <div class="settings-group"><p class="settings-title">데이터</p><div class="settings-card">
        ${state.metadata.sample?`<button class="setting-row" id="clearSample" style="width:100%;border-top:0;border-left:0;border-right:0;background:transparent;text-align:left"><span class="setting-copy"><strong>예시 내역 지우기</strong><span>설정은 유지하고 거래만 비웁니다.</span></span><i class="ph ph-trash"></i></button>`:''}
        <button class="setting-row" id="exportData" style="width:100%;border:0;background:transparent;text-align:left"><span class="setting-copy"><strong>데이터 내보내기</strong><span>JSON 백업 파일</span></span><i class="ph ph-download-simple"></i></button>
      </div></div>
      <div class="settings-group"><p class="settings-title">공동 사용</p><div class="settings-card">
        ${publicDemoMode
          ? `<div class="setting-row"><span class="setting-copy"><strong>공개 계산용 모드</strong><span>이 기기의 브라우저에만 저장됩니다.</span></span><span class="badge accent">로컬</span></div><button class="setting-row" id="logoutBtn" style="width:100%;border:0;background:transparent;text-align:left"><span class="setting-copy"><strong>계산 데이터 초기화</strong><span>이 기기에 저장된 계산 내역을 지웁니다.</span></span><i class="ph ph-trash"></i></button>`
          : `<div class="setting-row"><span class="setting-copy"><strong>${esc(currentUser?.displayName||'사용자')}</strong><span>부부 전용 계정 · ${memberRole}</span></span><span class="badge accent">로그인됨</span></div>${currentUser?.role==='OWNER'?'<button class="setting-row" id="invitePartnerBtn" style="width:100%;border:0;background:transparent;text-align:left"><span class="setting-copy"><strong>배우자 초대코드 발급</strong><span>10분 동안 한 번 사용할 수 있는 코드입니다.</span></span><i class="ph ph-user-plus"></i></button>':''}<button class="setting-row" id="logoutBtn" style="width:100%;border:0;background:transparent;text-align:left"><span class="setting-copy"><strong>로그아웃</strong><span>이 기기에서 가계부 연결을 닫습니다.</span></span><i class="ph ph-sign-out"></i></button>`}
      </div></div>`);
    els.sheetBody.querySelectorAll('[data-mode]').forEach(btn=>btn.addEventListener('click',()=>{state.profile.mode=btn.dataset.mode;state.profile.defaultShared=true;save();openSettingsSheet();render();}));
    els.sheetBody.querySelectorAll('[data-style]').forEach(btn=>btn.addEventListener('click',()=>{state.preferences.style=btn.dataset.style;save();applyTheme();openSettingsSheet();}));
    els.sheetBody.querySelectorAll('[data-theme]').forEach(btn=>btn.addEventListener('click',()=>{state.preferences.theme=btn.dataset.theme;save();applyTheme();openSettingsSheet();}));
    els.sheetBody.querySelectorAll('[data-accent]').forEach(btn=>btn.addEventListener('click',()=>{state.preferences.accent=btn.dataset.accent;save();applyTheme();openSettingsSheet();}));
    document.getElementById('customAccent')?.addEventListener('input',e=>{state.preferences.customAccent=e.target.value;state.preferences.accent='custom';save();applyTheme();});
    document.getElementById('budgetSetting').addEventListener('click',()=>openBudgetSheet(openSettingsSheet));
    document.getElementById('recurringSetting').addEventListener('click',()=>openRecurringSheet(openSettingsSheet));
    document.getElementById('categorySetting').addEventListener('click',()=>openCategorySheet('expense',openSettingsSheet));
    document.getElementById('paymentSetting').addEventListener('click',()=>openPaymentSheet(openSettingsSheet));
    document.getElementById('clearSample')?.addEventListener('click',()=>{state.transactions=[];state.metadata.sample=false;state.metadata.recurringPosted={};save();render();openSettingsSheet();showToast('예시 내역을 지웠습니다.');});
    document.getElementById('exportData').addEventListener('click',exportData);
    document.getElementById('invitePartnerBtn')?.addEventListener('click',()=>issueInvite(openSettingsSheet));
    document.getElementById('logoutBtn').addEventListener('click',logout);
  }

  function openCategorySheet(kind='expense',backAction=null){
    const isIncome=kind==='income';
    const list=isIncome?state.incomeCategories:state.expenseCategories;
    const label=isIncome?'수입':'지출';
    openSheet('카테고리','수입·지출 별도 관리',`
      <div class="form-section"><div class="segmented"><button type="button" data-cat-kind="expense" class="${!isIncome?'active':''}">지출</button><button type="button" data-cat-kind="income" class="${isIncome?'active':''}">수입</button></div></div>
      <div class="list" style="margin-bottom:12px">${list.map(c=>`<div class="setting-row"><strong style="font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(c)}</strong><span style="display:flex;gap:6px"><button class="icon-button" data-cat-rename="${escAttr(c)}" aria-label="이름 변경" style="width:34px;height:34px"><i class="ph ph-pencil-simple"></i></button><button class="icon-button" data-cat-delete="${escAttr(c)}" aria-label="삭제" style="width:34px;height:34px"><i class="ph ph-trash"></i></button></span></div>`).join('')}</div>
      <div class="inline-grid" style="grid-template-columns:minmax(0,1fr) auto"><input id="newCategory" class="input" placeholder="새 ${label} 카테고리"><button id="newCategoryBtn" class="primary-button" style="width:auto">추가</button></div>`,backAction);

    els.sheetBody.querySelectorAll('[data-cat-kind]').forEach(btn=>btn.addEventListener('click',()=>openCategorySheet(btn.dataset.catKind,backAction)));
    els.sheetBody.querySelectorAll('[data-cat-delete]').forEach(btn=>btn.addEventListener('click',()=>{
      if(list.length<=1){showToast(`${label} 카테고리는 하나 이상 필요합니다.`);return;}
      const name=btn.dataset.catDelete;
      const idx=list.indexOf(name); if(idx>=0)list.splice(idx,1);
      if(!isIncome) delete state.budget.byCategory[name];
      save();openCategorySheet(kind,backAction);
    }));
    els.sheetBody.querySelectorAll('[data-cat-rename]').forEach(btn=>btn.addEventListener('click',()=>{
      const oldName=btn.dataset.catRename;
        openMiniAdd(`${label} 카테고리 이름 변경`,'새 이름',newName=>{
        newName=newName.trim();
        if(!newName||newName===oldName)return;
        if(list.includes(newName)){showToast('같은 이름의 카테고리가 있습니다.');return;}
        const idx=list.indexOf(oldName); if(idx>=0)list[idx]=newName;
        state.transactions.forEach(t=>{if(t.type===kind&&t.category===oldName)t.category=newName;});
        state.recurring.forEach(r=>{if(r.type===kind&&r.category===oldName)r.category=newName;});
        if(!isIncome&&Object.prototype.hasOwnProperty.call(state.budget.byCategory,oldName)){
          state.budget.byCategory[newName]=state.budget.byCategory[oldName];
          delete state.budget.byCategory[oldName];
        }
        save();openCategorySheet(kind,backAction);showToast('카테고리 이름을 변경했습니다.');
      },()=>openCategorySheet(kind,backAction));
      const input=document.getElementById('miniValue'); if(input)input.value=oldName;
    }));
    document.getElementById('newCategoryBtn').addEventListener('click',()=>{
      const name=document.getElementById('newCategory').value.trim();
      if(name&&!list.includes(name)){list.push(name);save();openCategorySheet(kind,backAction);}
    });
  }

  function openPaymentSheet(backAction=null){
    openSheet('결제수단','직접 이름 지정',`<div class="list" style="margin-bottom:12px">${state.paymentMethods.map(p=>`<div class="setting-row"><strong style="font-size:13px">${esc(p)}</strong><button class="icon-button" data-pay-delete="${escAttr(p)}" style="width:34px;height:34px"><i class="ph ph-trash"></i></button></div>`).join('')}</div><div class="inline-grid" style="grid-template-columns:1fr auto"><input id="newPayment" class="input" placeholder="예: 가족카드"><button id="newPaymentBtn" class="primary-button" style="width:auto">추가</button></div>`,backAction);
    els.sheetBody.querySelectorAll('[data-pay-delete]').forEach(btn=>btn.addEventListener('click',()=>{if(state.paymentMethods.length<=1){showToast('결제수단은 하나 이상 필요합니다.');return;}state.paymentMethods=state.paymentMethods.filter(p=>p!==btn.dataset.payDelete);save();openPaymentSheet(backAction);}));
    document.getElementById('newPaymentBtn').addEventListener('click',()=>{const name=document.getElementById('newPayment').value.trim();if(name&&!state.paymentMethods.includes(name)){state.paymentMethods.push(name);save();openPaymentSheet(backAction);}});
  }

  function openVehicleSheet(){
    openSheet('차량 추가','자동차 관리',`<form id="vehicleForm"><div class="form-section"><label class="form-label">차량 이름</label><input id="vehicleName" class="input" placeholder="내 자동차"></div><div class="form-section"><label class="form-label">현재 주행거리</label><input id="vehicleKm" class="input" inputmode="numeric" placeholder="68420"></div><button class="primary-button">차량 추가</button></form>`);
    document.getElementById('vehicleForm').addEventListener('submit',e=>{e.preventDefault();const name=document.getElementById('vehicleName').value.trim()||'내 자동차';const km=Number(document.getElementById('vehicleKm').value)||0;state.vehicles.push({id:uid(),name,currentKm:km,items:[{id:uid(),name:'엔진오일',lastDate:'',lastKm:null,minKm:8000,maxKm:10000,lastCost:0}]});save();closeSheet();render();showToast('차량을 추가했습니다.');});
  }

  function openVehicleDetail(id){
    const v=state.vehicles.find(x=>x.id===id); if(!v)return;
    openSheet(v.name,'자동차 관리',`<form id="vehicleEditForm"><div class="form-section"><label class="form-label">현재 주행거리</label><input id="currentKm" class="input" inputmode="numeric" value="${v.currentKm||0}"></div><button class="primary-button">주행거리 저장</button></form><div style="height:18px"></div><div class="section-head"><div><h2>관리항목</h2><p>엔진오일 외에는 직접 추가</p></div><button class="text-button" id="addMaintenance">+ 추가</button></div><div class="list">${v.items.map(item=>maintenanceRow(v,item)).join('')}</div><div style="height:14px"></div><button class="danger-button" id="deleteVehicle">차량 삭제</button>`);
    document.getElementById('vehicleEditForm').addEventListener('submit',e=>{e.preventDefault();v.currentKm=Number(document.getElementById('currentKm').value)||0;save();closeSheet();render();showToast('주행거리를 저장했습니다.');});
    document.getElementById('addMaintenance').addEventListener('click',()=>openMaintenanceSheet(id));
    document.getElementById('deleteVehicle').addEventListener('click',()=>{state.vehicles=state.vehicles.filter(x=>x.id!==id);save();closeSheet();render();showToast('차량을 삭제했습니다.');});
    els.sheetBody.querySelectorAll('[data-maint]').forEach(btn=>btn.addEventListener('click',()=>openMaintenanceSheet(id,btn.dataset.maint)));
  }

  function maintenanceRow(v,item){
    const driven=item.lastKm!=null?Math.max(0,Number(v.currentKm)-Number(item.lastKm)):null;
    return `<button class="list-row" data-maint="${item.id}" style="width:100%;border-left:0;border-right:0;border-top:0;text-align:left;color:inherit;background:transparent"><span class="row-icon"><i class="ph-duotone ph-wrench"></i></span><span class="row-main"><span class="row-title">${esc(item.name)}</span><span class="row-meta">${driven==null?'아직 교체기록 없음':`교체 후 ${currency.format(driven)}km 주행`}</span></span><i class="ph ph-caret-right" style="color:var(--text-2)"></i></button>`;
  }

  function openMaintenanceSheet(vehicleId,itemId=null){
    const v=state.vehicles.find(x=>x.id===vehicleId); if(!v)return;
    const item=itemId?v.items.find(x=>x.id===itemId):{id:uid(),name:'',lastDate:isoToday,lastKm:v.currentKm,minKm:'',maxKm:'',lastCost:''};
    openSheet(itemId?'관리항목 수정':'관리항목 추가',v.name,`<form id="maintForm"><div class="form-section"><label class="form-label">항목 이름</label><input id="maintName" class="input" value="${escAttr(item.name)}" placeholder="타이어, 미션오일 등"></div><div class="form-section inline-grid inline-grid-stack-mobile"><div><label class="form-label">교체 날짜</label><input id="maintDate" class="input" type="date" value="${item.lastDate||isoToday}"></div><div><label class="form-label">교체 당시 km</label><input id="maintKm" class="input" inputmode="numeric" value="${item.lastKm??v.currentKm??''}"></div></div><div class="form-section inline-grid"><div><label class="form-label">내 기준 최소 km</label><input id="maintMin" class="input" inputmode="numeric" value="${item.minKm||''}" placeholder="8000"></div><div><label class="form-label">내 기준 최대 km</label><input id="maintMax" class="input" inputmode="numeric" value="${item.maxKm||''}" placeholder="10000"></div></div><div class="form-section"><label class="form-label">비용 <span>선택</span></label><input id="maintCost" class="input" inputmode="numeric" value="${item.lastCost||''}"></div><div class="form-section"><div class="switch-row"><div class="switch-copy"><strong>비용을 가계부에도 기록</strong><span>비용이 있을 때 차량 지출로 함께 저장합니다.</span></div><input id="maintToLedger" class="toggle" type="checkbox"></div></div><button class="primary-button">저장</button>${itemId?`<div style="height:9px"></div><button type="button" class="danger-button" id="deleteMaint">항목 삭제</button>`:''}</form>`);
    document.getElementById('maintForm').addEventListener('submit',e=>{e.preventDefault();const next={...item,name:document.getElementById('maintName').value.trim()||'관리항목',lastDate:document.getElementById('maintDate').value,lastKm:Number(document.getElementById('maintKm').value)||0,minKm:Number(document.getElementById('maintMin').value)||0,maxKm:Number(document.getElementById('maintMax').value)||0,lastCost:Number(document.getElementById('maintCost').value)||0};if(itemId){const idx=v.items.findIndex(x=>x.id===itemId);v.items[idx]=next;}else v.items.push(next);if(document.getElementById('maintToLedger').checked&&next.lastCost>0){state.transactions.push(tx('expense',next.lastCost,'차량',`${v.name} ${next.name}`,state.paymentMethods[0],next.lastDate||isoToday,state.profile.defaultShared!==false));}save();closeSheet();render();showToast('관리기록을 저장했습니다.');});
    document.getElementById('deleteMaint')?.addEventListener('click',()=>{v.items=v.items.filter(x=>x.id!==itemId);save();closeSheet();render();showToast('관리항목을 삭제했습니다.');});
  }

  function openCustomManageSheet(){
    openSheet('직접 관리 추가','필요할 때만',`<form id="customForm"><div class="form-section"><label class="form-label">이름</label><input id="customName" class="input" placeholder="직접 관리할 항목"></div><div class="form-section"><label class="form-label">메모 <span>선택</span></label><textarea id="customNote" class="textarea" rows="3" placeholder="관리 방법이나 기준을 자유롭게 기록"></textarea></div><button class="primary-button">추가</button></form>`);
    document.getElementById('customForm').addEventListener('submit',e=>{e.preventDefault();const name=document.getElementById('customName').value.trim();if(!name){showToast('이름을 입력해주세요.');return;}state.customManage.push({id:uid(),name,note:document.getElementById('customNote').value.trim(),logs:[]});save();closeSheet();render();showToast('관리항목을 추가했습니다.');});
  }

  function openCustomDetail(id){
    const item=state.customManage.find(x=>x.id===id);if(!item)return;
    openSheet(item.name,'직접 관리',`<div class="form-section"><div class="subtle-box">${esc(item.note||'메모가 없습니다.')}</div></div><button class="danger-button" id="deleteCustom">관리항목 삭제</button>`);
    document.getElementById('deleteCustom').addEventListener('click',()=>{state.customManage=state.customManage.filter(x=>x.id!==id);save();closeSheet();render();showToast('관리항목을 삭제했습니다.');});
  }

  function showPrivateInfo(){
    if(state.profile.mode==='solo'){showToast('혼자 사용 중이라 모든 내역이 내 기록입니다.');return;}
    const count=state.transactions.filter(t=>t.shared===false).length;
    openSheet('비공개 내역','공동 가계부',count?`<div class="list">${state.transactions.filter(t=>t.shared===false).sort((a,b)=>b.date.localeCompare(a.date)).map(transactionRow).join('')}</div>`:empty('eye-slash','비공개 내역이 없습니다','공동 내역이 기본이며 거래별로 비공개할 수 있습니다.'));
    els.sheetBody.querySelectorAll('[data-txid]').forEach(btn=>btn.addEventListener('click',()=>openTransactionSheet(btn.dataset.txid)));
  }

  function openMiniAdd(title,placeholder,onSave,backAction=null){
    openSheet(title,'직접 추가',`<form id="miniForm"><div class="form-section"><input id="miniValue" class="input" placeholder="${escAttr(placeholder)}" autofocus></div><button class="primary-button">추가</button></form>`,backAction);
    document.getElementById('miniForm').addEventListener('submit',e=>{e.preventDefault();const value=document.getElementById('miniValue').value.trim();if(value)onSave(value);});
  }

  function exportData(){
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`household-ledger-${isoToday}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('백업 파일을 만들었습니다.');
  }

  function applyTheme(){
    const p=state.preferences; let resolved=p.theme||'system';
    if(resolved==='system') resolved=systemThemeQuery?.matches?'dark':'light';
    document.documentElement.dataset.theme=resolved;
    document.documentElement.dataset.themePreference=p.theme||'system';
    document.documentElement.dataset.style=p.style||'compact';
    document.documentElement.style.colorScheme=resolved==='dark'?'dark':'light';
    document.body?.style.setProperty('background-color','var(--bg)');
    document.getElementById('app')?.style.setProperty('background-color','var(--bg)');
    const accent=p.accent==='custom'?p.customAccent:(accentPresets[p.accent]||accentPresets.slate);
    const strong=mix(accent,resolved==='dark'?'#ffffff':'#000000',resolved==='dark'?.35:.22);
    const soft=mix(accent,resolved==='dark'?'#191e21':'#ffffff',.84);
    document.documentElement.style.setProperty('--accent-source',accent);
    document.documentElement.style.setProperty('--accent',accent);
    document.documentElement.style.setProperty('--accent-strong',strong);
    document.documentElement.style.setProperty('--accent-soft',soft);
    document.documentElement.style.setProperty('--accent-contrast',contrastText(accent));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',resolved==='dark'?'#101416':getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()||'#f3f5f6');
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content',resolved==='dark'?'dark':'light');
  }

  function mix(a,b,ratio){
    const pa=hexRgb(a),pb=hexRgb(b);return '#'+pa.map((v,i)=>Math.round(v+(pb[i]-v)*ratio).toString(16).padStart(2,'0')).join('');
  }
  function hexRgb(hex){hex=hex.replace('#','');if(hex.length===3)hex=hex.split('').map(x=>x+x).join('');return [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));}
  function contrastText(hex){const [r,g,b]=hexRgb(hex).map(v=>v/255);const lum=.2126*r+.7152*g+.0722*b;return lum>.57?'#101416':'#ffffff';}

  function openSheet(title,eyebrow,html,backAction=null){
    sheetBackAction=typeof backAction==='function'?backAction:null;
    els.sheetTitle.textContent=title;
    els.sheetEyebrow.textContent=eyebrow||'';
    els.sheetBackBtn.hidden=!sheetBackAction;
    els.sheetBody.innerHTML=html;
    els.sheet.hidden=false;
    els.backdrop.hidden=false;
    document.body.style.overflow='hidden';
    setTimeout(()=>els.sheetBody.querySelector('[autofocus]')?.focus(),30);
  }
  function closeSheet(){sheetBackAction=null;els.sheetBackBtn.hidden=true;els.sheet.hidden=true;els.backdrop.hidden=true;els.sheetBody.innerHTML='';document.body.style.overflow='';}
  function showToast(msg){clearTimeout(toastTimer);els.toast.textContent=msg;els.toast.classList.add('show');toastTimer=setTimeout(()=>els.toast.classList.remove('show'),1800);}
  function empty(icon,title,desc){return `<div class="card empty-state"><i class="ph-duotone ph-${icon}"></i><strong>${title}</strong><p>${desc}</p></div>`;}
  function esc(v=''){return String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
  function escAttr(v=''){return esc(v).replace(/'/g,'&#39;');}
})();

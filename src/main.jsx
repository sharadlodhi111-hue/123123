import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDown, ArrowRight, ArrowUpRight, Bell, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Flame, FlaskConical, FolderOpen, GraduationCap, LayoutDashboard, LogOut, Menu, Moon, MoreHorizontal, Plus, Search, Settings, Sparkles, Sun, Target, TrendingUp, X } from 'lucide-react';
import { chapterList, SUBJECTS, STATUS, statusLabel } from './syllabus';
import { supabase, loadStudentData, saveStudentData } from './backend';
import './styles.css';

const ResourceLibrary = React.lazy(() => import('./resources').then(module => ({ default: module.ResourceLibrary })));

const STORE = 'studywell:v1:';
const todayKey = () => new Date().toLocaleDateString('en-CA');
const fresh = () => ({ profile: { name: '', class: '10', session: '2026–27', dailyHours: 3, examDate: '2027-02-15', holidays: ['Sunday'] }, statuses: {}, tasks: [], sessions: [], generated: false, streak: 0, completedDates: [] });
const studyStreak = dates => {
  const done = new Set(dates || []);
  let cursor = new Date();
  let key = cursor.toLocaleDateString('en-CA');
  if (!done.has(key)) { cursor.setDate(cursor.getDate() - 1); key = cursor.toLocaleDateString('en-CA'); }
  let total = 0;
  while (done.has(key)) { total++; cursor.setDate(cursor.getDate() - 1); key = cursor.toLocaleDateString('en-CA'); }
  return total;
};
const normalizeData = value => { const base = fresh(); return { ...base, ...(value || {}), profile: { ...base.profile, ...(value?.profile || {}) }, statuses: value?.statuses || {}, tasks: Array.isArray(value?.tasks) ? value.tasks : [], chapterWork: value?.chapterWork || {}, completedDates: Array.isArray(value?.completedDates) ? value.completedDates : [] }; };
const safeRead = id => { try { return normalizeData(JSON.parse(localStorage.getItem(STORE + id))); } catch { return fresh(); } };
const initials = name => (name || 'Student').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
const prettyDate = date => new Intl.DateTimeFormat('en-IN', { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
const minutesLabel = n => `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ''}`;
function timeMinutes(value) {
  const m = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]), min = Number(m[2] || 0);
  if (m[3]) { const pm = m[3].toLowerCase() === 'pm'; h = h % 12 + (pm ? 12 : 0); }
  return h * 60 + min;
}
function makePlan(data) {
  const hours = Math.max(1, Math.min(10, Number(data.profile.dailyHours) || 3));
  const slots = Math.floor(hours * 60 / 50);
  const candidates = chapterList.map(c => {
    const s = data.statuses[c.id] || 'not-started';
    const weight = (s === 'not-started' ? 4 : s === 'partial' ? 3 : 1) * c.difficulty * (c.formativeOnly ? .45 : 1);
    return { ...c, s, weight };
  }).sort((a, b) => {
    const hash = value => [...value].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
    return hash(a.id) - hash(b.id);
  });
  const totalWeight = candidates.reduce((n, c) => n + c.weight, 0);
  const due = new Date(`${data.profile.examDate || '2027-02-15'}T12:00:00`);
  const days = Math.max(7, Math.min(120, Math.ceil((due - new Date()) / 86400000)));
  const output = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(); date.setDate(date.getDate() + d);
    if ((data.profile.holidays || []).includes(date.toLocaleDateString('en-US', { weekday: 'long' }))) continue;
    const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
    let session = 0, lastEnd = -1;
    for (let j = 0; j < slots; j++) {
      let startMinute = timeMinutes('16:00') + j * 60;
      startMinute = Math.max(startMinute, lastEnd);
      if (startMinute + 50 > 23 * 60) continue;
      const cursor = ((d * slots + j) * 37) % totalWeight;
      let cumulative = 0;
      const chapter = candidates.find(c => (cumulative += c.weight) > cursor) || candidates[0];
      if (!chapter) continue;
      const kind = chapter.s === 'completed' ? ['Revision', 'NCERT questions', 'PYQ practice'][j % 3] : chapter.s === 'partial' ? ['Finish concepts', 'Targeted practice', 'Quick revision'][j % 3] : ['Learn concepts', 'NCERT reading', 'Practice questions'][j % 3];
      const dateKey = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const time = `${String(Math.floor(startMinute / 60)).padStart(2,'0')}:${String(startMinute % 60).padStart(2,'0')}`;
      output.push({ id: `${dateKey}-${session}-${chapter.id}`, date: dateKey, time, subject: chapter.group || chapter.subject, chapterId: chapter.id, chapter: chapter.name, title: kind, duration: 50, done: false, kind });
      lastEnd = startMinute + 50;
      session++;
    }
  }
  return output;
}

function App() {
  const [auth, setAuth] = useState(null);
  const [page, setPage] = useState('Dashboard');
  const [data, setData] = useState(fresh);
  const [authMode, setAuthMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All chapters');
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(localStorage.getItem('murlidhar:theme') === 'dark');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [modal, setModal] = useState('');
  const [activeChapter, setActiveChapter] = useState(null);
  const [draftTask, setDraftTask] = useState('');
  const [name, setName] = useState('');

  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('murlidhar:theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
    else Promise.all([
      navigator.serviceWorker.getRegistrations().then(registrations => registrations.map(registration => registration.unregister())),
      'caches' in window ? caches.keys().then(keys => keys.filter(key => key.startsWith('murlidhar-shell-')).map(key => caches.delete(key))) : Promise.resolve([])
    ]).catch(() => {});
  }, []);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(async ({ data: { session } }) => { if (session) await enter(session.user); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { if (!session) { setAuth(null); setData(fresh()); } });
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (!auth) return; const id = auth.id; localStorage.setItem(STORE + id, JSON.stringify(data)); if (auth.real) saveStudentData(id, data).catch(() => setNotice('Cloud sync is temporarily unavailable. Your changes are saved on this device.')); }, [data, auth]);

  async function enter(user, local = false) {
    const userId = local ? `demo-${user.id}` : user.id;
    let loaded = local ? safeRead(userId) : normalizeData((await loadStudentData(user.id).catch(() => null)) || safeRead(userId));
    const accountLabel = user.email || user.phone || '';
    if (local && !loaded.profile.name) loaded.profile.name = user.name || accountLabel;
    setData(loaded); setAuth({ id: userId, email: user.email || '', admin: user.app_metadata?.role === 'admin', real: !local, name: loaded.profile.name || user.user_metadata?.full_name || user.name || accountLabel });
    if (!loaded.profile.name || !loaded.profile.examDate) setShowOnboarding(true);
  }
  async function signInWithGoogle() {
    setBusy(true);
    try {
      if (!supabase) throw new Error('Connect Supabase and enable Google under Authentication → Sign-in methods to use Google sign-in.');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      });
      if (error) throw error;
    } catch (err) { setNotice(err.message || 'Google sign-in could not be started. Please try again.'); }
    finally { setBusy(false); }
  }
  function demoLogin() { enter({ id: 'preview-student', name: name || 'Aarav Sharma' }, true); }
  function logout() { if (auth?.real) supabase.auth.signOut(); else { setAuth(null); setData(fresh()); } }
  const statusCounts = useMemo(() => chapterList.reduce((a, c) => { a[data.statuses[c.id] || 'not-started']++; return a; }, { completed: 0, partial: 0, 'not-started': 0 }), [data.statuses]);
  const completion = Math.round((statusCounts.completed + statusCounts.partial * .5) / chapterList.length * 100);
  const today = todayKey();
  const todayTasks = data.tasks.filter(t => t.date === today);
  const doneToday = todayTasks.filter(t => t.done).length;
  const elapsed = Math.max(0, Math.ceil((new Date(`${data.profile.examDate || '2027-02-15'}T12:00:00`) - new Date()) / 86400000));
  const filteredChapters = chapterList.filter(c => (filter === 'All chapters' || c.subject === filter || c.group === filter) && c.name.toLowerCase().includes(search.toLowerCase()));
  const weeklyTasks = data.tasks.filter(t => { const diff = (new Date(t.date + 'T12:00:00') - new Date()) / 86400000; return diff >= -6 && diff <= 0; });
  
  function replanFuture(d, statuses) {
    if (!d.generated) return d.tasks;
    const replacement = makePlan({ ...d, statuses }).filter(t => t.date > today);
    const kept = d.tasks.filter(t => t.date <= today || t.done);
    const ids = new Set(kept.map(t => t.id));
    return [...kept, ...replacement.filter(t => !ids.has(t.id))];
  }
  function updateStatus(id, status) { setData(d => { const statuses = { ...d.statuses, [id]: status }; return { ...d, statuses, tasks: replanFuture(d, statuses) }; }); }
  function updateChapterWork(id, key, checked) { setData(d => { const chapterWork = { ...d.chapterWork, [id]: { ...d.chapterWork?.[id], [key]: checked } }; const done = Object.values(chapterWork[id]).filter(Boolean).length; const statuses = { ...d.statuses, [id]: done === 6 ? 'completed' : done ? 'partial' : 'not-started' }; return { ...d, chapterWork, statuses, tasks: replanFuture(d, statuses) }; }); }
  function toggleTask(id) { setData(d => { const tasks = d.tasks.map(t => t.id === id ? { ...t, done: !t.done } : t); const task = tasks.find(t => t.id === id); const statuses = { ...d.statuses }; if (task?.done && task.chapterId && (!statuses[task.chapterId] || statuses[task.chapterId] === 'not-started')) statuses[task.chapterId] = 'partial'; const completedDates = task?.done ? [...new Set([...d.completedDates, task.date])] : d.completedDates; return { ...d, tasks: replanFuture({ ...d, tasks }, statuses), statuses, completedDates, streak: studyStreak(completedDates) }; }); }
  function postponeTask(id) { setData(d => ({ ...d, tasks: d.tasks.map(t => t.id === id ? { ...t, date: new Date(Date.now() + 86400000).toLocaleDateString('en-CA') } : t) })); }
  function generatePlan() { const tasks = makePlan(data); setData(d => ({ ...d, tasks, generated: true })); setNotice(`Your plan is ready — ${tasks.length} study blocks mapped around your available hours.`); setPage('Today’s Plan'); }
  useEffect(() => { const handle = () => generatePlan(); window.addEventListener('murlidhar:generate', handle); return () => window.removeEventListener('murlidhar:generate', handle); }, [data]);
  function saveProfile(e) { e.preventDefault(); const savedName = name || data.profile.name; setData(d => ({ ...d, profile: { ...d.profile, name: savedName, class: '10', session: '2026–27', dailyHours: Number(d.profile.dailyHours) || 3 } })); setAuth(a => ({ ...a, name: savedName || a.name })); setShowOnboarding(false); setNotice('Your study profile is saved.'); }
  function addTask(e) { e.preventDefault(); if (!draftTask.trim()) return; const item = { id: `personal-${Date.now()}`, date: today, time: '20:00', subject: 'Personal', chapterId: '', chapter: 'Personal task', title: draftTask.trim(), duration: 30, done: false, kind: 'Personal' }; setData(d => ({ ...d, tasks: [...d.tasks, item] })); setDraftTask(''); setModal(''); }
  function clearProgress() { if (window.confirm('Reset all chapter and planner progress for this account? This cannot be undone.')) { setData(fresh()); setModal(''); } }

  if (!auth) return (
    <div className="auth-shell">
      <div className="auth-art">
        <div className="brand"><img className="brand-logo" src="/murlidhar-classes.jpg" alt="Murlidhar Classes teacher" /><span className="brand-name">MURLIDHAR CLASSES</span></div>
        <div className="auth-art-content">
          <span className="eyebrow">CBSE CLASS X · 2026–27</span>
          <h1>Plan Smart.<br/>Study Better.<br/>Achieve More.</h1>
          <p>Your Science preparation, shaped around your progress and your real week.</p>
          <div className="auth-art-card"><div className="streak-icon"><Flame size={18}/></div><div><strong>Consistency beats cramming.</strong><span>Make today count, one focused block at a time.</span></div><ArrowUpRight size={18}/></div>
        </div>
        <div className="auth-art-footer">MURLIDHAR CLASSES · Your Success, Our Mission.</div>
      </div>
      <main className="auth-main">
        <div className="auth-top"><span>{authMode === 'signup' ? 'Already have an account?' : 'New student?'}</span><button className="text-button" onClick={() => { setAuthMode(authMode === 'signup' ? 'login' : 'signup'); setNotice(''); }}>{authMode === 'signup' ? 'Sign in' : 'Create account'}</button></div>
        <section className="auth-form-wrap">
          <span className="eyebrow">{authMode === 'signup' ? 'GET STARTED' : 'WELCOME BACK'}</span>
          <h2>{authMode === 'signup' ? 'Create your student account' : 'Continue with Google'}</h2>
          <p className="muted">{authMode === 'signup' ? 'Use your Google account to create a secure student profile.' : 'Sign in securely with the Google account on this device.'}</p>
          <button type="button" className="google-signin-button" onClick={signInWithGoogle} disabled={busy}>
            <span className="google-mark" aria-hidden="true">G</span>{busy ? 'Opening Google…' : authMode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}<ArrowRight size={17}/>
          </button>
          {!supabase && <div className="demo-callout"><div><strong>Local preview</strong><p>Google sign-in uses Supabase Auth. Preview data stays in this browser.</p></div><button className="secondary-button" onClick={demoLogin}>Open preview</button></div>}
          {notice && <div className="notice" role="status">{notice}</div>}
          <div className="auth-privacy"><CheckCircle2 size={16}/> Google secures your sign-in<span>·</span> Your study progress stays private</div>
          <div className="auth-switch">{authMode === 'signup' ? 'Already registered?' : 'New to Murlidhar Classes?'} <button onClick={() => { setAuthMode(authMode === 'signup' ? 'login' : 'signup'); setNotice(''); }} className="text-button">{authMode === 'signup' ? 'Sign in' : 'Create an account'}</button></div>
        </section>
      </main>
    </div>
  );

  const nav = [{ label: 'OVERVIEW', items: [{ n: 'Dashboard', I: LayoutDashboard }, { n: 'Today’s Plan', label: 'My Study Plan', I: Target }, { n: 'Weekly Planner', I: CalendarDays }] }, { label: 'YOUR STUDY', items: [{ n: 'Chapter Tracker', I: BookOpen }, { n: 'Resource Library', I: FolderOpen }] }];
  const selectedPage = <>
    {page === 'Dashboard' && <Dashboard data={data} counts={statusCounts} completion={completion} elapsed={elapsed} tasks={todayTasks} doneToday={doneToday} setPage={setPage} toggleTask={toggleTask} setModal={setModal} weekly={weeklyTasks} />}
    {page === 'Today’s Plan' && <TodayPage data={data} todayTasks={todayTasks} doneToday={doneToday} toggleTask={toggleTask} postpone={postponeTask} setModal={setModal} setPage={setPage} />}
    {page === 'Weekly Planner' && <WeeklyPage data={data} toggleTask={toggleTask} setPage={setPage} />}
    {page === 'Chapter Tracker' && <ChaptersPage data={data} chapters={filteredChapters} filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} updateStatus={updateStatus} counts={statusCounts} completion={completion} openChapter={setActiveChapter} />}
    {page === 'Resource Library' && <React.Suspense fallback={<div className="resource-empty"><span>Opening resource library…</span></div>}><ResourceLibrary auth={auth} /></React.Suspense>}
    {page === 'Settings' && <SettingsPage data={data} setData={setData} setDark={setDark} dark={dark} setName={setName} auth={auth} onReset={clearProgress} />}
  </>;

  return <div className="app-shell"><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="brand"><img className="brand-logo small" src="/murlidhar-classes.jpg" alt="" /><span className="brand-name">MURLIDHAR CLASSES</span></div><div className="sidebar-session"><span className="session-dot"/> CLASS X <span>2026–27</span></div><nav>{nav.map(section => <div className="nav-section" key={section.label}><span className="nav-label">{section.label}</span>{section.items.map(({ n, I, label }) => <button className={`nav-item ${page === n ? 'active' : ''}`} key={n} onClick={() => { setPage(n); setMenuOpen(false); }}><I size={18}/>{label || n}{n === 'Today’s Plan' && todayTasks.some(t => !t.done) && <span className="nav-count">{todayTasks.filter(t => !t.done).length}</span>}</button>)}</div>)}</nav><div className="sidebar-bottom"><div className="sidebar-tip"><div className="tip-icon"><Sparkles size={15}/></div><strong>Small steps add up.</strong><p>You’ve got this. Keep showing up for yourself.</p><button onClick={() => setPage('Chapter Tracker')}>View progress <ArrowRight size={13}/></button></div><button className={`nav-item ${page === 'Settings' ? 'active' : ''}`} onClick={() => { setPage('Settings'); setMenuOpen(false); }}><Settings size={18}/>Profile / Settings</button><div className="profile-mini"><div className="avatar">{initials(auth.name)}</div><div className="profile-lines"><strong>{auth.name || 'Student'}</strong><span>{auth.real ? auth.email : 'Local preview'}</span></div><button className="icon-button" title="Sign out" onClick={logout}><LogOut size={16}/></button></div></div></aside>{menuOpen && <button className="backdrop" onClick={() => setMenuOpen(false)} aria-label="Close navigation"/>}<main className="main-area"><header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)}><Menu size={19}/></button><div className="breadcrumbs"><span>Murlidhar Classes</span><ChevronRight size={14}/><strong>{page}</strong></div><div className="topbar-actions"><div className="date-chip"><CalendarDays size={15}/>{prettyDate(new Date())}</div><button className="icon-button theme-toggle" onClick={() => setDark(!dark)} title="Toggle colour theme">{dark ? <Sun size={18}/> : <Moon size={18}/>}</button><button className="icon-button" title="Help"><CircleHelp size={18}/></button><div className="avatar avatar-small">{initials(auth.name)}</div></div></header><div className="page-content">{selectedPage}</div></main>{notice && auth && <div className="toast"><CheckCircle2 size={16}/>{notice}<button onClick={() => setNotice('')}><X size={14}/></button></div>}{(modal === 'task' || showOnboarding) && <div className="modal-backdrop"><div className="modal"><button className="modal-close" onClick={() => { setModal(''); setShowOnboarding(false); }}><X size={18}/></button>{showOnboarding ? <OnboardingForm data={data} setData={setData} name={name} setName={setName} onSave={saveProfile}/> : <><span className="eyebrow">ADD A PERSONAL TARGET</span><h2>Make it your own</h2><form className="stack-form" onSubmit={addTask}><label>What would you like to study?<input autoFocus value={draftTask} onChange={e => setDraftTask(e.target.value)} placeholder="e.g. Revise chemical equations" required/></label><button className="primary-button full">Add to today <Plus size={16}/></button></form></>}</div></div>}{activeChapter && <ChapterWorkModal chapter={activeChapter} work={data.chapterWork?.[activeChapter.id] || {}} onChange={(key, checked) => updateChapterWork(activeChapter.id, key, checked)} onClose={() => setActiveChapter(null)} />}</div>;
}

function OnboardingForm({ data, setData, name, setName, onSave }) {
  const profile = data.profile;
  const update = (key, value) => setData(d => ({ ...d, profile: { ...d.profile, [key]: value } }));
  const toggleHoliday = day => update('holidays', (profile.holidays || []).includes(day) ? profile.holidays.filter(item => item !== day) : [...(profile.holidays || []), day]);
  return <>
    <span className="eyebrow">A PLAN THAT FITS YOUR LIFE</span><h2>Set up your study space</h2><p className="muted">A few details help us shape a realistic Class 10 Science timetable.</p>
    <form className="stack-form" onSubmit={onSave}>
      <label>Student name<input value={name || profile.name || ''} onChange={e => setName(e.target.value)} placeholder="Student name" required/></label>
      <div className="form-row"><label>Class<input value="Class 10" readOnly/></label><label>Academic session<input value="2026–27" readOnly/></label></div>
      <div className="form-row"><label>Daily study hours<input type="number" min="1" max="8" step="0.5" value={profile.dailyHours} onChange={e => update('dailyHours', e.target.value)} required/></label><label>Board exam date<input type="date" value={profile.examDate || ''} onChange={e => update('examDate', e.target.value)} required/></label></div>
      <fieldset className="holiday-picker"><legend>Weekly holidays</legend><div className="holiday-days">{['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day => <label key={day}><input type="checkbox" checked={(profile.holidays || []).includes(day)} onChange={() => toggleHoliday(day)}/><span>{day.slice(0,3)}</span></label>)}</div></fieldset>
      <button className="primary-button full">Save my profile <ArrowRight size={16}/></button>
    </form>
  </>;
}
function PageHeading({ eyebrow, title, subtitle, right }) { return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{right}</div>; }
function ProgressRing({ value, size = 118 }) { const r = 43, c = 2 * Math.PI * r, offset = c - value / 100 * c; return <svg className="progress-ring" width={size} height={size} viewBox="0 0 100 100"><circle cx="50" cy="50" r={r} className="ring-bg"/><circle cx="50" cy="50" r={r} className="ring-value" strokeDasharray={c} strokeDashoffset={offset} transform="rotate(-90 50 50)"/><text x="50" y="47" className="ring-number" textAnchor="middle">{value}%</text><text x="50" y="64" className="ring-caption" textAnchor="middle">complete</text></svg>; }
function Dashboard({ data, counts, completion, elapsed, tasks, doneToday, setPage, toggleTask, setModal, weekly }) {
 const pct = tasks.length ? Math.round(doneToday / tasks.length * 100) : 0;
 return <><PageHeading eyebrow={`${new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase()}`} title={`Good ${new Date().getHours() < 12 ? 'morning' : 'evening'}, ${data.profile.name.split(' ')[0] || 'there'} 👋`} subtitle="Your steady progress is adding up. Here’s your day at a glance." right={<button className="primary-button" onClick={() => setPage('Chapter Tracker')}>Plan my week <ArrowRight size={16}/></button>}/><div className="hero-row"><div className="hero-card"><div className="hero-copy"><span className="eyebrow light">YOUR BOARD COUNTDOWN</span><h2>One day closer<br/>to your goal.</h2><p>A little focused effort today can make tomorrow feel easier.</p><div className="countdown"><strong>{elapsed}</strong><span>days<br/>to boards</span><span className="countdown-divider"/><div><small>SESSION</small><b>CBSE · Class X</b></div></div></div><div className="hero-art"><div className="sun-circle"/><div className="book-stack"><div/><div/><div/></div><div className="hero-spark spark-a">✦</div><div className="hero-spark spark-b">✧</div></div></div><div className="summary-card"><div className="card-heading"><div><span className="eyebrow">SYLLABUS OVERVIEW</span><h3>You’re building momentum</h3></div><button className="icon-button" onClick={() => setPage('Chapter Tracker')}><ArrowUpRight size={18}/></button></div><div className="summary-main"><ProgressRing value={completion}/><div className="summary-stats"><div><span className="status-dot green-dot"/><span>Completed</span><strong>{counts.completed}</strong></div><div><span className="status-dot amber-dot"/><span>Partially completed</span><strong>{counts.partial}</strong></div><div><span className="status-dot gray-dot"/><span>Not started</span><strong>{counts['not-started']}</strong></div></div></div><button className="link-button" onClick={() => setPage('Chapter Tracker')}>See chapter breakdown <ArrowRight size={14}/></button></div></div>
 <div className="section-title"><div><span className="eyebrow">MAKE TODAY COUNT</span><h2>Your daily rhythm</h2></div><button className="link-button" onClick={() => setPage('Today’s Plan')}>Full day plan <ArrowRight size={14}/></button></div><div className="dashboard-grid"><div className="card today-card"><div className="card-heading"><div><h3>Today’s Science targets</h3><p>{tasks.length ? `${doneToday} of ${tasks.length} study blocks complete` : 'Start with a plan that works for you'}</p></div><span className="mini-progress">{pct}%</span></div>{tasks.length ? <><div className="thin-progress"><i style={{ width: `${pct}%` }}/></div><div className="task-list compact">{tasks.slice(0, 4).map(t => <TaskRow key={t.id} task={t} toggle={toggleTask}/>)}</div><button className="link-button" onClick={() => setPage('Today’s Plan')}>View all {tasks.length} tasks <ArrowRight size={14}/></button></> : <div className="empty-small"><span className="empty-icon"><Target size={20}/></span><strong>Your plan is waiting</strong><p>Choose your chapter status and we’ll shape a realistic weekly rhythm.</p><button className="primary-button small" onClick={() => setPage('Chapter Tracker')}>Select chapters <ArrowRight size={14}/></button></div>}</div><div className="card routine-card"><div className="card-heading"><div><h3>Your routine</h3><p>A gentle nudge to stay consistent</p></div><span className="routine-icon"><Flame size={18}/></span></div><div className="streak-number">{data.streak}<span> day streak</span></div><p className="routine-note">You’re showing up for your future self. Keep it going.</p><div className="week-dots">{['M','T','W','T','F','S','S'].map((day,i)=><div key={i} className={i < (data.streak % 7 || 4) ? 'streak-done' : ''}><span>{day}</span><i>{i < (data.streak % 7 || 4) ? <Check size={12}/> : '·'}</i></div>)}</div><div className="routine-footer"><span><Clock3 size={14}/> {data.profile.dailyHours}h daily target</span><span><TrendingUp size={14}/> {weekly.filter(t=>t.done).length} this week</span></div></div></div>
 <div className="section-title section-title-spaced"><div><span className="eyebrow">STAY ON TRACK</span><h2>Science progress by subject</h2></div><button className="link-button" onClick={() => setPage('Chapter Tracker')}>Chapter breakdown <ArrowRight size={14}/></button></div><div className="subject-grid">{['Physics','Chemistry','Biology'].map((group,i)=>{const chapters=chapterList.filter(c=>c.group===group);const value=Math.round(chapters.reduce((n,c)=>n+(data.statuses[c.id]==='completed'?1:data.statuses[c.id]==='partial'?.5:0),0)/chapters.length*100)||0;return <button className="subject-card" key={group} onClick={()=>setPage('Chapter Tracker')}><div className={`subject-symbol ${['blue','amber','green'][i]}`}>{i===0?<Activity size={19}/>:i===1?<FlaskConical size={19}/>:<BookOpen size={19}/>}</div><div className="subject-meta"><strong>{group}</strong><span>{chapters.length} chapters</span></div><strong className="subject-pct">{value}%</strong><div className="thin-progress"><i className={`fill-${['blue','amber','green'][i]}`} style={{width:`${value}%`}}/></div></button>})}</div>
 <div className="dashboard-footer-note"><Sparkles size={15}/><span>Need a plan tailored to your remaining syllabus?</span><button onClick={()=>setPage('Chapter Tracker')}>Build your study plan <ArrowRight size={13}/></button></div></>;
}
function TaskRow({ task, toggle, postpone, showTime = false }) { return <div className={`task-row ${task.done?'is-done':''}`}><button className={`task-check ${task.done?'checked':''}`} onClick={()=>toggle(task.id)} aria-label={task.done?'Mark incomplete':'Mark complete'}>{task.done&&<Check size={13}/>}</button><div className="task-content"><div className="task-title-row"><strong>{task.title}</strong>{task.kind==='Personal'&&<span className="tag personal-tag">PERSONAL</span>}</div><span>{task.subject}{task.chapter&&task.chapter!=='Personal task'?` · ${task.chapter}`:''}</span></div><div className="task-time">{showTime&&<span>{task.time}</span>}<span>{task.duration} min</span></div>{postpone&&<button className="icon-button task-more" onClick={()=>postpone(task.id)} title="Postpone to tomorrow"><MoreHorizontal size={17}/></button>}</div>; }
function TodayPage({ data, todayTasks, doneToday, toggleTask, postpone, setModal, setPage }) { const groups={}; todayTasks.forEach(t=>(groups[t.time]??=[]).push(t)); return <><PageHeading eyebrow="YOUR DAY, AT YOUR PACE" title="Today’s plan" subtitle={`${prettyDate(new Date())} · ${data.profile.dailyHours} hours set aside for you`} right={<button className="secondary-button" onClick={()=>setModal('task')}><Plus size={16}/> Add a task</button>}/><div className="today-stats"><div className="card stat-card"><span className="stat-label">FOCUS BLOCKS</span><strong>{doneToday}<small> / {todayTasks.length}</small></strong><span>completed today</span></div><div className="card stat-card"><span className="stat-label">STUDY TIME</span><strong>{minutesLabel(todayTasks.filter(t=>t.done).reduce((n,t)=>n+t.duration,0))}</strong><span>of {minutesLabel(todayTasks.reduce((n,t)=>n+t.duration,0))} planned</span></div><div className="card stat-card"><span className="stat-label">DAILY TARGET</span><strong>{todayTasks.length?Math.round(doneToday/todayTasks.length*100):0}<small>%</small></strong><span>you’re doing great</span></div></div>{!data.generated&&<div className="callout"><div className="callout-icon"><Sparkles size={18}/></div><div><strong>Your targets are shaped by your chapter progress.</strong><p>Set chapter statuses first, then generate a plan that fits your study hours.</p></div><button className="primary-button small" onClick={()=>setPage('Chapter Tracker')}>Select chapters <ArrowRight size={14}/></button></div>}<div className="plan-layout"><div className="card day-timeline"><div className="card-heading"><div><h3>Study schedule</h3><p>50-minute focus blocks with short breaks in between</p></div><span className="day-badge">TODAY</span></div>{todayTasks.length?Object.entries(groups).map(([time,items])=><div className="timeline-group" key={time}><div className="timeline-time">{time}</div><div className="timeline-line"><i/></div><div className="timeline-items">{items.map(t=><div className={`schedule-item ${t.done?'done':''}`} key={t.id}><TaskRow task={t} toggle={toggleTask} postpone={postpone}/><span className="schedule-subject">{t.subject} <span>·</span> {t.chapter}</span></div>)}</div></div>):<EmptyState icon={Target} title="Nothing on the plan yet" text="Generate your first personalised plan from your chapter tracker." action="Choose chapter status" onAction={()=>setPage('Chapter Tracker')}/>}</div><aside className="card day-side"><span className="eyebrow">A KIND REMINDER</span><div className="day-quote">“You don’t have to see the whole staircase, just take the first step.”</div><span className="quote-author">— Martin Luther King Jr.</span><div className="side-divider"/><strong>Plan at a glance</strong><div className="side-stat"><span>Study blocks</span><b>{todayTasks.length}</b></div><div className="side-stat"><span>Time planned</span><b>{minutesLabel(todayTasks.reduce((n,t)=>n+t.duration,0))}</b></div><button className="secondary-button full" onClick={()=>setModal('task')}><Plus size={15}/> Add a personal task</button></aside></div></>; }
function WeeklyPage({ data, toggleTask, setPage }) { const start=new Date();start.setDate(start.getDate()-((start.getDay()+6)%7)); const days=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);const key=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);return {d,key,tasks:data.tasks.filter(t=>t.date===key)}});return <><PageHeading eyebrow="A GOOD WEEK STARTS HERE" title="Weekly planner" subtitle="A balanced view of your study blocks, practice, and revision." right={<button className="primary-button" onClick={()=>setPage('Chapter Tracker')}><Sparkles size={16}/> Rebuild my plan</button>}/><div className="week-summary"><div className="card week-summary-card"><div className="week-icon blue"><CalendarDays size={19}/></div><div><span>STUDY BLOCKS</span><strong>{days.reduce((n,d)=>n+d.tasks.length,0)}</strong></div></div><div className="card week-summary-card"><div className="week-icon green"><CheckCircle2 size={19}/></div><div><span>COMPLETED</span><strong>{days.reduce((n,d)=>n+d.tasks.filter(t=>t.done).length,0)}</strong></div></div><div className="card week-summary-card"><div className="week-icon amber"><Clock3 size={19}/></div><div><span>FOCUS TIME</span><strong>{minutesLabel(days.flatMap(d=>d.tasks.filter(t=>t.done)).reduce((n,t)=>n+t.duration,0))}</strong></div></div></div><div className="weekly-grid">{days.map((day,i)=><section className={`card weekday-card ${day.key===todayKey()?'is-today':''}`} key={day.key}><div className="weekday-heading"><span>{day.d.toLocaleDateString('en',{weekday:'short'}).toUpperCase()}</span><strong>{day.d.getDate()}</strong>{day.key===todayKey()&&<i>Today</i>}</div>{day.tasks.length?<div className="weekday-tasks">{day.tasks.map(t=><button className={`weekday-task ${t.done?'done':''}`} key={t.id} onClick={()=>toggleTask(t.id)}><span className={`weekday-task-dot ${t.subject.toLowerCase().replace(' ','-')}`}/><b>{t.time}</b><span>{t.chapter}</span><small>{t.title}</small></button>)}</div>:<div className="weekday-empty">{(data.profile.holidays||[]).includes(day.d.toLocaleDateString('en-US',{weekday:'long'}))?'Rest day':'No sessions planned'}</div>}</section>)}</div><div className="weekly-note"><Sparkles size={16}/><div><strong>Leave space to breathe.</strong><span>Your plan respects your selected holidays and daily study hours.</span></div></div></>; }
function ChaptersPage({ data, chapters, filter, setFilter, search, setSearch, updateStatus, counts, completion, openChapter }) { const groups=[...new Set(chapters.map(c=>c.group))];return <><PageHeading eyebrow="KNOW WHERE YOU STAND" title="Science chapter tracker" subtitle="Choose the status that feels right today. You can change it anytime." right={<button className="primary-button" onClick={()=>window.dispatchEvent(new Event('murlidhar:generate'))}><Sparkles size={16}/> Generate my study plan</button>}/><div className="chapter-summary card"><div className="chapter-summary-top"><div><span className="eyebrow">YOUR SYLLABUS</span><strong>{completion}% <small>overall</small></strong></div><div className="chapter-counts"><div><i className="status-dot green-dot"/><span>Completed</span><b>{counts.completed}</b></div><div><i className="status-dot amber-dot"/><span>Partially completed</span><b>{counts.partial}</b></div><div><i className="status-dot gray-dot"/><span>Not started</span><b>{counts['not-started']}</b></div></div></div><div className="thin-progress"><i style={{width:`${completion}%`}}/></div></div><div className="chapter-toolbar"><div className="filter-pills"><button className={filter==='All chapters'?'chosen':''} onClick={()=>setFilter('All chapters')}>All chapters</button>{Object.keys(SUBJECTS[0].groups).map(group=><button key={group} className={filter===group?'chosen':''} onClick={()=>setFilter(group)}>{group}</button>)}</div><label className="search-box"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a chapter…"/></label></div>{groups.length?groups.map(group=><section className="chapter-section" key={group}><div className="chapter-group-heading"><h2>{group}</h2><span>{chapters.filter(c=>c.group===group).length} chapters</span></div><div className="chapter-list">{chapters.filter(c=>c.group===group).map(c=>{const status=data.statuses[c.id]||'not-started';return <article className="chapter-row" key={c.id}><div className={`chapter-subject-mark ${SUBJECTS.find(s=>s.name===c.subject)?.color||'blue'}`}><BookOpen size={17}/></div><button type="button" className="chapter-info" onClick={() => openChapter(c)}><strong>{c.name}</strong><span>{c.subject}{c.formativeOnly&&<em>Formative only</em>}{c.scopeNote&&<em>{c.scopeNote}</em>}</span></button><div className="status-select" role="group" aria-label={`${c.name} completion status`}>{STATUS.map(s=><button key={s} className={`${s} ${status===s?'selected':''}`} onClick={()=>updateStatus(c.id,s)} title={statusLabel[s]} aria-pressed={status===s}>{s==='completed'?<CheckCircle2 size={15}/>:s==='partial'?<Activity size={15}/>:<span className="empty-status-circle"/>}<span>{s==='not-started'?'Not started':s==='partial'?'Partially completed':'Completed'}</span></button>)}</div></article>})}</div></section>):<EmptyState icon={Search} title="No chapters match that search" text="Try a different chapter name or subject."/>}<div className="syllabus-source">Science chapter list follows the CBSE Class X curriculum for 2026–27. <a href="https://cbseacademic.nic.in/curriculum_2027.html" target="_blank" rel="noreferrer">View CBSE curriculum <ArrowUpRight size={12}/></a></div></>; }
function SettingsPage({ data, setData, setDark, dark, setName, auth, onReset }) {
  const upd = (key, value) => setData(d => ({ ...d, profile: { ...d.profile, [key]: value } }));
  const toggleHoliday = day => upd('holidays', (data.profile.holidays || []).includes(day) ? data.profile.holidays.filter(item => item !== day) : [...(data.profile.holidays || []), day]);
  return <>
    <PageHeading eyebrow="MAKE IT WORK FOR YOU" title="Profile & settings" subtitle="Your study details and appearance preferences."/>
    <div className="settings-layout">
      <div className="card settings-card">
        <div className="settings-heading"><span className="settings-icon"><GraduationCap size={19}/></span><div><h3>Student profile</h3><p>Used to shape your Science plan</p></div></div>
        <label className="settings-field">Student name<input value={data.profile.name || ''} onChange={e => { upd('name', e.target.value); setName(e.target.value); }}/></label>
        <div className="form-row"><label className="settings-field">Class<input value="Class 10" readOnly/></label><label className="settings-field">Academic session<input value="2026–27" readOnly/></label></div>
        <div className="form-row"><label className="settings-field">Daily study hours<input type="number" min="1" max="8" step="0.5" value={data.profile.dailyHours} onChange={e => upd('dailyHours', e.target.value)}/></label><label className="settings-field">Board exam date<input type="date" value={data.profile.examDate || ''} onChange={e => upd('examDate', e.target.value)}/></label></div>
        <fieldset className="holiday-picker"><legend>Weekly holidays</legend><div className="holiday-days">{['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day => <label key={day}><input type="checkbox" checked={(data.profile.holidays || []).includes(day)} onChange={() => toggleHoliday(day)}/><span>{day.slice(0,3)}</span></label>)}</div></fieldset>
        <button className="primary-button" onClick={() => window.dispatchEvent(new Event('murlidhar:generate'))}><Sparkles size={15}/> Regenerate my study plan</button>
      </div>
      <div className="settings-side">
        <div className="card settings-card"><div className="settings-heading"><span className="settings-icon"><Sun size={19}/></span><div><h3>Appearance</h3><p>Choose what feels comfortable</p></div></div><div className="setting-toggle"><div><strong>Dark mode</strong><span>Use a softer screen at night</span></div><button className={`switch ${dark?'on':''}`} onClick={() => setDark(!dark)} aria-pressed={dark}><i/></button></div></div>
        <div className="card settings-card danger-card"><div className="settings-heading"><span className="settings-icon"><CircleHelp size={19}/></span><div><h3>Account & data</h3><p>Your study records belong to you</p></div></div><p className="muted">{supabase?'Your progress syncs securely to your student account.':'Preview data is stored only in this browser. Set up Supabase for secure accounts and cloud sync.'}</p><button className="danger-button" onClick={() => { if (window.confirm('Reset all chapter and planner progress for this account? This cannot be undone.')) onReset(); }}>Reset my study progress</button></div>
      </div>
    </div>
  </>;
}
function ChapterWorkModal({ chapter, work, onChange, onClose }) { const items = [['topics','Topics covered'],['ncert','NCERT reading complete'],['notes','Notes prepared'],['questions','Question practice'],['pyq','Previous-year questions'],['revision','Revision complete']]; return <div className="modal-backdrop" onClick={onClose}><div className="modal chapter-work-modal" onClick={e=>e.stopPropagation()}><button className="modal-close" onClick={onClose}><X size={18}/></button><span className="eyebrow">CHAPTER CHECK-IN · {chapter.subject.toUpperCase()}</span><h2>{chapter.name}</h2><p className="muted">Tick off the work you’ve done. Your chapter status and future targets update with your progress.</p><div className="work-checklist">{items.map(([key,label])=><label key={key} className="work-check"><input type="checkbox" checked={!!work[key]} onChange={e=>onChange(key,e.target.checked)}/><span className="custom-check"><Check size={13}/></span><span>{label}</span></label>)}</div><button className="secondary-button full" onClick={onClose}>Done</button></div></div>; }
function EmptyState({ icon: Icon, title, text, action, onAction }) {return <div className="empty-state"><span className="empty-icon"><Icon size={22}/></span><strong>{title}</strong><p>{text}</p>{action&&<button className="secondary-button" onClick={onAction}>{action} <ArrowRight size={14}/></button>}</div>;}

window.addEventListener('generate-study-plan',()=>window.dispatchEvent(new CustomEvent('murlidhar:generate')));
const rootElement = document.getElementById('root');
const root = rootElement._reactRoot || createRoot(rootElement);
rootElement._reactRoot = root;
root.render(<App/>);

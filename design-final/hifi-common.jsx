// LifeOS — Hi-fi primitives
// Reusable building blocks for all screens.

const HCATS = {
  deep:    { name: 'Deep Work', cls: 'cat-deep' },
  study:   { name: 'Study',     cls: 'cat-study' },
  admin:   { name: 'Admin',     cls: 'cat-admin' },
  gym:     { name: 'Gym',       cls: 'cat-gym' },
  break:   { name: 'Break',     cls: 'cat-break' },
  commute: { name: 'Commute',   cls: 'cat-commute' },
};

// ─── Phone shell (bare screen, no bezel — 360×780) ───────────
function HiPhone({ children, dark }) {
  return (
    <div className={`hi-phone ${dark ? 'dark' : ''}`}>
      <div className="screen">{children}</div>
    </div>
  );
}

function HiStatusBar({ time = '9:41' }) {
  return (
    <div className="hi-statusbar">
      <span>{time}</span>
      <span className="glyphs">
        {/* signal */}
        <svg width="17" height="11" viewBox="0 0 17 11" fill="none">
          <rect x="0"  y="7" width="3" height="4"  rx="0.5" fill="currentColor"/>
          <rect x="4"  y="5" width="3" height="6"  rx="0.5" fill="currentColor"/>
          <rect x="8"  y="3" width="3" height="8"  rx="0.5" fill="currentColor"/>
          <rect x="12" y="0" width="3" height="11" rx="0.5" fill="currentColor"/>
        </svg>
        {/* wifi */}
        <svg width="15" height="11" viewBox="0 0 15 11" fill="none">
          <path d="M7.5 10c.7 0 1.2-.5 1.2-1.2S8.2 7.6 7.5 7.6 6.3 8.1 6.3 8.8 6.8 10 7.5 10z" fill="currentColor"/>
          <path d="M3.5 6.5a5.6 5.6 0 0 1 8 0" stroke="currentColor" strokeWidth="1.2" fill="none"/>
          <path d="M0.7 3.6a9.6 9.6 0 0 1 13.6 0" stroke="currentColor" strokeWidth="1.2" fill="none"/>
        </svg>
        {/* battery */}
        <svg width="26" height="11" viewBox="0 0 26 11" fill="none">
          <rect x="0.5" y="0.5" width="22" height="10" rx="2.5" stroke="currentColor" strokeOpacity="0.5"/>
          <rect x="2" y="2" width="17" height="7" rx="1.2" fill="currentColor"/>
          <rect x="23.5" y="3.5" width="1.5" height="4" rx="0.5" fill="currentColor" fillOpacity="0.5"/>
        </svg>
      </span>
    </div>
  );
}

// ─── Top runner banner ──────────────────────────────────────
function HiRunner({ cat = 'admin', name = 'Admin · running', elapsed = '1:00:08', meta }) {
  const c = HCATS[cat];
  return (
    <div className={`hi-runner ${c.cls}`} style={{marginTop: 14}}>
      <span className="dot"/>
      <div style={{display:'flex', flexDirection:'column', minWidth:0}}>
        <span className="name">{name}</span>
        <span className="meta">{meta || c.name}</span>
      </div>
      <span className="timer">{elapsed}</span>
      <span className="stop" role="button" aria-label="stop"/>
    </div>
  );
}

// ─── Date header ────────────────────────────────────────────
function HiDateHead({ title = 'Today', sub = 'Tue · May 26', showArrows = true, right }) {
  return (
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding: '18px 24px 6px'}}>
      {showArrows && (
        <button style={{padding:'4px 8px', background:'transparent', border:0, fontSize:18, color:'var(--ink)', cursor:'pointer', minWidth:24, lineHeight:1, fontFamily:'var(--font-display)'}}>‹</button>
      )}
      <div style={{textAlign:'center'}}>
        <div className="hi-num">{sub}</div>
        <div className="hi-h2" style={{marginTop:4}}>{title}</div>
      </div>
      {right ?? (showArrows
        ? <button style={{padding:'4px 8px', background:'transparent', border:0, fontSize:18, color:'var(--ink)', cursor:'pointer', minWidth:24, lineHeight:1, fontFamily:'var(--font-display)'}}>›</button>
        : <span style={{width:24}}/>)}
    </div>
  );
}

// ─── Tab bar ────────────────────────────────────────────────
function HiTabBar({ active = 'home' }) {
  const tabs = [
    { id: 'home', label: 'Home',     icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 9.5L10 3l7 6.5V17H3V9.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg> },
    { id: 'day',  label: 'Day',      icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="4" y="3" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M4 7h12" stroke="currentColor" strokeWidth="1.6"/></svg> },
    { id: 'week', label: 'Week',     icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M3 8h14M7 4v13M13 4v13" stroke="currentColor" strokeWidth="1.6"/></svg> },
    { id: 'set',  label: 'Settings', icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6"/><path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1L4.7 4.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg> },
  ];
  return (
    <div className="hi-tabbar">
      {tabs.map(t => (
        <div key={t.id} className={`tab ${active === t.id ? 'active' : ''}`}>
          <span className="icon">{t.icon}</span>
          <span>{t.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── FABs ──────────────────────────────────────────────────
function HiFab({ kind = 'primary', label }) {
  const text = label ?? (kind === 'primary'
    ? <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 2.5v11l10-5.5-10-5.5z"/></svg>
    : <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 3v10M3 8h10"/></svg>);
  return <div className={`hi-fab ${kind}`}>{text}</div>;
}

// ─── Hour ticks ────────────────────────────────────────────
function HiHourCol({ start = 7, end = 22, height = 480, top = 0, left = 0, every = 1, fmt12 = true }) {
  const ticks = [];
  const h = height / (end - start);
  for (let hr = start; hr <= end; hr += every) {
    const label = fmt12 ? `${hr % 12 || 12}${hr < 12 || hr === 24 ? 'a' : 'p'}` : `${String(hr).padStart(2,'0')}`;
    ticks.push(
      <div key={hr} className="hi-tick"
           style={{top: top + (hr - start) * h - 5, left}}>{label}</div>
    );
  }
  return <>{ticks}</>;
}

// ─── Block ─────────────────────────────────────────────────
// mode = 'planned' | 'actual'
function HiBlock({ top, height, left = 0, right, width, cat = 'deep', mode = 'actual', label, sub, style }) {
  const c = HCATS[cat];
  const fullStyle = { top, height, left, ...(right !== undefined ? { right } : {}), ...(width !== undefined ? { width } : {}), ...style };
  return (
    <div className={`hi-block ${mode} ${c.cls}`} style={fullStyle}>
      {label && <div className="title">{label}</div>}
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

// ─── Running block (crosses now line) ──────────────────────
// top + height define the bounds. nowAt is absolute px from same origin.
// Above nowAt = solid; below = gradient fade into translucent.
function HiRunningBlock({ top, height, nowAt, cat = 'deep', label, elapsed, left = 0, right, width, style }) {
  const c = HCATS[cat];
  // now-px is the relative offset within the block where the fade begins
  const filledPx = Math.max(0, nowAt - top);
  const nowPct = `${Math.max(8, Math.min(100, (filledPx / height) * 100))}%`;
  const fullStyle = { top, height, left, ...(right !== undefined ? { right } : {}), ...(width !== undefined ? { width } : {}), '--now-px': nowPct, ...style };
  return (
    <div className={`hi-block running ${c.cls}`} style={fullStyle}>
      <div className="title">{label}</div>
      {elapsed && <div className="elapsed">{elapsed} · running</div>}
    </div>
  );
}

// ─── Chip ──────────────────────────────────────────────────
function HiChip({ cat, label, selected, dashed }) {
  return (
    <div className={`hi-chip ${HCATS[cat]?.cls || ''} ${selected ? 'selected' : ''}`}
         style={dashed ? { borderStyle: 'dashed', color: 'var(--text-3)' } : undefined}>
      {cat && <span className="swatch" style={{background:'var(--c)'}}/>}
      <span>{label}</span>
    </div>
  );
}

// ─── Tag ───────────────────────────────────────────────────
function HiTag({ label }) {
  return (
    <span className="hi-tag">
      {label}
      <span className="x">×</span>
    </span>
  );
}

Object.assign(window, {
  HCATS, HiPhone, HiStatusBar, HiRunner, HiDateHead, HiTabBar,
  HiFab, HiHourCol, HiBlock, HiRunningBlock, HiChip, HiTag,
});

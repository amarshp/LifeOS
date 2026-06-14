// Shared wireframe primitives for LifeOS sketches
// Hand-drawn aesthetic — pure b&w + category hatching

const CATS = {
  deep:    { name: 'Deep Work', cls: 'cat-deep' },
  study:   { name: 'Study',     cls: 'cat-study' },
  admin:   { name: 'Admin',     cls: 'cat-admin' },
  gym:     { name: 'Gym',       cls: 'cat-gym' },
  break:   { name: 'Break',     cls: 'cat-break' },
  commute: { name: 'Commute',   cls: 'cat-commute' },
};

// Hand-drawn phone outline
function Phone({ children, style }) {
  return (
    <div className="phone" style={style}>
      <div className="screen">{children}</div>
    </div>
  );
}

function StatusBar({ time = '9:41' }) {
  return (
    <div className="statusbar">
      <span>{time}</span>
      <span className="right">
        <span>●●●</span>
        <span>▮▮</span>
      </span>
    </div>
  );
}

function DateHead({ date = 'Tue · May 26', sub = 'today' }) {
  return (
    <div className="datehead">
      <span className="arrows">←</span>
      <span style={{textAlign:'center'}}>
        <div className="date">{date}</div>
        <div className="sub">{sub}</div>
      </span>
      <span className="arrows">→</span>
    </div>
  );
}

function Runner({ cat = 'deep', task = 'API refactor', time = '0:42:17' }) {
  return (
    <div className="runner">
      <span className="dot" />
      <span style={{fontWeight:700}}>{task}</span>
      <span style={{color:'var(--ink-faint)'}}>· {CATS[cat].name}</span>
      <span className="stop">■</span>
    </div>
  );
}

function TabBar({ active = 'home' }) {
  const tabs = [
    {id:'home', label:'Home',     icon:'☷'},
    {id:'day',  label:'Day',      icon:'☰'},
    {id:'week', label:'Week',     icon:'▦'},
    {id:'set',  label:'Settings', icon:'⚙'},
  ];
  return (
    <div className="tabbar">
      {tabs.map(t => (
        <div key={t.id} className={`tab ${active===t.id?'active':''}`}>
          <div className="icon">{t.icon}</div>
          <div>{t.label}</div>
        </div>
      ))}
    </div>
  );
}

function Fab({ label = '▶', kind = 'primary', bottom }) {
  const style = bottom !== undefined ? { bottom } : {};
  return <div className={`fab ${kind==='secondary'?'fab-secondary':''}`} style={style}>{label}</div>;
}

// Block component used on timeline rails
function Block({ top, height, left = 0, width = '100%', cat = 'deep', mode = 'actual', label, sub, style }) {
  const c = CATS[cat];
  const modeCls = mode === 'planned' ? 'planned' : 'actual';
  return (
    <div className={`block ${modeCls} ${c.cls}`}
         style={{ top, height, left, width, ...style }}>
      <div style={{fontWeight: mode==='actual'?700:400}}>{label}</div>
      {sub && <div style={{fontSize:8, opacity:0.7}}>{sub}</div>}
    </div>
  );
}

// RunningBlock — a task in progress that crosses the now-line.
//   top:      where the task started (px from top of rail)
//   nowAt:    where the now-line is (px from top of rail)
//   pendingH: how far below now the translucent "planned remainder" extends
//   No end time is displayed — the block fades open-ended.
function RunningBlock({ top, nowAt, pendingH = 60, left = 0, width = '100%', cat = 'deep', label, elapsed, style }) {
  const c = CATS[cat];
  const filledH = Math.max(8, nowAt - top);
  const totalH = filledH + pendingH;
  return (
    <div className="running" style={{ top, height: totalH, left, width, ...style }}>
      {/* opaque past portion */}
      <div className={`filled ${c.cls}`} style={{ height: filledH }}>
        <div style={{padding:'4px 6px', fontFamily:'var(--label)', fontSize:10, fontWeight:700}}>
          {label}
        </div>
        {elapsed && (
          <div style={{padding:'0 6px', fontFamily:'var(--hand)', fontSize:13, fontWeight:600}}>
            {elapsed}
          </div>
        )}
      </div>
      {/* translucent future portion (no fixed end) */}
      <div className={`pending ${c.cls}`} style={{ height: pendingH, top: filledH }} />
    </div>
  );
}

// Annotation w/ scribble arrow
function Note({ children, style, arrow }) {
  return (
    <div className="note" style={style}>
      {arrow && <span className="scribble-arrow" style={{position:'absolute', ...arrow}}>{arrow.glyph || '↘'}</span>}
      <span>{children}</span>
    </div>
  );
}

// Category legend tile (used on canvas section headers)
function Legend() {
  return (
    <div className="legend">
      {Object.entries(CATS).map(([k, v]) => (
        <div key={k} className="item">
          <div className={`swatch ${v.cls}`} />
          <span>{v.name}</span>
        </div>
      ))}
      <div className="item">
        <div className="swatch planned" />
        <span>= planned (dashed)</span>
      </div>
      <div className="item">
        <div className="swatch actual" />
        <span>= actual (solid)</span>
      </div>
    </div>
  );
}

// Hours tick column
function HourCol({ start = 6, end = 22, height = 460, top = 0, left = 4, every = 1 }) {
  const ticks = [];
  const h = height / (end - start);
  for (let hr = start; hr <= end; hr += every) {
    ticks.push(
      <div key={hr} className="tick"
           style={{position:'absolute', top: top + (hr-start)*h - 5, left}}>
        {hr%12 || 12}{hr<12?'a':'p'}
      </div>
    );
  }
  return <>{ticks}</>;
}

// Horizontal time axis (for week view)
function HourRow({ start = 7, end = 22, width = 600, top = 0, left = 0 }) {
  const ticks = [];
  const w = width / (end - start);
  for (let hr = start; hr <= end; hr++) {
    ticks.push(
      <div key={hr} className="tick"
           style={{position:'absolute', top, left: left + (hr-start)*w}}>
        {hr%12 || 12}{hr<12?'a':'p'}
      </div>
    );
  }
  return <>{ticks}</>;
}

Object.assign(window, { CATS, Phone, StatusBar, DateHead, Runner, TabBar, Fab, Block, RunningBlock, Note, Legend, HourCol, HourRow });

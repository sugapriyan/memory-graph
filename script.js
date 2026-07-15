/* ---------- Config ---------- */
const GOOGLE_CLIENT_ID = '674200917976-jusm4p7l498r21gd98hop329egd71i9l.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FOLDER_NAME = 'Memory Graph';
const DRIVE_FILE_NAME = 'memory-graph-data.json';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

const DATA_VERSION = 2;
const NODE_R = 26; // node circle radius, also used to offset link endpoints for arrowheads

/* ---------- Category colors (Material tonal fills) ---------- */
const CATEGORY_COLOR_HEX = {
  career: '#00A78E',
  project: '#F5A623',
  skill: '#EF5DA8',
  idea: '#8C5CF2',
  personal: '#4C8DF5',
  people: '#F97644',
  finance: '#34B95C'
};
const CATEGORY_LABELS = {
  career: 'Career',
  project: 'Project',
  skill: 'Skill',
  idea: 'Idea / Topic',
  personal: 'Personal',
  people: 'Person / Relationship',
  finance: 'Investment'
};

// Suggested relationship vocabulary, offered as quick-pick chips wherever a
// relationship label can be typed. Free text is always allowed too.
const REL_VOCAB = ['works at', 'built', 'uses', 'knows', 'part of', 'led to', 'invested in'];

function seedData(){
  return {
    version: DATA_VERSION,
    nodes: [
      {id:'you', label:'Sugapriyan', category:'personal', note:'You.'},
      {id:'career-rd', label:'Rural Development (Programmer)', category:'career', note:'2012–2023. IT implementation support & training for central government schemes.'},
      {id:'career-msl', label:'Muthu Soft Labs (PRM)', category:'career', note:'Joined Oct 2023. Started as BA, now Project Relationship Manager.'},
      {id:'career-ai', label:'AI-Augmented Technical PM', category:'career', note:'Emerging hybrid positioning: PM + hands-on AI-assisted builder.'},
      {id:'proj-tancam', label:'TN Skill / TANCAM', category:'project', note:'End-to-end Training Management application, built with AI assistance.'},
      {id:'proj-ebook', label:'Tamil Alphabet eBook', category:'project', note:'Children\'s eBook for Kindle KDP, ages 3–5.'},
      {id:'skill-react', label:'React', category:'skill', note:''},
      {id:'skill-java', label:'Java / Spring Boot', category:'skill', note:''},
      {id:'skill-python', label:'Python', category:'skill', note:''},
      {id:'skill-pm', label:'Stakeholder & Delivery Mgmt', category:'skill', note:''},
      {id:'idea-hybrid', label:'Hybrid Positioning', category:'idea', note:'PM credibility + shipped full-stack AI-built apps = rare combination.'},
      {id:'personal-chennai', label:'Chennai, Tamil Nadu', category:'personal', note:'Home base.'},
      {id:'people-shobana', label:'Shobana', category:'people', note:''},
      {id:'finance-kite', label:'Zerodha Kite Portfolio', category:'finance', note:'', invested:null, current:null}
    ],
    links: [
      {source:'you', target:'career-msl', label:'works at'},
      {source:'you', target:'personal-chennai', label:'based in'},
      {source:'you', target:'people-shobana', label:'wife'},
      {source:'you', target:'finance-kite', label:'invests via'},
      {source:'career-rd', target:'career-msl'},
      {source:'career-msl', target:'career-ai'},
      {source:'career-ai', target:'proj-tancam'},
      {source:'career-ai', target:'skill-pm'},
      {source:'proj-tancam', target:'skill-react'},
      {source:'proj-tancam', target:'skill-java'},
      {source:'career-msl', target:'proj-ebook'},
      {source:'proj-ebook', target:'skill-python'},
      {source:'career-ai', target:'idea-hybrid'},
      {source:'proj-tancam', target:'skill-pm'}
    ]
  };
}

// Upgrades older on-Drive data in place. v1 (no version field) -> v2: adds the
// version marker and a 'dir' field on links ('none' | 'st' | 'ts'). Existing
// links stay undirected — direction is opt-in via the link editor.
function migrateData(d){
  if(!d || !Array.isArray(d.nodes) || !Array.isArray(d.links)) return seedData();
  if(!d.version || d.version < DATA_VERSION){
    d.version = DATA_VERSION;
  }
  d.links.forEach(l => { if(l.dir !== 'st' && l.dir !== 'ts') l.dir = 'none'; });
  return d;
}

/* ---------- App state ---------- */
let data = null;
let selectedNode = null;
let linkMode = false;
let linkSource = null;
let linkTarget = null;
let activeFilters = new Set();
let newNodeCategory = null;   // category chosen in step 1 of the add flow
let isDirty = false;          // true when the selected node has unsaved edits
let savedSnapshot = null;     // last-saved {note, invested, current} for the selected node
let currentOverlay = null;    // null = Home, else 'add' | 'node' | 'ask' | 'graph'

let addChips = [];            // [{id, label, category, rel}] — pending connections for the node being added
let activeChipId = null;      // chip currently open in the inline relationship editor
let editingLink = null;       // link object open in the bottom sheet
let focusNodeId = null;       // node spotlighted on the graph canvas
let focusHops = 1;            // 1 or 2 hop neighborhood in focus mode
let pathHighlight = null;     // {nodes:Set, links:Set} from the path finder
let undoStash = null;         // {node, links, timer} for soft-deleted node

/* ---------- Auth state ---------- */
let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let pendingTokenCallbacks = [];
let driveFolderId = null;
let driveFileId = null;

/* ---------- D3 setup ---------- */
const svg = d3.select('#graph');
const wrap = document.getElementById('graph-wrap');
let width = wrap.clientWidth, height = wrap.clientHeight;
svg.attr('viewBox', [0,0,width,height]);

// Arrowhead marker for directional links. Lives in <defs>, a sibling of the
// zoom/pan group `g`, so it survives every render() (which only clears `g`).
// orient='auto-start-reverse' lets the same marker serve both line ends.
const defs = svg.append('defs');
defs.append('marker')
  .attr('id', 'arrow')
  .attr('viewBox', '0 -5 10 10')
  .attr('refX', 8)
  .attr('markerWidth', 6.5)
  .attr('markerHeight', 6.5)
  .attr('orient', 'auto-start-reverse')
  .append('path')
  .attr('d', 'M0,-5L10,0L0,5')
  .attr('fill', '#4B4556');

const g = svg.append('g');
svg.call(d3.zoom().scaleExtent([0.3,2.5]).on('zoom', (e)=> g.attr('transform', e.transform)));

let linkSel, linkHitSel, nodeSel, linkLabelSel;
let simulation;

/* ==========================================================
   Screen navigation (Home / Ask / Graph tabs + Add / Notes overlays)
   ========================================================== */

function refreshGraphDimensions(){
  width = wrap.clientWidth;
  height = wrap.clientHeight;
  svg.attr('viewBox', [0,0,width,height]);
  if(simulation){
    simulation.force('center', d3.forceCenter(width/2, height/2));
    simulation.force('x', d3.forceX(width/2).strength(0.045));
    simulation.force('y', d3.forceY(height/2).strength(0.045));
    simulation.alpha(0.5).restart();
  }
}

function applyOverlayVisibility(){
  document.getElementById('add-screen').classList.toggle('hidden', currentOverlay !== 'add');
  document.getElementById('node-screen').classList.toggle('hidden', currentOverlay !== 'node');
  document.getElementById('ask-screen').classList.toggle('hidden', currentOverlay !== 'ask');
  document.getElementById('graph-overlay').classList.toggle('hidden', currentOverlay !== 'graph');

  // Bottom nav active state (Home / Ask / Graph)
  document.getElementById('nav-home').classList.toggle('active', currentOverlay === null);
  document.getElementById('nav-ask').classList.toggle('active', currentOverlay === 'ask');
  document.getElementById('nav-graph').classList.toggle('active', currentOverlay === 'graph');

  // FAB is available on the three tabs, hidden while Add / Notes cover the screen
  const fabHidden = currentOverlay === 'add' || currentOverlay === 'node';
  document.getElementById('fab-add').classList.toggle('hidden', fabHidden);

  if(currentOverlay === 'graph') refreshGraphDimensions();
  if(currentOverlay !== 'graph'){ clearFocus(); }
}

// Every view has exactly one way back: the phone's hardware back (or the
// on-screen back button, wired to history.back()). Switching directly between
// two views replaces the history entry rather than stacking, so "back" from
// anywhere lands on Home in a single step.
function openScreen(view){
  const wasHome = currentOverlay === null;
  currentOverlay = view;
  applyOverlayVisibility();
  if(wasHome){
    history.pushState({ mgOverlay: view }, '');
  } else {
    history.replaceState({ mgOverlay: view }, '');
  }
}

window.addEventListener('popstate', () => {
  if(currentOverlay === 'node' && isDirty){
    const label = selectedNode ? selectedNode.label : 'this entry';
    const discard = window.confirm(`You have unsaved changes to "${label}". Discard them and go back?`);
    if(!discard){
      history.pushState({ mgOverlay: 'node' }, ''); // veto the back navigation, stay put
      return;
    }
    if(savedSnapshot && selectedNode){
      selectedNode.note = savedSnapshot.note;
      selectedNode.invested = savedSnapshot.invested;
      selectedNode.current = savedSnapshot.current;
    }
    clearDirty();
  }
  closeLinkSheet();
  currentOverlay = null;
  applyOverlayVisibility();
});

/* ==========================================================
   Google sign-in (Google Identity Services token client)
   ========================================================== */

function tryInitTokenClient(){
  if(window.google && google.accounts && google.accounts.oauth2){
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if(resp && resp.access_token){
          accessToken = resp.access_token;
          const ttl = resp.expires_in ? Number(resp.expires_in) : 3500;
          tokenExpiresAt = Date.now() + ttl * 1000;
          pendingTokenCallbacks.forEach(cb => cb.resolve(accessToken));
        } else {
          pendingTokenCallbacks.forEach(cb => cb.reject(new Error('No access token returned')));
        }
        pendingTokenCallbacks = [];
      },
      error_callback: (err) => {
        pendingTokenCallbacks.forEach(cb => cb.reject(err));
        pendingTokenCallbacks = [];
      }
    });
  } else {
    setTimeout(tryInitTokenClient, 200);
  }
}

function requestToken(promptMode, timeoutMs){
  return new Promise((resolve, reject) => {
    if(!tokenClient){ reject(new Error('Google sign-in is still loading')); return; }
    let settled = false;
    let timer = null;
    const entry = {
      resolve: (t) => { if(!settled){ settled = true; if(timer) clearTimeout(timer); resolve(t); } },
      reject: (e) => { if(!settled){ settled = true; if(timer) clearTimeout(timer); reject(e); } }
    };
    if(timeoutMs){
      timer = setTimeout(() => entry.reject(new Error('Silent token request timed out')), timeoutMs);
    }
    pendingTokenCallbacks.push(entry);
    tokenClient.requestAccessToken({ prompt: promptMode });
  });
}

async function ensureToken(){
  if(accessToken && Date.now() < tokenExpiresAt - 60000){
    return accessToken;
  }
  try{
    return await requestToken('', 4000);
  }catch(e){
    return await requestToken('consent');
  }
}

async function handleSignIn(){
  const errBox = document.getElementById('signin-error');
  const spinner = document.getElementById('signin-loading');
  const mainBtn = document.getElementById('sign-in-btn-main');
  errBox.textContent = '';
  mainBtn.style.display = 'none';
  spinner.style.display = 'block';
  try{
    try{
      await requestToken('', 4000); // silent — succeeds without any UI if a session is already granted
    }catch(silentErr){
      await requestToken('consent'); // first time, or silent failed — show the picker once
    }
    document.getElementById('signin-overlay').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    document.getElementById('auth-status').textContent = 'Signed in · syncing…';
    document.getElementById('sign-out-btn').style.display = 'block';
    await initDriveAndLoad();
    document.getElementById('auth-status').textContent = 'Signed in';
  }catch(e){
    console.error(e);
    errBox.textContent = 'Sign-in failed or was cancelled. Please try again.';
    mainBtn.style.display = 'inline-block';
  }finally{
    spinner.style.display = 'none';
  }
}

function handleSignOut(){
  if(accessToken && window.google){
    try{ google.accounts.oauth2.revoke(accessToken, () => {}); }catch(e){}
  }
  accessToken = null;
  tokenExpiresAt = 0;
  driveFileId = null;
  driveFolderId = null;
  data = null;
  selectedNode = null;
  savedSnapshot = null;
  clearDirty();
  clearFocus();
  pathHighlight = null;
  currentOverlay = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('signin-overlay').classList.remove('hidden');
  document.getElementById('sign-in-btn-main').style.display = 'inline-block';
  document.getElementById('sign-out-btn').style.display = 'none';
}

/* ==========================================================
   Google Drive REST helpers (drive.file scope)
   ========================================================== */

async function driveFetch(url, options){
  options = options || {};
  const token = await ensureToken();
  const headers = Object.assign({}, options.headers, { Authorization: 'Bearer ' + token });
  const res = await fetch(url, Object.assign({}, options, { headers }));
  if(!res.ok){
    const text = await res.text().catch(() => '');
    throw new Error('Drive API error ' + res.status + ': ' + text);
  }
  return res;
}

async function findFolder(name){
  const q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='" + name + "' and trashed=false");
  const res = await driveFetch(DRIVE_API + '?q=' + q + '&fields=files(id,name)');
  const json = await res.json();
  return (json.files && json.files[0]) ? json.files[0].id : null;
}

async function createFolder(name){
  const res = await driveFetch(DRIVE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, mimeType: 'application/vnd.google-apps.folder' })
  });
  const json = await res.json();
  return json.id;
}

async function ensureFolder(){
  let id = await findFolder(DRIVE_FOLDER_NAME);
  if(!id) id = await createFolder(DRIVE_FOLDER_NAME);
  return id;
}

async function findFile(folderId, name){
  const q = encodeURIComponent("name='" + name + "' and '" + folderId + "' in parents and trashed=false");
  const res = await driveFetch(DRIVE_API + '?q=' + q + '&fields=files(id,name)');
  const json = await res.json();
  return (json.files && json.files[0]) ? json.files[0].id : null;
}

async function createDriveFile(folderId, name, content){
  const boundary = 'memorygraphboundary';
  const metadata = { name: name, parents: [folderId], mimeType: 'application/json' };
  const body =
    '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: application/json\r\n\r\n' +
    content + '\r\n' +
    '--' + boundary + '--';
  const res = await driveFetch(DRIVE_UPLOAD_API + '?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
    body: body
  });
  const json = await res.json();
  return json.id;
}

async function readDriveFile(fileId){
  const res = await driveFetch(DRIVE_API + '/' + fileId + '?alt=media');
  return res.text();
}

async function updateDriveFile(fileId, content){
  await driveFetch(DRIVE_UPLOAD_API + '/' + fileId + '?uploadType=media', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: content
  });
}

/* ---------- Load / persist, always reading fresh from Drive ---------- */

function showSaved(msg){
  const el = document.getElementById('save-indicator');
  el.textContent = msg || 'Saved';
  el.style.opacity = 1;
  clearTimeout(showSaved._t);
  showSaved._t = setTimeout(() => el.style.opacity = 0, 1100);
}

async function initDriveAndLoad(){
  try{
    driveFolderId = await ensureFolder();
    const existingId = await findFile(driveFolderId, DRIVE_FILE_NAME);
    if(existingId){
      driveFileId = existingId;
      const text = await readDriveFile(existingId);
      data = migrateData(text ? JSON.parse(text) : seedData());
    } else {
      data = seedData();
      driveFileId = await createDriveFile(driveFolderId, DRIVE_FILE_NAME, JSON.stringify(data));
    }
  }catch(e){
    console.error('Drive load failed', e);
    data = seedData();
    document.getElementById('auth-status').textContent = 'Could not reach Drive — changes won\'t save';
  }
  render();
}

// Strips D3's runtime mutations before writing to Drive: after the simulation
// binds, link.source/target become node objects and nodes carry vx/vy/fx/fy.
// Serializing those verbatim bloats the file and can create circular data.
function serializeData(){
  return JSON.stringify({
    version: data.version || DATA_VERSION,
    nodes: data.nodes.map(n => {
      const out = { id:n.id, label:n.label, category:n.category, note:n.note || '' };
      if(n.category === 'finance'){ out.invested = n.invested ?? null; out.current = n.current ?? null; }
      if(typeof n.x === 'number') out.x = n.x;
      if(typeof n.y === 'number') out.y = n.y;
      return out;
    }),
    links: data.links.map(l => ({
      source: (l.source && l.source.id) || l.source,
      target: (l.target && l.target.id) || l.target,
      label: l.label || '',
      dir: l.dir || 'none'
    }))
  });
}

async function persist(){
  if(!driveFileId){ return; }
  try{
    await updateDriveFile(driveFileId, serializeData());
    showSaved();
  }catch(e){
    console.error('save failed', e);
  }
}

/* ---------- Local backup download ---------- */

function downloadBackup(){
  if(!data) return;
  const stamp = new Date().toISOString().slice(0,10);
  const blob = new Blob([serializeData()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'memory-graph-backup-' + stamp + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  showSaved('Backup downloaded');
}

/* ==========================================================
   Graph rendering
   ========================================================== */

function linkKey(l){
  const s = (l.source && l.source.id) || l.source;
  const t = (l.target && l.target.id) || l.target;
  return [s, t].sort().join('|');
}

function render(){
  g.selectAll('*').remove();

  simulation = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.links).id(d=>d.id).distance(112).strength(0.6))
    .force('charge', d3.forceManyBody().strength(-260))
    .force('center', d3.forceCenter(width/2, height/2))
    .force('x', d3.forceX(width/2).strength(0.045))
    .force('y', d3.forceY(height/2).strength(0.045))
    .force('collide', d3.forceCollide(44));

  linkSel = g.append('g').selectAll('line')
    .data(data.links).enter().append('line')
    .attr('class','link')
    .attr('marker-end', d => d.dir === 'st' ? 'url(#arrow)' : null)
    .attr('marker-start', d => d.dir === 'ts' ? 'url(#arrow)' : null);

  // Wide invisible twin of every link, purely as a finger-sized tap target
  // for the connection editor. Rendered after .link so it sits on top.
  linkHitSel = g.append('g').selectAll('line')
    .data(data.links).enter().append('line')
    .attr('class','link-hit')
    .on('click', (event, d) => {
      event.stopPropagation();
      if(linkMode) return;
      openLinkSheet(d);
    });

  linkLabelSel = g.append('g').selectAll('text')
    .data(data.links).enter().append('text')
    .attr('class','link-label')
    .text(d => d.label || '');

  const nodeG = g.append('g').selectAll('g')
    .data(data.nodes, d=>d.id).enter().append('g')
    .attr('class','node')
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended))
    .on('click', (event, d) => { event.stopPropagation(); onNodeClick(d); });

  nodeG.append('circle')
    .attr('class','core')
    .attr('r', NODE_R)
    .attr('fill', d => CATEGORY_COLOR_HEX[d.category]);

  nodeG.append('text')
    .attr('dy', NODE_R + 16)
    .selectAll('tspan')
    .data(d => wrapLabel(d.label))
    .enter().append('tspan')
    .attr('x', 0)
    .attr('dy', (d,i) => i === 0 ? 0 : 13)
    .text(d => d);

  nodeSel = nodeG;

  simulation.on('tick', () => {
    // Trim each link back from the node centers so arrowheads stay visible
    // outside the circles instead of hiding underneath them.
    linkSel.each(function(d){
      const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      const pad = NODE_R + 3;
      const sx = d.source.x + (dx/len) * pad, sy = d.source.y + (dy/len) * pad;
      const tx = d.target.x - (dx/len) * pad, ty = d.target.y - (dy/len) * pad;
      d3.select(this).attr('x1', sx).attr('y1', sy).attr('x2', tx).attr('y2', ty);
    });
    linkHitSel
      .attr('x1', d=>d.source.x).attr('y1', d=>d.source.y)
      .attr('x2', d=>d.target.x).attr('y2', d=>d.target.y);
    linkLabelSel
      .attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2 - 5);
    nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  updateSelectionStyles();
  updateFinanceSummary();
  updateStats();
  updateVisibility();
}

function wrapLabel(label){
  const words = label.split(' ');
  const lines = [];
  let cur = '';
  words.forEach(w => {
    if((cur + ' ' + w).trim().length > 16){
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  });
  if(cur) lines.push(cur.trim());
  return lines.slice(0,3);
}

function dragstarted(event, d){
  if(!event.active) simulation.alphaTarget(0.2).restart();
  d.fx = d.x; d.fy = d.y;
}
function dragged(event, d){ d.fx = event.x; d.fy = event.y; }
function dragended(event, d){
  if(!event.active) simulation.alphaTarget(0);
  persist();
}

svg.on('click', () => {
  if(linkMode){ exitLinkMode(); return; }
  clearFocus();
  pathHighlight = null;
  selectedNode = null;
  savedSnapshot = null;
  clearDirty();
  updateSelectionStyles();
  updateVisibility();
});

function onNodeClick(d){
  if(linkMode){
    if(!linkSource){
      linkSource = d;
      document.getElementById('connect-hint').textContent = `Now tap another node to link with "${d.label}".`;
    } else if(linkSource.id !== d.id){
      const exists = data.links.some(l =>
        (l.source.id === linkSource.id && l.target.id === d.id) ||
        (l.source.id === d.id && l.target.id === linkSource.id));
      if(exists){
        exitLinkMode();
        return;
      }
      linkTarget = d;
      document.getElementById('connect-hint').style.display = 'none';
      openScreen('node');
      const confirmBox = document.getElementById('link-confirm');
      confirmBox.style.display = 'block';
      document.getElementById('link-label-input').value = '';
      document.getElementById('link-label-input').focus();
    }
    return;
  }
  // Tap-to-focus: spotlight the node's neighborhood and show its card.
  // Notes open from the card, so a stray tap never yanks you off the canvas.
  setFocus(d);
}

/* ==========================================================
   Focus mode — spotlight a node's 1- or 2-hop neighborhood
   ========================================================== */

function neighborhood(nodeId, hops){
  const adj = {};
  data.links.forEach(l => {
    const s = (l.source && l.source.id) || l.source;
    const t = (l.target && l.target.id) || l.target;
    (adj[s] = adj[s] || []).push(t);
    (adj[t] = adj[t] || []).push(s);
  });
  const nodes = new Set([nodeId]);
  let frontier = [nodeId];
  for(let h = 0; h < hops; h++){
    const next = [];
    frontier.forEach(id => (adj[id] || []).forEach(other => {
      if(!nodes.has(other)){ nodes.add(other); next.push(other); }
    }));
    frontier = next;
  }
  const links = new Set();
  data.links.forEach(l => {
    const s = (l.source && l.source.id) || l.source;
    const t = (l.target && l.target.id) || l.target;
    if(nodes.has(s) && nodes.has(t)) links.add(linkKey(l));
  });
  return { nodes, links };
}

function setFocus(d){
  focusNodeId = d.id;
  focusHops = 1;
  selectedNode = d;
  savedSnapshot = snapshotNode(d);
  updateSelectionStyles();
  const card = document.getElementById('focus-card');
  card.classList.remove('hidden');
  document.getElementById('focus-title').textContent = d.label;
  document.getElementById('focus-cat').textContent = CATEGORY_LABELS[d.category] || d.category;
  const dot = document.getElementById('focus-dot');
  dot.className = 'cat-dot cat-' + d.category;
  document.getElementById('focus-hops-btn').textContent = 'Show 2 hops';
  updateVisibility();
}

function clearFocus(){
  focusNodeId = null;
  focusHops = 1;
  document.getElementById('focus-card').classList.add('hidden');
  updateVisibility();
}

/* ==========================================================
   Visibility — one pass combining focus, path highlight and
   category filters (priority: focus > path > filters)
   ========================================================== */

function updateVisibility(){
  const legend = document.getElementById('legend');
  legend.classList.toggle('filtering', activeFilters.size > 0);
  legend.querySelectorAll('.legend-chip').forEach(item => {
    item.classList.toggle('active', activeFilters.has(item.dataset.category));
  });

  if(!nodeSel) return;

  let visNodes = null, visLinks = null;
  if(focusNodeId){
    const n = neighborhood(focusNodeId, focusHops);
    visNodes = n.nodes; visLinks = n.links;
  } else if(pathHighlight){
    visNodes = pathHighlight.nodes; visLinks = pathHighlight.links;
  }

  if(visNodes){
    nodeSel.style('opacity', d => visNodes.has(d.id) ? 1 : 0.12);
    linkSel
      .style('opacity', d => visLinks.has(linkKey(d)) ? 1 : 0.06)
      .style('stroke', d => (pathHighlight && !focusNodeId && visLinks.has(linkKey(d))) ? '#6446D6' : null)
      .style('stroke-width', d => (pathHighlight && !focusNodeId && visLinks.has(linkKey(d))) ? 3.5 : null);
    linkLabelSel.style('opacity', d => visLinks.has(linkKey(d)) ? 1 : 0.06);
    return;
  }

  linkSel.style('stroke', null).style('stroke-width', null);
  nodeSel.style('opacity', d => (activeFilters.size === 0 || activeFilters.has(d.category)) ? 1 : 0.15);
  const linkFilterOpacity = d => {
    if(activeFilters.size === 0) return 1;
    const sc = (d.source && typeof d.source === 'object') ? d.source.category : null;
    const tc = (d.target && typeof d.target === 'object') ? d.target.category : null;
    return (activeFilters.has(sc) || activeFilters.has(tc)) ? 1 : 0.08;
  };
  linkSel.style('opacity', linkFilterOpacity);
  linkLabelSel.style('opacity', linkFilterOpacity);
}

/* ==========================================================
   Link editor bottom sheet — rename, direction, delete
   ========================================================== */

function linkEndLabels(l){
  const sId = (l.source && l.source.id) || l.source;
  const tId = (l.target && l.target.id) || l.target;
  const sNode = data.nodes.find(n => n.id === sId);
  const tNode = data.nodes.find(n => n.id === tId);
  return { s: sNode ? sNode.label : sId, t: tNode ? tNode.label : tId };
}

function shortName(label){
  return label.length > 14 ? label.slice(0, 13) + '…' : label;
}

function openLinkSheet(l){
  editingLink = l;
  const ends = linkEndLabels(l);
  document.getElementById('link-sheet-title').textContent = ends.s + '  ·  ' + ends.t;
  document.getElementById('link-sheet-label').value = l.label || '';
  document.getElementById('dir-st').textContent = shortName(ends.s) + ' → ' + shortName(ends.t);
  document.getElementById('dir-ts').textContent = shortName(ends.t) + ' → ' + shortName(ends.s);
  setDirSegment(l.dir || 'none');
  document.getElementById('link-sheet').classList.remove('hidden');
  document.getElementById('link-sheet-scrim').classList.remove('hidden');
}

function setDirSegment(dir){
  document.querySelectorAll('#link-dir-seg button').forEach(b => {
    b.classList.toggle('active', b.dataset.dir === dir);
  });
}

function currentDirSegment(){
  const active = document.querySelector('#link-dir-seg button.active');
  return active ? active.dataset.dir : 'none';
}

function closeLinkSheet(){
  editingLink = null;
  document.getElementById('link-sheet').classList.add('hidden');
  document.getElementById('link-sheet-scrim').classList.add('hidden');
}

/* ==========================================================
   Ask your graph — local keyword search over nodes, notes,
   categories and relationship links. Not a chatbot: it scores
   and surfaces matching parts of the graph rather than
   generating free-form text, so it works fully offline and
   never sends notes anywhere.
   ========================================================== */

const ASK_STOPWORDS = new Set([
  'a','an','the','is','are','was','were','who','what','when','where','why','how',
  'do','does','did','my','me','i','of','in','on','at','to','for','and','or',
  'about','tell','know','with','have','has','you','your','it','this','that'
]);

function tokenizeAsk(str){
  return (String(str || '').toLowerCase().match(/[a-z0-9\u0B80-\u0BFF]+/g) || []);
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

// nodeId -> list of { label, otherLabel, otherId } covering both directions of every link.
function buildRelationshipIndex(){
  const index = {};
  data.links.forEach(l => {
    const sId = (l.source && l.source.id) || l.source;
    const tId = (l.target && l.target.id) || l.target;
    const sNode = data.nodes.find(n => n.id === sId);
    const tNode = data.nodes.find(n => n.id === tId);
    if(!sNode || !tNode) return;
    (index[sId] = index[sId] || []).push({ label: l.label, otherLabel: tNode.label, otherId: tId });
    (index[tId] = index[tId] || []).push({ label: l.label, otherLabel: sNode.label, otherId: sId });
  });
  return index;
}

// Shared scorer: how well a node matches a set of search terms.
function scoreNode(node, terms, relIndex){
  let score = 0;
  const labelLower = node.label.toLowerCase();
  const noteLower = (node.note || '').toLowerCase();
  const catLabel = (CATEGORY_LABELS[node.category] || '').toLowerCase();
  const rels = (relIndex && relIndex[node.id]) || [];
  terms.forEach(t => {
    if(labelLower.includes(t)) score += 4;
    if(catLabel.includes(t)) score += 2;
    if(noteLower.includes(t)) score += 1;
    rels.forEach(r => {
      if(r.label && r.label.toLowerCase().includes(t)) score += 5;
      if(r.otherLabel.toLowerCase().includes(t)) score += 2;
    });
  });
  return score;
}

function runAsk(query){
  const resultsBox = document.getElementById('ask-results');
  const terms = tokenizeAsk(query).filter(t => t.length > 1 && !ASK_STOPWORDS.has(t));

  if(!data || terms.length === 0){
    resultsBox.innerHTML = '<div class="card"><div class="empty">Type a name, category, or relationship word — like a person\'s name, "wife", or a project name.</div></div>';
    return;
  }

  const relIndex = buildRelationshipIndex();

  const scored = data.nodes.map(node => ({
    node,
    score: scoreNode(node, terms, relIndex),
    rels: relIndex[node.id] || []
  }))
  .filter(r => r.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 6);

  if(scored.length === 0){
    resultsBox.innerHTML = '<div class="card"><div class="empty">No matches in your graph yet for that. Try different words, or add more notes and connections.</div></div>';
    return;
  }

  resultsBox.innerHTML = scored.map(r => {
    const relLines = r.rels.map(rel => {
      const verb = rel.label ? escapeHtml(rel.label) : 'connected to';
      return `<div class="ask-rel">${verb} — ${escapeHtml(rel.otherLabel)}</div>`;
    }).join('');
    return `
      <div class="ask-result">
        <div class="ask-result-head">
          <span class="cat-dot cat-${r.node.category}"></span>
          <span class="ask-result-title">${escapeHtml(r.node.label)}</span>
        </div>
        <div class="node-cat">${escapeHtml(CATEGORY_LABELS[r.node.category] || r.node.category)}</div>
        ${r.node.note ? `<div class="ask-result-note">${escapeHtml(r.node.note)}</div>` : ''}
        ${relLines}
      </div>
    `;
  }).join('');
}

/* ==========================================================
   Path finder — BFS shortest path between any two memories
   ========================================================== */

function populatePathSelects(){
  const from = document.getElementById('path-from');
  const to = document.getElementById('path-to');
  const prevFrom = from.value, prevTo = to.value;
  const optionsHtml = '<option value="">— choose —</option>' +
    data.nodes.map(n => `<option value="${escapeHtml(n.id)}">${escapeHtml(n.label)}</option>`).join('');
  from.innerHTML = optionsHtml;
  to.innerHTML = optionsHtml;
  if(data.nodes.some(n => n.id === prevFrom)) from.value = prevFrom;
  if(data.nodes.some(n => n.id === prevTo)) to.value = prevTo;
}

function findPath(fromId, toId){
  if(fromId === toId) return [fromId];
  const adj = {};
  data.links.forEach(l => {
    const s = (l.source && l.source.id) || l.source;
    const t = (l.target && l.target.id) || l.target;
    (adj[s] = adj[s] || []).push(t);
    (adj[t] = adj[t] || []).push(s);
  });
  const prev = { [fromId]: null };
  const queue = [fromId];
  while(queue.length){
    const cur = queue.shift();
    if(cur === toId) break;
    (adj[cur] || []).forEach(next => {
      if(!(next in prev)){ prev[next] = cur; queue.push(next); }
    });
  }
  if(!(toId in prev)) return null;
  const path = [];
  let cur = toId;
  while(cur !== null){ path.unshift(cur); cur = prev[cur]; }
  return path;
}

function runPathFinder(){
  const fromId = document.getElementById('path-from').value;
  const toId = document.getElementById('path-to').value;
  const box = document.getElementById('path-result');
  if(!fromId || !toId){
    box.innerHTML = '<div class="empty">Choose two memories to connect.</div>';
    return;
  }
  const path = findPath(fromId, toId);
  if(!path){
    box.innerHTML = '<div class="empty">No path found — these two aren\'t connected through your graph yet.</div>';
    pathHighlight = null;
    return;
  }
  const byId = {};
  data.nodes.forEach(n => byId[n.id] = n);
  const chain = path.map((id, i) => {
    const n = byId[id];
    const step = `<span class="path-step"><span class="cat-dot cat-${n.category}"></span>${escapeHtml(n.label)}</span>`;
    return i === 0 ? step : `<span class="path-arrow">→</span>${step}`;
  }).join('');
  box.innerHTML = `<div class="path-chain">${chain}</div><button class="btn-filled" id="path-show-btn">Show on graph</button>`;

  const nodesSet = new Set(path);
  const linksSet = new Set();
  for(let i = 0; i < path.length - 1; i++){
    linksSet.add([path[i], path[i+1]].sort().join('|'));
  }
  document.getElementById('path-show-btn').addEventListener('click', () => {
    pathHighlight = { nodes: nodesSet, links: linksSet };
    clearFocus();
    openScreen('graph');
    updateVisibility();
  });
}

/* ==========================================================
   Home cards: stats & investment summary
   ========================================================== */

function updateStats(){
  const box = document.getElementById('graph-stats');
  if(!data){ box.innerHTML = ''; return; }
  const nodeCount = data.nodes.length;
  const linkCount = data.links.length;
  const linked = new Set();
  data.links.forEach(l => {
    linked.add((l.source && l.source.id) || l.source);
    linked.add((l.target && l.target.id) || l.target);
  });
  const orphans = data.nodes.filter(n => !linked.has(n.id));
  let html = `
    <div class="stat-pill"><div class="stat-num">${nodeCount}</div><div class="stat-label">memories</div></div>
    <div class="stat-pill"><div class="stat-num">${linkCount}</div><div class="stat-label">connections</div></div>
  `;
  if(orphans.length > 0){
    const names = orphans.slice(0,3).map(n => escapeHtml(n.label)).join(', ');
    html += `<div class="stat-note">${orphans.length} ${orphans.length === 1 ? 'memory has' : 'memories have'} no connections yet (${names}${orphans.length > 3 ? '…' : ''}). Open them and tap "Connect to another node" so they don't get lost.</div>`;
  }
  box.innerHTML = html;
}

function updateFinanceSummary(){
  const financeNodes = data.nodes.filter(n => n.category === 'finance' && typeof n.invested === 'number' && typeof n.current === 'number');
  const section = document.getElementById('finance-summary-section');
  const box = document.getElementById('finance-summary');
  if(financeNodes.length === 0){
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  const totalInvested = financeNodes.reduce((sum,n) => sum + n.invested, 0);
  const totalCurrent = financeNodes.reduce((sum,n) => sum + n.current, 0);
  const diff = totalCurrent - totalInvested;
  const pct = totalInvested > 0 ? (diff / totalInvested) * 100 : 0;
  const word = diff >= 0 ? 'Profit' : 'Loss';
  const colorClass = diff >= 0 ? 'return-pos' : 'return-neg';
  box.innerHTML = `
    <div class="summary-row"><span>Total invested</span><span>₹${totalInvested.toLocaleString('en-IN')}</span></div>
    <div class="summary-row"><span>Current value</span><span>₹${totalCurrent.toLocaleString('en-IN')}</span></div>
    <div class="summary-row total"><span>${word}</span><span>₹${Math.abs(diff).toLocaleString('en-IN')} (${diff>=0?'+':'-'}${Math.abs(pct).toFixed(1)}%)</span></div>
  `;
  box.querySelector('.summary-row.total').classList.add(colorClass);
}

/* ==========================================================
   Node selection & dirty tracking
   ========================================================== */

function snapshotNode(d){
  return { note: d.note || '', invested: d.invested ?? null, current: d.current ?? null };
}

function markDirty(){
  isDirty = true;
  document.getElementById('save-detail-btn').classList.add('dirty');
  document.getElementById('detail-dirty-hint').textContent = 'Unsaved changes';
}

function clearDirty(){
  isDirty = false;
  document.getElementById('save-detail-btn').classList.remove('dirty');
  document.getElementById('detail-dirty-hint').textContent = '';
}

// Returns false if the switch was blocked (unsaved changes, user chose to keep editing).
function selectNode(d){
  if(selectedNode && d.id !== selectedNode.id && isDirty){
    const discard = window.confirm(`You have unsaved changes to "${selectedNode.label}". Discard them and switch?`);
    if(!discard) return false;
    if(savedSnapshot){
      selectedNode.note = savedSnapshot.note;
      selectedNode.invested = savedSnapshot.invested;
      selectedNode.current = savedSnapshot.current;
    }
  }
  selectedNode = d;
  savedSnapshot = snapshotNode(d);
  clearDirty();
  if(recognizing && recognition){ recognition.stop(); }
  document.getElementById('voice-hint').textContent = '';
  document.getElementById('detail-title').textContent = d.label;
  document.getElementById('detail-cat').textContent = CATEGORY_LABELS[d.category] || d.category;
  document.getElementById('detail-note').value = d.note || '';
  const financeBox = document.getElementById('detail-finance');
  if(d.category === 'finance'){
    financeBox.style.display = 'block';
    document.getElementById('detail-invested').value = (d.invested ?? '');
    document.getElementById('detail-current').value = (d.current ?? '');
    updateReturnBadge(d);
  } else {
    financeBox.style.display = 'none';
  }
  updateSelectionStyles();
  return true;
}

function updateReturnBadge(d){
  const badge = document.getElementById('return-badge');
  if(d.invested && d.current !== null && d.current !== undefined && !isNaN(d.invested) && d.invested > 0){
    const diff = d.current - d.invested;
    const pct = (diff / d.invested) * 100;
    const word = diff >= 0 ? 'Profit' : 'Loss';
    badge.className = 'return-badge ' + (diff >= 0 ? 'return-pos' : 'return-neg');
    badge.textContent = `${word}: ₹${Math.abs(diff).toLocaleString('en-IN')} (${diff >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(1)}%)`;
  } else {
    badge.className = '';
    badge.textContent = '';
  }
}

function updateSelectionStyles(){
  if(!nodeSel) return;
  nodeSel.classed('selected', d => selectedNode && d.id === selectedNode.id);
}

function exitLinkMode(){
  linkMode = false;
  linkSource = null;
  linkTarget = null;
  document.getElementById('connect-btn').classList.remove('active');
  document.getElementById('connect-hint').style.display = 'none';
  document.getElementById('link-confirm').style.display = 'none';
}

/* ==========================================================
   Soft delete with undo snackbar
   ========================================================== */

function showSnackbar(msg, showUndo){
  const bar = document.getElementById('snackbar');
  document.getElementById('snackbar-msg').textContent = msg;
  document.getElementById('snackbar-undo').style.display = showUndo ? 'block' : 'none';
  bar.classList.remove('hidden');
  clearTimeout(showSnackbar._t);
  showSnackbar._t = setTimeout(() => bar.classList.add('hidden'), 6000);
}

function deleteSelectedNode(){
  if(!selectedNode || !data) return;
  if(selectedNode.id === 'you'){
    showSnackbar('The root node can\'t be deleted.', false);
    return;
  }
  const node = selectedNode;
  const id = node.id;
  const removedLinks = data.links.filter(l => {
    const s = (l.source && l.source.id) || l.source;
    const t = (l.target && l.target.id) || l.target;
    return s === id || t === id;
  });
  data.nodes = data.nodes.filter(n => n.id !== id);
  data.links = data.links.filter(l => !removedLinks.includes(l));
  undoStash = { node, links: removedLinks };
  selectedNode = null;
  savedSnapshot = null;
  clearDirty();
  clearFocus();
  persist();
  render();
  history.back(); // leave the notes screen
  showSnackbar(`Deleted "${node.label}"`, true);
}

function undoDelete(){
  if(!undoStash || !data) return;
  data.nodes.push(undoStash.node);
  undoStash.links.forEach(l => data.links.push({
    source: (l.source && l.source.id) || l.source,
    target: (l.target && l.target.id) || l.target,
    label: l.label || '',
    dir: l.dir || 'none'
  }));
  const restoredLabel = undoStash.node.label;
  undoStash = null;
  persist();
  render();
  document.getElementById('snackbar').classList.add('hidden');
  showSaved(`Restored "${restoredLabel}"`);
}

/* ==========================================================
   Voice input (speech-to-text: English-India + Tamil)
   ========================================================== */

let recognition = null;
let recognizing = false;
let manualStop = false;
let currentLang = 'en-IN';

function setupSpeechRecognition(){
  const micBtn = document.getElementById('mic-btn');
  const hint = document.getElementById('voice-hint');
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SpeechRecognitionImpl){
    micBtn.style.display = 'none';
    hint.textContent = "Voice input isn't supported in this browser — try Chrome.";
    return;
  }

  recognition = new SpeechRecognitionImpl();
  // continuous mode is unreliable on Android (it can re-fire the same final
  // result on internal restarts, causing repeated words). Instead we run one
  // utterance at a time and auto-start the next turn right after — same feel
  // for the person (just keep talking), but each phrase is captured once.
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = currentLang;

  recognition.onresult = (event) => {
    let finalTranscript = '';
    for(let i = 0; i < event.results.length; i++){
      if(event.results[i].isFinal){
        finalTranscript += event.results[i][0].transcript;
      }
    }
    if(finalTranscript && selectedNode){
      const noteBox = document.getElementById('detail-note');
      const existing = noteBox.value;
      const sep = existing && !existing.endsWith(' ') && !existing.endsWith('\n') ? ' ' : '';
      const updated = existing + sep + finalTranscript.trim() + ' ';
      noteBox.value = updated;
      selectedNode.note = updated;
      markDirty();
    }
  };

  recognition.onend = () => {
    if(recognizing && !manualStop){
      try{ recognition.start(); }
      catch(e){ recognizing = false; micBtn.classList.remove('recording'); }
    } else {
      recognizing = false;
      micBtn.classList.remove('recording');
      if(hint.textContent === 'Listening…') hint.textContent = '';
    }
  };

  recognition.onerror = (event) => {
    if(event.error === 'no-speech' || event.error === 'aborted'){
      return; // benign — onend fires right after and decides whether to restart
    }
    manualStop = true;
    recognizing = false;
    micBtn.classList.remove('recording');
    if(event.error === 'not-allowed' || event.error === 'permission-denied'){
      hint.textContent = 'Microphone access was blocked — check your browser permissions.';
    } else {
      hint.textContent = 'Voice input hit an error: ' + event.error;
    }
  };

  micBtn.addEventListener('click', () => {
    if(!selectedNode) return;
    if(recognizing){
      manualStop = true;
      recognizing = false;
      recognition.stop();
      micBtn.classList.remove('recording');
      hint.textContent = isDirty ? 'Tap "Save changes" below to keep this.' : '';
      return;
    }
    manualStop = false;
    recognizing = true;
    recognition.lang = currentLang;
    hint.textContent = 'Listening…';
    micBtn.classList.add('recording');
    try{
      recognition.start();
    }catch(e){ /* already started, ignore */ }
  });

  document.querySelectorAll('.lang-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      currentLang = pill.dataset.lang;
      document.querySelectorAll('.lang-pill').forEach(p => p.classList.toggle('active', p === pill));
    });
  });
}

/* ==========================================================
   Add flow — chip picker, inline relationship labels,
   suggested connections
   ========================================================== */

function goToAddStep1(){
  newNodeCategory = null;
  addChips = [];
  activeChipId = null;
  document.getElementById('chip-rel-editor').classList.add('hidden');
  document.getElementById('suggest-row-wrap').classList.add('hidden');
  document.getElementById('connect-search').value = '';
  document.getElementById('connect-results').classList.add('hidden');
  document.getElementById('node-label').value = '';
  document.getElementById('add-step-details').style.display = 'none';
  document.getElementById('add-step-category').style.display = 'block';
}

// The root node representing the person themselves — seedData always creates it
// as id 'you', and the app never allows deleting it.
function findYouNodeId(){
  if(!data) return null;
  const you = data.nodes.find(n => n.id === 'you');
  return you ? you.id : null;
}

function renderAddChips(){
  const list = document.getElementById('chip-list');
  list.innerHTML = '';
  addChips.forEach(chip => {
    const el = document.createElement('div');
    el.className = 'link-chip' + (chip.id === activeChipId ? ' editing' : '');
    el.innerHTML = `
      <span class="cat-dot cat-${chip.category}"></span>
      <span class="chip-name">${escapeHtml(chip.label)}</span>
      ${chip.rel ? `<span class="chip-rel">${escapeHtml(chip.rel)}</span>` : ''}
      <span class="chip-x" data-remove="${escapeHtml(chip.id)}">✕</span>
    `;
    el.addEventListener('click', (e) => {
      if(e.target.dataset && e.target.dataset.remove){
        addChips = addChips.filter(c => c.id !== e.target.dataset.remove);
        if(activeChipId === e.target.dataset.remove){
          activeChipId = null;
          document.getElementById('chip-rel-editor').classList.add('hidden');
        }
        renderAddChips();
        refreshSuggestions();
        return;
      }
      openChipRelEditor(chip.id);
    });
    list.appendChild(el);
  });
}

function openChipRelEditor(chipId){
  activeChipId = chipId;
  const chip = addChips.find(c => c.id === chipId);
  if(!chip) return;
  document.getElementById('chip-rel-label').textContent = 'Relationship with "' + chip.label + '" (optional)';
  document.getElementById('chip-rel-input').value = chip.rel || '';
  document.getElementById('chip-rel-editor').classList.remove('hidden');
  renderAddChips();
  document.getElementById('chip-rel-input').focus();
}

function closeChipRelEditor(){
  if(activeChipId){
    const chip = addChips.find(c => c.id === activeChipId);
    if(chip) chip.rel = document.getElementById('chip-rel-input').value.trim();
  }
  activeChipId = null;
  document.getElementById('chip-rel-editor').classList.add('hidden');
  renderAddChips();
}

function addChip(node){
  if(addChips.some(c => c.id === node.id)) return;
  addChips.push({ id: node.id, label: node.label, category: node.category, rel: '' });
  renderAddChips();
  refreshSuggestions();
}

function renderConnectResults(query){
  const box = document.getElementById('connect-results');
  const q = query.trim().toLowerCase();
  if(!q || !data){
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const matches = data.nodes
    .filter(n => !addChips.some(c => c.id === n.id) && n.label.toLowerCase().includes(q))
    .slice(0, 6);
  if(matches.length === 0){
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.innerHTML = '';
  matches.forEach(n => {
    const row = document.createElement('div');
    row.className = 'connect-result';
    row.innerHTML = `<span class="cat-dot cat-${n.category}"></span>${escapeHtml(n.label)}`;
    row.addEventListener('click', () => {
      addChip(n);
      document.getElementById('connect-search').value = '';
      box.classList.add('hidden');
    });
    box.appendChild(row);
  });
  box.classList.remove('hidden');
}

// "Possibly related" — reuses the Ask scorer against the typed label, so the
// same brain powers both search and link suggestions. Debounced; hidden when
// nothing scores or when everything relevant is already chipped.
let suggestTimer = null;
function refreshSuggestions(){
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(() => {
    const wrapEl = document.getElementById('suggest-row-wrap');
    const row = document.getElementById('suggest-row');
    const text = document.getElementById('node-label').value;
    const terms = tokenizeAsk(text).filter(t => t.length > 1 && !ASK_STOPWORDS.has(t));
    if(!data || terms.length === 0){
      wrapEl.classList.add('hidden');
      return;
    }
    const relIndex = buildRelationshipIndex();
    const top = data.nodes
      .filter(n => !addChips.some(c => c.id === n.id))
      .map(n => ({ n, score: scoreNode(n, terms, relIndex) }))
      .filter(r => r.score > 0)
      .sort((a,b) => b.score - a.score)
      .slice(0, 3);
    if(top.length === 0){
      wrapEl.classList.add('hidden');
      return;
    }
    row.innerHTML = '';
    top.forEach(r => {
      const chipEl = document.createElement('span');
      chipEl.className = 'suggest-chip';
      chipEl.innerHTML = `<span class="cat-dot cat-${r.n.category}"></span>＋ ${escapeHtml(r.n.label)}`;
      chipEl.addEventListener('click', () => addChip(r.n));
      row.appendChild(chipEl);
    });
    wrapEl.classList.remove('hidden');
  }, 400);
}

// Renders REL_VOCAB quick-pick chips into a container; tapping one puts the
// verb into the paired input (and keeps focus there for further edits).
function renderVocabChips(containerId, inputId){
  const box = document.getElementById(containerId);
  box.innerHTML = '';
  REL_VOCAB.forEach(v => {
    const el = document.createElement('span');
    el.className = 'vocab-chip';
    el.textContent = v;
    el.addEventListener('click', () => {
      const input = document.getElementById(inputId);
      input.value = v;
      input.focus();
    });
    box.appendChild(el);
  });
}

/* ==========================================================
   Static UI wiring
   ========================================================== */

document.getElementById('sign-in-btn-main').addEventListener('click', handleSignIn);
document.getElementById('sign-out-btn').addEventListener('click', handleSignOut);

/* ---- Bottom nav & FAB ---- */
document.getElementById('nav-home').addEventListener('click', () => {
  if(currentOverlay !== null) history.back();
});
document.getElementById('nav-ask').addEventListener('click', () => {
  if(currentOverlay === 'ask') return;
  populatePathSelects();
  openScreen('ask');
});
document.getElementById('nav-graph').addEventListener('click', () => {
  if(currentOverlay === 'graph') return;
  openScreen('graph');
});
document.getElementById('fab-add').addEventListener('click', () => {
  goToAddStep1();
  openScreen('add');
});

document.getElementById('add-home-btn').addEventListener('click', () => history.back());
document.getElementById('node-home-btn').addEventListener('click', () => history.back());

/* ---- Ask & path finder ---- */
document.getElementById('ask-btn').addEventListener('click', () => runAsk(document.getElementById('ask-input').value));
document.getElementById('ask-input').addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){ e.preventDefault(); runAsk(e.target.value); }
});
document.getElementById('path-btn').addEventListener('click', runPathFinder);

/* ---- Add flow ---- */
document.querySelectorAll('.category-card').forEach(card => {
  card.addEventListener('click', () => {
    newNodeCategory = card.dataset.category;
    document.getElementById('add-step-category').style.display = 'none';
    document.getElementById('add-step-details').style.display = 'block';
    const badge = document.getElementById('chosen-category-badge');
    badge.innerHTML = `<span class="cat-dot cat-${newNodeCategory}"></span>${CATEGORY_LABELS[newNodeCategory]}`;
    document.getElementById('finance-fields').style.display = newNodeCategory === 'finance' ? 'block' : 'none';
    // Person/Relationship entries start pre-bonded to the root "you" node —
    // shown as a removable chip rather than a hidden default.
    addChips = [];
    if(newNodeCategory === 'people'){
      const youId = findYouNodeId();
      const you = youId ? data.nodes.find(n => n.id === youId) : null;
      if(you) addChips.push({ id: you.id, label: you.label, category: you.category, rel: '' });
    }
    renderAddChips();
    document.getElementById('node-label').focus();
  });
});

document.getElementById('add-back-btn').addEventListener('click', goToAddStep1);

document.getElementById('node-label').addEventListener('input', refreshSuggestions);
document.getElementById('connect-search').addEventListener('input', (e) => renderConnectResults(e.target.value));
document.getElementById('chip-rel-done').addEventListener('click', closeChipRelEditor);

document.getElementById('add-node-btn').addEventListener('click', () => {
  const labelInput = document.getElementById('node-label');
  const label = labelInput.value.trim();
  if(!label || !data || !newNodeCategory) return;
  closeChipRelEditor(); // capture any relationship text still open in the editor
  const category = newNodeCategory;
  const id = 'n-' + Date.now();
  const node = {id, label, category, note:'', x: width/2 + (Math.random()-0.5)*100, y: height/2 + (Math.random()-0.5)*100};
  if(category === 'finance'){
    const investedVal = parseFloat(document.getElementById('node-invested').value);
    const currentVal = parseFloat(document.getElementById('node-current').value);
    node.invested = isNaN(investedVal) ? null : investedVal;
    node.current = isNaN(currentVal) ? null : currentVal;
    document.getElementById('node-invested').value = '';
    document.getElementById('node-current').value = '';
  }
  data.nodes.push(node);

  // One link per chip — all written to Drive in the single persist() below.
  addChips.forEach(chip => {
    data.links.push({ source: id, target: chip.id, label: chip.rel || '', dir: 'none' });
  });

  labelInput.value = '';
  persist();
  render();
  showSaved(addChips.length > 0 ? `Added with ${addChips.length} connection${addChips.length > 1 ? 's' : ''}` : 'Added');
  goToAddStep1();
});

/* ---- Node notes ---- */
// Typing/speaking here only updates the screen — nothing reaches Drive until "Save changes" is tapped.
document.getElementById('detail-note').addEventListener('input', (e) => {
  if(!selectedNode) return;
  selectedNode.note = e.target.value;
  markDirty();
});

document.getElementById('detail-invested').addEventListener('input', (e) => {
  if(!selectedNode) return;
  const val = parseFloat(e.target.value);
  selectedNode.invested = isNaN(val) ? null : val;
  updateReturnBadge(selectedNode);
  updateFinanceSummary();
  markDirty();
});

document.getElementById('detail-current').addEventListener('input', (e) => {
  if(!selectedNode) return;
  const val = parseFloat(e.target.value);
  selectedNode.current = isNaN(val) ? null : val;
  updateReturnBadge(selectedNode);
  updateFinanceSummary();
  markDirty();
});

document.getElementById('save-detail-btn').addEventListener('click', () => {
  if(!selectedNode) return;
  savedSnapshot = snapshotNode(selectedNode);
  clearDirty();
  persist();
  showSaved('Saved changes');
});

document.getElementById('connect-btn').addEventListener('click', () => {
  if(!selectedNode) return;
  linkMode = true;
  linkSource = selectedNode;
  document.getElementById('connect-btn').classList.add('active');
  const hint = document.getElementById('connect-hint');
  hint.style.display = 'block';
  hint.textContent = `Now tap another node to link with "${selectedNode.label}".`;
  clearFocus();
  openScreen('graph');
});

document.getElementById('confirm-link-btn').addEventListener('click', () => {
  if(!linkSource || !linkTarget) return;
  const label = document.getElementById('link-label-input').value.trim();
  data.links.push({source: linkSource.id, target: linkTarget.id, label, dir: 'none'});
  const targetNode = linkTarget;
  persist();
  render();
  selectNode(targetNode);
  exitLinkMode();
});

document.getElementById('cancel-link-btn').addEventListener('click', () => {
  exitLinkMode();
});

document.getElementById('clear-entry-btn').addEventListener('click', () => {
  if(!selectedNode) return;
  const extra = selectedNode.category === 'finance' ? ' and investment figures' : '';
  const ok = window.confirm(`Clear the notes${extra} for this entry? Tap "Save changes" afterward to make it permanent.`);
  if(!ok) return;
  document.getElementById('detail-note').value = '';
  selectedNode.note = '';
  if(selectedNode.category === 'finance'){
    document.getElementById('detail-invested').value = '';
    document.getElementById('detail-current').value = '';
    selectedNode.invested = null;
    selectedNode.current = null;
    updateReturnBadge(selectedNode);
    updateFinanceSummary();
  }
  markDirty();
});

document.getElementById('delete-node-btn').addEventListener('click', () => {
  if(!selectedNode) return;
  deleteSelectedNode();
});
document.getElementById('snackbar-undo').addEventListener('click', undoDelete);

/* ---- Focus card ---- */
document.getElementById('focus-open-btn').addEventListener('click', () => {
  if(!focusNodeId) return;
  const d = data.nodes.find(n => n.id === focusNodeId);
  if(!d) return;
  const switched = selectNode(d);
  if(switched !== false) openScreen('node');
});
document.getElementById('focus-hops-btn').addEventListener('click', () => {
  focusHops = focusHops === 1 ? 2 : 1;
  document.getElementById('focus-hops-btn').textContent = focusHops === 1 ? 'Show 2 hops' : 'Show 1 hop';
  updateVisibility();
});
document.getElementById('focus-close-btn').addEventListener('click', () => {
  clearFocus();
  selectedNode = null;
  updateSelectionStyles();
});

/* ---- Link bottom sheet ---- */
document.querySelectorAll('#link-dir-seg button').forEach(b => {
  b.addEventListener('click', () => setDirSegment(b.dataset.dir));
});
document.getElementById('link-sheet-save').addEventListener('click', () => {
  if(!editingLink) return;
  editingLink.label = document.getElementById('link-sheet-label').value.trim();
  editingLink.dir = currentDirSegment();
  persist();
  closeLinkSheet();
  render();
  showSaved('Connection updated');
});
document.getElementById('link-sheet-delete').addEventListener('click', () => {
  if(!editingLink) return;
  const ends = linkEndLabels(editingLink);
  if(!window.confirm(`Delete the connection between "${ends.s}" and "${ends.t}"?`)) return;
  data.links = data.links.filter(l => l !== editingLink);
  persist();
  closeLinkSheet();
  render();
  showSaved('Connection deleted');
});
document.getElementById('link-sheet-close').addEventListener('click', closeLinkSheet);
document.getElementById('link-sheet-scrim').addEventListener('click', closeLinkSheet);

/* ---- Home data card ---- */
document.getElementById('backup-btn').addEventListener('click', downloadBackup);

document.getElementById('reset-btn').addEventListener('click', () => {
  if(!data) return;
  if(isDirty && !window.confirm('You have unsaved changes that will be lost. Reset anyway?')) return;
  if(!window.confirm('Reset your whole graph back to the starting map? This can\'t be undone.')) return;
  data = seedData();
  selectedNode = null;
  savedSnapshot = null;
  clearDirty();
  clearFocus();
  pathHighlight = null;
  activeFilters = new Set();
  undoStash = null;
  goToAddStep1();
  persist();
  render();
});

document.querySelectorAll('#legend .legend-chip').forEach(item => {
  item.addEventListener('click', () => {
    const cat = item.dataset.category;
    if(activeFilters.has(cat)) activeFilters.delete(cat);
    else activeFilters.add(cat);
    clearFocus();
    pathHighlight = null;
    updateVisibility();
  });
});

window.addEventListener('resize', () => {
  if(!document.getElementById('graph-overlay').classList.contains('hidden')){
    refreshGraphDimensions();
  }
});

window.addEventListener('beforeunload', (e) => {
  if(isDirty){
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ==========================================================
   Startup
   ========================================================== */

function registerServiceWorker(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

window.addEventListener('load', () => {
  registerServiceWorker();
  setupSpeechRecognition();
  tryInitTokenClient();
  renderVocabChips('rel-vocab-add', 'chip-rel-input');
  renderVocabChips('rel-vocab-confirm', 'link-label-input');
  renderVocabChips('rel-vocab-sheet', 'link-sheet-label');
});

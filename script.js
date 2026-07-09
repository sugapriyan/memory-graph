/* ---------- Config ---------- */
const GOOGLE_CLIENT_ID = '674200917976-jusm4p7l498r21gd98hop329egd71i9l.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FOLDER_NAME = 'Memory Graph';
const DRIVE_FILE_NAME = 'memory-graph-data.json';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

/* ---------- Category colors (ink tones for the wax-seal graph nodes) ---------- */
const CATEGORY_COLOR_HEX = {
  career: '#2E6D5E',
  project: '#B07C1E',
  skill: '#9C3A56',
  idea: '#6A4C93',
  personal: '#3A6089',
  people: '#A85630',
  finance: '#3D7A43'
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

function seedData(){
  return {
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

/* ---------- App state ---------- */
let data = null;
let selectedNode = null;
let linkMode = false;
let linkSource = null;
let linkTarget = null;
let activeFilters = new Set();
let newNodeCategory = null;   // category chosen in step 1 of the add-node flow
let isDirty = false;          // true when the selected node has unsaved edits
let savedSnapshot = null;     // last-saved {note, invested, current} for the selected node
let currentOverlay = null;    // null = Home screen, else 'add' | 'node' | 'graph'

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

// Small hex helpers used to build the wax-seal gradients below.
function lightenHex(hex, amt){
  const num = parseInt(hex.slice(1), 16);
  const r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
  const mix = (c) => Math.round(c + (255 - c) * amt);
  return '#' + [mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2,'0')).join('');
}
function darkenHex(hex, amt){
  const num = parseInt(hex.slice(1), 16);
  const r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
  const mix = (c) => Math.round(c * (1 - amt));
  return '#' + [mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2,'0')).join('');
}

// Signature motif: every category node in the graph renders as a small stamped
// wax seal rather than a flat dot. Defined once in <defs> (a sibling of the
// zoom/pan group `g`) so it survives every render() call, which only clears `g`.
const defs = svg.append('defs');
Object.keys(CATEGORY_COLOR_HEX).forEach(cat => {
  const base = CATEGORY_COLOR_HEX[cat];
  const grad = defs.append('radialGradient')
    .attr('id', 'seal-' + cat).attr('cx', '32%').attr('cy', '26%').attr('r', '80%');
  grad.append('stop').attr('offset', '0%').attr('stop-color', lightenHex(base, 0.5));
  grad.append('stop').attr('offset', '55%').attr('stop-color', base);
  grad.append('stop').attr('offset', '100%').attr('stop-color', darkenHex(base, 0.22));
});

const g = svg.append('g');
svg.call(d3.zoom().scaleExtent([0.3,2.5]).on('zoom', (e)=> g.attr('transform', e.transform)));

let linkSel, nodeSel, linkLabelSel;
let simulation;

/* ---------- Screen navigation (Home / Add / Node notes / Graph) ---------- */

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
  if(currentOverlay === 'graph') refreshGraphDimensions();
}

// Opens a full-screen view. Every view has exactly one way back: its own "‹ Home"
// button, wired to history.back() — which keeps the phone's hardware back button in
// sync instead of exiting the app. Switching directly between two overlays (e.g.
// Graph -> Node notes when picking a link target) replaces the current history entry
// rather than stacking one on top of another, so "back" from anywhere always lands
// on Home in a single step.
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
  showSaved._t = setTimeout(() => el.style.opacity = 0, 900);
}

async function initDriveAndLoad(){
  try{
    driveFolderId = await ensureFolder();
    const existingId = await findFile(driveFolderId, DRIVE_FILE_NAME);
    if(existingId){
      driveFileId = existingId;
      const text = await readDriveFile(existingId);
      data = text ? JSON.parse(text) : seedData();
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

async function persist(){
  if(!driveFileId){ return; }
  try{
    await updateDriveFile(driveFileId, JSON.stringify(data));
    showSaved();
  }catch(e){
    console.error('save failed', e);
  }
}

/* ==========================================================
   Graph rendering
   ========================================================== */

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
    .data(data.links).enter().append('line').attr('class','link');

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
    .attr('r', 28)
    .attr('fill', d => 'url(#seal-' + d.category + ')')
    .attr('stroke', d => darkenHex(CATEGORY_COLOR_HEX[d.category], 0.35));

  nodeG.append('text')
    .attr('dy', 44)
    .selectAll('tspan')
    .data(d => wrapLabel(d.label))
    .enter().append('tspan')
    .attr('x', 0)
    .attr('dy', (d,i) => i === 0 ? 0 : 13)
    .text(d => d);

  nodeSel = nodeG;

  simulation.on('tick', () => {
    linkSel
      .attr('x1', d=>d.source.x).attr('y1', d=>d.source.y)
      .attr('x2', d=>d.target.x).attr('y2', d=>d.target.y);
    linkLabelSel
      .attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2 - 4);
    nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  updateSelectionStyles();
  updateFinanceSummary();
  updateFilterVisuals();
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
  if(selectedNode && isDirty){
    const discard = window.confirm(`You have unsaved changes to "${selectedNode.label}". Discard them and close?`);
    if(!discard) return;
    if(savedSnapshot){
      selectedNode.note = savedSnapshot.note;
      selectedNode.invested = savedSnapshot.invested;
      selectedNode.current = savedSnapshot.current;
    }
  }
  selectedNode = null;
  savedSnapshot = null;
  clearDirty();
  updateSelectionStyles();
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
  const switched = selectNode(d);
  if(switched !== false) openScreen('node');
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

function runAsk(query){
  const resultsBox = document.getElementById('ask-results');
  const terms = tokenizeAsk(query).filter(t => t.length > 1 && !ASK_STOPWORDS.has(t));

  if(!data || terms.length === 0){
    resultsBox.innerHTML = '<div class="empty">Type a name, category, or relationship word — like a person\'s name, "wife", or a project name.</div>';
    return;
  }

  const relIndex = buildRelationshipIndex();

  const scored = data.nodes.map(node => {
    let score = 0;
    const labelLower = node.label.toLowerCase();
    const noteLower = (node.note || '').toLowerCase();
    const catLabel = (CATEGORY_LABELS[node.category] || '').toLowerCase();
    const rels = relIndex[node.id] || [];

    terms.forEach(t => {
      if(labelLower.includes(t)) score += 4;
      if(catLabel.includes(t)) score += 2;
      if(noteLower.includes(t)) score += 1;
      rels.forEach(r => {
        if(r.label && r.label.toLowerCase().includes(t)) score += 5;
        if(r.otherLabel.toLowerCase().includes(t)) score += 2;
      });
    });
    return { node, score, rels };
  })
  .filter(r => r.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 6);

  if(scored.length === 0){
    resultsBox.innerHTML = '<div class="empty">No matches in your graph yet for that. Try different words, or add more notes and connections.</div>';
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
          <span class="seal-dot cat-${r.node.category}"></span>
          <span class="ask-result-title">${escapeHtml(r.node.label)}</span>
        </div>
        <div class="node-cat">${escapeHtml(CATEGORY_LABELS[r.node.category] || r.node.category)}</div>
        ${r.node.note ? `<div class="ask-result-note">${escapeHtml(r.node.note)}</div>` : ''}
        ${relLines}
      </div>
    `;
  }).join('');
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
    // revert the in-place mutations on the previously-selected node back to last-saved values
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

function updateFilterVisuals(){
  const legend = document.getElementById('legend');
  legend.classList.toggle('filtering', activeFilters.size > 0);
  legend.querySelectorAll('.legend-chip').forEach(item => {
    item.classList.toggle('active', activeFilters.has(item.dataset.category));
  });

  if(!nodeSel) return;
  nodeSel.style('opacity', d => (activeFilters.size === 0 || activeFilters.has(d.category)) ? 1 : 0.15);
  linkSel.style('opacity', d => {
    if(activeFilters.size === 0) return 1;
    const sc = (d.source && typeof d.source === 'object') ? d.source.category : null;
    const tc = (d.target && typeof d.target === 'object') ? d.target.category : null;
    return (activeFilters.has(sc) || activeFilters.has(tc)) ? 1 : 0.08;
  });
  linkLabelSel.style('opacity', d => {
    if(activeFilters.size === 0) return 1;
    const sc = (d.source && typeof d.source === 'object') ? d.source.category : null;
    const tc = (d.target && typeof d.target === 'object') ? d.target.category : null;
    return (activeFilters.has(sc) || activeFilters.has(tc)) ? 1 : 0.08;
  });
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
   Static UI wiring
   ========================================================== */

document.getElementById('sign-in-btn-main').addEventListener('click', handleSignIn);
document.getElementById('sign-out-btn').addEventListener('click', handleSignOut);

document.getElementById('open-graph-btn').addEventListener('click', () => openScreen('graph'));
document.getElementById('close-graph-btn').addEventListener('click', () => history.back());

document.getElementById('open-add-btn').addEventListener('click', () => {
  goToAddStep1();
  openScreen('add');
});
document.getElementById('add-home-btn').addEventListener('click', () => history.back());

document.getElementById('node-home-btn').addEventListener('click', () => history.back());

document.getElementById('open-ask-btn').addEventListener('click', () => {
  document.getElementById('ask-results').innerHTML = '';
  document.getElementById('ask-input').value = '';
  openScreen('ask');
  document.getElementById('ask-input').focus();
});
document.getElementById('ask-home-btn').addEventListener('click', () => history.back());
document.getElementById('ask-btn').addEventListener('click', () => runAsk(document.getElementById('ask-input').value));
document.getElementById('ask-input').addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){ e.preventDefault(); runAsk(e.target.value); }
});

function goToAddStep1(){
  newNodeCategory = null;
  document.getElementById('add-step-details').style.display = 'none';
  document.getElementById('add-step-category').style.display = 'block';
}

// The root node representing the person themselves — seedData always creates it
// as id 'you', and there is currently no way to delete it from the app.
function findYouNodeId(){
  if(!data) return null;
  const you = data.nodes.find(n => n.id === 'you');
  return you ? you.id : null;
}

// Rebuilds the "Connect to" dropdown from the current graph so newly-added nodes
// can be bonded to an existing one right away, instead of needing a separate trip
// through "Connect to another node" afterward. Person/Relationship nodes default
// to the root "you" node — that's the automatic bond for family/relationship
// entries like a spouse or child — but any category can connect to anything.
function populateLinkTargetOptions(preferredId){
  const select = document.getElementById('node-link-target');
  select.innerHTML = '<option value="">— none —</option>';
  if(!data) return;
  data.nodes.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n.id;
    opt.textContent = n.label;
    select.appendChild(opt);
  });
  select.value = (preferredId && data.nodes.some(n => n.id === preferredId)) ? preferredId : '';
  document.getElementById('add-link-relationship-wrap').style.display = select.value ? 'block' : 'none';
}

document.getElementById('node-link-target').addEventListener('change', (e) => {
  document.getElementById('add-link-relationship-wrap').style.display = e.target.value ? 'block' : 'none';
});

document.querySelectorAll('.category-card').forEach(card => {
  card.addEventListener('click', () => {
    newNodeCategory = card.dataset.category;
    document.getElementById('add-step-category').style.display = 'none';
    document.getElementById('add-step-details').style.display = 'block';
    const badge = document.getElementById('chosen-category-badge');
    badge.innerHTML = `<span class="seal-dot cat-${newNodeCategory}"></span>${CATEGORY_LABELS[newNodeCategory]}`;
    document.getElementById('finance-fields').style.display = newNodeCategory === 'finance' ? 'block' : 'none';
    populateLinkTargetOptions(newNodeCategory === 'people' ? findYouNodeId() : null);
    document.getElementById('node-label').focus();
  });
});

document.getElementById('add-back-btn').addEventListener('click', goToAddStep1);

document.getElementById('add-node-btn').addEventListener('click', () => {
  const labelInput = document.getElementById('node-label');
  const label = labelInput.value.trim();
  if(!label || !data || !newNodeCategory) return;
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

  const linkTargetId = document.getElementById('node-link-target').value;
  if(linkTargetId){
    const relLabel = document.getElementById('node-link-label').value.trim();
    data.links.push({ source: id, target: linkTargetId, label: relLabel });
  }

  labelInput.value = '';
  document.getElementById('node-link-label').value = '';
  persist();
  render();
  showSaved('Added');
  goToAddStep1();
});

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
  openScreen('graph');
});

document.getElementById('confirm-link-btn').addEventListener('click', () => {
  if(!linkSource || !linkTarget) return;
  const label = document.getElementById('link-label-input').value.trim();
  data.links.push({source: linkSource.id, target: linkTarget.id, label});
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

document.getElementById('reset-btn').addEventListener('click', () => {
  if(!data) return;
  if(isDirty && !window.confirm('You have unsaved changes that will be lost. Reset anyway?')) return;
  data = seedData();
  selectedNode = null;
  savedSnapshot = null;
  clearDirty();
  activeFilters = new Set();
  goToAddStep1();
  persist();
  render();
});

document.querySelectorAll('#legend .legend-chip').forEach(item => {
  item.addEventListener('click', () => {
    const cat = item.dataset.category;
    if(activeFilters.has(cat)) activeFilters.delete(cat);
    else activeFilters.add(cat);
    updateFilterVisuals();
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
});

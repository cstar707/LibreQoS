// Node Manager Chatbot UI using private_ws and persistent gateway proxy

function private_ws_url() {
  const proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  return proto + window.location.host + '/websocket/private_ws';
}

const log = document.getElementById('chatLog');
const input = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

function scrollToBottom() { log.scrollTop = log.scrollHeight; }

function bubbleUser(text) {
  const row = document.createElement('div');
  row.className = 'msg me';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.appendChild(bubble);
  log.appendChild(row);
  scrollToBottom();
}

function bubbleAssistantStart() {
  const row = document.createElement('div');
  row.className = 'msg bot';
  const avatar = document.createElement('img');
  avatar.src = 'libby.png';
  avatar.className = 'avatar';
  const body = document.createElement('div');
  const meta = document.createElement('div');
  meta.className = 'meta muted';
  meta.textContent = 'Libby';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const reason = document.createElement('div');
  reason.className = 'reason';
  const content = document.createElement('div');
  content.className = 'content';
  bubble.appendChild(reason);
  bubble.appendChild(content);
  body.appendChild(meta);
  body.appendChild(bubble);
  row.appendChild(avatar);
  row.appendChild(body);
  log.appendChild(row);
  scrollToBottom();
  return { row, reason, content };
}

let currentAssistant = null;
let sseBuffer = '';

function escapeHtml(s){
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(u){
  try { const url = new URL(u, window.location.origin); return (/^https?:$/i).test(url.protocol) ? url.href : '#'; } catch { return '#'; }
}

function mdToHtml(md){
  if (!md) return '';
  let s = escapeHtml(md);
  // Convert GitHub-style tables before other line transforms
  s = (function convertTables(input){
    const lines = input.split(/\r?\n/);
    let out = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const mHead = /^\s*\|(.+)\|\s*$/.exec(l);
      const l2 = i + 1 < lines.length ? lines[i+1] : '';
      const isSep = /^\s*\|?\s*(:?-{3,}:?\s*\|\s*)+(:?-{3,}:?)\s*\|?\s*$/.test(l2);
      if (mHead && isSep) {
        const headerCells = mHead[1].split('|').map(c => c.trim());
        i++; // skip separator line
        let bodyRows = [];
        while (i + 1 < lines.length) {
          const nx = lines[i+1];
          if (!/^\s*\|(.+)\|\s*$/.test(nx)) break;
          i++;
          const rowMatch = /^\s*\|(.+)\|\s*$/.exec(nx);
          const cells = rowMatch[1].split('|').map(c => c.trim());
          bodyRows.push(cells);
        }
        let html = '<table class="table table-sm table-striped table-bordered">';
        html += '<thead><tr>' + headerCells.map(h => `<th>${h}</th>`).join('') + '</tr></thead>';
        html += '<tbody>' + bodyRows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody>';
        html += '</table>';
        out.push(html);
      } else {
        out.push(l);
      }
    }
    return out.join('\n');
  })(s);
  // ATX headings (#, ##, ###)
  s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  // code fences
  s = s.replace(/```([\s\S]*?)```/g, (m, p1) => `<pre><code>${p1}</code></pre>`);
  // inline code
  s = s.replace(/`([^`]+)`/g, (m, p1) => `<code>${p1}</code>`);
  // links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^\)\s]+)\)/g, (m, t, u) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  // bold **text** first
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italics *text*
  s = s.replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, '$1<em>$2</em>');
  // line breaks
  s = s.replace(/\r?\n/g, '<br>');
  return s;
}

function appendSys(text) {
  const row = document.createElement('div');
  row.className = 'msg';
  const bubble = document.createElement('div');
  bubble.className = 'bubble muted';
  bubble.textContent = text;
  row.appendChild(bubble);
  log.appendChild(row);
  scrollToBottom();
}

function ensureAssistant() {
  if (!currentAssistant) {
    const ui = bubbleAssistantStart();
    currentAssistant = { ...ui, contentRaw: '', reasonRaw: '' };
  }
}

function handleSsePayload(payload) {
  if (payload === '[DONE]') { currentAssistant = null; return; }
  let obj;
  try { obj = JSON.parse(payload); } catch { obj = null; }
  const ch = obj && obj.choices && obj.choices[0];
  const delta = ch && ch.delta ? ch.delta : null;
  ensureAssistant();
  if (delta) {
    if (typeof delta.reasoning === 'string' && delta.reasoning.length) {
      currentAssistant.reasonRaw += delta.reasoning;
      currentAssistant.reason.textContent = currentAssistant.reasonRaw;
    }
    if (typeof delta.content === 'string' && delta.content.length) {
      currentAssistant.contentRaw += delta.content;
      currentAssistant.content.innerHTML = mdToHtml(currentAssistant.contentRaw);
    }
    if (ch.finish_reason === 'stop') currentAssistant = null;
  } else {
    // Not JSON; append raw text
    currentAssistant.contentRaw += payload;
    currentAssistant.content.innerHTML = mdToHtml(currentAssistant.contentRaw);
  }
  scrollToBottom();
}

function handleStreamText(text) {
  sseBuffer += text;
  const lines = sseBuffer.split(/\r?\n/);
  sseBuffer = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('data:')) {
      handleSsePayload(trimmed.slice(5).trim());
    } else if (trimmed.startsWith('[error]')) {
      appendSys(trimmed);
    } // ignore other SSE fields (event:, id:, retry:)
  }
}

const ws = new WebSocket(private_ws_url());
ws.onopen = () => {
  appendSys('Connected to Libby');
  const startMsg = { Chatbot: { browser_ts_ms: Date.now() } };
  ws.send(JSON.stringify(startMsg));
};
ws.onmessage = (ev) => {
  const text = typeof ev.data === 'string' ? ev.data : String(ev.data || '');
  handleStreamText(text);
};
ws.onclose = () => appendSys('Disconnected');

function sendText() {
  const text = input.value.trim();
  if (!text) return;
  bubbleUser(text);
  const msg = { ChatbotUserInput: { text } };
  ws.send(JSON.stringify(msg));
  input.value = '';
}

sendBtn.onclick = sendText;
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });

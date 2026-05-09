/* ===========================
   DISCLOSURE ARCHIVE — App
   =========================== */

const API = '';
let allDocuments = [];
let currentFilter = 'all';
let currentSearch = '';
let openModalId = null;

// ─── Boot ──────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initNav();
  await Promise.all([loadStats(), loadDocuments(), loadTimeline(), loadQuotes()]);
  connectSSE();
});

// ─── Nav scroll effect ─────────────────────

function initNav() {
  window.addEventListener('scroll', () => {
    const nav = document.getElementById('nav');
    nav?.classList.toggle('scrolled', window.scrollY > 80);
  });
}

// ─── Stats ─────────────────────────────────

async function loadStats() {
  try {
    const res = await fetch(`${API}/api/stats`);
    const data = await res.json();
    setEl('stat-docs', data.totalDocuments);
    setEl('stat-pages', data.totalPages > 0 ? data.totalPages.toLocaleString() + '+' : '5,000+');
    setEl('stat-analyzed', data.processedDocuments);
    setEl('footer-updated', new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
    updateProgress(data.processedDocuments, data.totalDocuments);
  } catch (e) { console.error('Stats load failed', e); }
}

// ─── Documents ─────────────────────────────

async function loadDocuments() {
  try {
    const res = await fetch(`${API}/api/manifest`);
    const data = await res.json();
    allDocuments = data.documents || [];
    renderDocuments();
  } catch (e) {
    console.error('Documents load failed', e);
    setEl('doc-grid', '<p style="color:var(--gray);padding:40px">Failed to load documents.</p>');
  }
}

function renderDocuments() {
  let docs = allDocuments.filter(d => {
    const matchFilter = currentFilter === 'all' || d.agency === currentFilter;
    const matchSearch = !currentSearch || [d.displayTitle, d.title, d.agency, d.summary?.tldr || '']
      .join(' ').toLowerCase().includes(currentSearch.toLowerCase());
    return matchFilter && matchSearch;
  });

  setEl('archive-count', `Showing ${docs.length} of ${allDocuments.length} documents`);
  updateProgress(
    allDocuments.filter(d => d.status === 'processed').length,
    allDocuments.length
  );

  if (docs.length === 0) {
    setEl('doc-grid', '<p style="color:var(--gray);grid-column:1/-1;padding:40px;text-align:center">No documents match your filter.</p>');
    return;
  }

  setEl('doc-grid', docs.map(docCardHTML).join(''));

  // Attach click handlers
  document.querySelectorAll('.doc-card').forEach(card => {
    card.addEventListener('click', () => openModal(card.dataset.id));
  });
}

function docCardHTML(doc) {
  const agencyClass = agencyBadgeClass(doc.agency);
  const statusBadge = statusBadgeHTML(doc.status);
  const tldr = doc.summary?.tldr
    ? `<div class="doc-tldr">${esc(doc.summary.tldr)}</div>`
    : '';
  const highlightCount = doc.summary?.totalHighlights
    ? `<span>⚡ ${doc.summary.totalHighlights} highlight${doc.summary.totalHighlights !== 1 ? 's' : ''}</span>`
    : '';
  return `
<div class="doc-card ${doc.status}" data-id="${esc(doc.id)}" role="button" tabindex="0" aria-label="Open ${esc(doc.displayTitle)}">
  <div class="doc-card-header">
    <div class="doc-card-main">
      <div class="doc-agency ${agencyClass}">${esc(doc.agency)}</div>
      <div class="doc-title">${esc(doc.displayTitle)}</div>
      <div class="doc-meta">
        <span>Released: ${esc(doc.releaseDate || '2026-05-08')}</span>
        ${doc.totalPages ? `<span>${doc.totalPages} pages</span>` : ''}
        ${doc.chunkCount ? `<span>${doc.chunkCount} sections</span>` : ''}
        ${highlightCount}
      </div>
    </div>
    ${statusBadge}
  </div>
  ${tldr}
  <div class="doc-card-footer">
    <span>${doc.status === 'processed' ? 'Full analysis available' : doc.status === 'processing' ? 'Analysis in progress...' : 'Awaiting analysis'}</span>
    <span class="doc-expand-btn">VIEW <span class="arrow">▼</span></span>
  </div>
</div>`;
}

function agencyBadgeClass(agency) {
  const map = { 'FBI': 'badge-fbi', 'Department of War': 'badge-dow', 'NASA': 'badge-nasa', 'Department of State': 'badge-state' };
  return map[agency] || 'badge-dow';
}

function statusBadgeHTML(status) {
  const map = {
    processed: '<span class="doc-status-badge status-processed">ANALYZED</span>',
    processing: '<span class="doc-status-badge status-processing">PROCESSING</span>',
    pending: '<span class="doc-status-badge status-pending">PENDING</span>'
  };
  return map[status] || map.pending;
}

// ─── Filter & Search ────────────────────────

document.addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (btn) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderDocuments();
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'doc-search') {
    currentSearch = e.target.value;
    renderDocuments();
  }
});

// ─── Progress bar ───────────────────────────

function updateProgress(processed, total) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  setEl('progress-label', `${processed} / ${total} analyzed`);
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = `${pct}%`;
  setEl('stat-analyzed', processed);
}

// ─── Timeline ──────────────────────────────

async function loadTimeline() {
  try {
    const res = await fetch(`${API}/api/timeline`);
    const data = await res.json();
    renderTimeline(data.events || []);
  } catch (e) {
    console.error('Timeline load failed', e);
    setEl('timeline-container', '<p style="color:var(--gray)">Failed to load timeline.</p>');
  }
}

function renderTimeline(events) {
  const el = document.getElementById('timeline-container');
  if (!el) return;

  const catClass = (cat, sig) => {
    const classes = [cat, sig === 'critical' ? 'critical' : ''];
    return classes.filter(Boolean).join(' ');
  };

  const catBadge = cat => {
    const labels = { sighting: 'SIGHTING', program: 'PROGRAM', disclosure: 'DISCLOSURE', incident: 'INCIDENT' };
    return `<span class="timeline-category-badge cat-${cat}">${labels[cat] || cat.toUpperCase()}</span>`;
  };

  const formatDate = d => {
    const parsed = new Date(d + 'T00:00:00');
    if (isNaN(parsed)) return d;
    return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: d.split('-').length === 3 ? 'numeric' : undefined });
  };

  const html = `
    <div class="timeline-line" aria-hidden="true"></div>
    <div class="timeline-events">
      ${events.map(ev => `
        <div class="timeline-event ${catClass(ev.category, ev.significance)} ${ev.isLatest ? 'latest' : ''}">
          <div class="timeline-card">
            <div class="timeline-date">${formatDate(ev.date)}</div>
            <div class="timeline-card-header">
              ${catBadge(ev.category)}
              <h3 class="timeline-card-title">${esc(ev.title)}</h3>
            </div>
            <p class="timeline-card-desc">${esc(ev.description)}</p>
            ${ev.relatedDoc ? `<a class="timeline-related-link" href="#documents" onclick="openModal('${esc(ev.relatedDoc)}')">→ VIEW DOCUMENT IN ARCHIVE</a>` : ''}
          </div>
          <div class="timeline-dot-wrap">
            <div class="timeline-dot" title="${ev.category}"></div>
          </div>
          <div style="flex:1;max-width:calc(50% - 40px)"></div>
        </div>
      `).join('')}
    </div>`;
  el.innerHTML = html;
}

// ─── Quotes ─────────────────────────────────

async function loadQuotes() {
  try {
    const res = await fetch(`${API}/api/quotes`);
    const data = await res.json();
    renderQuotes(data.quotes || []);
  } catch (e) {
    console.error('Quotes load failed', e);
    setEl('quotes-grid', '<p style="color:var(--gray)">Failed to load quotes.</p>');
  }
}

function renderQuotes(quotes) {
  const catBadge = cat => {
    const cfg = {
      politician: ['qcat-politician', 'POLITICIAN'],
      whistleblower: ['qcat-whistleblower', 'WHISTLEBLOWER'],
      media: ['qcat-media', 'MEDIA/JOURNALIST']
    };
    const [cls, label] = cfg[cat] || ['', cat];
    return `<span class="quote-category-badge ${cls}">${label}</span>`;
  };

  setEl('quotes-grid', quotes.map(q => `
    <div class="quote-card ${q.category}">
      <div class="quote-mark" aria-hidden="true">"</div>
      <p class="quote-text">${esc(q.quote)}</p>
      <div>
        <div class="quote-person">${esc(q.person)}</div>
        <div class="quote-role">${esc(q.role)}</div>
      </div>
      ${q.context ? `<p class="quote-context">${esc(q.context)}</p>` : ''}
      <div class="quote-footer">
        <span>${esc(q.source)} — ${q.date ? q.date.substring(0,4) : ''}</span>
        ${catBadge(q.category)}
      </div>
    </div>
  `).join(''));
}

// ─── Modal ───────────────────────────────────

async function openModal(docId) {
  if (!docId) return;
  openModalId = docId;
  const doc = allDocuments.find(d => d.id === docId);
  if (!doc) return;

  // Set header
  const agClass = agencyBadgeClass(doc.agency);
  const agEl = document.getElementById('modal-agency');
  if (agEl) { agEl.className = `modal-agency ${agClass}`; agEl.textContent = doc.agency; }
  setEl('modal-title', doc.displayTitle);
  setEl('modal-meta', `
    <span>Released: ${doc.releaseDate || '2026-05-08'}</span>
    ${doc.totalPages ? `<span>${doc.totalPages} pages</span>` : ''}
    <span>${doc.chunkCount || 0} chunks</span>
  `);

  // Reset tabs
  document.querySelectorAll('.tab-btn').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
  document.querySelector('.tab-btn[data-tab="overview"]')?.classList.add('active');
  document.querySelector('.tab-btn[data-tab="overview"]')?.setAttribute('aria-selected', 'true');

  setEl('modal-body', '<div class="modal-loading"><div class="loading-spinner"></div><p>Loading analysis...</p></div>');

  const overlay = document.getElementById('modal-overlay');
  overlay?.classList.add('open');
  overlay?.removeAttribute('aria-hidden');
  document.body.style.overflow = 'hidden';

  // Fetch full document data
  try {
    const res = await fetch(`${API}/api/document/${encodeURIComponent(docId)}`);
    if (res.status === 404) {
      renderModalPending(doc);
      return;
    }
    const data = await res.json();
    renderModalContent(data, doc);
  } catch (e) {
    renderModalPending(doc);
  }
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay?.classList.remove('open');
  overlay?.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  openModalId = null;
}

document.getElementById('modal-close')?.addEventListener('click', closeModal);
document.getElementById('modal-overlay')?.addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Tab switching inside modal
document.addEventListener('click', e => {
  const tb = e.target.closest('.tab-btn');
  if (!tb) return;
  const tab = tb.dataset.tab;
  document.querySelectorAll('.tab-btn').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
  tb.classList.add('active');
  tb.setAttribute('aria-selected', 'true');
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');
});

// Section expand/collapse inside modal
document.addEventListener('click', e => {
  const hdr = e.target.closest('.section-item-header');
  if (!hdr) return;
  hdr.closest('.section-item')?.classList.toggle('open');
});

function renderModalContent(data, doc) {
  const overviewHTML = `
    <div class="tab-content active" id="tab-overview">
      ${data.tldr ? `<div class="doc-overview-tldr">${esc(data.tldr)}</div>` : ''}
      <div class="doc-overview-body">${esc(data.overview || '')}</div>
      ${data.significance ? `<div class="doc-overview-sig">★ Why This Matters: ${esc(data.significance)}</div>` : ''}
      ${data.top_highlights?.length ? `
        <div class="doc-top-highlights">
          <h4>Top Highlights</h4>
          ${data.top_highlights.map(h => `<div class="highlight-item">${esc(h)}</div>`).join('')}
        </div>` : ''}
      ${data.allKeyEntities?.length ? `
        <div style="margin-top:24px">
          <p style="font-size:10px;letter-spacing:.2em;color:var(--gray-light);margin-bottom:10px">KEY ENTITIES MENTIONED</p>
          <div class="doc-key-entities">
            ${data.allKeyEntities.slice(0,30).map(e => `<span class="entity-tag">${esc(e)}</span>`).join('')}
          </div>
        </div>` : ''}
    </div>`;

  const sectionsHTML = `
    <div class="tab-content" id="tab-sections">
      <div class="sections-list">
        ${(data.sections || []).map(sec => `
          <div class="section-item">
            <div class="section-item-header">
              <span class="section-pages">PP. ${esc(sec.pagesRange)}</span>
              <span class="section-summary">${esc(sec.section_overview || 'No summary available.')}</span>
              <span class="section-toggle" aria-hidden="true">▼</span>
            </div>
            <div class="section-item-body">
              <div class="page-list">
                ${(sec.pages || []).map(p => `
                  <div class="page-item ${p.interesting ? 'notable' : ''}">
                    <span class="page-num">P.${p.page}</span>
                    <span class="page-content">
                      ${esc(p.summary || '')}
                      ${p.interesting && p.interesting_reason ? `<span class="page-reason">▲ ${esc(p.interesting_reason)}</span>` : ''}
                    </span>
                    ${p.interesting ? '<span class="page-notable-badge">NOTABLE</span>' : ''}
                  </div>`).join('')}
              </div>
              ${sec.highlights?.length ? `
                <div class="section-highlights">
                  <h5>SECTION HIGHLIGHTS</h5>
                  ${sec.highlights.map(h => `<div class="section-highlight-item">${esc(h)}</div>`).join('')}
                </div>` : ''}
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  const allHL = data.allHighlights || [];
  const intPages = data.interestingPages || [];
  const highlightsHTML = `
    <div class="tab-content" id="tab-highlights">
      <p class="highlights-count">${allHL.length} notable finding${allHL.length !== 1 ? 's' : ''} across ${(data.sections || []).length} sections.</p>
      <div class="all-highlights-list">
        ${allHL.length ? allHL.map(h => `<div class="all-highlight-item">${esc(h)}</div>`).join('') : '<p style="color:var(--gray)">No highlights extracted yet.</p>'}
      </div>
      ${intPages.length ? `
        <div class="interesting-pages-section">
          <h4>NOTABLE PAGES (${intPages.length})</h4>
          ${intPages.map(p => `
            <div class="interesting-page-item">
              <span class="interesting-page-num">PAGE ${p.page}<br><small style="color:var(--gray)">pp. ${esc(p.section)}</small></span>
              <span>${esc(p.reason)}</span>
            </div>`).join('')}
        </div>` : ''}
    </div>`;

  const curious = data.allCuriousFindings || [];
  const topCurious = data.top_curious || [];
  const curiousHTML = `
    <div class="tab-content" id="tab-curious">
      <div class="curious-intro">
        <span class="curious-count">${curious.length} curious finding${curious.length !== 1 ? 's' : ''}</span> flagged by AI analysis — unusual details, strange language, suspicious redactions, contradictions, and unexplained references that a serious researcher would want to investigate.
      </div>
      ${topCurious.length ? `
        <div class="top-curious-section">
          <h4>MOST INTRIGUING (AI-SELECTED)</h4>
          ${topCurious.map(c => `<div class="top-curious-item">${esc(c)}</div>`).join('')}
        </div>` : ''}
      ${curious.length ? `
        <div class="curious-list" style="margin-top:${topCurious.length ? '28px' : '0'}">
          ${curious.map(c => `
            <div class="curious-item">
              <div class="curious-item-header">
                <span class="curious-page-tag">PAGE ${c.page}</span>
                ${c.category ? `<span class="curious-category-tag">${esc(c.category)}</span>` : ''}
                ${c.sectionPages ? `<span class="curious-section-ref">pp. ${esc(c.sectionPages)}</span>` : ''}
              </div>
              <p class="curious-finding-text">${esc(c.finding)}</p>
            </div>`).join('')}
        </div>` : `<p class="curious-empty">No curious findings flagged in this document. Either the content was straightforward, or AI analysis hasn't run yet.</p>`}
    </div>`;

  const sourceHTML = `
    <div class="tab-content" id="tab-source">
      <div class="source-tab">
        <div class="source-field"><div class="source-label">DOCUMENT ID</div><div class="source-value">${esc(data.id || doc.id)}</div></div>
        <div class="source-field"><div class="source-label">TITLE (ORIGINAL)</div><div class="source-value">${esc(data.title || doc.title)}</div></div>
        <div class="source-field"><div class="source-label">AGENCY</div><div class="source-value">${esc(data.agency || doc.agency)}</div></div>
        <div class="source-field"><div class="source-label">RELEASE DATE</div><div class="source-value">${esc(data.releaseDate || doc.releaseDate || '2026-05-08')}</div></div>
        <div class="source-field source-url"><div class="source-label">SOURCE URL</div><div class="source-value"><a href="${esc(data.url || doc.url || '')}" target="_blank" rel="noopener">${esc(data.url || doc.url || 'N/A')}</a></div></div>
        <div class="source-field"><div class="source-label">PAGES / CHUNKS</div><div class="source-value">${esc(String(data.totalChunks || doc.chunkCount || 0))} chunks analyzed</div></div>
        <div class="source-field"><div class="source-label">ANALYSIS DATE</div><div class="source-value">${data.processedAt ? new Date(data.processedAt).toLocaleString() : 'Pending'}</div></div>
        <div class="source-disclaimer">
          <strong style="color:var(--white)">Note:</strong> Summaries and highlights are generated by Claude AI (claude-opus-4-7) and may contain errors or omissions. Always verify important claims against the original source PDF above. Classification markings, dates, and names in the summaries are extracted from the documents as-is.
        </div>
      </div>
    </div>`;

  setEl('modal-body', overviewHTML + sectionsHTML + highlightsHTML + curiousHTML + sourceHTML);
}

function renderModalPending(doc) {
  const sectionsHTML = `<div class="tab-content" id="tab-sections"></div>`;
  const highlightsHTML = `<div class="tab-content" id="tab-highlights"></div>`;
  const sourceHTML = `
    <div class="tab-content" id="tab-source">
      <div class="source-tab">
        <div class="source-field"><div class="source-label">DOCUMENT ID</div><div class="source-value">${esc(doc.id)}</div></div>
        <div class="source-field"><div class="source-label">AGENCY</div><div class="source-value">${esc(doc.agency)}</div></div>
        <div class="source-field source-url"><div class="source-label">SOURCE URL</div><div class="source-value"><a href="${esc(doc.url || '')}" target="_blank" rel="noopener">${esc(doc.url || 'N/A')}</a></div></div>
      </div>
    </div>`;

  const pendingHTML = `
    <div class="tab-content active" id="tab-overview">
      <div class="pending-notice">
        <div class="big-icon">⏳</div>
        <h3>Analysis Pending</h3>
        <p>This document hasn't been analyzed by AI yet. To analyze all documents, run:</p>
        <code>ANTHROPIC_API_KEY=sk-ant-... node process_pdfs.cjs</code>
        <p style="margin-top:16px">In the meantime, you can access the original PDF directly:</p>
        ${doc.url ? `<a href="${esc(doc.url)}" target="_blank" rel="noopener" class="hero-cta" style="margin-top:16px;display:inline-block;font-size:11px">VIEW SOURCE PDF →</a>` : ''}
      </div>
    </div>`;

  setEl('modal-body', pendingHTML + sectionsHTML + highlightsHTML + sourceHTML);
}

// ─── SSE Live Updates ────────────────────────

function connectSSE() {
  const es = new EventSource(`${API}/api/events`);
  es.onmessage = e => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'document_processed') {
        // Refresh document list
        loadDocuments();
        showToast('Analysis Complete', `"${data.displayTitle}" has been analyzed.`);
      } else if (data.type === 'new_documents') {
        loadDocuments();
        showToast('New Documents Released!', `${data.count} new document(s) found on war.gov and added to the archive.`);
      }
    } catch {}
  };
  es.onerror = () => {
    // Silent reconnect handled by browser
    document.getElementById('nav-status-text').textContent = 'RECONNECTING';
    setTimeout(() => {
      document.getElementById('nav-status-text').textContent = 'LIVE';
    }, 3000);
  };
}

// ─── Toast notifications ─────────────────────

function showToast(title, body) {
  const toast = document.createElement('div');
  toast.className = 'new-doc-toast';
  toast.innerHTML = `<div class="toast-title">${esc(title)}</div><div class="toast-body">${esc(body)}</div>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ─── Helpers ─────────────────────────────────

function setEl(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Keyboard nav for doc cards
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const card = e.target.closest('.doc-card');
    if (card) openModal(card.dataset.id);
  }
});

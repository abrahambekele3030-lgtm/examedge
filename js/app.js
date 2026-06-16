/**
 * ExamEdge — Main Application
 * Production-quality exam preparation platform for Ethiopian University Entrance Exam
 * Fully fixed and enhanced version
 */

// ============================================================
// STATE
// ============================================================

const State = {
  questions: [],           // All loaded questions
  filtered: [],            // Currently filtered question list
  currentIndex: 0,         // Index in filtered list
  answered: {},            // { qId: { selected, correct, timestamp } }
  wrong: {},               // { qId: { count, timestamps[], qRef } }
  bookmarks: new Set(),    // Set of bookmarked qIds
  revision: new Map(),     // Map qId -> priority (1–5)
  streak: 0,
  bestStreak: 0,
  examHistory: [],

  // Exam state
  exam: null,              // Active exam session

  // Flashcard state
  fc: { questions: [], index: 0, flipped: false },

  // UI
  currentView: 'practice',
  sidebarCollapsed: false,
  theme: 'dark',
  fontSize: 'normal',      // 'normal', 'large', 'xl'
  
  // Daily Goal
  dailyGoal: 20,
  dailySolved: 0,
  lastSolvedDate: '',

  // Metadata caches
  subjects: new Set(),
  grades: new Set(),
  units: new Map(),        // "subject|grade" -> Set of units
  sections: new Map(),     // "subject|grade|unit" -> Set of sections
};

// ============================================================
// PERSISTENCE
// ============================================================

const STORAGE_KEY = 'examedge_v3';

function saveState() {
  try {
    const data = {
      answered: State.answered,
      wrong: State.wrong,
      bookmarks: [...State.bookmarks],
      revision: [...State.revision.entries()],
      streak: State.streak,
      bestStreak: State.bestStreak,
      examHistory: State.examHistory.slice(-100),
      theme: State.theme,
      sidebarCollapsed: State.sidebarCollapsed,
      fontSize: State.fontSize,
      dailyGoal: State.dailyGoal,
      dailySolved: State.dailySolved,
      lastSolvedDate: State.lastSolvedDate,
      filters: typeof getFilters === 'function' ? getFilters() : undefined,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) { console.warn('Save failed', e); }
}

function loadState() {
  try {
    // Migrate from old key
    const oldRaw = localStorage.getItem('examedge_v2');
    const raw = localStorage.getItem(STORAGE_KEY) || oldRaw;
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.answered) State.answered = data.answered;
    if (data.wrong) State.wrong = data.wrong;
    if (data.bookmarks) State.bookmarks = new Set(data.bookmarks);
    if (data.revision) State.revision = new Map(data.revision);
    if (data.streak != null) State.streak = data.streak;
    if (data.bestStreak != null) State.bestStreak = data.bestStreak;
    if (data.examHistory) State.examHistory = data.examHistory;
    if (data.theme) State.theme = data.theme;
    if (data.sidebarCollapsed != null) State.sidebarCollapsed = data.sidebarCollapsed;
    if (data.fontSize) State.fontSize = data.fontSize;
    if (data.dailyGoal != null) State.dailyGoal = data.dailyGoal;
    if (data.dailySolved != null) State.dailySolved = data.dailySolved;
    if (data.lastSolvedDate) State.lastSolvedDate = data.lastSolvedDate;
    if (data.filters) State.filters = data.filters;

    // Reset daily solved if it's a new day
    const today = new Date().toISOString().split('T')[0];
    if (State.lastSolvedDate !== today) {
      State.dailySolved = 0;
      State.lastSolvedDate = today;
    }
  } catch (e) { console.warn('Load failed', e); }
}

// ============================================================
// DATA LOADING
// ============================================================

async function discoverAndLoadQuestions() {
  updateLoader(0, `Scanning manifest...`);

  let filePaths = [];
  try {
    const res = await fetch('data/manifest.json');
    if (res.ok) {
      const manifest = await res.json();
      filePaths = manifest.files || [];
    }
  } catch (e) {
    console.warn('Failed to load manifest.json', e);
  }

  if (filePaths.length === 0) {
    updateLoader(0, `Manifest failed. Fallback scanning...`);
    // Fallback: Build candidate paths — also include Unit_N' variants (apostrophe in Math)
    const subjects = ['Biology', 'Chemistry', 'Mathematics', 'Physics'];
    const grades = ['Grade_9', 'Grade_10', 'Grade_11', 'Grade_12'];
    const maxUnits = 15;
    const maxRounds = 10;
    
    for (const subject of subjects) {
      for (const grade of grades) {
        for (let u = 1; u <= maxUnits; u++) {
          for (let r = 1; r <= maxRounds; r++) {
            filePaths.push(`data/${subject}/${grade}/Unit_${u}/R${r}.json`);
            // Handle apostrophe variant (e.g., Unit_1')
            filePaths.push(`data/${subject}/${grade}/Unit_${u}'/R${r}.json`);
          }
        }
      }
    }
  }

  const allQuestions = [];
  let fileCount = 0;

  const CONCURRENCY = 12;
  const total = filePaths.length;
  let done = 0;

  async function fetchFile(path) {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      const data = await res.json();
      return { path, data };
    } catch { return null; }
  }

  for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
    const batch = filePaths.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(fetchFile));
    for (const result of results) {
      if (result && result.data && Array.isArray(result.data.questions) && result.data.questions.length > 0) {
        const { data, path } = result;
        const pathParts = path.split('/');
        const subjectName = pathParts[1];
        const gradeName = pathParts[2].replace(/_/g, ' ');
        // Normalize unit name — strip apostrophes from folder name for display
        const unitFolderRaw = pathParts[3];
        const unitFolderClean = unitFolderRaw.replace(/'/g, '').replace(/_/g, ' ');

        for (const q of data.questions) {
          if (!q.question_id || !q.question || !q.options || !q.correct_answer) continue;
          // Normalize fields
          q._subject = q.subject || subjectName;
          q._grade = q.grade || gradeName;
          q._unit = q.unit || (data.unit) || unitFolderClean;
          q._section = q.section || '';
          q._subsection = q.subsection || '';
          q._file = path;
          allQuestions.push(q);
        }
        fileCount++;
      }
      done++;
    }
    const pct = Math.round(done / total * 80);
    if (done % CONCURRENCY === 0 || done === total) {
      updateLoader(pct, `Loaded ${fileCount} files · ${allQuestions.length} questions...`);
    }
  }

  return allQuestions;
}

function updateLoader(percent, status) {
  const bar = document.getElementById('loader-bar');
  const statusEl = document.getElementById('loader-status');
  if (bar) bar.style.width = Math.round(percent) + '%';
  if (statusEl) statusEl.textContent = status;
}

// ============================================================
// METADATA EXTRACTION
// ============================================================

function buildMetadata() {
  State.subjects.clear();
  State.grades.clear();
  State.units.clear();
  State.sections.clear();

  for (const q of State.questions) {
    State.subjects.add(q._subject);
    State.grades.add(q._grade);

    const unitKey = q._subject + '|' + q._grade;
    if (!State.units.has(unitKey)) State.units.set(unitKey, new Set());
    State.units.get(unitKey).add(q._unit);

    if (q._section) {
      const sectionKey = q._subject + '|' + q._grade + '|' + q._unit;
      if (!State.sections.has(sectionKey)) State.sections.set(sectionKey, new Set());
      State.sections.get(sectionKey).add(q._section);
    }
  }
}

// Fast lookup map for questions by ID
let questionById = new Map();
function buildQuestionIndex() {
  questionById.clear();
  for (const q of State.questions) {
    questionById.set(q.question_id, q);
  }
}

// ============================================================
// FILTERING
// ============================================================

function getFilters() {
  return {
    subject: document.getElementById('filter-subject')?.value || '',
    grade: document.getElementById('filter-grade')?.value || '',
    unit: document.getElementById('filter-unit')?.value || '',
    section: document.getElementById('filter-section')?.value || '',
    difficulty: document.getElementById('filter-difficulty')?.value || '',
    status: document.getElementById('filter-status')?.value || '',
  };
}

function applyFilters(filters) {
  const f = filters !== undefined ? filters : getFilters();
  State.filtered = State.questions.filter(q => {
    if (f.subject && q._subject !== f.subject) return false;
    if (f.grade && q._grade !== f.grade) return false;
    if (f.unit && q._unit !== f.unit) return false;
    if (f.section && q._section !== f.section) return false;
    if (f.difficulty && q.difficulty_level !== f.difficulty) return false;
    if (f.status) {
      const ans = State.answered[q.question_id];
      if (f.status === 'unanswered' && ans) return false;
      if (f.status === 'correct' && (!ans || !ans.correct)) return false;
      if (f.status === 'wrong' && (!ans || ans.correct)) return false;
      if (f.status === 'bookmarked' && !State.bookmarks.has(q.question_id)) return false;
      if (f.status === 'revision' && !State.revision.has(q.question_id)) return false;
    }
    return true;
  });

  State.currentIndex = Math.min(State.currentIndex, Math.max(0, State.filtered.length - 1));
  updateFilterInfo();
  renderQuestion();
  saveState();
}

function updateFilterInfo() {
  const total = State.filtered.length;
  const answered = State.filtered.filter(q => State.answered[q.question_id]).length;
  const pct = total ? Math.round(answered / total * 100) : 0;
  const label = document.getElementById('question-count-label');
  if (label) label.textContent = `${answered.toLocaleString()} / ${total.toLocaleString()} answered (${pct}%)`;
  const bar = document.getElementById('progress-mini-bar');
  if (bar) bar.style.width = pct + '%';
  const jumpTotal = document.getElementById('jump-total');
  if (jumpTotal) jumpTotal.textContent = total.toLocaleString();
}

// ============================================================
// RENDER QUESTION
// ============================================================

function renderQuestion() {
  const q = State.filtered[State.currentIndex];
  if (!q) {
    renderEmpty();
    return;
  }

  // Clear previous state
  clearOptionStates();
  hideResult();
  hideExplanation();
  hideAiPanel();

  // Meta pills
  setText('q-subject', q._subject);
  setText('q-grade', q._grade);
  setText('q-unit', q._unit);
  setText('q-id', '#' + (State.currentIndex + 1));
  const diffPill = document.getElementById('q-difficulty');
  if (diffPill) {
    diffPill.textContent = (q.difficulty_level || 'unknown').toUpperCase();
    diffPill.dataset.difficulty = q.difficulty_level || 'unknown';
  }

  // Section
  const sectionParts = [q._section, q._subsection].filter(Boolean);
  const sectionEl = document.getElementById('q-section-label');
  if (sectionEl) {
    sectionEl.textContent = sectionParts.join(' › ');
    sectionEl.style.display = sectionParts.length ? '' : 'none';
  }

  // Question text
  const qText = document.getElementById('q-text');
  if (qText) {
    qText.innerHTML = formatText(q.question);
    typeset(qText);
  }

  // Options
  for (const key of ['A', 'B', 'C', 'D']) {
    const optText = document.getElementById(`opt-${key}-text`);
    if (optText) {
      optText.innerHTML = formatText(q.options?.[key] || '');
      typeset(optText.parentElement);
    }
    const btn = document.getElementById(`opt-${key}`);
    if (btn) {
      btn.style.display = q.options?.[key] ? '' : 'none';
    }
  }

  // Visual
  renderVisual(q);

  // Bookmark / revision state
  updateBookmarkButton(q.question_id);
  updateRevisionButton(q.question_id);

  // Hint
  const hintToast = document.getElementById('hint-toast');
  if (hintToast) hintToast.classList.add('hidden');

  // Jump input
  const jumpInput = document.getElementById('jump-input');
  if (jumpInput) {
    const val = parseInt(jumpInput.value);
    if (!isNaN(val)) {
      if (val < 1) jumpInput.value = 1;
      else if (val > State.filtered.length) jumpInput.value = State.filtered.length;
    } else {
      jumpInput.value = State.currentIndex + 1;
    }
  }

  // Nav buttons
  const prevBtn = document.getElementById('btn-prev');
  const nextBtn = document.getElementById('btn-next');
  if (prevBtn) prevBtn.disabled = State.currentIndex === 0;
  if (nextBtn) nextBtn.disabled = State.currentIndex >= State.filtered.length - 1;

  // If already answered, restore answer display
  const prev = State.answered[q.question_id];
  if (prev) {
    setTimeout(() => showAnswer(prev.selected, q, false), 50);
  }

  // Scroll question card into view
  document.querySelector('.question-area')?.scrollTo({ top: 0, behavior: 'instant' });
}

function renderEmpty() {
  const qText = document.getElementById('q-text');
  if (qText) qText.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3rem;gap:1rem;color:var(--text-muted)">
      <div style="font-size:3rem">😕</div>
      <div style="font-size:1rem;font-weight:600;color:var(--text-secondary)">No questions match current filters.</div>
      <div style="font-size:0.85rem">Try adjusting your filters or select "All Questions".</div>
    </div>`;
  for (const key of ['A','B','C','D']) {
    const el = document.getElementById(`opt-${key}-text`);
    if (el) el.textContent = '';
    const btn = document.getElementById(`opt-${key}`);
    if (btn) { btn.disabled = true; btn.style.display = 'none'; }
  }
  setText('q-subject', '');
  setText('q-grade', '');
  setText('q-unit', '');
  setText('q-id', '');
  const sectionEl = document.getElementById('q-section-label');
  if (sectionEl) sectionEl.style.display = 'none';
}

function renderVisual(q) {
  const area = document.getElementById('q-visual');
  if (!area) return;

  const vs = q.visual_system;
  if (!vs || !vs.requires_visual) {
    area.classList.add('hidden');
    return;
  }

  area.classList.remove('hidden');
  let html = '';

  if (vs.visual_title) html += `<div style="font-weight:600;margin-bottom:0.5rem;font-size:0.9rem">${formatText(vs.visual_title)}</div>`;

  if (vs.table_spec) {
    const t = vs.table_spec;
    if (t.headers && t.rows) {
      html += '<table class="q-table"><thead><tr>';
      for (const h of t.headers) html += `<th>${formatText(String(h))}</th>`;
      html += '</tr></thead><tbody>';
      for (const row of t.rows) {
        html += '<tr>';
        for (const cell of row) html += `<td>${formatText(String(cell))}</td>`;
        html += '</tr>';
      }
      html += '</tbody></table>';
    }
  } else if (vs.image_url) {
    html += `<div class="visual-image-container">
      <img src="${escapeHtml(vs.image_url)}" alt="${escapeHtml(vs.visual_description || 'Question visual')}" style="max-width: 100%; border-radius: var(--radius-md); box-shadow: var(--shadow-sm);" />
    </div>`;
  } else if (vs.visual_description) {
    html += `<div class="visual-placeholder">
      <div class="visual-icon">${getVisualIcon(vs.visual_type)}</div>
      <div class="visual-label">${escapeHtml(vs.visual_type || 'Visual')}</div>
      <div class="visual-desc">${escapeHtml(vs.visual_description)}</div>
    </div>`;
  }

  if (vs.caption) html += `<p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.5rem;text-align:center;font-style:italic">${escapeHtml(vs.caption)}</p>`;

  area.innerHTML = html;
  typeset(area);
}

function getVisualIcon(type) {
  const icons = {
    'graph': '📈', 'chart': '📊', 'diagram': '🖼️', 'table': '📋',
    'circuit': '⚡', 'molecule': '🔬', 'biology': '🧬',
    'geometry': '📐', 'number_line': '📏', 'flowchart': '🔄',
  };
  return icons[type?.toLowerCase()] || '🖼️';
}

// ============================================================
// ANSWER HANDLING
// ============================================================

function selectOption(selectedKey) {
  const q = State.filtered[State.currentIndex];
  if (!q) return;
  if (State.answered[q.question_id]) return;
  if (!q.options?.[selectedKey]) return;
  showAnswer(selectedKey, q, true);
}

function showAnswer(selectedKey, q, isNew) {
  const correct = q.correct_answer;
  const isCorrect = selectedKey === correct;

  // Style options
  for (const key of ['A', 'B', 'C', 'D']) {
    const btn = document.getElementById(`opt-${key}`);
    if (!btn) continue;
    btn.disabled = true;
    if (key === selectedKey) {
      btn.classList.add('selected', isCorrect ? 'correct' : 'wrong');
    }
    if (key === correct && !isCorrect) {
      btn.classList.add('correct');
    }
  }

  // Result banner
  showResult(isCorrect, correct, q.options?.[correct] || '');

  // Explanation panel (always show after answer)
  showExplanation(q);

  if (isNew) {
    // Record answer
    State.answered[q.question_id] = {
      selected: selectedKey,
      correct: isCorrect,
      timestamp: Date.now(),
    };

    updateDailyGoal(true);

    // Track wrong
    if (!isCorrect) {
      if (!State.wrong[q.question_id]) {
        State.wrong[q.question_id] = { count: 0, timestamps: [] };
      }
      State.wrong[q.question_id].count++;
      State.wrong[q.question_id].timestamps.push(Date.now());
      State.wrong[q.question_id].qRef = {
        text: q.question,
        subject: q._subject,
        unit: q._unit,
        grade: q._grade,
        id: q.question_id,
        section: q._section || '',
      };
    }

    // Streak
    if (isCorrect) {
      State.streak++;
      if (State.streak > State.bestStreak) State.bestStreak = State.streak;
    } else {
      State.streak = 0;
    }

    updateSidebarStats();
    updateBadges();
    updateFilterInfo();
    saveState();
    addRecentActivity(q, isCorrect);

    // Streak milestones
    if (isCorrect && State.streak > 0 && State.streak % 5 === 0) {
      showToast(`🔥 ${State.streak} streak! Keep going!`, 'success');
    }

    // Keyboard focus hint — auto-advance on Enter after answering
    document.getElementById('btn-next')?.focus();
  }
}

function showResult(isCorrect, correctKey, correctText) {
  const banner = document.getElementById('result-banner');
  if (!banner) return;
  banner.classList.remove('hidden', 'correct-banner', 'wrong-banner');
  banner.classList.add(isCorrect ? 'correct-banner' : 'wrong-banner');
  document.getElementById('result-icon').textContent = isCorrect ? '✅' : '❌';
  const resultText = document.getElementById('result-text');
  if (isCorrect) {
    resultText.innerHTML = `<strong>Correct!</strong><small>Great job. Press → or Enter to continue.</small>`;
  } else {
    resultText.innerHTML = `<strong>Incorrect.</strong><small>Correct answer: <strong>${escapeHtml(correctKey)}. ${formatText(correctText)}</strong></small>`;
  }
  typeset(banner);
}

function hideResult() {
  document.getElementById('result-banner')?.classList.add('hidden');
}

function showExplanation(q) {
  const panel = document.getElementById('explanation-panel');
  if (!panel) return;
  panel.classList.remove('hidden');

  const exp = q.explanations_tiered || {};

  // Main tab
  const defEl = document.getElementById('exp-definition');
  if (defEl) {
    defEl.innerHTML = exp.definition ? `📖 ${formatText(exp.definition)}` : '';
    defEl.style.display = exp.definition ? '' : 'none';
  }

  const bodyEl = document.getElementById('exp-body');
  if (bodyEl) {
    bodyEl.innerHTML = formatText(q.explanation || exp.concept_summary || '');
    // Revision note
    const note = exp.revision_note || q.publishing_metadata?.revision_note;
    if (note) {
      bodyEl.innerHTML += `<div class="revision-note">📌 <strong>Revision Note:</strong> ${formatText(note)}</div>`;
    }
    // Formula
    const formulas = q.formula_used || exp.formula_analysis || [];
    if (Array.isArray(formulas) && formulas.length > 0) {
      bodyEl.innerHTML += `<div class="formula-block">⚙️ <strong>Formula:</strong> ${formulas.map(f => {
        const text = typeof f === 'object' && f !== null ? (f.formula || escapeHtml(JSON.stringify(f))) : escapeHtml(f);
        const name = typeof f === 'object' && f !== null && f.name ? ` <span style="font-size:0.8em;color:var(--text-muted)">(${escapeHtml(f.name)})</span>` : '';
        return `<code class="formula-code">${text}</code>${name}`;
      }).join(' · ')}</div>`;
    }
  }

  const miscEl = document.getElementById('exp-misconceptions');
  if (miscEl) {
    const misc = Array.isArray(exp.misconceptions) ? exp.misconceptions.join(' ') : (exp.misconceptions || '');
    miscEl.innerHTML = misc ? `⚠️ <strong>Common Misconception:</strong> ${formatText(misc)}` : '';
    miscEl.style.display = misc ? '' : 'none';
  }

  // Tiered tab
  const tieredContent = document.getElementById('exp-tiered-content');
  if (tieredContent) {
    const levels = [
      { key: 'beginner', label: '🟢 Beginner', color: 'var(--accent-success)' },
      { key: 'intermediate', label: '🟡 Intermediate', color: 'var(--accent-warning)' },
      { key: 'advanced', label: '🔴 Advanced', color: 'var(--accent-danger)' },
      { key: 'worked_solution', label: '📐 Worked Solution', color: 'var(--accent-secondary)' },
      { key: 'reasoning_steps', label: '🧠 Reasoning Steps', color: 'var(--accent-primary)' },
    ];
    tieredContent.innerHTML = levels.map(l => {
      const val = exp[l.key];
      if (!val || (Array.isArray(val) && val.length === 0)) return '';
      const text = Array.isArray(val) ? val.map((s,i) => `<div class="ai-step"><span class="step-num">${i+1}</span> <div>${formatText(s)}</div></div>`).join('') : formatText(val);
      return `<div class="tiered-level-card" style="--level-color:${l.color}">
        <div class="tiered-level-header">${l.label}</div>
        <div class="tiered-level-body">${text}</div>
      </div>`;
    }).filter(Boolean).join('') || '<p style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem">No tiered content available.</p>';
    typeset(tieredContent);
  }

  // Flashcard tab
  const fcFront = exp.flashcard?.front || q.publishing_metadata?.flashcard_front || q.question;
  const fcBack = exp.flashcard?.back || q.publishing_metadata?.flashcard_back || q.explanation;
  const fcDisplay = document.getElementById('exp-flashcard-display');
  if (fcDisplay) {
    fcDisplay.innerHTML = `
      <div class="fc-q">${formatText(fcFront)}</div>
      <div class="fc-divider">↓ Answer ↓</div>
      <div class="fc-a">${formatText(fcBack || '')}</div>
    `;
    typeset(fcDisplay);
  }

  // Concepts tab
  const concepts = exp.related_concepts || [];
  const conceptsList = document.getElementById('exp-concepts-list');
  if (conceptsList) {
    // Glossary entry
    let glossaryHtml = '';
    const ge = exp.glossary_entry;
    if (ge && ge.term) {
      glossaryHtml = `<div class="glossary-entry">
        <div class="glossary-term">📚 ${escapeHtml(ge.term)}</div>
        <div class="glossary-def">${formatText(ge.definition || '')}</div>
        ${ge.related_terms?.length ? `<div class="glossary-related">${ge.related_terms.map(t => `<span class="concept-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>`;
    }

    if (concepts.length) {
      conceptsList.innerHTML = glossaryHtml + `<div class="concepts-label">Related Concepts</div>` + concepts.map(c =>
        `<span class="concept-tag" data-action="search-concept" data-concept="${escapeHtml(c)}">${escapeHtml(c)}</span>`
      ).join('');
    } else {
      conceptsList.innerHTML = glossaryHtml || '<span style="color:var(--text-muted);font-size:0.85rem">No related concepts listed.</span>';
    }
  }

  typeset(panel);
  setExplanationTab('main');
}

function searchConcept(concept) {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.value = concept;
    switchView('search');
    doSearch();
  }
}

function hideExplanation() {
  document.getElementById('explanation-panel')?.classList.add('hidden');
}

function hideAiPanel() {
  document.getElementById('ai-panel')?.classList.add('hidden');
  const aiOutput = document.getElementById('ai-output');
  if (aiOutput) aiOutput.innerHTML = '';
}

function setExplanationTab(tab) {
  document.querySelectorAll('.exp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.explanation-content').forEach(c => {
    c.classList.toggle('hidden', c.id !== `exp-${tab}`);
  });
}

// ============================================================
// OPTION STATES
// ============================================================

function clearOptionStates() {
  for (const key of ['A', 'B', 'C', 'D']) {
    const btn = document.getElementById(`opt-${key}`);
    if (!btn) continue;
    btn.disabled = false;
    btn.classList.remove('selected', 'correct', 'wrong');
    btn.style.display = '';
  }
}

// ============================================================
// NAVIGATION
// ============================================================

function goTo(index) {
  const clamped = Math.max(0, Math.min(index, State.filtered.length - 1));
  State.currentIndex = clamped;
  // Stop TTS when navigating
  if (_ttsActive) { window.speechSynthesis.cancel(); _ttsActive = false; document.getElementById('btn-tts')?.classList.remove('tts-active'); }
  renderQuestion();
  updateNoteDot();
}

function goNext() {
  if (State.currentIndex < State.filtered.length - 1) goTo(State.currentIndex + 1);
}
function goPrev() {
  if (State.currentIndex > 0) goTo(State.currentIndex - 1);
}

function goRandom() {
  if (State.filtered.length === 0) return;
  const idx = Math.floor(Math.random() * State.filtered.length);
  goTo(idx);
}

// ============================================================
// BOOKMARKS & REVISION
// ============================================================

function toggleBookmark(qId) {
  if (State.bookmarks.has(qId)) {
    State.bookmarks.delete(qId);
    showToast('Bookmark removed', 'info');
  } else {
    State.bookmarks.add(qId);
    showToast('Bookmarked! ⭐', 'success');
  }
  updateBookmarkButton(qId);
  updateBadges();
  saveState();
}

function toggleRevision(qId) {
  const current = State.revision.get(qId) || 0;
  if (current >= 3) {
    State.revision.delete(qId);
    showToast('Removed from revision list', 'info');
  } else {
    State.revision.set(qId, current + 1);
    const stars = '⭐'.repeat(current + 1);
    showToast(`Priority revision ${stars}`, 'success');
  }
  updateRevisionButton(qId);
  updateBadges();
  saveState();
}

function updateBookmarkButton(qId) {
  const btn = document.getElementById('btn-bookmark');
  if (btn) btn.classList.toggle('bookmarked', State.bookmarks.has(qId));
}

function updateRevisionButton(qId) {
  const btn = document.getElementById('btn-revise');
  const priority = State.revision.get(qId) || 0;
  if (btn) {
    btn.classList.toggle('starred', priority > 0);
    btn.title = priority > 0 ? `Priority: ${'⭐'.repeat(priority)} (click to increase/remove)` : 'Mark for Revision (R)';
  }
}

// ============================================================
// COPY FUNCTIONS
// ============================================================

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('Copied to clipboard! 📋', 'success'))
      .catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  ta.remove();
  showToast('Copied to clipboard! 📋', 'success');
}

function stripHtmlAndNormalizeMath(str) {
  if (!str) return '';
  // Remove simple HTML tags
  let text = String(str).replace(/<[^>]+>/g, '');
  // Replace HTML entities
  text = text.replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"');
  // Optional: We keep LaTeX delimiters \( \) and $$ because copying raw text
  // with math is usually best done by preserving LaTeX syntax for the clipboard.
  // We just want to ensure we don't have HTML tags mixed with LaTeX.
  return text;
}

function getCopyText(mode) {
  const q = State.filtered[State.currentIndex];
  if (!q) return '';
  const ans = State.answered[q.question_id];
  const opts = Object.entries(q.options || {}).map(([k,v]) => `${k}. ${stripHtmlAndNormalizeMath(v)}`).join('\n');

  if (mode === 'question') return stripHtmlAndNormalizeMath(q.question);
  if (mode === 'options') return `${stripHtmlAndNormalizeMath(q.question)}\n\n${opts}`;
  if (mode === 'all') {
    const selected = ans ? `Your answer: ${ans.selected}. ${stripHtmlAndNormalizeMath(q.options?.[ans.selected] || '')}` : 'Not answered';
    const correct = `Correct answer: ${q.correct_answer}. ${stripHtmlAndNormalizeMath(q.options?.[q.correct_answer] || '')}`;
    const exp = stripHtmlAndNormalizeMath(q.explanation || '');
    return `${stripHtmlAndNormalizeMath(q.question)}\n\n${opts}\n\n${selected}\n${correct}\n\nExplanation:\n${exp}`;
  }
  return stripHtmlAndNormalizeMath(q.question);
}

function searchOnline() {
  const q = State.filtered[State.currentIndex];
  if (!q) return;
  
  // Instantly copy full question with formatting per user request
  copyText(getCopyText('all'));
  
  const ans = State.answered[q.question_id];
  let query = stripHtmlAndNormalizeMath(q.question).substring(0, 200);
  if (ans) query += ` ${stripHtmlAndNormalizeMath(q.options?.[ans.selected] || '')}`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  
  // Delay the open slightly so the copy toast can be seen
  setTimeout(() => window.open(url, '_blank'), 400);
}

// ============================================================
// HINT
// ============================================================

function toggleHint() {
  const q = State.filtered[State.currentIndex];
  if (!q) return;
  const toast = document.getElementById('hint-toast');
  if (!toast) return;
  if (toast.classList.contains('hidden')) {
    toast.innerHTML = `💡 <strong>Hint:</strong> ${formatText(q.hint || 'No hint available for this question.')}`;
    toast.classList.remove('hidden');
    typeset(toast);
  } else {
    toast.classList.add('hidden');
  }
}

// ============================================================
// FILTER POPULATION
// ============================================================

function populateFilters() {
  const subjects = [...State.subjects].sort();
  const grades = [...State.grades].sort();

  // Practice filters
  fillSelect('filter-subject', subjects, 'All Subjects');
  fillSelect('filter-grade', grades, 'All Grades');
  fillSelect('filter-unit', [], 'All Units');
  fillSelect('filter-section', [], 'All Sections');

  // Search
  fillSelect('search-subject', subjects, 'All Subjects');

  // Exam
  fillSelect('exam-subject-select', subjects, 'Select Subject...');
  fillSelect('exam-grade-select', grades, 'Select Grade...');
  fillSelect('exam-unit-select', [], 'Select Unit...');

  // Flashcard
  fillSelect('fc-subject-filter', ['', ...subjects], null);
  const fcEl = document.getElementById('fc-subject-filter');
  if (fcEl && fcEl.options[0]) fcEl.options[0].text = 'All Subjects';
}

function fillSelect(id, items, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    el.appendChild(opt);
  }
  for (const item of items) {
    if (item === '') continue;
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = item;
    el.appendChild(opt);
  }
  // Also sync the custom dropdown UI for filter selects
  syncCustomSelect(id);
}

// Build / refresh the custom-select-dropdown list from the hidden <select>
function syncCustomSelect(id) {
  const select = document.getElementById(id);
  if (!select) return;
  const wrapper = select.closest('.custom-select-wrapper');
  if (!wrapper) return;
  const dropdown = wrapper.querySelector('.custom-select-dropdown');
  const textEl   = wrapper.querySelector('.custom-select-text');
  if (!dropdown) return;

  dropdown.innerHTML = '';
  for (const opt of select.options) {
    const div = document.createElement('div');
    div.className = 'custom-select-option' + (opt.selected ? ' selected' : '');
    div.dataset.value = opt.value;
    div.textContent = opt.text;
    div.addEventListener('click', () => {
      select.value = opt.value;
      // Mark selected
      dropdown.querySelectorAll('.custom-select-option').forEach(d => d.classList.remove('selected'));
      div.classList.add('selected');
      // Update label
      if (textEl) textEl.textContent = opt.text;
      // Close
      wrapper.classList.remove('open');
      // Fire change event on real select
      select.dispatchEvent(new Event('change'));
    });
    dropdown.appendChild(div);
  }
  // Sync label to current value
  if (textEl && select.options[select.selectedIndex]) {
    textEl.textContent = select.options[select.selectedIndex].text;
  }
}

// Wire open/close for all custom-select-wrappers in the filter bar
function initCustomSelects() {
  document.querySelectorAll('.custom-select-wrapper').forEach(wrapper => {
    const display = wrapper.querySelector('.custom-select-display');
    const select  = wrapper.querySelector('select');
    if (!display || !select) return;

    // Build initial list from the hidden select's existing options
    syncCustomSelect(select.id);

    // Toggle open on click
    display.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = wrapper.classList.contains('open');
      // Close all other dropdowns
      document.querySelectorAll('.custom-select-wrapper.open').forEach(w => w.classList.remove('open'));
      if (!isOpen) wrapper.classList.add('open');
    });

    display.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        display.click();
      } else if (e.key === 'Escape') {
        wrapper.classList.remove('open');
      }
    });
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.custom-select-wrapper.open').forEach(w => w.classList.remove('open'));
  });
}


function updateUnitFilter() {
  const subject = document.getElementById('filter-subject')?.value || '';
  const grade = document.getElementById('filter-grade')?.value || '';

  let units = [];
  if (subject && grade) {
    units = [...(State.units.get(subject + '|' + grade) || [])].sort(naturalSort);
  } else if (subject) {
    const merged = new Set();
    for (const [k, v] of State.units) {
      if (k.startsWith(subject + '|')) for (const u of v) merged.add(u);
    }
    units = [...merged].sort(naturalSort);
  } else if (grade) {
    const merged = new Set();
    for (const [k, v] of State.units) {
      if (k.endsWith('|' + grade)) for (const u of v) merged.add(u);
    }
    units = [...merged].sort(naturalSort);
  }

  fillSelect('filter-unit', units, 'All Units');
  // Reset section filter
  fillSelect('filter-section', [], 'All Sections');
}

function updateSectionFilter() {
  const subject = document.getElementById('filter-subject')?.value || '';
  const grade = document.getElementById('filter-grade')?.value || '';
  const unit = document.getElementById('filter-unit')?.value || '';

  let sections = [];
  if (subject && grade && unit) {
    const key = subject + '|' + grade + '|' + unit;
    sections = [...(State.sections.get(key) || [])].sort();
  } else if (unit) {
    const merged = new Set();
    for (const [k, v] of State.sections) {
      if (k.endsWith('|' + unit)) for (const s of v) merged.add(s);
    }
    sections = [...merged].sort();
  }
  fillSelect('filter-section', sections, 'All Sections');
}

// Natural sort for unit names like "Unit 1", "Unit 2", "Unit 10"
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// ============================================================
// EXAM MODE
// ============================================================

let examTimer = null;
let examTimeRemaining = 0;
let examStartTime = 0;

function startExam() {
  const type = document.querySelector('.exam-type-btn.active[data-type]')?.dataset.type || 'mixed';
  const count = parseInt(document.getElementById('exam-count')?.value || '20');
  const timeMin = parseInt(document.getElementById('exam-time')?.value || '30');
  const diff = document.querySelector('[data-diff].active')?.dataset.diff || 'any';

  let pool = [...State.questions];

  if (type === 'subject') {
    const subject = document.getElementById('exam-subject-select')?.value;
    if (subject) pool = pool.filter(q => q._subject === subject);
  } else if (type === 'unit') {
    const grade = document.getElementById('exam-grade-select')?.value;
    const unit = document.getElementById('exam-unit-select')?.value;
    if (grade) pool = pool.filter(q => q._grade === grade);
    if (unit) pool = pool.filter(q => q._unit === unit);
  } else if (type === 'wrong') {
    const wrongIds = new Set(Object.keys(State.wrong));
    pool = pool.filter(q => wrongIds.has(q.question_id));
  } else if (type === 'revision') {
    const revIds = new Set(State.revision.keys());
    pool = pool.filter(q => revIds.has(q.question_id));
  }

  if (diff !== 'any') pool = pool.filter(q => q.difficulty_level === diff);

  if (pool.length === 0) {
    showToast('No questions available for these settings!', 'error');
    return;
  }

  // Shuffle and take
  shuffle(pool);
  const examQs = pool.slice(0, Math.min(count, pool.length));

  State.exam = {
    questions: examQs,
    answers: new Array(examQs.length).fill(null),
    currentIndex: 0,
    startTime: Date.now(),
    timeLimit: timeMin * 60,
    finished: false,
    type,
  };

  document.getElementById('exam-setup').classList.add('hidden');
  document.getElementById('exam-results').classList.add('hidden');
  document.getElementById('exam-active').classList.remove('hidden');

  buildExamDots();
  renderExamQuestion();

  const timerEl = document.getElementById('exam-timer');
  if (timeMin > 0) {
    examTimeRemaining = timeMin * 60;
    examStartTime = Date.now();
    if (timerEl) timerEl.style.display = '';
    updateExamTimer();
    clearInterval(examTimer);
    examTimer = setInterval(() => {
      examTimeRemaining--;
      updateExamTimer();
      if (examTimeRemaining <= 0) {
        clearInterval(examTimer);
        showToast("⏰ Time's up! Ending exam...", 'error');
        setTimeout(endExam, 1500);
      }
    }, 1000);
  } else {
    if (timerEl) timerEl.style.display = 'none';
  }
}

function buildExamDots() {
  const dots = document.getElementById('exam-q-dots');
  if (!dots) return;
  dots.innerHTML = '';
  // Only show dots for first 50 questions (performance)
  const limit = Math.min(State.exam.questions.length, 50);
  for (let i = 0; i < limit; i++) {
    const dot = document.createElement('div');
    dot.className = 'exam-dot' + (i === 0 ? ' current' : '');
    dot.title = `Q${i+1}`;
    const idx = i;
    dot.addEventListener('click', () => { State.exam.currentIndex = idx; renderExamQuestion(); });
    dots.appendChild(dot);
  }
}

function updateExamDots() {
  const dots = document.querySelectorAll('.exam-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('current', i === State.exam.currentIndex);
    dot.classList.toggle('answered', State.exam.answers[i] !== null);
  });
}

function renderExamQuestion() {
  const exam = State.exam;
  if (!exam) return;
  const q = exam.questions[exam.currentIndex];
  if (!q) return;

  document.getElementById('exam-q-counter').textContent = `Q ${exam.currentIndex + 1} / ${exam.questions.length}`;
  const fill = document.getElementById('exam-progress-fill');
  if (fill) fill.style.width = ((exam.currentIndex + 1) / exam.questions.length * 100) + '%';

  const examQText = document.getElementById('exam-q-text');
  if (examQText) {
    examQText.innerHTML = formatText(q.question);
    typeset(examQText);
  }

  const examMeta = document.getElementById('exam-q-meta');
  if (examMeta) {
    examMeta.innerHTML = `<span class="meta-pill subject-pill">${escapeHtml(q._subject)}</span>
      <span class="meta-pill grade-pill">${escapeHtml(q._grade)}</span>
      <span class="meta-pill difficulty-pill" data-difficulty="${q.difficulty_level||''}">${(q.difficulty_level||'').toUpperCase()}</span>
      <span class="meta-pill" style="margin-left:auto;color:var(--text-muted)">${exam.answers.filter(a=>a!==null).length} answered</span>`;
  }

  for (const key of ['A','B','C','D']) {
    const textEl = document.getElementById(`exam-opt-${key}-text`);
    if (textEl) {
      textEl.innerHTML = formatText(q.options?.[key] || '');
      typeset(textEl.parentElement);
    }
    const btn = document.getElementById(`exam-opt-${key}`);
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('selected', 'correct', 'wrong');
      btn.style.display = q.options?.[key] ? '' : 'none';
    }
  }

  const prev = exam.answers[exam.currentIndex];
  if (prev !== null) {
    const btn = document.getElementById(`exam-opt-${prev}`);
    if (btn) btn.classList.add('selected');
    for (const key of ['A','B','C','D']) {
      const b = document.getElementById(`exam-opt-${key}`);
      if (b) b.disabled = true;
    }
  }

  const prevBtn = document.getElementById('exam-btn-prev');
  const nextBtn = document.getElementById('exam-btn-next');
  if (prevBtn) prevBtn.disabled = exam.currentIndex === 0;
  if (nextBtn) nextBtn.disabled = exam.currentIndex >= exam.questions.length - 1;

  updateExamDots();
}

function selectExamOption(key) {
  const exam = State.exam;
  if (!exam || exam.answers[exam.currentIndex] !== null) return;

  const q = exam.questions[exam.currentIndex];
  if (!q.options?.[key]) return;

  exam.answers[exam.currentIndex] = key;

  const btn = document.getElementById(`exam-opt-${key}`);
  if (btn) btn.classList.add('selected');

  for (const key2 of ['A','B','C','D']) {
    const b = document.getElementById(`exam-opt-${key2}`);
    if (b) b.disabled = true;
  }

  updateExamDots();

  // Auto advance after 0.8s
  if (exam.currentIndex < exam.questions.length - 1) {
    setTimeout(() => {
      exam.currentIndex++;
      renderExamQuestion();
    }, 800);
  }
}

function updateExamTimer() {
  const t = examTimeRemaining;
  const m = Math.floor(t / 60).toString().padStart(2, '0');
  const s = (t % 60).toString().padStart(2, '0');
  const display = document.getElementById('timer-display');
  if (display) display.textContent = `${m}:${s}`;
  const timer = document.getElementById('exam-timer');
  if (timer) {
    timer.classList.remove('warning', 'danger');
    if (t < 60) timer.classList.add('danger');
    else if (t < 300) timer.classList.add('warning');
  }
}

function endExam() {
  clearInterval(examTimer);
  const exam = State.exam;
  if (!exam) return;
  exam.finished = true;

  const elapsed = Math.floor((Date.now() - exam.startTime) / 1000);
  const total = exam.questions.length;
  let correct = 0, wrong = 0, skipped = 0;

  for (let i = 0; i < total; i++) {
    const q = exam.questions[i];
    const ans = exam.answers[i];
    if (ans === null) { skipped++; continue; }
    const isCorrect = ans === q.correct_answer;
    if (isCorrect) correct++;
    else wrong++;

    // Update global answered state from exam
    if (!State.answered[q.question_id] || !State.answered[q.question_id].correct) {
      State.answered[q.question_id] = {
        selected: ans,
        correct: isCorrect,
        timestamp: Date.now(),
      };
    }

    // Track wrong questions
    if (!isCorrect) {
      if (!State.wrong[q.question_id]) State.wrong[q.question_id] = { count: 0, timestamps: [] };
      State.wrong[q.question_id].count++;
      State.wrong[q.question_id].timestamps.push(Date.now());
      State.wrong[q.question_id].qRef = {
        text: q.question, subject: q._subject, unit: q._unit, grade: q._grade,
        id: q.question_id, section: q._section || '',
      };
    }
  }

  const pct = total > 0 ? Math.round(correct / total * 100) : 0;

  State.examHistory.push({
    date: Date.now(),
    total, correct, wrong, skipped,
    pct, elapsed,
    type: exam.type || 'exam',
  });

  saveState();
  updateBadges();
  updateSidebarStats();
  renderExamResults(exam, correct, wrong, skipped, pct, elapsed);
}

function renderExamResults(exam, correct, wrong, skipped, pct, elapsed) {
  document.getElementById('exam-active').classList.add('hidden');
  document.getElementById('exam-results').classList.remove('hidden');

  document.getElementById('results-percent').textContent = pct + '%';
  document.getElementById('rs-correct').textContent = correct;
  document.getElementById('rs-wrong').textContent = wrong;
  document.getElementById('rs-skipped').textContent = skipped;
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  document.getElementById('rs-time').textContent = `${m}:${s.toString().padStart(2,'0')}`;

  const ring = document.getElementById('score-ring-fill');
  if (ring) {
    const circumference = 314;
    setTimeout(() => {
      ring.style.transition = 'stroke-dashoffset 1.5s cubic-bezier(0.34,1.56,0.64,1)';
      ring.style.strokeDashoffset = circumference - (pct / 100 * circumference);
      ring.style.stroke = pct >= 70 ? 'var(--accent-success)' : pct >= 50 ? 'var(--accent-warning)' : 'var(--accent-danger)';
    }, 100);
  }

  const perfMsg = pct >= 90 ? '🏆 Outstanding performance!' :
                  pct >= 80 ? '🌟 Excellent! Keep it up!' :
                  pct >= 70 ? '✅ Good job! Review weak areas.' :
                  pct >= 50 ? '📚 Passed, but more practice needed.' :
                  '❌ Needs improvement. Review all mistakes.';

  const resultsCard = document.querySelector('.results-card');
  if (resultsCard) {
    let msgEl = resultsCard.querySelector('.perf-msg');
    if (!msgEl) {
      msgEl = document.createElement('div');
      msgEl.className = 'perf-msg';
      document.querySelector('.results-header')?.insertAdjacentElement('afterend', msgEl);
    }
    msgEl.textContent = perfMsg;
    msgEl.style.cssText = `font-size:0.95rem;font-weight:600;text-align:center;padding:0.75rem;margin-bottom:1rem;
      background:${pct>=70?'rgba(52,211,153,0.1)':'rgba(239,68,68,0.1)'};
      border-radius:var(--radius-md);color:${pct>=70?'var(--accent-success)':'var(--accent-danger)'}`;
  }

  const review = document.getElementById('results-review');
  if (review) {
    review.innerHTML = exam.questions.map((q, i) => {
      const ans = exam.answers[i];
      const isCorrect = ans === q.correct_answer;
      const cls = ans === null ? 'skip-r' : (isCorrect ? 'correct-r' : 'wrong-r');
      const icon = ans === null ? '⏭' : (isCorrect ? '✓' : '✗');
      const qShort = escapeHtml(q.question.substring(0,80)) + (q.question.length > 80 ? '…' : '');
      const correctText = ans && !isCorrect ? ` (Correct: ${q.correct_answer})` : '';
      return `<div class="review-item ${cls}" data-action="jump" data-qid="${escapeHtml(q.question_id)}">
        <span class="review-num">${i+1}</span>
        <span class="review-icon">${icon}</span>
        <span class="review-text">${qShort}</span>
        <span class="review-answer">${ans || '—'}${correctText}</span>
      </div>`;
    }).join('');
  }
}

// ============================================================
// WRONG QUESTIONS VIEW
// ============================================================

function renderWrongView(tab) {
  tab = tab || 'all';
  const list = document.getElementById('wrong-questions-list');
  if (!list) return;

  let items = Object.entries(State.wrong).map(([id, data]) => ({ id, ...data }));

  if (tab === 'recent') {
    items.sort((a, b) => (b.timestamps?.slice(-1)[0] || 0) - (a.timestamps?.slice(-1)[0] || 0));
    items = items.slice(0, 50);
  } else if (tab === 'frequent') {
    items.sort((a, b) => b.count - a.count);
    items = items.slice(0, 50);
  }

  const badge = document.getElementById('wrong-badge');
  if (badge) {
    const total = Object.keys(State.wrong).length;
    badge.textContent = total;
    badge.style.display = total ? '' : 'none';
  }

  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🎉</div>
      <h3>No mistakes yet!</h3>
      <p>Keep practicing. Wrong answers will appear here for targeted review.</p>
    </div>`;
    return;
  }

  list.innerHTML = items.map((item, i) => {
    const ref = item.qRef || {};
    const time = item.timestamps?.slice(-1)[0];
    const timeStr = time ? timeAgo(time) : '';
    const wrongClass = item.count >= 3 ? 'wrong-item-high' : item.count >= 2 ? 'wrong-item-med' : '';
    return `<div class="q-list-item ${wrongClass}" data-id="${escapeHtml(item.id)}" data-action="jump" data-qid="${escapeHtml(item.id)}">
      <span class="q-list-num">${i+1}</span>
      <span class="q-list-icon">❌</span>
      <div class="q-list-body">
        <div class="q-list-text">${formatText((ref.text || item.id).substring(0, 100))}</div>
        <div class="q-list-meta">${escapeHtml(ref.subject||'')} · ${escapeHtml(ref.unit||'')} · ${timeStr}</div>
      </div>
      <span class="q-list-count ${item.count >= 3 ? 'q-list-count-high' : ''}">${item.count}×</span>
    </div>`;
  }).join('');
  
  if (typeof typesetAll === 'function') typesetAll(list);
}

// ============================================================
// BOOKMARKS VIEW
// ============================================================

function renderBookmarksView(tab) {
  tab = tab || 'bookmarks';
  const list = document.getElementById('bookmarks-list');
  if (!list) return;

  let ids = [];
  if (tab === 'bookmarks') {
    ids = [...State.bookmarks];
  } else {
    ids = [...State.revision.keys()].sort((a, b) => (State.revision.get(b) || 0) - (State.revision.get(a) || 0));
  }

  if (ids.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">${tab === 'bookmarks' ? '⭐' : '📌'}</div>
      <h3>${tab === 'bookmarks' ? 'No bookmarks yet' : 'No revision items'}</h3>
      <p>${tab === 'bookmarks' ? 'Press the bookmark button while answering to save a question.' : 'Press the star button while answering to mark for revision.'}</p>
    </div>`;
    return;
  }

  list.innerHTML = ids.map((id, i) => {
    const q = questionById.get(id);
    if (!q) return '';
    const priority = State.revision.get(id) || 0;
    const stars = priority > 0 ? '⭐'.repeat(priority) : '';
    const ans = State.answered[id];
    const statusIcon = ans ? (ans.correct ? '✅' : '❌') : '';
    const diffLabel = q.difficulty_level ? `<span class="meta-pill difficulty-pill" data-difficulty="${q.difficulty_level}" style="font-size:0.68rem">${q.difficulty_level}</span>` : '';
    return `<div class="q-list-item" data-action="jump" data-qid="${escapeHtml(id)}">
      <span class="q-list-num">${i+1}</span>
      <span class="q-list-icon">${tab === 'revision' ? stars || '📌' : '⭐'} ${statusIcon}</span>
      <div class="q-list-body">
        <div class="q-list-text">${formatText(q.question.substring(0,100))}${q.question.length > 100 ? '…' : ''}</div>
        <div class="q-list-meta">${escapeHtml(q._subject)} · ${escapeHtml(q._unit)}</div>
      </div>
      ${diffLabel}
    </div>`;
  }).filter(Boolean).join('');
  if (typeof typesetAll === 'function') typesetAll(list);
}

// ============================================================
// FLASHCARDS
// ============================================================

function buildFlashcards() {
  const subject = document.getElementById('fc-subject-filter')?.value || '';
  let pool = State.questions.filter(q => {
    if (subject && q._subject !== subject) return false;
    const fc = q.explanations_tiered?.flashcard;
    return fc && fc.front && fc.back;
  });
  shuffle(pool);
  State.fc.questions = pool;
  State.fc.index = 0;
  State.fc.flipped = false;
}

function startFlashcards() {
  buildFlashcards();
  if (State.fc.questions.length === 0) {
    showToast('No flashcards available!', 'error');
    return;
  }
  document.getElementById('flashcard-grid').innerHTML = '';
  document.getElementById('flashcard-grid').style.display = 'none';
  document.getElementById('flashcard-session').classList.remove('hidden');
  renderFlashcard();
}

function renderFlashcard() {
  const q = State.fc.questions[State.fc.index];
  if (!q) return;
  const fc = q.explanations_tiered?.flashcard || { front: q.question, back: q.explanation };
  State.fc.flipped = false;

  const card = document.getElementById('fc-card');
  const frontEl = document.getElementById('fc-front');
  const backEl = document.getElementById('fc-back');

  if (card) card.classList.remove('fc-flipped');
  if (frontEl) {
    frontEl.innerHTML = formatText(fc.front);
    typeset(frontEl);
  }
  if (backEl) {
    backEl.innerHTML = formatText(fc.back);
    backEl.classList.add('hidden');
    typeset(backEl);
  }
  document.getElementById('fc-counter').textContent = `${State.fc.index + 1} / ${State.fc.questions.length}`;

  // Subject pill
  const fcCard = document.getElementById('fc-card');
  if (fcCard) {
    let pill = fcCard.querySelector('.fc-subject-pill');
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'fc-subject-pill';
      fcCard.appendChild(pill);
    }
    pill.textContent = q._subject;
    const subjectColors = {
      'Biology': 'rgba(52,211,153,0.2)',
      'Chemistry': 'rgba(251,191,36,0.2)',
      'Mathematics': 'rgba(139,92,246,0.2)',
      'Physics': 'rgba(56,189,248,0.2)',
    };
    pill.style.cssText = `position:absolute;top:0.75rem;left:0.75rem;font-size:0.7rem;padding:2px 10px;border-radius:9999px;background:${subjectColors[q._subject]||'rgba(139,92,246,0.2)'};color:var(--accent-primary);font-weight:600;letter-spacing:0.05em;text-transform:uppercase`;
  }

  typeset(fcCard);
}

function flipFlashcard() {
  State.fc.flipped = !State.fc.flipped;
  const back = document.getElementById('fc-back');
  const card = document.getElementById('fc-card');
  if (back) back.classList.toggle('hidden', !State.fc.flipped);
  if (card) card.classList.toggle('fc-flipped', State.fc.flipped);
}

function renderFlashcardGrid() {
  buildFlashcards();
  const grid = document.getElementById('flashcard-grid');
  const session = document.getElementById('flashcard-session');
  if (!grid) return;

  session?.classList.add('hidden');
  grid.style.display = '';

  if (State.fc.questions.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🃏</div><h3>No flashcards available</h3><p>Questions with flashcard data will appear here.</p></div>';
    return;
  }

  grid.innerHTML = State.fc.questions.slice(0, 50).map((q, i) => {
    const fc = q.explanations_tiered?.flashcard || { front: q.question, back: q.explanation };
    const ans = State.answered[q.question_id];
    const statusDot = ans ? (ans.correct ? '✅' : '❌') : '';
    return `<div class="fc-grid-card" data-index="${i}" data-action="toggle-fc-grid">
      <div class="fc-grid-front">${formatText((fc.front||'').substring(0,120))}</div>
      <div class="fc-grid-back hidden">${formatText((fc.back||'').substring(0,200))}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:0.5rem">
        <span class="fc-grid-pill">${escapeHtml(q._subject)}</span>
        <span style="font-size:0.75rem">${statusDot}</span>
      </div>
    </div>`;
  }).join('');
  
  if (typeof typesetAll === 'function') typesetAll(grid);
}

function toggleFlashcardGrid(el) {
  const back = el.querySelector('.fc-grid-back');
  if (back) {
    back.classList.toggle('hidden');
    el.classList.toggle('fc-grid-flipped', !back.classList.contains('hidden'));
  }
}

// ============================================================
// SEARCH
// ============================================================

let searchTimer = null;

function doSearch() {
  const query = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
  const subject = document.getElementById('search-subject')?.value || '';
  const diff = document.getElementById('search-difficulty')?.value || '';
  const results = document.getElementById('search-results');
  if (!results) return;

  if (!query) {
    results.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><h3>Start typing to search</h3><p>Search across questions, options, explanations, and topics.</p></div>';
    document.getElementById('search-count').textContent = '';
    return;
  }

  const terms = query.split(/\s+/).filter(Boolean);

  let matches = State.questions.filter(q => {
    if (subject && q._subject !== subject) return false;
    if (diff && q.difficulty_level !== diff) return false;
    let rawHaystack = [
      q.question,
      Object.values(q.options || {}).join(' '),
      q.explanation || '',
      q._subject, q._grade, q._unit,
      q._section || '', q._subsection || '',
      q.question_id,
      q.explanations_tiered?.definition || '',
      q.explanations_tiered?.concept_summary || '',
      q.explanations_tiered?.revision_note || '',
      (q.explanations_tiered?.related_concepts || []).join(' '),
    ].join(' ').toLowerCase();

    // Normalize LaTeX for searching (strip delimiters so "x^2" matches "\(x^2\)")
    const haystack = rawHaystack.replace(/\\\(/g, '').replace(/\\\)/g, '').replace(/\$\$/g, '').replace(/\$/g, '');
    return terms.every(t => haystack.includes(t));
  });

  const countEl = document.getElementById('search-count');
  if (countEl) countEl.textContent = matches.length.toLocaleString() + ' results';

  if (matches.length === 0) {
    results.innerHTML = '<div class="empty-state"><div class="empty-state-icon">😔</div><h3>No results found</h3><p>Try different keywords or remove filters.</p></div>';
    return;
  }

  results.innerHTML = matches.slice(0, 80).map(q => {
    const highlightedQ = highlight(q.question.substring(0, 120), terms);
    const ans = State.answered[q.question_id];
    const statusIcon = ans ? (ans.correct ? '✅' : '❌') : '';
    const isBookmarked = State.bookmarks.has(q.question_id) ? '⭐' : '';
    const isRevision = State.revision.has(q.question_id) ? '📌' : '';
    const sectionInfo = q._section ? `<span style="color:var(--text-muted);font-size:0.72rem"> · ${escapeHtml(q._section)}</span>` : '';
    return `<div class="search-result-item" data-action="jump" data-qid="${escapeHtml(q.question_id)}">
      <div class="search-result-header">
        <span class="meta-pill subject-pill">${escapeHtml(q._subject)}</span>
        <span class="meta-pill grade-pill">${escapeHtml(q._grade)}</span>
        <span class="meta-pill difficulty-pill" data-difficulty="${q.difficulty_level}">${q.difficulty_level || ''}</span>
        ${statusIcon ? `<span>${statusIcon}</span>` : ''}
        ${isBookmarked ? `<span>${isBookmarked}</span>` : ''}
        ${isRevision ? `<span>${isRevision}</span>` : ''}
      </div>
      <div class="search-result-text">${formatText(highlightedQ)}${q.question.length > 120 ? '…' : ''}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.375rem">${escapeHtml(q._unit)}${sectionInfo} · ${escapeHtml(q.question_id)}</div>
    </div>`;
  }).join('');
  
  if (typeof typesetAll === 'function') typesetAll(results);
}

function highlight(text, terms) {
  const escaped = escapeHtml(text);
  let result = escaped;
  for (const term of terms) {
    const re = new RegExp(escapeRegex(escapeHtml(term)), 'gi');
    result = result.replace(re, m => `<mark>${m}</mark>`);
  }
  return result;
}

function jumpToQuestion(qId) {
  const q = questionById.get(qId);
  if (!q) return;

  // Reset all filters
  const filterIds = ['filter-subject', 'filter-grade', 'filter-unit', 'filter-section', 'filter-difficulty', 'filter-status'];
  filterIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  applyFilters({});

  const filteredIdx = State.filtered.findIndex(q => q.question_id === qId);
  if (filteredIdx !== -1) {
    State.currentIndex = filteredIdx;
    switchView('practice');
    renderQuestion();
  }
}

// ============================================================
// STATISTICS
// ============================================================

function renderStats() {
  const total = State.questions.length;
  const answeredEntries = Object.entries(State.answered);
  const answered = answeredEntries.length;
  const correct = answeredEntries.filter(([,a]) => a.correct).length;
  const accuracy = answered > 0 ? Math.round(correct / answered * 100) : null;
  const remaining = total - answered;
  const wrongCount = Object.keys(State.wrong).length;

  setText('stat-total-solved', answered.toLocaleString());
  setText('stat-accuracy', accuracy !== null ? accuracy + '%' : '—');
  setText('stat-streak', State.streak);
  setText('stat-best-streak', State.bestStreak || 0);
  setText('stat-total-q', total.toLocaleString());
  setText('stat-remaining', remaining.toLocaleString());
  setText('stat-wrong-count', wrongCount.toLocaleString());
  updateSidebarStats();

  renderSubjectStats();
  renderWeakStrong();
  renderDifficultyStats();
  renderRecentActivity();
  renderExamHistory();
}

function renderSubjectStats() {
  const container = document.getElementById('stats-by-subject');
  if (!container) return;

  const bySubject = {};
  for (const [qId, ans] of Object.entries(State.answered)) {
    const q = questionById.get(qId);
    if (!q) continue;
    const s = q._subject;
    if (!bySubject[s]) bySubject[s] = { total: 0, correct: 0 };
    bySubject[s].total++;
    if (ans.correct) bySubject[s].correct++;
  }

  for (const s of State.subjects) {
    if (!bySubject[s]) bySubject[s] = { total: 0, correct: 0 };
  }

  const totalBySubject = {};
  for (const q of State.questions) {
    if (!totalBySubject[q._subject]) totalBySubject[q._subject] = 0;
    totalBySubject[q._subject]++;
  }

  const colors = {
    'Biology': 'hsl(152,76%,48%)',
    'Chemistry': 'hsl(38,97%,54%)',
    'Mathematics': 'hsl(258,90%,66%)',
    'Physics': 'hsl(199,89%,58%)',
  };

  container.innerHTML = Object.entries(bySubject).sort((a,b) => a[0].localeCompare(b[0])).map(([subject, data]) => {
    const pct = data.total ? Math.round(data.correct / data.total * 100) : 0;
    const color = colors[subject] || 'var(--accent-primary)';
    const totalQ = totalBySubject[subject] || 0;
    const completionPct = totalQ ? Math.round(data.total / totalQ * 100) : 0;
    return `<div class="subject-bar">
      <span class="subject-bar-label">${escapeHtml(subject)}</span>
      <div class="subject-bar-track">
        <div class="subject-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="subject-bar-val">${data.total ? pct + '%' : '—'} <span style="color:var(--text-muted);font-size:0.72rem">(${data.total}/${totalQ})</span></span>
    </div>`;
  }).join('') || '<p style="color:var(--text-muted);font-size:0.85rem">No data yet. Start practicing!</p>';
}

function renderWeakStrong() {
  const topicStats = {};
  for (const [qId, ans] of Object.entries(State.answered)) {
    const q = questionById.get(qId);
    if (!q) continue;
    const key = `${q._subject} › ${q._section || q._unit}`;
    if (!topicStats[key]) topicStats[key] = { total: 0, correct: 0, subject: q._subject };
    topicStats[key].total++;
    if (ans.correct) topicStats[key].correct++;
  }

  const entries = Object.entries(topicStats)
    .filter(([, d]) => d.total >= 2)
    .map(([name, d]) => ({ name, pct: Math.round(d.correct / d.total * 100), ...d }));

  const weak = [...entries].sort((a,b) => a.pct - b.pct).slice(0, 10);
  const strong = [...entries].sort((a,b) => b.pct - a.pct).slice(0, 10);

  renderTopicList('stats-weak-topics', weak, true);
  renderTopicList('stats-strong-topics', strong, false);
}

function renderTopicList(id, items, isWeak) {
  const container = document.getElementById(id);
  if (!container) return;
  if (items.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Not enough data yet. Answer at least 2 questions per topic.</p>';
    return;
  }
  container.innerHTML = items.map(item => {
    const cls = item.pct >= 80 ? 'good' : item.pct >= 50 ? 'ok' : 'bad';
    return `<div class="topic-row">
      <span class="topic-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <span style="font-size:0.72rem;color:var(--text-muted);margin:0 0.5rem;white-space:nowrap">${item.total} q</span>
      <span class="topic-accuracy ${cls}">${item.pct}%</span>
    </div>`;
  }).join('');
}

function renderDifficultyStats() {
  const container = document.getElementById('stats-difficulty');
  if (!container) return;
  const diffs = { easy: { total:0, correct:0 }, medium: { total:0, correct:0 }, hard: { total:0, correct:0 } };
  const totalByDiff = { easy: 0, medium: 0, hard: 0 };
  for (const q of State.questions) {
    if (diffs[q.difficulty_level]) totalByDiff[q.difficulty_level]++;
  }
  for (const [qId, ans] of Object.entries(State.answered)) {
    const q = questionById.get(qId);
    if (!q || !diffs[q.difficulty_level]) continue;
    diffs[q.difficulty_level].total++;
    if (ans.correct) diffs[q.difficulty_level].correct++;
  }
  const colors = { easy: 'var(--accent-success)', medium: 'var(--accent-warning)', hard: 'var(--accent-danger)' };
  container.innerHTML = Object.entries(diffs).map(([diff, d]) => {
    const pct = d.total ? Math.round(d.correct / d.total * 100) : 0;
    const totalQ = totalByDiff[diff] || 0;
    return `<div class="subject-bar">
      <span class="subject-bar-label" style="text-transform:capitalize">${diff}</span>
      <div class="subject-bar-track">
        <div class="subject-bar-fill" style="width:${pct}%;background:${colors[diff]}"></div>
      </div>
      <span class="subject-bar-val">${d.total ? pct + '%' : '—'} <span style="color:var(--text-muted);font-size:0.72rem">(${d.total}/${totalQ})</span></span>
    </div>`;
  }).join('');
}

let recentActivity = [];

function addRecentActivity(q, isCorrect) {
  recentActivity.unshift({ q, isCorrect, time: Date.now() });
  if (recentActivity.length > 30) recentActivity.pop();
}

function renderRecentActivity() {
  const container = document.getElementById('stats-recent');
  if (!container) return;
  if (recentActivity.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">No activity yet. Start practicing!</p>';
    return;
  }
  container.innerHTML = recentActivity.slice(0, 20).map(a => `
    <div class="recent-item" data-action="jump" data-qid="${escapeHtml(a.q.question_id)}">
      <span class="recent-icon">${a.isCorrect ? '✅' : '❌'}</span>
      <span class="recent-text">${escapeHtml(a.q.question.substring(0, 80))}${a.q.question.length > 80 ? '…' : ''}</span>
      <span class="recent-time">${timeAgo(a.time)}</span>
    </div>
  `).join('');
}

function renderExamHistory() {
  const container = document.getElementById('stats-exams');
  if (!container) return;
  if (State.examHistory.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">No exams completed yet.</p>';
    return;
  }
  container.innerHTML = State.examHistory.slice().reverse().slice(0, 15).map(e => {
    const d = new Date(e.date);
    const color = e.pct >= 70 ? 'var(--accent-success)' : e.pct >= 50 ? 'var(--accent-warning)' : 'var(--accent-danger)';
    const m = Math.floor(e.elapsed / 60);
    const s = e.elapsed % 60;
    const typeLabel = e.type && e.type !== 'exam' ? ` · ${e.type}` : '';
    return `<div class="exam-history-item">
      <div class="eh-score" style="color:${color}">${e.pct}%</div>
      <div class="eh-info">
        <div class="eh-desc">${e.correct}/${e.total} correct · ${e.wrong} wrong · ${e.skipped} skipped${typeLabel}</div>
        <div class="eh-time">${d.toLocaleDateString()} ${d.toLocaleTimeString()} · ${m}m ${s}s</div>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// VIEW MANAGEMENT
// ============================================================

function switchView(view) {
  State.currentView = view;

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.add('active');
  const navEl = document.getElementById(`nav-${view}`);
  if (navEl) navEl.classList.add('active');

  // View-specific rendering
  if (view === 'stats') renderStats();
  if (view === 'wrong') renderWrongView('all');
  if (view === 'bookmarks') renderBookmarksView('bookmarks');
  if (view === 'flashcards') {
    renderFlashcardGrid();
    document.getElementById('flashcard-session')?.classList.add('hidden');
  }
  if (view === 'practice') updateFilterInfo();
}

// ============================================================
// SIDEBAR
// ============================================================

function toggleSidebar() {
  State.sidebarCollapsed = !State.sidebarCollapsed;
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('collapsed', State.sidebarCollapsed);
  saveState();
}

// ============================================================
// THEME
// ============================================================

function toggleTheme() {
  State.theme = State.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', State.theme);
  saveState();
}

// ============================================================
// UTILITY
// ============================================================

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatText(text) {
  if (text === null || text === undefined) return '';
  let str = String(text);

  // Extract math blocks to protect them from markdown parsing
  const mathBlocks = [];
  str = str.replace(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\begin\{[a-zA-Z*]+\}[\s\S]*?\\end\{[a-zA-Z*]+\}|\$[\s\S]*?\$|\\\([\s\S]*?\\\))/g, match => {
    mathBlocks.push(match);
    return `__MATH_BLOCK_${mathBlocks.length - 1}__`;
  });

  // Apply simple markdown
  // Use negative lookbehinds/lookaheads or word boundaries for bold/italic to prevent partial matches
  str = str
    .replace(/(^|\s)\*\*([^\s].*?[^\s]|\S)\*\*(?=\s|$|[.,!?])/g, '$1<strong>$2</strong>')
    .replace(/(^|\s)\*([^\s].*?[^\s]|\S)\*(?=\s|$|[.,!?])/g, '$1<em>$2</em>')
    .replace(/`(.+?)`/g, '<code class="inline-code">$1</code>')
    .replace(/\n/g, '<br>');

  // Restore math blocks (replace ALL occurrences using split/join)
  for (let i = 0; i < mathBlocks.length; i++) {
    str = str.split(`__MATH_BLOCK_${i}__`).join(mathBlocks[i]);
  }

  return str;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

let mathJaxPromise = Promise.resolve();
let mathJaxLoadFailed = false;

// Check if MathJax failed to load after 5 seconds
setTimeout(() => {
  if (!window.MathJax || !window.MathJax.typesetPromise) {
    mathJaxLoadFailed = true;
    console.warn('MathJax failed to load in 5 seconds. Using fallback styling.');
    document.body.classList.add('mathjax-failed');
  }
}, 5000);

function typeset(el) {
  if (!el || mathJaxLoadFailed) return;
  
  if (window.MathJax && window.MathJax.typesetPromise) {
    mathJaxPromise = mathJaxPromise
      .then(() => window.MathJax.typesetPromise([el]))
      .catch((err) => {
        console.warn('MathJax typeset error, retrying...', err);
        // Fallback clear and retry once
        if (window.MathJax.typesetClear) {
          window.MathJax.typesetClear([el]);
          return window.MathJax.typesetPromise([el]).catch(e => console.error('MathJax retry failed:', e));
        }
      });
  } else {
    // MathJax isn't ready yet, queue it up for later when it loads
    setTimeout(() => typeset(el), 200);
  }
}

function typesetAll(container) {
  if (!container || mathJaxLoadFailed) return;
  
  if (window.MathJax && window.MathJax.typesetPromise) {
    mathJaxPromise = mathJaxPromise
      .then(() => window.MathJax.typesetPromise([container]))
      .catch(err => console.warn('MathJax typesetAll error:', err));
  } else {
    setTimeout(() => typesetAll(container), 200);
  }
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

function updateBadges() {
  const wrongCount = Object.keys(State.wrong).length;
  const bookmarkCount = State.bookmarks.size;

  const wb = document.getElementById('wrong-badge');
  if (wb) { wb.textContent = wrongCount; wb.style.display = wrongCount ? '' : 'none'; }

  const bb = document.getElementById('bookmark-badge');
  if (bb) { bb.textContent = bookmarkCount; bb.style.display = bookmarkCount ? '' : 'none'; }
}

function updateSidebarStats() {
  const answeredEntries = Object.entries(State.answered);
  const answered = answeredEntries.length;
  const correct = answeredEntries.filter(([,a]) => a.correct).length;
  const acc = answered > 0 ? Math.round(correct / answered * 100) + '%' : '—';
  setText('mini-solved', answered.toLocaleString());
  setText('mini-accuracy', acc);
  setText('mini-streak', State.streak);
}

// ============================================================
// TOAST
// ============================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Ignore when typing in inputs
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key.toUpperCase();

    // Global shortcuts
    if (key === '?') {
      e.preventDefault();
      document.getElementById('shortcuts-overlay')?.classList.toggle('hidden');
      return;
    }
    if (e.key === 'Escape') {
      document.getElementById('shortcuts-overlay')?.classList.add('hidden');
      document.getElementById('copy-menu')?.classList.add('hidden');
      document.getElementById('ai-panel')?.classList.add('hidden');
      return;
    }

    // Practice view shortcuts
    if (State.currentView === 'practice') {
      if (['A', 'C', 'D'].includes(key)) {
        e.preventDefault();
        selectOption(key);
        return;
      }
      if (key === 'B') {
        e.preventDefault();
        const q = State.filtered[State.currentIndex];
        if (q && State.answered[q.question_id]) {
          toggleBookmark(q.question_id);
        } else {
          selectOption('B');
        }
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        const q = State.filtered[State.currentIndex];
        if (q && State.answered[q.question_id]) {
          goNext();
        }
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        const q = State.filtered[State.currentIndex];
        if (q && State.answered[q.question_id]) goNext();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
        return;
      }
      if (key === 'H') { e.preventDefault(); toggleHint(); return; }
      if (key === 'R') {
        e.preventDefault();
        const q = State.filtered[State.currentIndex];
        if (q) toggleRevision(q.question_id);
        return;
      }
      if (key === 'S') {
        e.preventDefault();
        document.getElementById('btn-search-online')?.click();
        return;
      }
    }

    // Exam view shortcuts
    if (State.currentView === 'exam' && State.exam && !State.exam.finished) {
      if (['A', 'B', 'C', 'D'].includes(key)) {
        e.preventDefault();
        selectExamOption(key);
      }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (State.exam.currentIndex < State.exam.questions.length - 1) {
          State.exam.currentIndex++;
          renderExamQuestion();
        }
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (State.exam.currentIndex > 0) {
          State.exam.currentIndex--;
          renderExamQuestion();
        }
      }
    }
  });
}

// ============================================================
// EVENT LISTENERS
// ============================================================

function setupEventListeners() {
  // Sidebar toggle
  document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);

  // Nav items
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Theme toggle
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

  // Font Size
  document.getElementById('btn-font-dec')?.addEventListener('click', () => {
    if (State.fontSize === 'xl') setFontSize('large');
    else if (State.fontSize === 'large') setFontSize('normal');
  });
  document.getElementById('btn-font-inc')?.addEventListener('click', () => {
    if (State.fontSize === 'normal') setFontSize('large');
    else if (State.fontSize === 'large') setFontSize('xl');
  });

  // Mobile nav toggles
  document.getElementById('btn-mobile-filter')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('filter-row-container')?.classList.toggle('mobile-open');
  });
  
  // Close mobile filter when clicking outside
  document.addEventListener('click', (e) => {
    const filterRow = document.getElementById('filter-row-container');
    const filterBtn = document.getElementById('btn-mobile-filter');
    if (filterRow?.classList.contains('mobile-open') && 
        !filterRow.contains(e.target) && 
        (!filterBtn || !filterBtn.contains(e.target))) {
      filterRow.classList.remove('mobile-open');
    }
  });
  document.getElementById('m-nav-menu')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.add('mobile-open');
    document.getElementById('mobile-sidebar-overlay')?.classList.remove('hidden');
  });
  document.getElementById('mobile-sidebar-overlay')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.remove('mobile-open');
    document.getElementById('mobile-sidebar-overlay')?.classList.add('hidden');
  });
  // Mobile bottom nav buttons
  ['practice', 'exam', 'search'].forEach(view => {
    document.getElementById(`m-nav-${view}`)?.addEventListener('click', () => {
      document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
      document.getElementById(`m-nav-${view}`).classList.add('active');
      switchView(view);
    });
  });

  // Study Timer
  document.getElementById('study-timer')?.addEventListener('click', toggleStudyTimer);

  // Question Grid
  document.getElementById('btn-grid-view')?.addEventListener('click', () => {
    renderQuestionGrid();
    document.getElementById('q-grid-overlay')?.classList.remove('hidden');
  });
  document.getElementById('close-q-grid')?.addEventListener('click', () => {
    document.getElementById('q-grid-overlay')?.classList.add('hidden');
  });
  document.getElementById('q-grid-overlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('q-grid-overlay')) {
      document.getElementById('q-grid-overlay').classList.add('hidden');
    }
  });


  // Filter changes
  document.getElementById('filter-subject')?.addEventListener('change', () => { updateUnitFilter(); applyFilters(); });
  document.getElementById('filter-grade')?.addEventListener('change', () => { updateUnitFilter(); applyFilters(); });
  document.getElementById('filter-unit')?.addEventListener('change', () => { updateSectionFilter(); applyFilters(); });
  document.getElementById('filter-section')?.addEventListener('change', () => applyFilters());
  document.getElementById('filter-difficulty')?.addEventListener('change', () => applyFilters());
  document.getElementById('filter-status')?.addEventListener('change', () => applyFilters());

  // Options (practice)
  for (const key of ['A','B','C','D']) {
    document.getElementById(`opt-${key}`)?.addEventListener('click', () => selectOption(key));
  }

  // Navigation
  document.getElementById('btn-next')?.addEventListener('click', goNext);
  document.getElementById('btn-prev')?.addEventListener('click', goPrev);
  document.getElementById('btn-random')?.addEventListener('click', goRandom);

  // Jump input
  document.getElementById('jump-input')?.addEventListener('change', (e) => {
    let val = parseInt(e.target.value);
    if (!isNaN(val)) {
      if (val < 1) val = 1;
      else if (val > State.filtered.length) val = State.filtered.length;
      e.target.value = val;
      goTo(val - 1);
    } else {
      e.target.value = State.currentIndex + 1;
    }
  });
  document.getElementById('jump-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      let val = parseInt(e.target.value);
      if (!isNaN(val)) {
        if (val < 1) val = 1;
        else if (val > State.filtered.length) val = State.filtered.length;
        e.target.value = val;
        goTo(val - 1);
      } else {
        e.target.value = State.currentIndex + 1;
      }
    }
  });

  // Bookmark / Revision / Hint
  document.getElementById('btn-bookmark')?.addEventListener('click', () => {
    const q = State.filtered[State.currentIndex];
    if (q) toggleBookmark(q.question_id);
  });
  document.getElementById('btn-revise')?.addEventListener('click', () => {
    const q = State.filtered[State.currentIndex];
    if (q) toggleRevision(q.question_id);
  });
  document.getElementById('btn-hint')?.addEventListener('click', toggleHint);

  // Copy Button
  document.getElementById('btn-copy-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    copyText(getCopyText('all'));
  });

  // Search Online
  document.getElementById('btn-search-online')?.addEventListener('click', searchOnline);

  // Ask AI button → open sheet
  document.getElementById('btn-ask-ai')?.addEventListener('click', openAIPromptSheet);

  // AI Sheet: prompt card selection
  document.querySelectorAll('.prompt-option-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.prompt-option-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      _selectedPromptType = card.dataset.prompt;
    });
  });
  document.getElementById('ai-choice-share')?.addEventListener('click', () => sendToAI('share'));
  document.getElementById('ai-choice-copy')?.addEventListener('click',  () => sendToAI('copy'));
  document.getElementById('ai-sheet-close')?.addEventListener('click', closeAIPromptSheet);
  document.getElementById('ai-sheet-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('ai-sheet-overlay')) closeAIPromptSheet();
  });

  // Note button
  document.getElementById('btn-note')?.addEventListener('click', openNoteSheet);
  document.getElementById('note-sheet-close')?.addEventListener('click', closeNoteSheet);
  document.getElementById('note-btn-save')?.addEventListener('click', saveCurrentNote);
  document.getElementById('note-btn-delete')?.addEventListener('click', deleteCurrentNote);
  document.getElementById('note-sheet-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('note-sheet-overlay')) closeNoteSheet();
  });

  // TTS button
  document.getElementById('btn-tts')?.addEventListener('click', toggleTTS);

  // Re-render math
  document.getElementById('btn-rerender')?.addEventListener('click', rerenderMath);

  // Explanation tabs
  document.querySelectorAll('.exp-tab').forEach(tab => {
    tab.addEventListener('click', () => setExplanationTab(tab.dataset.tab));
  });

  // AI panel
  document.getElementById('btn-ai-toggle')?.addEventListener('click', () => {
    document.getElementById('ai-panel')?.classList.toggle('hidden');
  });
  document.getElementById('ai-close')?.addEventListener('click', () => {
    document.getElementById('ai-panel')?.classList.add('hidden');
  });
  document.querySelectorAll('.ai-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAiAction(btn.dataset.action));
  });

  // Exam setup — filter updates
  const updateExamUnits = () => {
    const subject = document.getElementById('exam-subject-select')?.value;
    const grade = document.getElementById('exam-grade-select')?.value;
    const merged = new Set();
    
    for (const [k, v] of State.units) {
      const matchSubject = !subject || k.startsWith(subject + '|');
      const matchGrade = !grade || k.endsWith('|' + grade);
      if (matchSubject && matchGrade) {
        for (const u of v) merged.add(u);
      }
    }
    const units = [...merged].sort(naturalSort);
    fillSelect('exam-unit-select', units, 'Select Unit...');
  };
  document.getElementById('exam-subject-select')?.addEventListener('change', updateExamUnits);
  document.getElementById('exam-grade-select')?.addEventListener('change', updateExamUnits);

  // Exam setup — type buttons
  document.querySelectorAll('.exam-type-btn[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.exam-type-btn[data-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const type = btn.dataset.type;
      document.getElementById('exam-subject-group').style.display = ['subject'].includes(type) ? '' : 'none';
      document.getElementById('exam-unit-group').style.display = ['unit'].includes(type) ? '' : 'none';
    });
  });

  // Difficulty buttons
  document.querySelectorAll('[data-diff]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-diff]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Count buttons
  document.querySelectorAll('.count-btn[data-count]').forEach(btn => {
    btn.addEventListener('click', () => {
      const countInput = document.getElementById('exam-count');
      if (countInput) countInput.value = btn.dataset.count;
      document.querySelectorAll('.count-btn[data-count]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Time buttons
  document.querySelectorAll('.count-btn[data-time]').forEach(btn => {
    btn.addEventListener('click', () => {
      const timeInput = document.getElementById('exam-time');
      if (timeInput) timeInput.value = btn.dataset.time;
      document.querySelectorAll('.count-btn[data-time]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('btn-start-exam')?.addEventListener('click', startExam);
  document.getElementById('btn-end-exam')?.addEventListener('click', () => {
    if (confirm('End exam now and see results?')) endExam();
  });
  document.getElementById('btn-new-exam')?.addEventListener('click', () => {
    document.getElementById('exam-results').classList.add('hidden');
    document.getElementById('exam-setup').classList.remove('hidden');
    const timerEl = document.getElementById('exam-timer');
    if (timerEl) timerEl.style.display = '';
    State.exam = null;
  });

  document.getElementById('btn-review-wrong-exam')?.addEventListener('click', () => {
    switchView('wrong');
  });

  // Exam options
  for (const key of ['A','B','C','D']) {
    document.getElementById(`exam-opt-${key}`)?.addEventListener('click', () => selectExamOption(key));
  }
  document.getElementById('exam-btn-next')?.addEventListener('click', () => {
    if (State.exam && State.exam.currentIndex < State.exam.questions.length - 1) {
      State.exam.currentIndex++;
      renderExamQuestion();
    }
  });
  document.getElementById('exam-btn-prev')?.addEventListener('click', () => {
    if (State.exam && State.exam.currentIndex > 0) {
      State.exam.currentIndex--;
      renderExamQuestion();
    }
  });

  // Wrong questions tabs
  document.querySelectorAll('[data-wrong-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-wrong-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderWrongView(tab.dataset.wrongTab);
    });
  });
  document.getElementById('btn-practice-wrong')?.addEventListener('click', () => {
    const wrongIds = Object.keys(State.wrong);
    if (wrongIds.length === 0) { showToast('No wrong questions yet!', 'info'); return; }
    const filterIds = ['filter-subject', 'filter-grade', 'filter-unit', 'filter-section', 'filter-difficulty'];
    filterIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const statusEl = document.getElementById('filter-status');
    if (statusEl) statusEl.value = 'wrong';
    applyFilters();
    switchView('practice');
  });
  document.getElementById('btn-clear-wrong')?.addEventListener('click', () => {
    if (confirm('Clear all wrong question history? This cannot be undone.')) {
      State.wrong = {};
      saveState();
      updateBadges();
      renderWrongView();
      showToast('Wrong questions cleared', 'info');
    }
  });

  // Bookmark tabs
  document.querySelectorAll('[data-bookmark-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-bookmark-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderBookmarksView(tab.dataset.bookmarkTab);
    });
  });
  document.getElementById('btn-practice-bookmarks')?.addEventListener('click', () => {
    const filterIds = ['filter-subject', 'filter-grade', 'filter-unit', 'filter-section', 'filter-difficulty'];
    filterIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const statusEl = document.getElementById('filter-status');
    if (statusEl) statusEl.value = 'bookmarked';
    applyFilters();
    switchView('practice');
  });
  document.getElementById('btn-practice-revision')?.addEventListener('click', () => {
    const filterIds = ['filter-subject', 'filter-grade', 'filter-unit', 'filter-section', 'filter-difficulty'];
    filterIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const statusEl = document.getElementById('filter-status');
    if (statusEl) statusEl.value = 'revision';
    applyFilters();
    switchView('practice');
  });

  // Flashcards
  document.getElementById('btn-start-flashcards')?.addEventListener('click', startFlashcards);
  document.getElementById('fc-card')?.addEventListener('click', flipFlashcard);
  document.getElementById('fc-next')?.addEventListener('click', () => {
    if (State.fc.index < State.fc.questions.length - 1) { State.fc.index++; renderFlashcard(); }
    else showToast('Last flashcard!', 'info');
  });
  document.getElementById('fc-prev')?.addEventListener('click', () => {
    if (State.fc.index > 0) { State.fc.index--; renderFlashcard(); }
  });
  document.getElementById('fc-subject-filter')?.addEventListener('change', renderFlashcardGrid);

  // Search
  document.getElementById('search-input')?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 200);
  });
  document.getElementById('search-subject')?.addEventListener('change', doSearch);
  document.getElementById('search-difficulty')?.addEventListener('change', doSearch);

  // Export Data
  document.getElementById('btn-export-data')?.addEventListener('click', () => {
    saveState();
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return showToast('No data to export.', 'error');
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().split('T')[0];
    a.download = `examedge_backup_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported successfully!', 'success');
  });

  // Import Data
  document.getElementById('btn-import-data')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data || typeof data !== 'object') throw new Error('Invalid format');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        showToast('Data imported! Reloading...', 'success');
        setTimeout(() => location.reload(), 1500);
      } catch (err) {
        showToast('Failed to import data. Invalid JSON.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Stats reset
  document.getElementById('btn-reset-stats')?.addEventListener('click', () => {
    if (confirm('Reset ALL progress? This action cannot be undone!')) {
      State.answered = {};
      State.wrong = {};
      State.bookmarks = new Set();
      State.revision = new Map();
      State.streak = 0;
      State.bestStreak = 0;
      State.examHistory = [];
      recentActivity = [];
      saveState();
      updateBadges();
      updateSidebarStats();
      renderStats();
      showToast('Progress reset successfully', 'info');
    }
  });

  // Shortcuts overlay close
  document.getElementById('close-shortcuts')?.addEventListener('click', () => {
    document.getElementById('shortcuts-overlay')?.classList.add('hidden');
  });
  document.getElementById('shortcuts-overlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('shortcuts-overlay')) {
      document.getElementById('shortcuts-overlay').classList.add('hidden');
    }
  });

  // ---- Event Delegation for dynamic elements ----
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;

    const action = el.dataset.action;

    if (action === 'jump') {
      const qid = el.dataset.qid;
      if (qid) jumpToQuestion(qid);
    } else if (action === 'search-concept') {
      const concept = el.dataset.concept;
      if (concept) searchConcept(concept);
    } else if (action === 'toggle-fc-grid') {
      toggleFlashcardGrid(el);
    }
  });
}

// ============================================================
// NEW FEATURES: Timer, ChatGPT, Font Size, Grid, Goal
// ============================================================

// Daily Goal
function updateDailyGoal(increment = false) {
  if (increment) {
    State.dailySolved++;
    saveState();
  }
  const pct = Math.min(100, Math.round(State.dailySolved / State.dailyGoal * 100));
  const fill = document.getElementById('goal-ring-fill');
  const text = document.getElementById('goal-text');
  if (fill) {
    fill.style.strokeDashoffset = 100 - pct;
  }
  if (text) {
    text.textContent = `${State.dailySolved}/${State.dailyGoal}`;
  }
  
  if (increment && State.dailySolved === State.dailyGoal) {
    showToast('🎉 Daily goal reached! Excellent work!', 'success');
  }
}

// Font Size
function applyFontSize() {
  document.documentElement.setAttribute('data-font-size', State.fontSize);
}
function setFontSize(size) {
  State.fontSize = size;
  applyFontSize();
  saveState();
}

// ============================================================
// AI PROMPT SHEET
// ============================================================
let _selectedPromptType = 'explain';

function buildAIPrompt(type) {
  const q = State.filtered[State.currentIndex];
  if (!q) return '';
  let optionsText = '';
  if (q.options) {
    for (const [k, v] of Object.entries(q.options)) {
      optionsText += `${k}. ${v}\n`;
    }
  }
  const qText = stripHtmlAndNormalizeMath(q.question);
  const ans = State.answered[q.question_id];
  const ansLine = ans ? `\nNote: The correct answer is ${q.correct_answer}.` : '';

  const prompts = {
    explain: `Question:\n${qText}\n\nOptions:\n${optionsText}${ansLine}\n\nPlease explain this question clearly and in detail.`,
    options: `Question:\n${qText}\n\nOptions:\n${optionsText}${ansLine}\n\nPlease explain each option one by one — why it is correct or incorrect.`,
    steps:   `Question:\n${qText}\n\nOptions:\n${optionsText}${ansLine}\n\nWalk me through a step-by-step solution to this question.`,
    correct: `Question:\n${qText}\n\nOptions:\n${optionsText}${ansLine}\n\nWhy is the correct answer right? Explain the reasoning in depth.`,
    hint:    `Question:\n${qText}\n\nOptions:\n${optionsText}\n\nGive me a helpful hint to guide me toward the answer. Do NOT reveal the answer itself.`,
    simple:  `Question:\n${qText}\n\nOptions:\n${optionsText}${ansLine}\n\nExplain this question as simply as possible, as if I am a beginner.`
  };
  return prompts[type] || prompts.explain;
}

function openAIPromptSheet() {
  const overlay = document.getElementById('ai-sheet-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  // Default selection
  document.querySelectorAll('.prompt-option-card').forEach(c => c.classList.remove('selected'));
  const def = document.querySelector(`.prompt-option-card[data-prompt="${_selectedPromptType}"]`);
  if (def) def.classList.add('selected');
}

function closeAIPromptSheet() {
  document.getElementById('ai-sheet-overlay')?.classList.add('hidden');
}

function sendToAI(appChoice) {
  const prompt = buildAIPrompt(_selectedPromptType);
  if (!prompt) return;
  copyText(prompt);

  if (appChoice === 'share' && navigator.share) {
    navigator.share({ text: prompt })
      .then(() => showToast('Shared!', 'success'))
      .catch(() => showToast('Prompt copied to clipboard!', 'info'));
  } else if (appChoice === 'share') {
    // Fallback: try intent URL for ChatGPT, else just copy
    showToast('Prompt copied! Open your AI app and paste.', 'info');
    try { window.location.href = 'intent://#Intent;package=com.openai.chatgpt;end'; } catch(e) {}
  } else {
    showToast('Prompt copied to clipboard!', 'success');
  }
  closeAIPromptSheet();
}

// ============================================================
// QUICK NOTES
// ============================================================
let _notes = {};

function loadNotes() {
  try { _notes = JSON.parse(localStorage.getItem('examedge_notes') || '{}'); } catch(e) { _notes = {}; }
}

function saveNotes() {
  try { localStorage.setItem('examedge_notes', JSON.stringify(_notes)); } catch(e) {}
}

function openNoteSheet() {
  const q = State.filtered[State.currentIndex];
  if (!q) return;
  const overlay = document.getElementById('note-sheet-overlay');
  const textarea = document.getElementById('note-textarea');
  if (!overlay || !textarea) return;
  textarea.value = _notes[q.question_id] || '';
  overlay.classList.remove('hidden');
  setTimeout(() => textarea.focus(), 350);
}

function closeNoteSheet() {
  document.getElementById('note-sheet-overlay')?.classList.add('hidden');
}

function saveCurrentNote() {
  const q = State.filtered[State.currentIndex];
  if (!q) return;
  const text = document.getElementById('note-textarea')?.value.trim() || '';
  if (text) {
    _notes[q.question_id] = text;
  } else {
    delete _notes[q.question_id];
  }
  saveNotes();
  updateNoteDot();
  closeNoteSheet();
  showToast('Note saved!', 'success');
}

function deleteCurrentNote() {
  const q = State.filtered[State.currentIndex];
  if (!q) return;
  delete _notes[q.question_id];
  saveNotes();
  updateNoteDot();
  if (document.getElementById('note-textarea')) document.getElementById('note-textarea').value = '';
  closeNoteSheet();
  showToast('Note deleted', 'info');
}

function updateNoteDot() {
  const q = State.filtered[State.currentIndex];
  const dot = document.getElementById('note-dot');
  if (!dot) return;
  if (q && _notes[q.question_id]) {
    dot.classList.remove('hidden');
  } else {
    dot.classList.add('hidden');
  }
}

// ============================================================
// TEXT-TO-SPEECH
// ============================================================
let _ttsUtterance = null;
let _ttsActive = false;

function toggleTTS() {
  if (_ttsActive) {
    window.speechSynthesis.cancel();
    _ttsActive = false;
    document.getElementById('btn-tts')?.classList.remove('tts-active');
    return;
  }
  const q = State.filtered[State.currentIndex];
  if (!q) return;

  let optionsText = '';
  if (q.options) {
    for (const [k, v] of Object.entries(q.options)) {
      optionsText += ` Option ${k}: ${stripHtmlAndNormalizeMath(v)}.`;
    }
  }
  const text = `Question: ${stripHtmlAndNormalizeMath(q.question)}. ${optionsText}`;

  _ttsUtterance = new SpeechSynthesisUtterance(text);
  _ttsUtterance.lang = 'en-US';
  _ttsUtterance.rate = 0.92;
  _ttsUtterance.onend = () => {
    _ttsActive = false;
    document.getElementById('btn-tts')?.classList.remove('tts-active');
  };
  window.speechSynthesis.speak(_ttsUtterance);
  _ttsActive = true;
  document.getElementById('btn-tts')?.classList.add('tts-active');
  showToast('Reading question aloud...', 'info');
}

// ============================================================
// SWIPE GESTURES
// ============================================================
function setupSwipeGestures() {
  const card = document.getElementById('question-card');
  if (!card) return;
  let startX = 0, startY = 0;

  card.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  card.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0) goNext();
      else goPrev();
    }
  }, { passive: true });
}

// ============================================================
// DICTIONARY (Free Dictionary API)
// ============================================================
let _dictPopup = null;
let _dictAudio = null;

function setupDictionary() {
  // Create popup element
  if (!document.getElementById('dict-popup')) {
    const popup = document.createElement('div');
    popup.id = 'dict-popup';
    popup.className = 'dict-popup hidden';
    popup.innerHTML = `
      <div class="dict-header">
        <div>
          <span class="dict-word" id="dict-word"></span>
          <span class="dict-phonetic" id="dict-phonetic"></span>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button id="dict-audio-btn" class="dict-audio-btn hidden" title="Pronounce">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg>
          </button>
          <button class="dict-close-btn" id="dict-close">&times;</button>
        </div>
      </div>
      <div class="dict-body" id="dict-body"></div>
    `;
    document.body.appendChild(popup);
    _dictPopup = popup;

    document.getElementById('dict-close').addEventListener('click', closeDictPopup);
    document.addEventListener('click', e => {
      if (_dictPopup && !_dictPopup.classList.contains('hidden') && !_dictPopup.contains(e.target)) {
        closeDictPopup();
      }
    });
  }

  // Long-press / double-tap on question area to look up selected word
  const qArea = document.getElementById('main-content');
  if (!qArea) return;

  let holdTimer = null;
  qArea.addEventListener('touchstart', e => {
    holdTimer = setTimeout(() => {
      const sel = window.getSelection()?.toString().trim();
      if (sel && sel.split(' ').length <= 3) lookupWord(sel);
    }, 600);
  }, { passive: true });
  qArea.addEventListener('touchend', () => clearTimeout(holdTimer), { passive: true });
  qArea.addEventListener('touchmove', () => clearTimeout(holdTimer), { passive: true });

  // Desktop: double-click on a word
  qArea.addEventListener('dblclick', () => {
    const sel = window.getSelection()?.toString().trim();
    if (sel && sel.split(' ').length <= 3) lookupWord(sel);
  });
}

async function lookupWord(word) {
  if (!word) return;
  const cleanWord = word.replace(/[^a-zA-Z\-]/g, '');
  if (!cleanWord) return;

  showDictPopup(cleanWord, null, 'Loading...');
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`);
    if (!res.ok) throw new Error('Not found');
    const data = await res.json();
    displayDictResult(data[0]);
  } catch(e) {
    showDictPopup(cleanWord, null, `<p class="dict-error">No definition found for "${cleanWord}"</p>`);
  }
}

function showDictPopup(word, phonetic, bodyHtml) {
  if (!_dictPopup) setupDictionary();
  const popup = document.getElementById('dict-popup');
  if (!popup) return;
  document.getElementById('dict-word').textContent = word;
  document.getElementById('dict-phonetic').textContent = phonetic || '';
  document.getElementById('dict-body').innerHTML = bodyHtml;
  popup.classList.remove('hidden');
}

function closeDictPopup() {
  document.getElementById('dict-popup')?.classList.add('hidden');
  if (_dictAudio) { _dictAudio.pause(); _dictAudio = null; }
}

function displayDictResult(entry) {
  if (!entry) return;
  const phonetics = entry.phonetics || [];
  const phonetic = (entry.phonetic || phonetics.find(p => p.text)?.text || '');
  const audioUrl = phonetics.find(p => p.audio)?.audio || '';

  const audioBtn = document.getElementById('dict-audio-btn');
  if (audioUrl && audioBtn) {
    audioBtn.classList.remove('hidden');
    audioBtn.onclick = () => {
      if (_dictAudio) _dictAudio.pause();
      _dictAudio = new Audio(audioUrl);
      _dictAudio.play();
    };
  } else if (audioBtn) {
    audioBtn.classList.add('hidden');
  }

  let html = '';
  for (const meaning of (entry.meanings || []).slice(0, 3)) {
    html += `<div class="dict-pos">${meaning.partOfSpeech}</div>`;
    for (const def of (meaning.definitions || []).slice(0, 2)) {
      html += `<div class="dict-def">${def.definition}</div>`;
      if (def.example) html += `<div class="dict-example">"${def.example}"</div>`;
    }
    const syns = (meaning.synonyms || []).slice(0, 5);
    if (syns.length) html += `<div class="dict-synonyms">Synonyms: ${syns.map(s => `<span class="dict-syn" onclick="lookupWord('${s}')">${s}</span>`).join(', ')}</div>`;
  }

  if (document.getElementById('dict-word')) document.getElementById('dict-word').textContent = entry.word || '';
  if (document.getElementById('dict-phonetic')) document.getElementById('dict-phonetic').textContent = phonetic;
  if (document.getElementById('dict-body')) document.getElementById('dict-body').innerHTML = html;
}

// Math Re-render
function rerenderMath() {
  const card = document.getElementById('question-card');
  if (card) {
    if (window.MathJax && window.MathJax.typesetClear) {
      window.MathJax.typesetClear([card]);
    }
    typeset(card);
    showToast('Formula refreshed', 'info');
  }
}

// Study Timer
let studyTimerInterval = null;
let studyTimeRemaining = 25 * 60; // 25 mins
let isStudyBreak = false;
let isStudyTimerRunning = false;

function toggleStudyTimer() {
  const display = document.getElementById('study-timer-display');
  const timerBtn = document.getElementById('study-timer');
  
  if (isStudyTimerRunning) {
    clearInterval(studyTimerInterval);
    isStudyTimerRunning = false;
    timerBtn.style.opacity = '0.7';
  } else {
    isStudyTimerRunning = true;
    timerBtn.style.opacity = '1';
    
    studyTimerInterval = setInterval(() => {
      studyTimeRemaining--;
      
      if (studyTimeRemaining <= 0) {
        isStudyBreak = !isStudyBreak;
        studyTimeRemaining = isStudyBreak ? 5 * 60 : 25 * 60; // 5 min break, 25 min study
        showToast(isStudyBreak ? '☕ Time for a 5-minute break!' : '📚 Break is over. Time to study!', isStudyBreak ? 'success' : 'info');
        if (timerBtn) timerBtn.classList.toggle('break', isStudyBreak);
      }
      
      const m = Math.floor(studyTimeRemaining / 60).toString().padStart(2, '0');
      const s = (studyTimeRemaining % 60).toString().padStart(2, '0');
      if (display) display.textContent = `${m}:${s}`;
    }, 1000);
  }
}

// Question Grid
function renderQuestionGrid() {
  const container = document.getElementById('q-grid-container');
  const count = document.getElementById('q-grid-count');
  if (!container) return;
  
  if (count) count.textContent = `(${State.filtered.length})`;
  
  let html = '';
  const limit = Math.min(State.filtered.length, 300); // cap for performance
  
  for (let i = 0; i < limit; i++) {
    const q = State.filtered[i];
    const ans = State.answered[q.question_id];
    let cls = '';
    if (i === State.currentIndex) cls = 'current';
    else if (ans) cls = ans.correct ? 'correct' : 'wrong';
    
    html += `<div class="q-grid-item ${cls}" data-index="${i}">${i + 1}</div>`;
  }
  
  if (State.filtered.length > 300) {
    html += `<div style="grid-column: 1/-1; text-align: center; font-size: 0.8rem; color: var(--text-muted); padding: 10px;">Showing first 300 questions</div>`;
  }
  
  container.innerHTML = html;
  
  // Attach events
  container.querySelectorAll('.q-grid-item[data-index]').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.index);
      goTo(idx);
      document.getElementById('q-grid-overlay')?.classList.add('hidden');
    });
  });
}

// ============================================================
// AI ASSIST (Using rich explanations from JSON)
// ============================================================

function handleAiAction(action) {
  const q = State.filtered[State.currentIndex];
  if (!q) return;
  const output = document.getElementById('ai-output');
  if (!output) return;

  const exp = q.explanations_tiered || {};
  const pm = q.publishing_metadata || {};

  let html = '';
  switch (action) {
    case 'explain':
      html = `<div class="ai-section">
        <div class="ai-section-title">📘 Question Analysis</div>
        <p>${formatText(exp.concept_summary || q.explanation || 'No explanation available.')}</p>
        ${exp.beginner ? `<div class="ai-level-card ai-beginner"><div class="ai-level-label">🟢 Simplified</div>${formatText(exp.beginner)}</div>` : ''}
        ${exp.definition ? `<div class="exp-definition" style="margin-top:0.75rem">📖 ${formatText(exp.definition)}</div>` : ''}
      </div>`;
      break;

    case 'correct': {
      const correctKey = q.correct_answer;
      const correctText = q.options?.[correctKey] || '';
      const steps = exp.reasoning_steps;
      html = `<div class="ai-section">
        <div class="ai-section-title">✅ Correct Answer: ${escapeHtml(correctKey)}</div>
        <p><strong>${escapeHtml(correctText)}</strong></p>
        <p style="margin-top:0.5rem">${formatText(q.explanation || exp.advanced || '')}</p>
        ${exp.intermediate ? `<div class="ai-level-card" style="margin-top:0.75rem;--level-color:var(--accent-warning)"><div class="ai-level-label">🟡 In-depth</div>${formatText(exp.intermediate)}</div>` : ''}
        ${steps?.length ? `<div class="ai-steps"><div class="ai-steps-title">🧠 Reasoning Steps:</div>${steps.map((s,i) => `<div class="ai-step"><span class="step-badge">${i+1}</span>${escapeHtml(s)}</div>`).join('')}</div>` : ''}
      </div>`;
      break;
    }

    case 'wrong': {
      const wrongKeys = ['A','B','C','D'].filter(k => k !== q.correct_answer && q.options?.[k]);
      html = `<div class="ai-section">
        <div class="ai-section-title">❌ Why Other Options Are Wrong</div>
        ${wrongKeys.map(k => `<div class="ai-wrong-option">
          <div class="ai-wrong-option-label">${escapeHtml(k)}. ${escapeHtml(q.options?.[k] || '')}</div>
          <div class="ai-wrong-option-reason">${exp.misconceptions?.length ? formatText(exp.misconceptions[0].substring(0,200)) : 'This is an incorrect option. Carefully compare it with the correct answer.'}</div>
        </div>`).join('')}
      </div>`;
      break;
    }

    case 'similar':
      html = `<div class="ai-section">
        <div class="ai-section-title">🔄 Practice These Related Concepts</div>
        ${exp.related_concepts?.length ? `<div class="concepts-list" style="margin:0.5rem 0">${exp.related_concepts.map(c => `<span class="concept-tag" data-action="search-concept" data-concept="${escapeHtml(c)}">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
        ${exp.glossary_entry ? `<div class="ai-level-card" style="margin-top:0.75rem;--level-color:var(--accent-primary)"><div class="ai-level-label">📚 Key Term: ${escapeHtml(exp.glossary_entry.term || '')}</div>${formatText(exp.glossary_entry.definition || '')}</div>` : ''}
        <p style="margin-top:0.5rem;color:var(--text-muted);font-size:0.82rem">💡 Click a concept tag to search for related questions.</p>
      </div>`;
      break;

    case 'easier':
      html = `<div class="ai-section">
        <div class="ai-section-title">⬇️ Simplified Explanation</div>
        <div class="ai-level-card ai-beginner"><div class="ai-level-label">🟢 Beginner Level</div>${formatText(exp.beginner || 'Focus on the core concept: ' + (exp.definition || q.question))}</div>
        ${exp.revision_note || pm.revision_note ? `<div class="revision-note" style="margin-top:0.75rem">📌 <strong>Quick Revision:</strong> ${formatText(exp.revision_note || pm.revision_note)}</div>` : ''}
      </div>`;
      break;

    case 'harder':
      html = `<div class="ai-section">
        <div class="ai-section-title">⬆️ Advanced Understanding</div>
        <div class="ai-level-card" style="--level-color:var(--accent-danger)"><div class="ai-level-label">🔴 Advanced Level</div>${formatText(exp.advanced || 'Research the underlying mechanisms and edge cases of this topic.')}</div>
        ${exp.formula_analysis?.length ? `<div class="formula-block" style="margin-top:0.75rem">⚙️ <strong>Formulas:</strong> ${exp.formula_analysis.map(f => `<code class="formula-code">${escapeHtml(f)}</code>`).join(' ')}` : ''}
        ${pm.bloom_level ? `<div style="margin-top:0.5rem;font-size:0.8rem;color:var(--text-muted)">Bloom's Level: <strong>${escapeHtml(pm.bloom_level)}</strong></div>` : ''}
      </div>`;
      break;
  }

  output.innerHTML = html;
  typeset(output);
}

// ============================================================
// INIT
// ============================================================

async function init() {
  loadState();
  document.documentElement.setAttribute('data-theme', State.theme);
  if (State.sidebarCollapsed) {
    document.getElementById('sidebar')?.classList.add('collapsed');
  }

  // Update sidebar with loaded state immediately
  updateSidebarStats();
  updateBadges();

  try {
    const questions = await discoverAndLoadQuestions();

    if (questions.length === 0) {
      updateLoader(0, '⚠️ No questions found. Check data folder structure.');
      return;
    }

    State.questions = questions;
    updateLoader(85, `Processing ${questions.length.toLocaleString()} questions...`);

    // Build metadata and index
    buildMetadata();
    buildQuestionIndex();

    // Populate UI filters
    populateFilters();

    // Restore saved filters to DOM if present
    if (State.filters) {
      if (document.getElementById('filter-subject')) document.getElementById('filter-subject').value = State.filters.subject || '';
      if (document.getElementById('filter-grade')) document.getElementById('filter-grade').value = State.filters.grade || '';
      updateUnitFilter();
      if (document.getElementById('filter-unit')) document.getElementById('filter-unit').value = State.filters.unit || '';
      updateSectionFilter();
      if (document.getElementById('filter-section')) document.getElementById('filter-section').value = State.filters.section || '';
      if (document.getElementById('filter-difficulty')) document.getElementById('filter-difficulty').value = State.filters.difficulty || '';
      if (document.getElementById('filter-status')) document.getElementById('filter-status').value = State.filters.status || '';
    }

    // Initialise custom dropdown wrappers (filter bar)
    initCustomSelects();
    // Sync custom dropdown labels to restored values
    ['filter-subject','filter-grade','filter-unit','filter-section','filter-difficulty','filter-status'].forEach(syncCustomSelect);

    // Apply initial filter
    applyFilters();

    // Setup events
    setupEventListeners();
    setupKeyboard();
    setupSwipeGestures();
    setupDictionary();
    loadNotes();
    updateNoteDot();

    updateBadges();
    updateSidebarStats();
    updateDailyGoal();
    applyFontSize();

    updateLoader(100, '✅ Ready!');

    // Hide loading, show app
    await new Promise(r => setTimeout(r, 350));
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.opacity = '0';
      setTimeout(() => {
        loadingScreen.style.display = 'none';
        document.getElementById('app').classList.remove('hidden');
      }, 500);
    }

    // Initial search view placeholder
    doSearch();

    console.log(`✅ ExamEdge loaded: ${questions.length.toLocaleString()} questions from ${State.subjects.size} subjects`);
    showToast(`✅ ${questions.length.toLocaleString()} questions ready!`, 'success');

  } catch (err) {
    console.error('Init error:', err);
    updateLoader(0, `❌ Error: ${err.message}`);
  }
}

// Start
init();

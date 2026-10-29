/* Pure quiz behavior. Classic script for file://, CommonJS for Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EE_CORE = api;
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const TYPES = ['single', 'multi', 'judge'];
  let sequence = 0;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const integer = (x, min, max) => Number.isInteger(x) && x >= min && x <= max;
  const timestamp = x => Number.isFinite(x) && x >= 0;
  const round = x => Math.round(x * 10) / 10;
  const getQuestions = bank => bank.questions || bank;

  function checkAnswer(question, selected) {
    if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length) return false;
    if (selected.some(i => !integer(i, 0, question.options.length - 1))) return false;
    return selected.length === question.answer.length && selected.every(i => question.answer.includes(i));
  }
  function shuffle(items, rng = Math.random) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.max(0, Math.floor(rng() * (i + 1))));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  function filterQuestions(bank, filter = {}) {
    return getQuestions(bank).filter(q =>
      (!filter.module || filter.module === 'all' || q.module === filter.module) &&
      (!filter.type || filter.type === 'all' || q.type === filter.type) &&
      (!filter.level || filter.level === 'all' || q.level === filter.level) &&
      (!Array.isArray(filter.ids) || filter.ids.includes(q.id)) &&
      (!filter.keyword || (q.stem + q.explanation).toLowerCase().includes(filter.keyword.toLowerCase()))
    );
  }
  function buildSession(bank, config, now = Date.now(), rng = Math.random) {
    const pool = filterQuestions(bank, config.filter || {});
    let chosen;
    const mode = config.mode === 'exam' ? 'exam' : 'practice';
    if (mode === 'exam') {
      if (!integer(config.minutes, 1, 180)) throw new Error('考试时间应为 1—180 分钟。');
      chosen = [];
      for (const type of TYPES) {
        const count = config.counts && config.counts[type];
        if (!integer(count, 0, getQuestions(bank).length)) throw new Error('各题型数量必须为非负整数，且不能超过题库总量。');
        const typed = pool.filter(q => q.type === type);
        if (typed.length < count) throw new Error(({single:'单选',multi:'多选',judge:'判断'})[type] + '可用题目不足，请减少数量或扩大筛选范围。');
        chosen.push(...shuffle(typed, rng).slice(0, count));
      }
      if (!chosen.length) throw new Error('至少选择一道题。');
      chosen = shuffle(chosen, rng);
    } else {
      if (!pool.length) throw new Error('当前筛选下没有可用题目，请调整条件。');
      if (!integer(config.count, 1, 10000)) throw new Error('练习题数应为正整数。');
      chosen = (config.order === 'sequential' ? pool : shuffle(pool, rng)).slice(0, config.count);
    }
    return {
      id: 'session-' + now + '-' + (++sequence) + '-' + Math.floor(rng()*1e9),
      mode, ids: chosen.map(q => q.id), answers: {}, submitted: {}, recorded: {}, flags: [], index: 0,
      startedAt: now, deadline: mode === 'exam' ? now + config.minutes * 60000 : null,
      scopeLabel: config.scopeLabel || (mode === 'exam' ? '模拟考试' : '章节练习')
    };
  }
  function selectAnswer(session, question, index) {
    if (!session || !session.ids.includes(question.id) || !integer(index, 0, question.options.length - 1)) return;
    if (session.mode === 'practice' && session.submitted[question.id]) return;
    if (question.type === 'multi') {
      const selected = session.answers[question.id] || [];
      session.answers[question.id] = (selected.includes(index) ? selected.filter(x => x !== index) : selected.concat(index)).sort((a,b)=>a-b);
    } else session.answers[question.id] = [index];
  }
  function createState() { return {schema: 1, stats: {}, favorites: [], history: [], active: null}; }
  function recordAttempt(state, id, correct, now) {
    const previous = state.stats[id] || {attempts: 0, correct: 0, wrong: 0};
    state.stats[id] = {
      attempts: previous.attempts + 1, correct: previous.correct + (correct ? 1 : 0),
      wrong: previous.wrong + (correct ? 0 : 1), lastCorrect: correct, lastAt: now
    };
  }
  function submitPractice(state, bank, now = Date.now()) {
    const s = state.active;
    if (!s || s.mode !== 'practice') throw new Error('当前不是练习会话。');
    const id = s.ids[s.index];
    if (s.submitted[id]) return;
    if (!(s.answers[id] || []).length) throw new Error('请先选择答案。');
    const q = getQuestions(bank).find(x => x.id === id);
    recordAttempt(state, id, checkAnswer(q, s.answers[id]), now);
    s.submitted[id] = true; s.recorded[id] = true;
  }
  function summarize(session, bank) {
    const map = new Map(getQuestions(bank).map(q => [q.id,q]));
    const byType = Object.fromEntries(TYPES.map(t => [t,{total:0,correct:0}]));
    const rows = session.ids.map(id => {
      const q = map.get(id);
      const selected = (session.mode === 'practice' && session.submitted && !session.submitted[id] ? [] : (session.answers[id] || [])).slice();
      const correct = checkAnswer(q, selected);
      byType[q.type].total++; byType[q.type].correct += correct ? 1 : 0;
      return {id, selected, correct, unanswered: !selected.length};
    });
    const correct = rows.filter(r => r.correct).length;
    return {
      total: rows.length, correct, unanswered: rows.filter(r => r.unanswered).length,
      score: rows.length ? round(correct / rows.length * 100) : 0, byType,
      wrongIds: rows.filter(r=>!r.correct).map(r=>r.id), rows
    };
  }
  function finishSession(state, bank, now = Date.now()) {
    const s = state.active;
    if (!s) return null;
    const summary = summarize(s, bank);
    for (const row of summary.rows) {
      if (s.mode === 'exam' && !s.recorded[row.id]) recordAttempt(state, row.id, row.correct, now);
    }
    const end = s.mode === 'exam' ? Math.min(now, s.deadline) : now;
    const result = {...summary, id:s.id, mode:s.mode, scopeLabel:s.scopeLabel,
      startedAt:s.startedAt, finishedAt:Math.max(end,s.startedAt),
      elapsedMs:Math.max(0,end-s.startedAt), ids:s.ids.slice(),
      answers:Object.fromEntries(summary.rows.filter(r=>r.selected.length).map(r=>[r.id,r.selected.slice()]))};
    state.history = [result, ...state.history.filter(r=>r.id!==s.id)].slice(0,50);
    state.active = null;
    return result;
  }
  function isExpired(session, now = Date.now()) { return !!session && session.mode === 'exam' && now >= session.deadline; }
  function remainingMs(session, now = Date.now()) { return session && session.deadline !== null ? Math.max(0,session.deadline-now) : null; }
  function getMistakes(state, unresolvedOnly = true) {
    return Object.keys(state.stats).filter(id => state.stats[id].wrong > 0 && (!unresolvedOnly || !state.stats[id].lastCorrect))
      .sort((a,b)=>state.stats[b].lastAt-state.stats[a].lastAt);
  }
  function toggleFavorite(state,id) {
    state.favorites = state.favorites.includes(id) ? state.favorites.filter(x=>x!==id) : state.favorites.concat(id);
  }
  function getStats(state) {
    const records = Object.values(state.stats);
    const attempts = records.reduce((sum,r)=>sum+r.attempts,0);
    const correct = records.reduce((sum,r)=>sum+r.correct,0);
    return {attempts,correct,accuracy:attempts?round(correct/attempts*100):null,
      seen:records.length, wrongCount:getMistakes(state).length, favoriteCount:state.favorites.length};
  }
  function encode(state) { return JSON.stringify({app:'ee-quiz',version:1,state},null,2); }

  // Validate a complete import before replacing the current state. Recompute result summaries.
  function decode(raw, bank) {
    const fail = () => { throw new Error('学习记录格式不正确或与当前题库不兼容，原记录未被更改。'); };
    if (typeof raw !== 'string' || raw.length > 10000000) fail();
    let data;
    try { data = JSON.parse(raw); } catch (_) { fail(); }
    if (!data || data.app !== 'ee-quiz' || data.version !== 1 || !data.state || data.state.schema !== 1) fail();
    const x = data.state;
    const map = new Map(getQuestions(bank).map(q=>[q.id,q]));
    const object = o => o && typeof o === 'object' && !Array.isArray(o);
    const ids = list => {
      if (!Array.isArray(list) || list.some(id=>typeof id!=='string'||!map.has(id)) || new Set(list).size!==list.length) fail();
      return list.slice();
    };
    const answers = (obj, list) => {
      if (!object(obj)) fail();
      const out = {};
      for (const [id, values] of Object.entries(obj)) {
        if (!list.includes(id) || !Array.isArray(values) || new Set(values).size!==values.length || values.some(i=>!integer(i,0,map.get(id).options.length-1))) fail();
        if (map.get(id).type!=='multi' && values.length>1) fail();
        out[id] = values.slice().sort((a,b)=>a-b);
      }
      return out;
    };
    const booleanMap = (obj, list) => {
      if (!object(obj)) fail();
      const out={};
      for (const [id,value] of Object.entries(obj)) { if (!list.includes(id)||value!==true) fail(); out[id]=true; }
      return out;
    };
    if (!object(x.stats) || !Array.isArray(x.history) || x.history.length>50) fail();
    const out = createState();
    out.favorites = ids(x.favorites);
    for (const [id,r] of Object.entries(x.stats)) {
      if (!map.has(id) || !object(r) || !integer(r.attempts,1,1e9) || !integer(r.correct,0,r.attempts) || !integer(r.wrong,0,r.attempts) || r.correct+r.wrong!==r.attempts || typeof r.lastCorrect!=='boolean' || (r.lastCorrect ? r.correct===0 : r.wrong===0) || !timestamp(r.lastAt)) fail();
      out.stats[id]={attempts:r.attempts,correct:r.correct,wrong:r.wrong,lastCorrect:r.lastCorrect,lastAt:r.lastAt};
    }
    const base = r => {
      if (!object(r) || typeof r.id!=='string' || r.id.length>160 || !r.id) fail();
      if (!['practice','exam'].includes(r.mode) || !timestamp(r.startedAt) || typeof r.scopeLabel!=='string' || r.scopeLabel.length>300) fail();
      const list=ids(r.ids); if (!list.length) fail();
      return {id:r.id,mode:r.mode,ids:list,answers:answers(r.answers,list),startedAt:r.startedAt,scopeLabel:r.scopeLabel};
    };
    out.history = x.history.map(r=>{
      const s=base(r);
      if (!timestamp(r.finishedAt) || r.finishedAt<r.startedAt) fail();
      return {...summarize(s,bank),...s,finishedAt:r.finishedAt,elapsedMs:r.finishedAt-r.startedAt};
    });
    if (new Set(out.history.map(r=>r.id)).size!==out.history.length) fail();
    if (x.active !== null) {
      const r=x.active,s=base(r);
      if (!integer(r.index,0,s.ids.length-1) || out.history.some(h=>h.id===s.id)) fail();
      if (s.mode==='exam' ? (!timestamp(r.deadline)||r.deadline<=s.startedAt||r.deadline-s.startedAt>180*60000) : r.deadline!==null) fail();
      const flags=ids(r.flags); if (flags.some(id=>!s.ids.includes(id))) fail();
      const submitted=booleanMap(r.submitted,s.ids), recorded=booleanMap(r.recorded,s.ids);
      if (s.mode==='exam' && (Object.keys(submitted).length || Object.keys(recorded).length)) fail();
      if (Object.keys(submitted).some(id=>!recorded[id] || !(s.answers[id]||[]).length || !out.stats[id]) || Object.keys(recorded).some(id=>!submitted[id])) fail();
      out.active={...s,index:r.index,deadline:r.deadline,flags,submitted,recorded};
    }
    return out;
  }
  return {TYPES,checkAnswer,shuffle,filterQuestions,buildSession,selectAnswer,createState,submitPractice,summarize,finishSession,isExpired,remainingMs,getMistakes,toggleFavorite,getStats,encode,decode};
});

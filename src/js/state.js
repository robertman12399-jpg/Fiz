/* ============================================================
   ФизМат RPG — state.js
   Слой модели и сохранения. Здесь живёт всё состояние игры
   и правила его изменения (опыт, уровни, прогресс, достижения).
   UI (app.js) НЕ трогает state напрямую — только через методы State.

   Сохранение идёт в LocalStorage. Если LocalStorage недоступен
   (например, в предпросмотре), используется память на время сессии.
   Чтобы позже подключить Firebase — достаточно заменить объект Storage.
   ============================================================ */

/* ----------------------------------------------------------
   Слой хранения: LocalStorage с безопасным запасным вариантом
---------------------------------------------------------- */
const Storage = {
  KEY: "fizmatrpg.save.v1",
  _mem: null,
  _hasLS: (function () {
    try {
      const k = "__fmrpg_test__";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  })(),
  read() {
    try { if (this._hasLS) return localStorage.getItem(this.KEY); } catch (e) {}
    return this._mem;
  },
  write(str) {
    try { if (this._hasLS) { localStorage.setItem(this.KEY, str); return; } } catch (e) {}
    this._mem = str; // запасной путь
  },
  clear() {
    try { if (this._hasLS) localStorage.removeItem(this.KEY); } catch (e) {}
    this._mem = null;
  },
};

/* ----------------------------------------------------------
   Состояние по умолчанию (новая игра)
---------------------------------------------------------- */
function defaultState() {
  return {
    version: 1,
    hero: null, // { name, classId, level, xp, coins }
    progress: {}, // topicId -> объект прогресса темы
    achievements: [], // id полученных достижений
    items: [], // id собранных артефактов
    unlocks: { avatars: ["av_default"], accents: ["ac_cyan"] },
    equipped: { avatar: "av_default", accent: "ac_cyan" },
    stats: {
      correctAnswers: 0, questionsAnswered: 0, problemsSolved: 0,
      experiments: 0, topicsCompleted: 0, mistakes: 0,
      recoveries: 0, bossesDefeated: 0, chaptersCompleted: 0,
    },
    // Прогресс по сюжетным главам (визуальная новелла):
    // current — активная глава, scene — индекс текущей сцены, completed — карта пройденных
    adventure: { current: null, scene: 0, completed: {} },
    // Прогресс по учебным миссиям курса (теория-RPG): done — карта "secId:idx" -> true
    course: { done: {} },
    // Прогресс по тренажёру: max — макс. открытый уровень по теме "secId:idx", solved — всего решено
    trainer: { max: {}, solved: 0 },
    // Результаты экзамена
    exam: { best: 0, taken: 0 },
    // Пройденные сценарии практики "Расставь силы": id сценария -> true
    forcesDone: {},
    // Стиль исследователя — чисто косметика (выборы в сюжете), не влияет на обучение
    style: { experiment: 0, formula: 0, risk: 0 },
    // Лог конкретных ошибок для режима "Разбор ошибок": key -> {question, wrong, correct, explain, chId, chTitle, grade, kind, ts}
    // Запись появляется при неверном ответе и стирается, как только тот же вопрос решён верно.
    mistakesLog: {},
    // Результаты итогового контроля по темам учебника: missionKey -> {pct, passed, ts}
    // Сохраняется НАВСЕГДА (в отличие от обычных тренировок внутри темы, которые сбрасываются).
    // Серия дней подряд: count — текущая серия, best — рекорд,
    // lastDate — последний день, когда что-то было заработано ("YYYY-MM-DD", локальная дата устройства)
    streak: { count: 0, best: 0, lastDate: null },
    courseControl: { best: {} },
    // Интервальное повторение (spaced repetition). Появляется у темы, когда
    // её итоговая проверка пройдена в первый раз. key -> { stage, dueDate, lastReviewDate }
    // stage 0..4 соответствует интервалам SPACING_INTERVALS (в днях).
    spacing: {},
    // Личная цель на тему: ученик САМ выбирает планку перед проверкой.
    // key -> { target: 70|85|100, ts }. Недостижение цели не наказывается —
    // засчитывается обычный результат, просто без бонуса за смелость.
    goals: {},
    settings: { sound: true, music: true, onboarded: false, teacherUnlocked: false },
  };
}

/* ----------------------------------------------------------
   Даты для серии дней подряд (streak). Работаем с ЛОКАЛЬНОЙ
   календарной датой устройства как строкой "YYYY-MM-DD" —
   так разница в днях считается надёжно и не путается с переводом
   часов (сравниваем местную полночь, а не абсолютное время).
---------------------------------------------------------- */
function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function dateKeyToLocalMidnight(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function daysBetweenKeys(keyA, keyB) {
  return Math.round((dateKeyToLocalMidnight(keyA) - dateKeyToLocalMidnight(keyB)) / 86400000);
}
function addDaysToKey(key, days) {
  const d = dateKeyToLocalMidnight(key);
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
// Растущие интервалы интервального повторения, в днях. Прошёл проверку —
// переходим к следующему (более длинному) интервалу. Провалил — откат на 0.
const SPACING_INTERVALS = [1, 3, 7, 14, 30];

/* ----------------------------------------------------------
   Объект State — единая точка работы с состоянием
---------------------------------------------------------- */
const State = {
  data: defaultState(),
  pendingEvents: [], // события для UI: {type, payload}

  /* --- загрузка / сохранение --- */
  load() {
    const raw = Storage.read();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        this.data = Object.assign(defaultState(), parsed);
        // подстрахуем вложенные объекты
        this.data.stats = Object.assign(defaultState().stats, parsed.stats || {});
        this.data.unlocks = Object.assign(defaultState().unlocks, parsed.unlocks || {});
        this.data.equipped = Object.assign(defaultState().equipped, parsed.equipped || {});
        this.data.settings = Object.assign(defaultState().settings, parsed.settings || {});
        this.data.adventure = Object.assign(defaultState().adventure, parsed.adventure || {});
        this.data.style = Object.assign(defaultState().style, parsed.style || {});
      } catch (e) {
        this.data = defaultState();
      }
    }
    return this.data;
  },
  save() { Storage.write(JSON.stringify(this.data)); },

  // ---- Ежедневные квесты ----
  questToday() { const d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); },
  dailyEnsure() {
    if (!this.data.daily || this.data.daily.date !== this.questToday()) {
      this.data.daily = { date: this.questToday(), c: {}, claimed: {} };
      this.save();
    }
    return this.data.daily;
  },
  questBump(metric, n) {
    const d = this.dailyEnsure();
    d.c[metric] = (d.c[metric] || 0) + (n || 1);
    const done = [];
    ((typeof window !== "undefined" && window.QUEST_DEFS) || []).forEach((q) => {
      if (!d.claimed[q.id] && (d.c[q.metric] || 0) >= q.target) {
        d.claimed[q.id] = true;
        if (this.awardStory) this.awardStory(q.xp, q.coins, "quest"); else { this.addXP(q.xp, "quest"); }
        done.push(q);
      }
    });
    this.save();
    return done;
  },
  questProgress() {
    const d = this.dailyEnsure();
    return ((typeof window !== "undefined" && window.QUEST_DEFS) || []).map((q) => ({
      q, val: Math.min(d.c[q.metric] || 0, q.target), done: !!d.claimed[q.id] || (d.c[q.metric] || 0) >= q.target,
    }));
  },
  questDoneCount() { return this.questProgress().filter((x) => x.done).length; },

  // ---- Экспорт / импорт сохранения ----
  exportData() { return JSON.stringify(this.data, null, 2); },
  importData(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    if (!("hero" in parsed) && !("stats" in parsed) && !("settings" in parsed)) return false;
    this.data = Object.assign(defaultState(), parsed);
    this.data.stats = Object.assign(defaultState().stats, parsed.stats || {});
    this.data.unlocks = Object.assign(defaultState().unlocks, parsed.unlocks || {});
    this.data.equipped = Object.assign(defaultState().equipped, parsed.equipped || {});
    this.data.settings = Object.assign(defaultState().settings, parsed.settings || {});
    this.data.adventure = Object.assign(defaultState().adventure, parsed.adventure || {});
    this.data.style = Object.assign(defaultState().style, parsed.style || {});
    this.save();
    return true;
  },
  reset() { Storage.clear(); this.data = defaultState(); },
  hasSave() { return !!Storage.read(); },

  /* --- события для UI --- */
  emit(type, payload) { this.pendingEvents.push({ type, payload }); },
  takeEvents() { const e = this.pendingEvents; this.pendingEvents = []; return e; },

  /* --- герой --- */
  createHero(name, classId) {
    this.data.hero = {
      name: (name || "Герой").trim().slice(0, 20),
      classId: classId,
      level: 1,
      xp: 0,
      coins: 0,
    };
    this.collectAchievements();
    this.save();
  },
  heroClass() { return GAME.classes.find((c) => c.id === this.data.hero.classId); },

  /* --- уровни и опыт --- */
  levelFromXP(xp) {
    let lvl = 1;
    for (const L of GAME.levels) if (xp >= L.xpStart) lvl = L.level;
    return lvl;
  },
  levelInfo() {
    const xp = this.data.hero ? this.data.hero.xp : 0;
    const level = this.levelFromXP(xp);
    const cur = GAME.levels[level - 1];
    const next = GAME.levels[level]; // undefined на максимуме
    const xpIntoLevel = xp - cur.xpStart;
    const xpForLevel = next ? next.xpStart - cur.xpStart : 0;
    const percent = next ? Math.min(100, Math.round((xpIntoLevel / xpForLevel) * 100)) : 100;
    return { level, title: cur.title, xp, xpIntoLevel, xpForLevel, percent, isMax: !next };
  },

  // Применяет бонус класса в зависимости от типа действия
  bonusMultiplier(actionType) {
    if (!this.data.hero) return 1;
    const cls = this.heroClass();
    const map = { theory: "theory", question: "theory", experiment: "experiments", problem: "problems", boss: "space" };
    return cls && map[actionType] === cls.bonusType ? 1.1 : 1;
  },

  addXP(amount, actionType) {
    if (!this.data.hero) return { gained: 0, leveledUp: false };
    this.updateStreak();
    const mult = this.bonusMultiplier(actionType);
    const gained = Math.round(amount * mult);
    const oldLevel = this.data.hero.level;
    this.data.hero.xp += gained;
    const newLevel = this.levelFromXP(this.data.hero.xp);
    this.data.hero.level = newLevel;
    if (newLevel > oldLevel) {
      this.emit("levelup", { level: newLevel, title: GAME.levels[newLevel - 1].title });
    }
    return { gained, leveledUp: newLevel > oldLevel, newLevel };
  },
  addCoins(n) { if (this.data.hero) this.data.hero.coins += n; },

  /* --- серия дней подряд (streak) --- */
  // Отмечает сегодняшний день как активный. Вызывается автоматически из
  // addXP — то есть при ЛЮБОМ заработанном опыте, а не только при заходе
  // в приложение. Если сегодня уже отмечено — ничего не делает (идемпотентно).
  updateStreak() {
    if (!this.data.streak) this.data.streak = { count: 0, best: 0, lastDate: null };
    const s = this.data.streak;
    const today = todayKey();
    if (s.lastDate === today) return; // уже засчитано сегодня
    if (s.lastDate && daysBetweenKeys(today, s.lastDate) === 1) {
      s.count += 1; // вчера тоже был активен — серия продолжается
    } else {
      s.count = 1; // разрыв (или самый первый день) — серия начинается заново
    }
    s.lastDate = today;
    if (s.count > s.best) s.best = s.count;
  },
  // Статус серии ДЛЯ ОТОБРАЖЕНИЯ, не меняет данные. Три состояния:
  //   "active"  — сегодня уже отмечено, серия учтена
  //   "at_risk" — вчера был активен, сегодня ещё нет — можно спасти, зайдя сегодня
  //   "broken"  — разрыв больше суток, текущая серия сгорела (но best сохранён)
  streakInfo() {
    const s = this.data.streak || { count: 0, best: 0, lastDate: null };
    if (!s.lastDate) return { count: 0, best: s.best || 0, status: "none" };
    const today = todayKey();
    if (s.lastDate === today) return { count: s.count, best: s.best, status: "active" };
    const diff = daysBetweenKeys(today, s.lastDate);
    if (diff === 1) return { count: s.count, best: s.best, status: "at_risk" };
    return { count: 0, best: s.best, status: "broken" };
  },

  // Универсальная выдача награды (опыт + монеты) с бонусом класса
  grant(rewardKey, actionType) {
    const r = GAME.rewards[rewardKey];
    if (!r) return { xp: 0, coins: 0 };
    const res = this.addXP(r.xp, actionType);
    this.addCoins(r.coins);
    return { xp: res.gained, coins: r.coins, leveledUp: res.leveledUp };
  },

  /* --- сюжетные главы (визуальная новелла) --- */
  chapterById(chId) { return (GAME.chapters || []).find((c) => c.id === chId); },
  isChapterDone(chId) { return !!this.data.adventure.completed[chId]; },

  // Начать (или продолжить) главу: запоминаем активную, не сбрасываем прогресс
  startChapter(chId) {
    const a = this.data.adventure;
    // Переход в ДРУГУЮ главу — всегда начинаем со сцены 0 (раньше сбрасывалось
    // только для уже пройденных глав, из-за чего новая глава наследовала
    // номер сцены от предыдущей и сразу открывалась не с начала).
    if (a.current !== chId) { a.current = chId; a.scene = 0; }
    if (typeof a.scene !== "number") a.scene = 0;
    this.save();
    return a.scene;
  },
  // Перейти к следующей сцене активной главы
  advanceScene(chId) {
    const a = this.data.adventure;
    if (a.current !== chId) { a.current = chId; a.scene = 0; }
    a.scene = (a.scene || 0) + 1;
    this.save();
    return a.scene;
  },
  sceneIndex(chId) {
    const a = this.data.adventure;
    return a.current === chId ? (a.scene || 0) : 0;
  },

  /* --- Лаборатория открытий (собранные законы) --- */
  discoveryUnlocked(d) {
    if (!d) return false;
    if (d.chapterId && this.isChapterDone(d.chapterId)) return true;
    if (d.topicId && this.data.progress[d.topicId] && this.data.progress[d.topicId].completed) return true;
    return false;
  },
  discoveriesUnlocked() { return (GAME.discoveries || []).filter((d) => this.discoveryUnlocked(d)).length; },
  totalDiscoveries() { return (GAME.discoveries || []).length; },

  /* --- стиль исследователя (косметика: выборы в сюжете) --- */
  recordStyle(kind) {
    if (!this.data.style) this.data.style = { experiment: 0, formula: 0, risk: 0 };
    if (kind in this.data.style) { this.data.style[kind]++; this.save(); }
  },
  styleLabel() {
    const s = this.data.style || {};
    const total = (s.experiment || 0) + (s.formula || 0) + (s.risk || 0);
    if (!total) return "Начинающий исследователь";
    const names = { experiment: "Экспериментатор", formula: "Теоретик", risk: "Смельчак" };
    let best = "experiment", max = -1;
    ["experiment", "formula", "risk"].forEach((k) => { if ((s[k] || 0) > max) { max = s[k] || 0; best = k; } });
    return names[best];
  },

  // Произвольная награда за действие в истории (опыт + монеты), с бонусом класса
  awardStory(xp, coins, actionType) {
    const res = this.addXP(xp || 0, actionType);
    if (coins) this.addCoins(coins);
    this.save();
    return { xp: res.gained, coins: coins || 0, leveledUp: res.leveledUp };
  },

  // Завершить главу: бонус, достижение, отметка о прохождении (защита от повтора)
  completeChapter(chId) {
    const ch = this.chapterById(chId);
    if (!ch) return { xp: 0, coins: 0, already: true };
    const already = this.isChapterDone(chId);
    if (!already) {
      this.data.adventure.completed[chId] = true;
      this.data.stats.chaptersCompleted++;
    }
    const r = ch.reward || { xp: 0, coins: 0 };
    const res = already ? { gained: 0 } : this.addXP(r.xp, "boss");
    if (!already && r.coins) this.addCoins(r.coins);
    this.emit("chapterComplete", { chapterId: chId, title: ch.title, reward: { xp: res.gained, coins: already ? 0 : r.coins } });
    if (!already) this.collectAchievements();
    this.save();
    return { xp: res.gained, coins: already ? 0 : r.coins, leveledUp: res.leveledUp, already };
  },

  /* --- учебные миссии (курс по классам, теория-RPG) --- */
  isMissionDone(key) {
    return !!(this.data.course && this.data.course.done && this.data.course.done[key]);
  },
  completeMission(key, reward) {
    if (!this.data.course) this.data.course = { done: {} };
    if (!this.data.course.done) this.data.course.done = {};
    const already = !!this.data.course.done[key];
    if (!already) this.data.course.done[key] = true;
    const r = reward || { xp: 0, coins: 0 };
    const res = already ? { gained: 0, leveledUp: false } : this.addXP(r.xp || 0, "mission");
    if (!already && r.coins) this.addCoins(r.coins);
    this.emit("missionComplete", { key, reward: { xp: res.gained, coins: already ? 0 : (r.coins || 0) } });
    if (!already) this.collectAchievements();
    this.save();
    return { xp: res.gained, coins: already ? 0 : (r.coins || 0), leveledUp: res.leveledUp, already };
  },
  missionsDoneCount() {
    const d = (this.data.course && this.data.course.done) || {};
    return Object.keys(d).filter((k) => d[k]).length;
  },

  /* --- тренажёр по темам --- */
  trainerMaxLevel(key) {
    return (this.data.trainer && this.data.trainer.max && this.data.trainer.max[key]) || 1;
  },
  unlockTrainerLevel(key, lvl) {
    if (!this.data.trainer) this.data.trainer = { max: {}, solved: 0 };
    if (!this.data.trainer.max) this.data.trainer.max = {};
    if (lvl > (this.data.trainer.max[key] || 1)) this.data.trainer.max[key] = lvl;
    this.save();
  },
  trainerSolved() {
    if (!this.data.trainer) this.data.trainer = { max: {}, solved: 0 };
    this.data.trainer.solved = (this.data.trainer.solved || 0) + 1;
    const r = this.addXP(5, "trainer");
    this.save();
    return r;
  },

  /* --- прогресс по темам --- */
  ensureTopic(topicId) {
    if (this.data.progress[topicId]) return this.data.progress[topicId];
    const t = GAME.topics.find((x) => x.id === topicId);
    this.data.progress[topicId] = {
      started: false,
      theory: t.theory.map(() => false),
      experiment: false,
      questions: t.questions.map(() => false),
      problems: t.problems.map(() => false),
      bossDone: false,
      completed: false,
      mistakes: 0,
    };
    return this.data.progress[topicId];
  },

  topicStageDone(topicId) {
    const p = this.data.progress[topicId];
    if (!p) return { theory: false, experiment: false, questions: false, problems: false, boss: false };
    return {
      theory: p.theory.every(Boolean),
      experiment: p.experiment,
      questions: p.questions.every(Boolean),
      problems: p.problems.every(Boolean),
      boss: p.bossDone,
    };
  },

  markStarted(topicId) {
    const p = this.ensureTopic(topicId);
    if (!p.started) { p.started = true; this.save(); }
  },

  readTheoryCard(topicId, idx) {
    const p = this.ensureTopic(topicId);
    if (p.theory[idx]) return null; // уже прочитано
    p.theory[idx] = true;
    const g = this.grant("theoryCard", "theory");
    this.afterAction(topicId);
    return g;
  },

  doExperiment(topicId) {
    const p = this.ensureTopic(topicId);
    if (p.experiment) return null;
    p.experiment = true;
    this.data.stats.experiments++;
    const g = this.grant("experiment", "experiment");
    this.afterAction(topicId);
    return g;
  },

  answerQuestion(topicId, idx, isCorrect) {
    const p = this.ensureTopic(topicId);
    this.data.stats.questionsAnswered++;
    if (!isCorrect) {
      p.mistakes++;
      this.data.stats.mistakes++;
      this.afterAction(topicId);
      return { correct: false };
    }
    this.data.stats.correctAnswers++;
    const wasFirstFail = p._qFailed && p._qFailed[idx];
    const newlyCorrect = !p.questions[idx];
    if (newlyCorrect) p.questions[idx] = true;
    let g = null;
    if (newlyCorrect) g = this.grant("question", "question");
    if (wasFirstFail) this.recordRecovery();
    this.afterAction(topicId);
    return Object.assign({ correct: true }, g || {});
  },

  solveProblem(topicId, idx, isCorrect) {
    const p = this.ensureTopic(topicId);
    if (!isCorrect) {
      p.mistakes++;
      this.data.stats.mistakes++;
      p._pFailed = p._pFailed || {};
      p._pFailed[idx] = true;
      this.afterAction(topicId);
      return { correct: false };
    }
    const wasFirstFail = p._pFailed && p._pFailed[idx];
    const newlyCorrect = !p.problems[idx];
    if (newlyCorrect) { p.problems[idx] = true; this.data.stats.problemsSolved++; }
    let g = null;
    if (newlyCorrect) g = this.grant("problem", "problem");
    if (wasFirstFail) this.recordRecovery();
    this.afterAction(topicId);
    return Object.assign({ correct: true }, g || {});
  },

  defeatBoss(topicId, isCorrect) {
    const p = this.ensureTopic(topicId);
    if (!isCorrect) {
      p.mistakes++;
      this.data.stats.mistakes++;
      this.afterAction(topicId);
      return { correct: false };
    }
    if (p.bossDone) { this.afterAction(topicId); return { correct: true, already: true }; }
    p.bossDone = true;
    this.data.stats.bossesDefeated++;
    const g = this.grant("boss", "boss");
    this.emit("bossWin", { topicId });
    // выдаём артефакт за босса
    const item = GAME.items.find((it) => it.topicId === topicId);
    if (item && !this.data.items.includes(item.id)) {
      this.data.items.push(item.id);
      this.emit("item", item);
    }
    this.afterAction(topicId);
    return Object.assign({ correct: true }, g);
  },

  recordRecovery() { this.data.stats.recoveries++; },

  // Проверяет, пройдена ли тема целиком, и начисляет бонус
  maybeCompleteTopic(topicId) {
    const p = this.data.progress[topicId];
    if (!p || p.completed) return;
    const s = this.topicStageDone(topicId);
    if (s.theory && s.experiment && s.questions && s.problems && s.boss) {
      p.completed = true;
      this.data.stats.topicsCompleted++;
      const g = this.grant("topicDone", "topicDone");
      this.emit("topicComplete", { topicId, reward: g });
    }
  },

  // Вызывается после каждого действия: проверка темы, достижений, сохранение
  afterAction(topicId) {
    this.maybeCompleteTopic(topicId);
    this.collectAchievements();
    this.save();
  },

  /* --- разбор ошибок: точечный лог неверных ответов (не просто счётчик) --- */
  logMistake(key, entry) {
    this.data.mistakesLog[key] = Object.assign({ ts: Date.now() }, entry);
    this.save();
  },
  clearMistake(key) {
    if (this.data.mistakesLog[key]) { delete this.data.mistakesLog[key]; this.save(); }
  },
  mistakesList() {
    return Object.keys(this.data.mistakesLog)
      .map((k) => Object.assign({ key: k }, this.data.mistakesLog[k]))
      .sort((a, b) => b.ts - a.ts);
  },

  /* --- итоговый контроль по теме учебника --- */
  controlBest(key) {
    if (!this.data.courseControl) this.data.courseControl = { best: {} };
    return this.data.courseControl.best[key] || null;
  },
  // Сохраняет попытку контроля. Награду даёт только за ПЕРВОЕ успешное прохождение
  // (порог 70%), чтобы нельзя было пересдавать тему ради бесконечного опыта.
  saveControlResult(key, score, total) {
    if (!this.data.courseControl) this.data.courseControl = { best: {} };
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    const passed = pct >= 70;
    const prev = this.data.courseControl.best[key];
    const firstPass = passed && !(prev && prev.passed);
    const better = !prev || pct > prev.pct;
    if (better) this.data.courseControl.best[key] = { pct, passed, ts: Date.now() };
    let reward = null;
    if (firstPass) {
      reward = this.awardStory(40, 15, "control");
      // Тема впервые пройдена — заводим её в интервальное повторение,
      // начиная с самого короткого интервала (SPACING_INTERVALS[0] = 1 день).
      if (!this.data.spacing) this.data.spacing = {};
      if (!this.data.spacing[key]) {
        const today = todayKey();
        this.data.spacing[key] = { stage: 0, dueDate: addDaysToKey(today, SPACING_INTERVALS[0]), lastReviewDate: today };
      }
    }
    this.save();
    return { pct, passed, firstPass, reward };
  },

  /* --- интервальное повторение (spaced repetition) --- */
  // Список тем, для которых наступил (или прошёл) срок повторения — не
  // мутирует данные, только читает. Отсортирован по степени просрочки:
  // самые «горящие» темы первыми.
  dueForReview() {
    if (!this.data.spacing) return [];
    const today = todayKey();
    const list = [];
    Object.keys(this.data.spacing).forEach((key) => {
      const s = this.data.spacing[key];
      const overdueDays = daysBetweenKeys(today, s.dueDate);
      if (overdueDays >= 0) list.push({ key, stage: s.stage, dueDate: s.dueDate, overdueDays });
    });
    list.sort((a, b) => b.overdueDays - a.overdueDays);
    return list;
  },
  // Темы, которые ещё не подошли, но уже в цикле повторения — для
  // прозрачности («скоро повторим»), не мутирует данные.
  upcomingReview() {
    if (!this.data.spacing) return [];
    const today = todayKey();
    const list = [];
    Object.keys(this.data.spacing).forEach((key) => {
      const s = this.data.spacing[key];
      const inDays = daysBetweenKeys(s.dueDate, today);
      if (inDays > 0) list.push({ key, stage: s.stage, dueDate: s.dueDate, inDays });
    });
    list.sort((a, b) => a.inDays - b.inDays);
    return list;
  },
  // Записывает результат сессии повторения: прошёл — интервал растёт до
  // следующего этапа; не прошёл — откат на самый короткий интервал.
  recordReviewResult(key, passed) {
    if (!this.data.spacing) this.data.spacing = {};
    const s = this.data.spacing[key] || { stage: 0, dueDate: todayKey(), lastReviewDate: todayKey() };
    const today = todayKey();
    let newStage;
    if (passed) newStage = Math.min(s.stage + 1, SPACING_INTERVALS.length - 1);
    else newStage = 0;
    const dueDate = addDaysToKey(today, SPACING_INTERVALS[newStage]);
    this.data.spacing[key] = { stage: newStage, dueDate, lastReviewDate: today };
    let reward = null;
    if (passed) reward = this.awardStory(15, 5, "review");
    this.save();
    return { passed, newStage, dueDate, intervalDays: SPACING_INTERVALS[newStage], reward };
  },
  // Человеко-читаемый статус для интерфейса.
  reviewStatus(key) {
    if (!this.data.spacing || !this.data.spacing[key]) return null;
    const s = this.data.spacing[key];
    const today = todayKey();
    const diff = daysBetweenKeys(s.dueDate, today); // >0 — ещё рано, 0 — сегодня, <0 — просрочено
    return { stage: s.stage, dueDate: s.dueDate, diff, due: diff <= 0 };
  },

  /* --- личная цель на тему (автономия: ученик сам ставит планку) --- */
  // Уровни цели и бонус за её достижение. Порог зачёта темы всегда 70% —
  // цель НЕ делает его строже, она только добавляет награду за смелость.
  goalLevels() {
    return [
      { target: 70, label: "Уверенно", desc: "Пройти тему", xp: 0, coins: 0 },
      { target: 85, label: "Сильно", desc: "Почти без ошибок", xp: 25, coins: 10 },
      { target: 100, label: "Идеально", desc: "Без единой ошибки", xp: 60, coins: 25 },
    ];
  },
  setGoal(key, target) {
    if (!this.data.goals) this.data.goals = {};
    this.data.goals[key] = { target, ts: Date.now() };
    this.save();
    return this.data.goals[key];
  },
  getGoal(key) {
    if (!this.data.goals) return null;
    return this.data.goals[key] || null;
  },
  // Проверяет, достигнута ли поставленная цель, и выдаёт бонус.
  // Вызывается ПОСЛЕ saveControlResult. Бонус — только за первое достижение.
  claimGoal(key, pct) {
    const goal = this.getGoal(key);
    if (!goal || goal.claimed) return null;
    if (pct < goal.target) return { reached: false, target: goal.target };
    const level = this.goalLevels().find((l) => l.target === goal.target);
    let reward = null;
    if (level && (level.xp || level.coins)) reward = this.awardStory(level.xp, level.coins, "goal");
    this.data.goals[key].claimed = true;
    this.save();
    return { reached: true, target: goal.target, label: level ? level.label : "", reward };
  },

  /* --- достижения --- */
  collectAchievements() {
    let added = true;
    let guard = 0;
    while (added && guard < 10) {
      added = false;
      guard++;
      for (const a of GAME.achievements) {
        if (this.data.achievements.includes(a.id)) continue;
        if (a.check(this.data)) {
          this.data.achievements.push(a.id);
          this.grant("achievement", "achievement");
          this.emit("achievement", a);
          added = true; // могло открыться зависящее достижение (напр. «Коллекционер»)
        }
      }
    }
  },

  /* --- открытие тем и миров --- */
  // Темы в мире открываются по порядку: первая доступна сразу.
  topicsOfWorld(worldId) { return GAME.topics.filter((t) => t.worldId === worldId); },

  isTopicUnlocked(topicId) {
    const t = GAME.topics.find((x) => x.id === topicId);
    if (!t) return false;
    const list = this.topicsOfWorld(t.worldId);
    const idx = list.findIndex((x) => x.id === topicId);
    if (idx === 0) return true; // первая тема мира
    const prev = list[idx - 1];
    const pp = this.data.progress[prev.id];
    return !!(pp && pp.completed);
  },

  isWorldUnlocked(worldId) {
    const w = GAME.worlds.find((x) => x.id === worldId);
    return w && w.status === "open";
  },

  /* --- слабые темы (для кабинета) --- */
  weakTopics() {
    return GAME.topics.filter((t) => {
      const p = this.data.progress[t.id];
      return p && p.started && p.mistakes >= 2;
    });
  },

  /* --- лавка --- */
  buyAvatar(id) {
    const item = GAME.shop.avatars.find((a) => a.id === id);
    if (!item || this.data.unlocks.avatars.includes(id)) return false;
    if (this.data.hero.coins < item.price) return false;
    this.data.hero.coins -= item.price;
    this.data.unlocks.avatars.push(id);
    this.save();
    return true;
  },
  buyAccent(id) {
    const item = GAME.shop.accents.find((a) => a.id === id);
    if (!item || this.data.unlocks.accents.includes(id)) return false;
    if (this.data.hero.coins < item.price) return false;
    this.data.hero.coins -= item.price;
    this.data.unlocks.accents.push(id);
    this.save();
    return true;
  },
  equipAvatar(id) { if (this.data.unlocks.avatars.includes(id)) { this.data.equipped.avatar = id; this.save(); } },
  equipAccent(id) { if (this.data.unlocks.accents.includes(id)) { this.data.equipped.accent = id; this.save(); } },

  equippedAvatarIcon() {
    const a = GAME.shop.avatars.find((x) => x.id === this.data.equipped.avatar);
    return a ? a.icon : "🧑‍🚀";
  },
  accentColor() {
    const a = GAME.shop.accents.find((x) => x.id === this.data.equipped.accent);
    return a ? a.color : "#38e1ff";
  },

  /* --- настройки --- */
  toggleSound() { this.data.settings.sound = !this.data.settings.sound; this.save(); return this.data.settings.sound; },
  toggleMusic() { this.data.settings.music = !this.data.settings.music; this.save(); return this.data.settings.music; },

  /* --- сводка прогресса --- */
  topicsStudied() { return Object.values(this.data.progress).filter((p) => p.completed).length; },
  totalTopics() { return GAME.topics.length; },
};

if (typeof window !== "undefined") { window.State = State; window.Storage = Storage; }

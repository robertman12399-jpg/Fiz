/* ============================================================
   ФизМат RPG — app.js
   Слой интерфейса (SPA). Рисует все экраны в #app и связывает
   действия пользователя с методами State (модель/сохранение).
   UI не хранит игровых данных — только временное состояние вида
   (какой экран открыт, какой этап, всплывающий фидбек).
   ============================================================ */

(function () {
  "use strict";

  const root = document.getElementById("app");

  /* Временное состояние интерфейса (не сохраняется) */
  const ui = {
    view: "map",      // create | adventure | scene | map | world | topic | cabinet | shop | teacher
    worldId: null,
    topicId: null,
    chId: null,       // активная сюжетная глава
    stage: "theory",  // theory | experiment | training | boss
    cab: "hero",      // hero | knowledge | missions | collection | program
    mission: null,    // активная миссия курса: { sec, idx }
    gradeSel: 7,      // выбранный класс в разделе «Программа»: 7 | 8 | 9
    realmId: null,    // открытый мир (атлас)
    tr: null,         // тренажёр: { key, level, task, streak } и фидбек trFb
    trFb: null,       // фидбек тренажёра: { checked, correct, val }
    fb: {},           // временный фидбек по заданиям: ключ -> {choice}
    forces: null,     // активная практика "Расставь силы": { scenarioId, on:{}, checked, correct }
    drillFb: {},      // фидбек интерактивных тренировок внутри учебника: "missionKey:blockIndex" -> {checked, correct}
    control: null,    // активный итоговый контроль темы: { key } — какая тема сейчас проверяется
    controlFb: {},     // фидбек по вопросам контроля: "key:itemIndex" -> {answered, pick, ok}
    controlDone: null, // результат завершённой попытки: { score, total, pct, passed, firstPass, reward }
    review: null,      // активная сессия повторения: { key, items } — items уже выбраны при старте
    reviewFb: {},      // фидбек по вопросам повторения: "review:i" -> {answered, pick, ok}
    reviewDone: null,  // результат завершённого повторения: { score, total, passed, intervalDays, reward }
  };

  function chapter(id) { return (GAME.chapters || []).find((c) => c.id === id); }

  /* Порядок показа вариантов ответа — перемешан, чтобы правильный ответ не
     оказывался предсказуемо на одной и той же позиции (без этого он часто
     совпадал с первым вариантом). Перемешивание ДЕТЕРМИНИРОВАННОЕ — зависит
     от текста самих вариантов, поэтому один и тот же вопрос при повторной
     отрисовке (после клика, при неверном ответе и т.д.) не "прыгает".
     Возвращает МАССИВ ИСХОДНЫХ ИНДЕКСОВ в новом порядке показа — сами данные
     (options, correct, data-idx) не меняются, поэтому вся логика проверки
     ответа продолжает работать без изменений. */
  function shuffledOrder(options, seedExtra) {
    const seedStr = (seedExtra || "") + "|" + options.join("|");
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++) seed = (Math.imul(seed, 31) + seedStr.charCodeAt(i)) | 0;
    const idx = options.map((_, i) => i);
    function rnd() {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
    }
    return idx;
  }

  /* Сортирует главы в порядке прохождения сюжета — по цепочке requires,
     а не по тому, в каком файле/порядке они были определены в коде.
     Обходом в глубину от «корней» (глав без requires внутри этого же
     набора — включая случай, когда requires ссылается на главу из
     другого класса, как у 8 класса). Если сюжет ветвится (несколько
     глав требуют одну и ту же предыдущую — как в 9 классе после
     «Скорости звука»), одна ветка показывается полностью, затем другая,
     в порядке их изначального определения — а не вперемешку. */
  function sortChaptersByStory(list) {
    const idSet = new Set(list.map((c) => c.id));
    const byId = {}; list.forEach((c) => { byId[c.id] = c; });
    const origIndex = {}; list.forEach((c, i) => { origIndex[c.id] = i; });
    const children = {};
    list.forEach((c) => {
      if (c.requires && idSet.has(c.requires)) {
        (children[c.requires] = children[c.requires] || []).push(c.id);
      }
    });
    const roots = list.filter((c) => !c.requires || !idSet.has(c.requires));
    const visited = new Set();
    const result = [];
    function visit(id) {
      if (visited.has(id)) return;
      visited.add(id);
      result.push(byId[id]);
      (children[id] || []).slice().sort((a, b) => origIndex[a] - origIndex[b]).forEach(visit);
    }
    roots.forEach((r) => visit(r.id));
    list.forEach((c) => { if (!visited.has(c.id)) result.push(c); }); // страховка от циклов/сирот
    return result;
  }

  let selectedClass = null; // выбор класса на экране создания
  let greeted = false;      // наставник поздоровался в этой сессии
  let introStep = 0;        // текущий шаг пролога (холодный старт)
  let creationReady = false; // пролог пройден -> показываем создание героя
  const celebrateQueue = [];
  let overlayShown = false;

  /* ---------- утилиты ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function topic(id) { return GAME.topics.find((t) => t.id === id); }
  function world(id) { return GAME.worlds.find((w) => w.id === id); }

  // Склонение «день/дня/дней» по числу (1 день, 2 дня, 5 дней, 11 дней, 21 день...)
  function dayWord(n) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a >= 11 && a <= 14) return "дней";
    if (b === 1) return "день";
    if (b >= 2 && b <= 4) return "дня";
    return "дней";
  }

  function parseNum(s) {
    if (s == null) return NaN;
    return parseFloat(String(s).replace(",", ".").replace(/\s/g, "").replace("−", "-"));
  }
  function checkNum(val, ans, tol) {
    if (isNaN(val)) return false;
    const t = tol != null ? tol : 0.01;
    return Math.abs(val - ans) <= t + 1e-9;
  }

  /* акцентный цвет (из Лавки) -> CSS-переменные */
  function setAccent() {
    const c = State.accentColor();
    document.documentElement.style.setProperty("--accent", c);
    let c2 = "#a06bff";
    if (c.toLowerCase() === "#a06bff") c2 = "#38e1ff";
    document.documentElement.style.setProperty("--accent-2", c2);
  }

  /* ---------- звук (WebAudio, без файлов) ---------- */
  let actx = null;
  function tone(type) {
    if (!State.data.settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.connect(g); g.connect(actx.destination);
      const now = actx.currentTime;
      o.type = (type === "flip" || type === "nav") ? "triangle" : "sine";
      if (type === "correct") { o.frequency.setValueAtTime(660, now); o.frequency.exponentialRampToValueAtTime(990, now + 0.12); }
      else if (type === "wrong") { o.frequency.setValueAtTime(300, now); o.frequency.exponentialRampToValueAtTime(160, now + 0.18); }
      else if (type === "win") { o.frequency.setValueAtTime(523, now); o.frequency.setValueAtTime(784, now + 0.12); o.frequency.setValueAtTime(1046, now + 0.24); }
      else if (type === "achieve") { o.frequency.setValueAtTime(660, now); o.frequency.setValueAtTime(880, now + 0.1); o.frequency.setValueAtTime(1175, now + 0.2); }
      else if (type === "flip") { o.frequency.setValueAtTime(520, now); o.frequency.exponentialRampToValueAtTime(720, now + 0.06); }
      else if (type === "nav") { o.frequency.setValueAtTime(360, now); o.frequency.exponentialRampToValueAtTime(300, now + 0.08); }
      const longS = (type === "win" || type === "achieve"), shortS = (type === "flip" || type === "nav");
      const peak = shortS ? 0.07 : 0.16, dur = longS ? 0.4 : (shortS ? 0.1 : 0.25);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(peak, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.start(now); o.stop(now + dur + 0.03);
    } catch (e) { /* звук не критичен */ }
  }

  /* ---------- фоновая музыка (Web Audio, мягкая пентатоника) ---------- */
  const Music = {
    ctx: null, master: null, timer: null, step: 0, playing: false,
    seq: [392.00, 523.25, 659.25, 587.33, 523.25, 440.00, 392.00, 0, 440.00, 523.25, 587.33, 659.25, 523.25, 392.00, 329.63, 0],
    start() {
      if (this.playing) return;
      try {
        this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === "suspended") this.ctx.resume();
        this.master = this.ctx.createGain(); this.master.gain.value = 0.05; this.master.connect(this.ctx.destination);
        this.playing = true; this.step = 0;
        const loop = () => { if (!this.playing) return; this.note(this.seq[this.step % this.seq.length]); this.step++; this.timer = setTimeout(loop, 520); };
        loop();
      } catch (e) { /* музыка не критична */ }
    },
    note(freq) {
      if (!freq || !this.ctx) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = "triangle"; o.frequency.value = freq; o.connect(g); g.connect(this.master);
      const now = this.ctx.currentTime;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.6, now + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      o.start(now); o.stop(now + 0.55);
    },
    stop() { this.playing = false; if (this.timer) { clearTimeout(this.timer); this.timer = null; } },
  };
  function startMusicIfEnabled() { if (State.data.settings.music && !Music.playing) Music.start(); }

  /* ---------- тосты ---------- */
  function toastBox() {
    let b = document.getElementById("toasts");
    if (!b) { b = document.createElement("div"); b.id = "toasts"; document.body.appendChild(b); }
    return b;
  }
  function toast(opts) {
    const el = document.createElement("div");
    el.className = "toast " + (opts.cls || "");
    el.innerHTML =
      `<span class="t-ico">${opts.ico || "✨"}</span>
       <span><span class="t-strong">${esc(opts.strong || "")}</span>${opts.sub ? `<br><span class="t-sub">${esc(opts.sub)}</span>` : ""}</span>`;
    toastBox().appendChild(el);
    const ttl = opts.ttl || 3000;
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 360); }, ttl);
  }
  function grantToast(g) {
    if (!g || !g.xp) return;
    toast({ ico: "⭐", strong: `+${g.xp} XP`, sub: g.coins ? `+${g.coins} монет` : "", cls: "gold", ttl: 1700 });
  }

  /* ---------- наставник ---------- */
  function mentorSay(text) {
    const old = document.getElementById("mentor-pop");
    if (old) old.remove();
    const el = document.createElement("div");
    el.id = "mentor-pop";
    el.className = "mentor-pop";
    el.innerHTML =
      `<button class="mp-close" aria-label="Закрыть">×</button>
       <div class="mp-avatar">${GAME.mentor.avatar}</div>
       <div><div class="mp-name">${esc(GAME.mentor.name)}</div><div class="mp-text">${esc(text)}</div></div>`;
    el.querySelector(".mp-close").addEventListener("click", () => { el.classList.add("out"); setTimeout(() => el.remove(), 360); });
    document.body.appendChild(el);
    clearTimeout(mentorSay._t);
    mentorSay._t = setTimeout(() => { if (el.parentNode) { el.classList.add("out"); setTimeout(() => el.remove(), 360); } }, 8000);
  }

  /* ---------- праздничный оверлей (уровень / босс) ---------- */
  function enqueueCelebrate(data) { celebrateQueue.push(data); if (!overlayShown) showNextCelebrate(); }
  function showNextCelebrate() {
    if (!celebrateQueue.length) { overlayShown = false; return; }
    overlayShown = true;
    const data = celebrateQueue.shift();
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML =
      `<div class="celebrate">
         <div class="cel-emoji">${data.emoji}</div>
         <h2>${esc(data.title)}</h2>
         <div class="cel-sub">${esc(data.sub || "")}</div>
         <div class="cel-mentor">«${esc(data.mentor || "")}»</div>
         <button class="btn btn-primary" data-cel-close>Продолжить</button>
       </div>`;
    document.body.appendChild(ov);
    sparks(); confetti(40);
    const close = () => { ov.remove(); showNextCelebrate(); };
    ov.querySelector("[data-cel-close]").addEventListener("click", close);
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  }
  function sparks() {
    const colors = ["#38e1ff", "#a06bff", "#ffd166", "#ff5d8f", "#4ade80"];
    for (let i = 0; i < 18; i++) {
      const s = document.createElement("div");
      s.className = "spark";
      s.style.background = pick(colors);
      s.style.left = (50 + (Math.random() * 40 - 20)) + "%";
      s.style.top = "45%";
      document.body.appendChild(s);
      const dx = (Math.random() * 2 - 1) * 240, dy = (Math.random() * -1 - 0.2) * 260;
      s.animate(
        [{ transform: "translate(0,0) rotate(0)", opacity: 1 },
         { transform: `translate(${dx}px,${dy + 200}px) rotate(${Math.random() * 540}deg)`, opacity: 0 }],
        { duration: 900 + Math.random() * 500, easing: "cubic-bezier(.2,.7,.3,1)" }
      ).onfinish = () => s.remove();
    }
  }

  /* ---------- обработка событий из State ---------- */
  function flushEvents() {
    const events = State.takeEvents();
    for (const e of events) {
      if (e.type === "levelup") {
        enqueueCelebrate({ emoji: "🎚️", title: `Уровень ${e.payload.level}!`, sub: e.payload.title, mentor: pick(GAME.mentor.lines.levelUp) });
        tone("win");
      } else if (e.type === "achievement") {
        tone("achieve");
        toast({ ico: e.payload.icon, strong: "Достижение получено!", sub: e.payload.title, cls: "gold", ttl: 3600 });
      } else if (e.type === "topicComplete") {
        const r = e.payload.reward || {};
        toast({ ico: "🏁", strong: "Тема пройдена!", sub: r.xp ? `+${r.xp} XP, +${r.coins} монет` : "", cls: "green", ttl: 3200 });
        mentorSay(pick(GAME.mentor.lines.topicDone));
      } else if (e.type === "bossWin") {
        const t = topic(e.payload.topicId);
        enqueueCelebrate({ emoji: "👑", title: "Босс повержен!", sub: t ? t.boss.title : "", mentor: pick(GAME.mentor.lines.bossWin) });
        tone("win");
      } else if (e.type === "item") {
        toast({ ico: e.payload.icon, strong: "Получен артефакт!", sub: e.payload.name, cls: "gold", ttl: 3600 });
      } else if (e.type === "missionComplete") {
        const r = e.payload.reward || {};
        toast({ ico: "🎯", strong: "Миссия пройдена!", sub: r.xp ? `+${r.xp} XP, +${r.coins} монет` : "", cls: "green", ttl: 3200 });
        mentorSay(pick(GAME.mentor.lines.topicDone));
      } else if (e.type === "chapterComplete") {
        const r = e.payload.reward || {};
        enqueueCelebrate({
          emoji: "🏆",
          title: "Глава пройдена!",
          sub: e.payload.title + (r.xp ? ` · +${r.xp} XP, +${r.coins} монет` : ""),
          mentor: pick(GAME.mentor.lines.bossWin),
        });
        tone("win");
      }
    }
  }

  /* ============================================================
     HUD (верхняя панель героя)
     ============================================================ */
  // Конфетти при завершении (лёгкие DOM-частицы)
  function confetti(n) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    n = n || 30;
    const layer = document.createElement("div"); layer.className = "confetti-layer"; layer.setAttribute("aria-hidden", "true");
    const colors = ["#38e1ff", "#7ee787", "#ffd166", "#ff7ad9", "#a06bff", "#ffb84d"];
    const stars = ["⭐", "✨", "💫", "🌟"];
    for (let i = 0; i < n; i++) {
      const b = document.createElement("i"); b.className = "confetti-bit";
      b.style.left = (Math.random() * 100) + "%";
      b.style.animationDelay = (Math.random() * 0.4) + "s";
      b.style.animationDuration = (1.5 + Math.random() * 1.3) + "s";
      b.style.setProperty("--spin", (Math.random() * 900 - 450) + "deg");
      const r = Math.random();
      if (r < 0.16) { b.classList.add("emoji"); b.textContent = stars[i % stars.length]; }
      else {
        b.style.background = colors[i % colors.length];
        const w = 6 + Math.random() * 7;
        if (r < 0.55) { b.classList.add("round"); b.style.width = w + "px"; b.style.height = w + "px"; }
        else { b.style.width = w + "px"; b.style.height = (10 + Math.random() * 9) + "px"; }
      }
      layer.appendChild(b);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3600);
  }
  // Всплывающее «+N XP» у HUD
  function floatXP(n) {
    if (!n) return; const host = root.querySelector(".hud"); if (!host) return;
    const f = document.createElement("div"); f.className = "xp-float"; f.textContent = "+" + n + " XP";
    host.appendChild(f); setTimeout(() => f.remove(), 1300);
  }
  // Частицы фона для страниц классов/миров
  function fxDots(n) {
    let s = "";
    for (let i = 0; i < (n || 14); i++) {
      const sz = (3 + Math.random() * 5).toFixed(1);
      s += `<i style="left:${(Math.random() * 100).toFixed(1)}%;top:${(Math.random() * 100).toFixed(1)}%;width:${sz}px;height:${sz}px;animation-delay:${(Math.random() * 8).toFixed(1)}s;animation-duration:${(8 + Math.random() * 10).toFixed(1)}s"></i>`;
    }
    return `<div class="screen-fx" aria-hidden="true">${s}</div>`;
  }
  // Пути к фото (авто-подхват из папки images/, иначе — наш SVG)
  function photoMission(key) { return `images/topic-${String(key).replace(":", "-")}.jpg`; }
  function photoRealm(id) { return `images/realm-${id}.jpg`; }
  function autoPhoto(src) {
    return `<img class="auto-photo" src="${src}" alt="" onload="this.parentNode.classList.add('has-photo')" onerror="this.remove()">`;
  }

  function streakChip() {
    const s = State.streakInfo();
    let ico = "🔥", cls = "streak-active", title = "Серия дней подряд";
    if (s.status === "at_risk") { ico = "⚠️🔥"; cls = "streak-risk"; }
    else if (s.status === "broken" || s.status === "none") { ico = "🔥"; cls = "streak-off"; }
    return `<button class="hud-chip ${cls}" data-act="streak-info" title="${esc(title)}"><span class="ico">${ico}</span>${s.count}</button>`;
  }

  function hudHTML() {
    const hero = State.data.hero;
    const li = State.levelInfo();
    const avatar = State.equippedAvatarIcon();
    const cls = State.heroClass();
    return `
      <header class="hud">
        <div class="hud-avatar" title="${esc(cls ? cls.name : "")}">${avatar}</div>
        <div class="hud-main">
          <div class="hud-row1">
            <span class="hud-name">${esc(hero.name)}</span>
            <span class="hud-level">Ур. ${li.level}</span>
            <span class="hud-title">${esc(li.title)}</span>
          </div>
          <div class="hud-bar bar bar-xp" aria-label="Опыт">
            <div class="bar-fill" style="width:${li.percent}%"></div>
          </div>
        </div>
        <div class="hud-stats">
          <span class="hud-chip coins" title="Монеты"><span class="ico">🪙</span>${hero.coins}</span>
          ${streakChip()}
          <span class="hud-chip studied" title="Изучено тем"><span class="ico">📚</span>${State.topicsStudied()}/${State.totalTopics()}</span>
          <span class="hud-chip quests" title="Квесты сегодня"><span class="ico">🏆</span>${State.questDoneCount()}/${((typeof window!=="undefined"&&window.QUEST_DEFS)||[]).length}</span>
          <button class="hud-sound" data-act="toggle-sound" title="Звуки">${State.data.settings.sound ? "🔊" : "🔇"}</button>
          <button class="hud-sound" data-act="toggle-music" title="Музыка">${State.data.settings.music ? "🎵" : "🔕"}</button>
        </div>
      </header>`;
  }
  function updateHUD() {
    const old = root.querySelector(".hud");
    if (!old) return;
    const oldFill = old.querySelector(".bar-xp .bar-fill");
    const oldW = oldFill ? oldFill.style.width : null;
    const tmp = document.createElement("div");
    tmp.innerHTML = hudHTML();
    const neo = tmp.firstElementChild;
    const newFill = neo.querySelector(".bar-xp .bar-fill");
    const targetW = newFill ? newFill.style.width : null;
    if (newFill && oldW != null) newFill.style.width = oldW; // старт с прежнего значения
    old.replaceWith(neo);
    if (newFill && targetW != null) requestAnimationFrame(() => { newFill.style.width = targetW; }); // плавная доводка
  }

  // Прогресс ежедневных квестов: засчитать действие и показать награду
  function bumpQuest(metric, n) {
    if (!State.data.hero) return;
    const done = State.questBump(metric, n || 1);
    if (done && done.length) {
      done.forEach((q) => toast({ ico: q.icon || "🏆", strong: "Квест выполнен: " + q.label, sub: "+" + q.xp + " XP · +" + q.coins + " 🪙", cls: "green", ttl: 2800 }));
      updateHUD(); tone("win"); confetti(28);
    }
  }

  // Экспорт сохранения в JSON-файл (скачивается)
  function doExport() {
    try {
      const blob = new Blob([State.exportData()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const d = new Date();
      a.href = url;
      a.download = "fizmat-save-" + d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate() + ".json";
      document.body.appendChild(a); a.click();
      setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (_) {} }, 150);
      toast({ ico: "💾", strong: "Сохранение скачано", sub: a.download, cls: "green", ttl: 2800 });
    } catch (e) { toast({ ico: "⚠️", strong: "Не удалось экспортировать", ttl: 2600 }); }
  }
  // Импорт сохранения из JSON-файла (с подтверждением и проверкой)
  function doImport() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "application/json,.json";
    inp.addEventListener("change", () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let parsed;
        try { parsed = JSON.parse(reader.result); }
        catch (e) { toast({ ico: "⚠️", strong: "Файл повреждён", sub: "Это не похоже на сохранение игры", ttl: 3200 }); return; }
        if (!window.confirm("Импорт ЗАМЕНИТ текущий прогресс на загруженный. Отменить будет нельзя. Продолжить?")) return;
        if (State.importData(parsed)) {
          toast({ ico: "✅", strong: "Прогресс загружен!", cls: "green", ttl: 1800 });
          setTimeout(() => { try { location.reload(); } catch (_) { render(); } }, 600);
        } else {
          toast({ ico: "⚠️", strong: "Неверный файл сохранения", sub: "Не найдены нужные данные игры", ttl: 3200 });
        }
      };
      reader.readAsText(file);
    });
    inp.click();
  }

  // Блок ежедневных квестов (на главном экране класса)
  function questsBlockHTML() {
    const list = State.questProgress();
    if (!list.length) return "";
    const doneN = list.filter((x) => x.done).length;
    const rows = list.map(({ q, val, done }) =>
      `<div class="quest-row ${done ? "done" : ""}">
         <span class="quest-ico">${done ? "✅" : q.icon}</span>
         <span class="quest-main"><span class="quest-label">${esc(q.label)}</span>
           <span class="quest-bar"><span class="quest-bar-fill" style="width:${Math.round(val / q.target * 100)}%"></span></span></span>
         <span class="quest-rew">${done ? "готово" : val + "/" + q.target}</span>
       </div>`).join("");
    return `<div class="quests-block">
        <div class="quests-head"><span>🗓️ Ежедневные квесты</span><span class="quests-count">${doneN}/${list.length}</span></div>
        ${rows}
        ${doneN === list.length ? `<div class="quests-alldone">🎉 Все квесты на сегодня выполнены — возвращайся завтра!</div>` : ""}
      </div>`;
  }

  function tabsHTML() {
    const gradeViews = ["grade", "worlds", "chapters", "practice", "problems", "exam", "realm", "course", "course-mission", "trainer", "scene", "adventure", "topic", "world", "map"];
    const inGrade = gradeViews.indexOf(ui.view) >= 0;
    const g = (n, ico) => `<button class="tab ${inGrade && ui.gradeSel === n ? "active" : ""}" data-act="open-grade" data-grade="${n}">
         <span class="ico">${ico}</span><span>${n} класс</span></button>`;
    const t = (view, ico, label, on) => `<button class="tab ${on ? "active" : ""}" data-act="go" data-view="${view}">
         <span class="ico">${ico}</span><span>${label}</span></button>`;
    return `<nav class="tabs">
      ${g(7, "📘")}${g(8, "📗")}${g(9, "📙")}
      ${t("cabinet", "🔬", "Лаборатория", ui.view === "cabinet")}
      ${t("shop", "🛒", "Лавка", ui.view === "shop")}
    </nav>`;
  }

  /* ============================================================
     ЭКРАН: пролог (холодный старт сценой)
     ============================================================ */
  function viewPrologue() {
    const steps = GAME.prologue || [];
    if (!steps.length) { creationReady = true; return viewCreation(); }
    const i = Math.min(introStep, steps.length - 1);
    const step = steps[i];
    const last = i >= steps.length - 1;
    return `
      <div class="scene prologue" style="--w-accent:#38e1ff">
        <div class="vn-top">
          <span class="vn-progress">Пролог · ${i + 1}/${steps.length}</span>
          <a class="vn-back" data-act="intro-skip">Пропустить →</a>
        </div>
        <div class="prologue-title">ФизМат RPG</div>
        <div class="prologue-sub">Хроники научных миров</div>
        <div class="vn-stage">
          <div class="vn-portrait has-char">${newton(step.mood)}</div>
          <div class="vn-box">
            <div class="vn-name">Ньютончик</div>
            <div class="vn-text">${esc(step.text)}</div>
            <div class="vn-actions"><button class="btn btn-primary" data-act="intro-next">${last ? "Создать исследователя →" : "Дальше ▶"}</button></div>
          </div>
        </div>
      </div>`;
  }

  /* ============================================================
     ЭКРАН: создание героя
     ============================================================ */
  function viewCreation() {
    return `
      <section class="creation">
        <div class="logo">🔬⚛️🚀</div>
        <h1>ФизМат RPG</h1>
        <p class="tagline">Прокачай знания. Открой законы Вселенной. Стань мастером науки.</p>

        <div class="lore">
          <div class="lore-title">🔷 ${esc(GAME.story.title)}</div>
          ${GAME.story.intro.map((p) => `<p>${esc(p)}</p>`).join("")}
          <p class="lore-motto">${esc(GAME.story.motto)}</p>
        </div>

        <div class="intro-goals">
          <div class="intro-goals-h">🤔 Ты наверняка замечал</div>
          <ul class="intro-goals-list">
            <li>Почему в резко тормозящем автобусе тебя <b>кидает вперёд</b>, хотя ты просто стоишь</li>
            <li>Почему <b>лёд плавает</b> в стакане, а камешек сразу идёт ко дну</li>
            <li>Почему <b>рюкзак с узкими лямками</b> режет плечи, а с широкими — нет</li>
            <li>Почему <b>тяжеленный корабль</b> держится на воде, а гвоздь тонет</li>
          </ul>
          <div class="intro-goals-note">Физика — это и есть ответы на такие вопросы.</div>
        </div>

        <div class="intro-can">
          <div class="intro-can-h">💪 К концу курса ты сможешь</div>
          <ul class="intro-can-list">
            <li>Посмотреть на любую ситуацию вокруг и <b>объяснить, что там происходит</b> — своими словами, а не заученной фразой</li>
            <li><b>Решать задачи</b> из учебника и контрольных: не подставлять формулы наугад, а понимать, какая нужна и почему</li>
            <li><b>Прикинуть в уме</b>, выдержит ли лёд, хватит ли силы сдвинуть шкаф, во сколько раз опаснее авария на большой скорости</li>
            <li><b>Не бояться физики</b> — когда понимаешь, откуда берётся формула, её не нужно зубрить</li>
          </ul>
        </div>

        <div class="field">
          <label for="hero-name">Имя героя</label>
          <input id="hero-name" type="text" maxlength="20" placeholder="Например: Алекс" autocomplete="off">
        </div>

        <div class="field" style="max-width:none">
          <label>Выбери класс</label>
          <div class="class-grid">
            ${GAME.classes.map((c) => `
              <button class="class-card" data-act="pick-class" data-id="${c.id}">
                <div class="cc-ico">${c.icon}</div>
                <div class="cc-name">${esc(c.name)}</div>
                <div class="cc-bonus">${esc(c.bonusText)}</div>
                <div class="cc-blurb">${esc(blurbOf(c))}</div>
              </button>`).join("")}
          </div>
        </div>

        <button class="btn btn-primary" data-act="create-hero" style="font-size:17px;padding:14px 28px">
          🚀 Начать приключение
        </button>
      </section>`;
  }

  /* ============================================================
     ЭКРАН: карта миров (звёздная карта)
     ============================================================ */
  function viewMap() {
    // Сколько частей Источника уже собрано = число полностью пройденных миров.
    let collected = 0;
    GAME.worlds.forEach((w) => {
      if (w.status !== "open") return;
      const ts = State.topicsOfWorld(w.id);
      if (ts.length && ts.every((t) => State.data.progress[t.id] && State.data.progress[t.id].completed)) collected++;
    });
    const totalShards = GAME.worlds.length;

    const nodes = GAME.worlds.map((w) => {
      const open = w.status === "open";
      const topics = State.topicsOfWorld(w.id);
      const done = topics.filter((t) => State.data.progress[t.id] && State.data.progress[t.id].completed).length;
      const allDone = open && topics.length && done === topics.length;
      const inProgress = open && done > 0 && !allDone;
      const cls = !open ? "locked" : inProgress ? "current" : "open";
      let badge = open
        ? (allDone ? `<span class="badge done">Пройден</span>` : `<span class="badge open">Открыт</span>`)
        : `<span class="badge soon">Скоро</span>`;
      const prog = open && topics.length ? `<div class="wc-progress">Прогресс: ${done} / ${topics.length} тем</div>` : "";
      return `
        <div class="world-node ${cls}" style="--w-accent:${w.accent}">
          <div class="node-orb">${w.icon}</div>
          <div class="world-card" ${open ? `data-act="open-world" data-id="${w.id}"` : `data-act="locked-world"`}>
            <div class="wc-top"><span class="wc-name">${esc(w.name)}</span>${badge}</div>
            <div class="wc-blurb">${esc(w.blurb)}</div>
            ${prog}
          </div>
        </div>`;
    }).join("");

    return `
      <div class="screen-head">
        <h2>🗺️ Карта миров</h2>
        <div class="sub">Путь исследователя: от механики — к звёздам. Проходи миры и собирай части Источника Знаний.</div>
        <div class="shard-bar">🔷 Части Источника: ${collected} / ${totalShards}</div>
      </div>
      <div class="starmap">${nodes}</div>`;
  }

  /* ============================================================
     ЭКРАН: мир (список тем)
     ============================================================ */
  function viewWorld() {
    const w = world(ui.worldId);
    const topics = State.topicsOfWorld(w.id);
    const rows = topics.map((t) => {
      const p = State.data.progress[t.id];
      const unlocked = State.isTopicUnlocked(t.id);
      const completed = p && p.completed;
      const sd = State.topicStageDone(t.id);
      const stages = [sd.theory, sd.experiment, (sd.questions && sd.problems), sd.boss];
      const pips = stages.map((on) => `<span class="pip ${on ? "on" : ""}"></span>`).join("");
      const cls = completed ? "done unlocked" : unlocked ? "unlocked" : "locked";
      const right = completed
        ? `<span class="badge done">✓ Пройдена</span>`
        : unlocked ? `<span class="badge open">Доступна</span>` : `🔒`;
      return `
        <div class="topic-row ${cls}" ${unlocked ? `data-act="open-topic" data-id="${t.id}"` : `data-act="locked-topic"`}>
          <div class="topic-ico">${t.questEmoji || t.icon}</div>
          <div class="topic-meta">
            <div class="tname">${esc(t.quest || t.title)}</div>
            <div class="ttag">${esc(t.title)}${t.tagline ? " · " + esc(t.tagline) : ""}</div>
            <div class="topic-mini">${pips}</div>
          </div>
          <div class="topic-right">${right}</div>
        </div>`;
    }).join("");

    return `
      <div class="crumbs">
        <a data-act="go" data-view="map">Карта</a><span class="sep">›</span><span>${esc(w.name)}</span>
      </div>
      <div class="screen-head"><h2>${w.icon} ${esc(w.name)}</h2><div class="sub">${esc(w.blurb)}</div></div>
      <div class="topic-list">${rows}</div>`;
  }

  /* ============================================================
     ЭКРАН: тема (консоль миссии, 4 этапа)
     ============================================================ */
  function viewTopic() {
    const t = topic(ui.topicId);
    const w = world(t.worldId);
    const p = State.ensureTopic(t.id);
    const sd = State.topicStageDone(t.id);

    const stages = [
      { id: "theory", step: "Этап 1", ico: "🔍", name: "Изучение", done: sd.theory },
      { id: "experiment", step: "Этап 2", ico: "🧪", name: "Эксперимент", done: sd.experiment },
      { id: "training", step: "Этап 3", ico: "⚔️", name: "Испытание", done: sd.questions && sd.problems },
      { id: "boss", step: "Этап 4", ico: "🌋", name: "Прорыв", done: sd.boss },
    ];
    const tracker = `<div class="stages">${stages.map((s) =>
      `<button class="stage-tab ${ui.stage === s.id ? "active" : ""} ${s.done ? "done" : ""}" data-act="stage" data-stage="${s.id}">
         <span class="st-step">${s.step}</span><span class="st-ico">${s.ico}</span><span class="st-name">${s.name}</span>
       </button>`).join("")}</div>`;

    let body = "";
    if (ui.stage === "theory") body = stageTheory(t, p);
    else if (ui.stage === "experiment") body = stageExperiment(t, p);
    else if (ui.stage === "training") body = stageTraining(t, p);
    else if (ui.stage === "boss") body = stageBoss(t, p);

    return `
      <div class="crumbs">
        <a data-act="go" data-view="map">Карта</a><span class="sep">›</span>
        <a data-act="go" data-view="world" data-id="${w.id}">${esc(w.name)}</a><span class="sep">›</span>
        <span>${esc(t.title)}</span>
      </div>
      <div class="console-head">
        <div class="ch-ico">${t.questEmoji || t.icon}</div>
        <div><h2>${esc(t.quest || t.title)}</h2><div class="ch-tag">${esc(t.title)} · ${esc(t.tagline)}</div></div>
      </div>
      ${(window.FullTopic && FullTopic.topics && FullTopic.topics[t.id]) ? `
      <button class="btn btn-gold" style="width:100%;margin-bottom:14px" data-act="full-topic" data-id="${t.id}">
        🎓 Пройти тему полностью — 9 методических этапов
      </button>` : ""}
      ${tracker}
      ${body}`;
  }

  function stageTheory(t, p) {
    const cards = t.theory.map((c, i) => `
      <div class="flip ${p.theory[i] ? "read" : ""}" data-act="flip" data-card="${i}">
        <div class="flip-inner">
          <div class="flip-face flip-front">
            <div class="tf-emoji">${c.emoji}</div>
            <div class="tf-title">${esc(c.title)}</div>
            <div class="tf-hint">нажми, чтобы открыть</div>
          </div>
          <div class="flip-face flip-back">
            <div class="tf-text">${esc(c.text)}</div>
            ${c.formula ? `<div class="tf-formula">${esc(c.formula)}</div>` : ""}
            <div class="tf-example">💡 ${esc(c.example)}</div>
          </div>
        </div>
      </div>`).join("");
    return `
      <div class="panel">
        <h3>📖 Теория</h3>
        <p class="panel-intro">Переверни все карточки, чтобы изучить тему. За каждую — опыт.</p>
        <div class="theory-grid">${cards}</div>
      </div>`;
  }

  function stageExperiment(t, p) {
    const ex = t.experiment;
    const done = p.experiment;
    const steps = ex.steps.map((s) => `<li>${esc(s)}</li>`).join("");
    let predictBlock;
    if (done) {
      predictBlock = `
        <div class="feedback ok"><span class="fb-ico">✅</span>
          <div><b>Эксперимент пройден.</b> ${esc(ex.predict.explain)}</div></div>`;
    } else {
      const opts = shuffledOrder(ex.predict.options, ex.predict.q).map((i) => {
        const o = ex.predict.options[i];
        const fb = ui.fb["predict"];
        const wrong = fb && fb.choice === i;
        return `<button class="option ${wrong ? "wrong" : ""}" data-act="answer-predict" data-idx="${i}">${esc(o)}</button>`;
      }).join("");
      const fb = ui.fb["predict"];
      const fbBlock = fb ? `<div class="feedback no"><span class="fb-ico">🤔</span><div>Не совсем. ${esc(ex.predict.explain.split(".")[0])}. Попробуй ещё раз.</div></div>` : "";
      predictBlock = `
        <div class="q-text">${esc(ex.predict.q)}</div>
        <div class="options">${opts}</div>${fbBlock}`;
    }
    return `
      <div class="panel">
        <h3>🧪 ${esc(ex.title)}</h3>
        <p class="panel-intro">${esc(ex.intro)}</p>
        <ol class="exp-steps">${steps}</ol>
        <div class="exp-insight">🔎 ${esc(ex.insight)}</div>
        ${predictBlock}
      </div>`;
  }

  function stageTraining(t, p) {
    const qDone = p.questions.filter(Boolean).length;
    const pDone = p.problems.filter(Boolean).length;

    const quiz = t.questions.map((q, i) => {
      const answered = p.questions[i];
      const fb = ui.fb["q:" + i];
      const opts = shuffledOrder(q.options, q.q).map((oi) => {
        const o = q.options[oi];
        let c = "";
        if (answered) c = oi === q.correct ? "correct" : "";
        else if (fb && fb.choice === oi) c = "wrong";
        return `<button class="option ${c}" ${answered ? "disabled" : ""} data-act="answer-q" data-q="${i}" data-idx="${oi}">${esc(o)}</button>`;
      }).join("");
      let feedback = "";
      if (answered) feedback = `<div class="feedback ok"><span class="fb-ico">✅</span><div>${esc(q.explain)}</div></div>`;
      else if (fb) feedback = `<div class="feedback no"><span class="fb-ico">💡</span><div>${esc(q.explain)} Попробуй ещё раз.</div></div>`;
      return `
        <div class="panel" style="margin-bottom:12px">
          <div class="q-progress">Вопрос ${i + 1} из ${t.questions.length}</div>
          <div class="q-text">${esc(q.q)}</div>
          <div class="options">${opts}</div>${feedback}
        </div>`;
    }).join("");

    const probs = t.problems.map((pr, i) => {
      const solved = p.problems[i];
      const fb = ui.fb["p:" + i];
      let inner;
      if (solved) {
        inner = `
          <div class="answer-row"><input value="${pr.answer}" disabled><span class="unit">${esc(pr.unit || "")}</span>
            <span class="badge done">✓ Решено</span></div>
          <div class="solution">📘 ${esc(pr.solution)}</div>`;
      } else {
        const fbBlock = fb ? `<div class="feedback no"><span class="fb-ico">🤔</span><div>Пока неверно. Проверь вычисления и попробуй ещё раз.</div></div>` : "";
        inner = `
          <div class="answer-row">
            <input id="inp-p-${i}" type="text" inputmode="decimal" placeholder="Ответ" autocomplete="off">
            <span class="unit">${esc(pr.unit || "")}</span>
            <button class="btn btn-primary btn-sm" data-act="check-problem" data-idx="${i}">Проверить</button>
          </div>${fbBlock}`;
      }
      return `
        <div class="panel" style="margin-bottom:12px">
          <div class="q-progress">Задача ${i + 1} из ${t.problems.length}</div>
          <div class="q-text">${esc(pr.q)}</div>${inner}
        </div>`;
    }).join("");

    return `
      <div class="panel" style="background:transparent;border:none;padding:0;margin-bottom:8px">
        <h3>🎯 Тренировка</h3>
        <p class="panel-intro">Вопросы: ${qDone}/${t.questions.length} · Задачи: ${pDone}/${t.problems.length}</p>
      </div>
      ${quiz}
      <div class="screen-head" style="margin:18px 0 10px"><h3 style="font-size:18px">🧮 Задачи</h3></div>
      ${probs}`;
  }

  function stageBoss(t, p) {
    const b = t.boss;
    if (p.bossDone) {
      const item = GAME.items.find((it) => it.topicId === t.id);
      return `
        <div class="panel boss-panel">
          <div class="boss-defeated">
            <div class="bd-emoji">🏆</div>
            <h3 style="color:var(--bio-green)">Босс повержен!</h3>
            <p>${esc(b.solution)}</p>
            ${item ? `<div class="feedback ok" style="justify-content:center"><span class="fb-ico">${item.icon}</span><div>Получен артефакт: <b>${esc(item.name)}</b></div></div>` : ""}
          </div>
        </div>`;
    }
    const fb = ui.fb["boss"];
    const fbBlock = fb ? `<div class="feedback no"><span class="fb-ico">🛡️</span><div>${esc(pick(GAME.mentor.lines.wrong))}</div></div>` : "";
    return `
      <div class="panel boss-panel">
        <div class="boss-head"><div class="b-ico">${b.emoji}</div><h3>${esc(b.title)}</h3></div>
        <div class="boss-story">${esc(b.story)}</div>
        <div class="answer-row">
          <input id="inp-boss" type="text" inputmode="decimal" placeholder="Твой ответ" autocomplete="off">
          <span class="unit">${esc(b.unit || "")}</span>
          <button class="btn btn-gold" data-act="check-boss">⚔️ Сразиться</button>
        </div>${fbBlock}
      </div>`;
  }

  /* ============================================================
     ЭКРАН: кабинет ученика
     ============================================================ */
  function viewCabinet() {
    const subtabs = [
      { id: "hero", label: "Мой герой" },
      { id: "knowledge", label: "Мои знания" },
      { id: "mistakes", label: "Разбор ошибок" },
      { id: "discoveries", label: "Открытия" },
      { id: "formulas", label: "Формулы" },
      { id: "missions", label: "Задания" },
      { id: "collection", label: "Коллекция" },
    ];
    if (typeof window !== "undefined" && window.FIZMAT_CONFIG && window.FIZMAT_CONFIG.teacherMode) subtabs.push({ id: "teacher", label: "Учителю" });
    const tabs = `<div class="subtabs">${subtabs.map((s) =>
      `<button class="subtab ${ui.cab === s.id ? "active" : ""}" data-act="cab" data-tab="${s.id}">${s.label}</button>`).join("")}</div>`;

    let body = "";
    if (ui.cab === "teacher" && !(window.FIZMAT_CONFIG && window.FIZMAT_CONFIG.teacherMode)) ui.cab = "hero";
    if (ui.cab === "hero") body = cabHero();
    else if (ui.cab === "knowledge") body = cabKnowledge();
    else if (ui.cab === "mistakes") body = cabMistakes();
    else if (ui.cab === "discoveries") body = cabDiscoveries();
    else if (ui.cab === "formulas") body = cabFormulas();
    else if (ui.cab === "missions") body = cabMissions();
    else if (ui.cab === "collection") body = cabCollection();
    else if (ui.cab === "teacher") body = State.data.settings.teacherUnlocked ? viewTeacher() : cabTeacherLock();
    else { ui.cab = "hero"; body = cabHero(); }

    const head = ui.cab === "teacher" ? "" : `<div class="screen-head"><h2>🔬 Лаборатория исследователя</h2></div>`;
    return `${head}${tabs}${body}`;
  }

  /* Лаборатория открытий — собранные законы (и справочник формул к ОГЭ) */
  function cabDiscoveries() {
    const ds = GAME.discoveries || [];
    const have = State.discoveriesUnlocked(), total = State.totalDiscoveries();
    const cards = ds.map((d) => {
      if (State.discoveryUnlocked(d)) {
        return `<div class="disc-card open">
            <div class="disc-ico">${d.icon}</div>
            <div class="disc-body">
              <div class="disc-name">${esc(d.name)}</div>
              <div class="disc-formula">${esc(d.formula)}</div>
              <div class="disc-tag">${esc(d.tagline)}</div>
            </div>
          </div>`;
      }
      return `<div class="disc-card locked">
          <div class="disc-ico">🔒</div>
          <div class="disc-body">
            <div class="disc-name">Закон ещё не открыт</div>
            <div class="disc-formula">? ? ?</div>
            <div class="disc-hint">${esc(d.hint)}</div>
          </div>
        </div>`;
    }).join("");
    return `
      <div class="disc-count">Открыто законов: <b>${have}</b> / ${total}</div>
      <div class="disc-grid">${cards}</div>`;
  }

  /* Разбор ошибок — точечный список того, что решено неверно и ещё не исправлено */
  function cabMistakes() {
    const list = State.mistakesList();
    if (!list.length) {
      return `<div class="mistakes-empty">
          <div class="mistakes-empty-ico">✅</div>
          <div class="mistakes-empty-title">Пока всё решено верно!</div>
          <div class="mistakes-empty-sub">Здесь появятся вопросы, которые ты решил неверно и ещё не пересдал — чтобы не пересматривать всю тему целиком, а только то, что действительно не получилось.</div>
        </div>`;
    }
    const kindLabel = { concept: "🧩 Мини-тест", practice: "✏️ Практика", boss: "👑 Босс главы" };
    const cards = list.map((m) => `
      <div class="mistake-card">
        <div class="mistake-top">
          <span class="mistake-kind">${kindLabel[m.kind] || "Вопрос"}</span>
          <span class="mistake-ch">${esc(m.chTitle || "")} · ${m.grade || 7} класс</span>
        </div>
        <div class="mistake-q">${esc(m.question || "")}</div>
        <div class="mistake-answers">
          <div class="mistake-wrong">Твой ответ: <b>${esc(String(m.wrong ?? "—"))}</b></div>
          <div class="mistake-correct">Правильный: <b>${esc(String(m.correct ?? "—"))}</b></div>
        </div>
        ${m.explain ? `<div class="mistake-explain">${esc(m.explain)}</div>` : ""}
        <button class="mistake-goto" data-act="adv-start" data-ch="${esc(m.chId)}">Пересдать в главе →</button>
      </div>`).join("");
    return `
      <div class="mistakes-count">Не исправлено пока: <b>${list.length}</b></div>
      <div class="mistakes-list">${cards}</div>`;
  }

  /* Справочник формул — шпаргалка по курсу, доступна всегда */
  function cabFormulas() {
    const groups = (GAME.formulas && (GAME.formulas["grade" + ui.gradeSel] || GAME.formulas.grade7)) || [];
    const body = groups.map((g) => {
      const cards = g.items.map((it) =>
        `<div class="fcard">
           <div class="fcard-top"><span class="fcard-name">${esc(it.name)}</span><button class="fcard-copy" data-act="formula-copy" data-f="${esc(it.f)}" title="Копировать">📋</button></div>
           <div class="fcard-f">${esc(it.f)}</div>
           ${it.note ? `<div class="fcard-note">${esc(it.note)}</div>` : ""}
         </div>`).join("");
      return `<div class="fgroup"><div class="fgroup-h">${esc(g.group)}</div><div class="fgrid">${cards}</div></div>`;
    }).join("");
    return `<div class="fintro">📐 Шпаргалка по всем формулам курса — доступна всегда, даже если тема ещё не пройдена. Нажми 📋, чтобы скопировать.</div>${body}`;
  }

  /* Программа по классам — всё в одном месте: главы-истории и темы-практика по классам.
     Сюда же будем добавлять теорию из учебников 7–8–9. */
  /* ============================================================
     КУРС-КАМПАНИЯ (теория-RPG): темы → миссии, формулы → открытия,
     задания → испытания. Контент берётся из GAME.course.
     ============================================================ */
  const MISSION_REWARD = { xp: 30, coins: 10 };

  function courseData() { return GAME.course && GAME.course["grade" + ui.gradeSel]; }
  function courseFlat() {
    const c = courseData(); if (!c) return [];
    const flat = []; let gi = 0;
    (c.sections || []).forEach((sec) => {
      (sec.topics || []).forEach((tp, idx) => { flat.push({ secId: sec.id, sec, idx, tp, key: sec.id + ":" + idx, gi: gi++ }); });
    });
    return flat;
  }
  function missionUnlocked(gi, flat) {
    // Свободный доступ: вся теория открыта (курс работает и как учебник).
    return true;
  }
  function courseGraph(kind) {
    if (kind === "motion") {
      return `<div class="th-graph"><svg viewBox="0 0 360 168" role="img" aria-label="Графики равномерного движения">
        <g transform="translate(8,8)">
          <line x1="22" y1="8" x2="22" y2="118" stroke="#9aa0c7" stroke-width="2"/>
          <line x1="22" y1="118" x2="150" y2="118" stroke="#9aa0c7" stroke-width="2"/>
          <polygon points="22,2 17,12 27,12" fill="#9aa0c7"/>
          <polygon points="156,118 146,113 146,123" fill="#9aa0c7"/>
          <line x1="22" y1="118" x2="138" y2="24" stroke="#38e1ff" stroke-width="3" stroke-linecap="round"/>
          <text x="6" y="14" fill="#eef1ff" font-size="13" font-weight="bold">S</text>
          <text x="150" y="136" fill="#eef1ff" font-size="13" font-weight="bold">t</text>
          <text x="20" y="156" fill="#9aa0c7" font-size="11">путь растёт равномерно</text>
        </g>
        <g transform="translate(196,8)">
          <line x1="22" y1="8" x2="22" y2="118" stroke="#9aa0c7" stroke-width="2"/>
          <line x1="22" y1="118" x2="150" y2="118" stroke="#9aa0c7" stroke-width="2"/>
          <polygon points="22,2 17,12 27,12" fill="#9aa0c7"/>
          <polygon points="156,118 146,113 146,123" fill="#9aa0c7"/>
          <line x1="22" y1="62" x2="138" y2="62" stroke="#ffd166" stroke-width="3" stroke-linecap="round"/>
          <text x="4" y="14" fill="#eef1ff" font-size="13" font-weight="bold">υ</text>
          <text x="150" y="136" fill="#eef1ff" font-size="13" font-weight="bold">t</text>
          <text x="20" y="156" fill="#9aa0c7" font-size="11">скорость постоянна</text>
        </g>
      </svg></div>`;
    }
    return "";
  }
  function renderBlock(b, i, missionKey) {
    if (b.p != null) return `<p class="th-p">${esc(b.p)}</p>`;
    if (b.def != null) return `<div class="th-def">${esc(b.def)}</div>`;
    if (b.f != null) return `<div class="th-formula"><span class="th-f-tag">🔓 Открытие</span><span class="th-f">${esc(b.f)}</span>${b.d ? `<span class="th-fd">${esc(b.d)}</span>` : ""}</div>`;
    if (b.graph != null) return courseGraph(b.graph);
    if (b.note != null) return `<div class="th-note">💡 ${esc(b.note)}</div>`;
    if (b.ex != null) return `<div class="th-ex"><b>Пример.</b> ${esc(b.ex)}</div>`;
    if (b.why != null) return `<div class="th-why"><span class="th-why-tag">💭 Почему так</span><div class="th-why-body">${esc(b.why)}</div></div>`;
    if (b.worked != null) {
      const w = b.worked;
      const steps = (w.steps || []).map((s, i2) => `<div class="th-wstep"><span class="th-wstep-n">${i2 + 1}</span><div>${esc(s)}</div></div>`).join("");
      return `<div class="th-worked">
        <div class="th-worked-tag">✍️ Разбор примера</div>
        ${w.task ? `<div class="th-worked-q">${esc(w.task)}</div>` : ""}
        ${w.given ? `<div class="th-worked-given"><b>Дано:</b> ${esc(w.given)}${w.find ? ` &nbsp;·&nbsp; <b>Найти:</b> ${esc(w.find)}` : ""}</div>` : ""}
        <div class="th-wsteps">${steps}</div>
        ${w.answer ? `<div class="th-worked-ans"><b>Ответ:</b> ${esc(w.answer)}</div>` : ""}
      </div>`;
    }
    if (b.table != null) {
      const tb = b.table;
      const head = (tb.headers || []).map((h) => `<th>${esc(h)}</th>`).join("");
      const rows = (tb.rows || []).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
      return `<div class="th-table-wrap">
        ${tb.caption ? `<div class="th-table-cap">${esc(tb.caption)}</div>` : ""}
        <table class="th-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
      </div>`;
    }
    if (b.drill != null) {
      const d = b.drill;
      const fbKey = missionKey + ":" + i;
      const fb = (ui.drillFb && ui.drillFb[fbKey]) || {};
      const label = d.label || "🎯 Потренируйся";
      let body;
      if (fb.checked) {
        body = `<div class="th-drill-fb ${fb.correct ? "ok" : "bad"}">
            ${fb.correct ? "✔ Верно!" : `✗ Пока не так. Правильный ответ: <b>${esc(String(d.answer))}${d.unit ? " " + esc(d.unit) : ""}</b>`}
          </div>
          ${d.solution ? `<div class="th-drill-sol">${esc(d.solution)}</div>` : ""}
          ${fb.correct ? "" : `<button class="btn btn-ghost btn-sm" data-act="course-drill-retry" data-key="${esc(fbKey)}">↺ Попробовать снова</button>`}`;
      } else {
        body = `<div class="th-drill-answer">
            <input id="drill-inp-${esc(fbKey.replace(/[^a-zA-Z0-9]/g, "_"))}" class="ft-input th-drill-input" inputmode="decimal" autocomplete="off" placeholder="Ответ" data-drillkey="${esc(fbKey)}">
            ${d.unit ? `<span class="ft-unit">${esc(d.unit)}</span>` : ""}
            <button class="btn btn-primary btn-sm" data-act="course-drill-check" data-key="${esc(fbKey)}">Проверить</button>
          </div>`;
      }
      return `<div class="th-drill">
          <div class="th-drill-tag">${esc(label)}</div>
          <div class="th-drill-q">${esc(d.q)}</div>
          ${d.svg ? `<div class="th-drill-svg">${d.svg}</div>` : ""}
          ${body}
        </div>`;
    }
    if (b.list != null) return `<ul class="th-list">${b.list.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    if (b.explore != null) {
      const ex = b.explore;
      const fbKey = missionKey + ":" + i;
      const fb = (ui.drillFb && ui.drillFb[fbKey]) || {};
      let body;
      if (fb.checked) {
        const picked = fb.pick;
        const opts = shuffledOrder(ex.options, ex.q).map((oi) => {
          const o = ex.options[oi];
          let cls = "exam-opt";
          if (oi === ex.correct) cls += " correct";
          else if (oi === picked) cls += " wrong";
          return `<div class="${cls}" style="cursor:default">${esc(o)}</div>`;
        }).join("");
        body = `<div class="th-mistake-opts">${opts}</div>
          <div class="th-explore-reveal"><span class="th-explore-reveal-tag">💡 А вот что на самом деле</span>${esc(ex.reveal)}</div>`;
      } else {
        const opts = shuffledOrder(ex.options, ex.q).map((oi) =>
          `<button class="exam-opt" data-act="course-explore-check" data-key="${esc(fbKey)}" data-correct="${ex.correct}" data-pick="${oi}">${esc(ex.options[oi])}</button>`
        ).join("");
        body = `<div class="th-mistake-opts">${opts}</div>`;
      }
      return `<div class="th-explore">
          <div class="th-explore-tag">🔍 Исследуй сам — прежде чем читать дальше</div>
          ${ex.scenario ? `<div class="th-explore-scenario">${esc(ex.scenario)}</div>` : ""}
          <div class="th-mistake-q">${esc(ex.q)}</div>
          ${body}
        </div>`;
    }
    if (b.transfer != null) {
      const tr = b.transfer;
      const fbKey = missionKey + ":" + i;
      const fb = (ui.drillFb && ui.drillFb[fbKey]) || {};
      const isMc = tr.kind === "mc";
      let body;
      if (fb.checked) {
        let inner;
        if (isMc) {
          const picked = fb.pick;
          inner = shuffledOrder(tr.options, tr.q).map((oi) => {
            const o = tr.options[oi];
            let cls = "exam-opt";
            if (oi === tr.correct) cls += " correct";
            else if (oi === picked) cls += " wrong";
            return `<div class="${cls}" style="cursor:default">${esc(o)}</div>`;
          }).join("");
        } else {
          inner = "";
        }
        body = `${inner}
          <div class="th-transfer-fb ${fb.correct ? "ok" : "bad"}">
            ${fb.correct ? "✔ Верно! Ты применил(а) знание в новой ситуации." : (isMc ? "✗ Не совсем — смотри разбор ниже." : `✗ Ответ: ${esc(String(tr.answer))} ${esc(tr.unit || "")}`)}
          </div>
          <div class="th-transfer-sol">${esc(tr.solution)}</div>`;
      } else if (isMc) {
        const opts = shuffledOrder(tr.options, tr.q).map((oi) =>
          `<button class="exam-opt" data-act="course-transfer-mc" data-key="${esc(fbKey)}" data-correct="${tr.correct}" data-pick="${oi}">${esc(tr.options[oi])}</button>`
        ).join("");
        body = `<div class="th-mistake-opts">${opts}</div>`;
      } else {
        const inpId = "tr-inp-" + fbKey.replace(/[^a-zA-Z0-9]/g, "_");
        body = `<div class="answer-row">
            <input id="${inpId}" class="th-drill-input" inputmode="decimal" autocomplete="off" placeholder="Ответ">
            ${tr.unit ? `<span class="unit">${esc(tr.unit)}</span>` : ""}
            <button class="btn btn-primary btn-sm" data-act="course-transfer-num" data-key="${esc(fbKey)}" data-inp="${inpId}">Проверить</button>
          </div>`;
      }
      return `<div class="th-transfer">
          <div class="th-transfer-tag">🌙 Особое испытание</div>
          ${tr.scenario ? `<div class="th-transfer-scenario">${esc(tr.scenario)}</div>` : ""}
          <div class="th-mistake-q">${esc(tr.q)}</div>
          ${body}
        </div>`;
    }
    if (b.mistake != null) {
      const m = b.mistake;
      const fbKey = missionKey + ":" + i;
      const fb = (ui.drillFb && ui.drillFb[fbKey]) || {};
      let body;
      if (fb.checked) {
        const picked = fb.pick;
        const opts = shuffledOrder(m.options, m.q).map((oi) => {
          const o = m.options[oi];
          let cls = "exam-opt";
          if (oi === m.correct) cls += " correct";
          else if (oi === picked) cls += " wrong";
          return `<div class="${cls}" style="cursor:default">${esc(o)}</div>`;
        }).join("");
        body = `<div class="th-mistake-opts">${opts}</div>
          <div class="th-mistake-fb ${fb.correct ? "ok" : "bad"}">
            ${fb.correct ? "✔ Точно! Именно в этом ошибка." : "✗ Не совсем — присмотрись ещё раз."}
          </div>
          <div class="th-mistake-explain">${esc(m.explain)}</div>`;
      } else {
        const opts = shuffledOrder(m.options, m.q).map((oi) =>
          `<button class="exam-opt" data-act="course-mistake-check" data-key="${esc(fbKey)}" data-correct="${m.correct}" data-pick="${oi}">${esc(m.options[oi])}</button>`
        ).join("");
        body = `<div class="th-mistake-opts">${opts}</div>`;
      }
      return `<div class="th-mistake">
          <div class="th-mistake-tag">❌ Типичная ошибка</div>
          <div class="th-mistake-wrong">«${esc(m.wrong)}»</div>
          <div class="th-mistake-q">${esc(m.q)}</div>
          ${body}
        </div>`;
    }
    return "";
  }

  function missionArt(key) {
    const a = (typeof window !== "undefined" && window.MISSION_ART) ? window.MISSION_ART[key] : null;
    if (!a) return "";
    const sec = String(key).split(":")[0];
    return `<div class="mq-illus poster ps-${sec}">${autoPhoto(photoMission(key))}<svg viewBox="0 0 300 110" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Иллюстрация к теме">${a}</svg></div>`;
  }
  function realmArt(id) {
    const a = (typeof window !== "undefined" && window.REALM_ART) ? window.REALM_ART[id] : null;
    if (!a) return "";
    return `<svg class="realm-cover-svg" viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Обложка мира">${a}</svg>`;
  }

  // Карта кампании: акты (разделы) и миссии (темы) с последовательным открытием
  function viewCourse() {
    const c = courseData();
    if (!c) return `<div class="panel">Курс не загружен.</div>`;
    const flat = courseFlat();
    const total = flat.length;
    const done = flat.filter((m) => State.isMissionDone(m.key)).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    const secsHTML = (c.sections || []).map((sec) => {
      const rows = (sec.topics || []).map((tp, idx) => {
        const m = flat.find((x) => x.secId === sec.id && x.idx === idx);
        const isDone = State.isMissionDone(m.key);
        const unlocked = missionUnlocked(m.gi, flat);
        const formula = (tp.b || []).find((b) => b.f);
        const badge = formula ? `<span class="mq-formula">${esc(formula.f)}</span>` : "";
        const st = isDone ? `<span class="mq-st done">✓</span>` : (unlocked ? `<span class="mq-st go">▶</span>` : `<span class="mq-st lock">🔒</span>`);
        const actAttr = unlocked ? `data-act="course-mission" data-sec="${sec.id}" data-idx="${idx}"` : `data-act="course-locked"`;
        return `<button class="mq-row ${isDone ? "done" : ""} ${unlocked ? "" : "locked"}" ${actAttr}>
            ${st}<span class="mq-title">${esc(tp.t)}</span>${badge}</button>`;
      }).join("");
      return `<div class="mq-act">
          <div class="mq-act-head"><span class="mq-act-ico">${sec.ico || "📘"}</span><b>${sec.n}. ${esc(sec.t)}</b></div>
          <div class="mq-act-sum">${esc(sec.sum || "")}</div>
          ${rows}
        </div>`;
    }).join("");

    return `
      <div class="mq-top">
        <button class="btn btn-ghost" data-act="open-grade" data-grade="7">← Раздел «7 класс»</button>
      </div>
      <div class="mq-hero">
        <div class="mq-hero-newton">${newton("happy")}</div>
        <div class="mq-hero-text">
          <div class="mq-hero-title">🎮 Кампания «${esc(c.title)}»</div>
          <div class="mq-hero-sub">${esc(c.subtitle || "")} Каждая тема — миссия Ньютончика: изучи знание, открой формулу, пройди испытания.</div>
        </div>
      </div>
      <div class="mq-progress-wrap">
        <div class="mq-progress"><div class="mq-progress-fill" style="width:${pct}%"></div></div>
        <div class="mq-progress-txt">Пройдено миссий: <b>${done}</b> / ${total}</div>
      </div>
      ${secsHTML}`;
  }

  // Экран миссии: рамка Ньютончика + теория + формула-открытие + испытания
  function viewCourseMission() {
    const flat = courseFlat();
    const m = ui.mission ? flat.find((x) => x.secId === ui.mission.sec && x.idx === ui.mission.idx) : null;
    if (!m) return viewCourse();
    const tp = m.tp, key = m.key, isDone = State.isMissionDone(key);
    const blocks = (tp.b || []).map((b, i) => renderBlock(b, i, key)).join("");
    const rem = (tp.rem && tp.rem.length)
      ? `<div class="th-remember"><div class="th-rem-h">📌 Запомни</div><ul>${tp.rem.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>`
      : "";
    const trials = (tp.tasks || []).map((t, i) => {
      const tierMap = { base: "База", mid: "Средний", high: "Повышенный" };
      const tierBadge = t.tier ? `<span class="th-task-tier ${t.tier}">${tierMap[t.tier] || t.tier}</span>` : "";
      return `<div class="th-task">
        <div class="th-task-q">${tierBadge}<span class="th-task-n">⚔️ Испытание ${i + 1}</span> ${esc(t.q)}</div>
        <details class="th-sol"><summary>Показать решение</summary><div class="th-sol-body">${esc(t.s)}</div></details>
      </div>`;
    }).join("");
    const next = flat[m.gi + 1];

    // Итоговую проверку нужно пройти НА 70%+, прежде чем миссию можно завершить —
    // если у темы вообще есть control. Темы без control (пока не докатаны) —
    // ведут себя как раньше, без блокировки.
    const controlBest = (tp.control && tp.control.length) ? State.controlBest(key) : null;
    const controlRequired = !!(tp.control && tp.control.length);
    const controlPassed = !controlRequired || (controlBest && controlBest.passed);

    const completeBtn = isDone
      ? `<div class="mq-done-banner">✅ Миссия пройдена!</div>`
      : controlPassed
        ? `<button class="btn btn-gold" data-act="course-complete" data-sec="${m.secId}" data-idx="${m.idx}">✅ Завершить миссию&nbsp;·&nbsp;+${MISSION_REWARD.xp} XP</button>`
        : `<div class="mq-locked-banner">🔒 Сначала пройди финальную проверку ниже — набери 70%, и кнопка завершения миссии откроется</div>`;
    const nextBtn = next
      ? `<button class="btn btn-primary" data-act="course-mission" data-sec="${next.secId}" data-idx="${next.idx}">Следующая миссия →</button>`
      : `<button class="btn btn-primary" data-act="open-course">К карте кампании</button>`;
    const linkCh = m.sec.ch
      ? `<button class="btn btn-ghost" data-act="adv-start" data-ch="${m.sec.ch}">⚔️ Закрепить в приключении</button>`
      : "";
    const hasTrainer = (typeof window !== "undefined" && window.TRAINER_MAP) ? window.TRAINER_MAP[key] : null;
    const trainerBtn = hasTrainer
      ? `<button class="btn btn-primary" data-act="open-trainer" data-key="${key}">🎯 Тренажёр: отработать тему</button>`
      : "";
    // «Расставь силы» — интерактивная лаба с диаграммами сил, содержательно
    // совпадающая именно с темой «Сила» (тяжесть/упругость/трение — все три
    // вида сил из теории). Пока привязана только к этой теме — при желании
    // список легко расширить на другие темы, где появятся свои сценарии.
    const forcesLabBtn = (key === "mechanics:6")
      ? `<button class="btn btn-primary" data-act="open-forces">⚖️ Расставь силы: потренируйся на схемах</button>`
      : "";
    const myGoal = (tp.control && tp.control.length) ? State.getGoal(key) : null;
    const goalPicker = State.goalLevels().map((l) => {
      const on = myGoal && myGoal.target === l.target;
      const bonus = (l.xp || l.coins) ? `+${l.xp} XP` : "";
      return `<button class="goal-opt ${on ? "on" : ""}" data-act="set-goal" data-key="${key}" data-target="${l.target}">
          <span class="goal-opt-pct">${l.target}%</span>
          <span class="goal-opt-label">${l.label}</span>
          <span class="goal-opt-desc">${l.desc}</span>
          ${bonus ? `<span class="goal-opt-bonus">${bonus}</span>` : ""}
        </button>`;
    }).join("");

    const controlCta = (tp.control && tp.control.length) ? (
      controlBest && controlBest.passed
        ? `<div class="th-control-cta">
            <span class="th-control-badge passed">✅ Пройдено на ${controlBest.pct}%</span>
            <div class="th-control-cta-sub">Можешь пройти ещё раз, чтобы улучшить результат.</div>
            <button class="btn btn-ghost btn-sm" data-act="open-control" data-key="${key}">↺ Пройти ещё раз</button>
          </div>`
        : `<div class="th-control-cta">
            <div class="th-control-cta-title">🏆 Финальная проверка</div>
            <div class="th-control-cta-sub">${tp.control.length} вопросов · нужно набрать 70%, чтобы засчиталось</div>
            <div class="goal-block">
              <div class="goal-block-h">🎯 На какой результат замахнёшься?</div>
              <div class="goal-opts">${goalPicker}</div>
              <div class="goal-block-note">${myGoal
                ? "Цель поставлена. Не дотянешь — ничего страшного, тема всё равно засчитается от 70%."
                : "Выбери сам. Планка повыше — больше награда, а тема засчитается от 70% в любом случае."}</div>
            </div>
            <button class="btn btn-gold" data-act="open-control" data-key="${key}">Начать проверку</button>
          </div>`
    ) : "";

    return `
      <div class="mq-mission-top">
        <button class="btn btn-ghost" data-act="open-course">← К карте</button>
        <span class="mq-badge">Миссия ${m.sec.n}.${m.idx + 1}${isDone ? " · ✓" : ""}</span>
      </div>
      <nav class="lesson-rail" aria-label="Этапы урока">
        <a href="#stage-engage" class="lesson-pill">🎬 Старт</a>
        <a href="#stage-body" class="lesson-pill">🔍 Исследуем</a>
        <a href="#stage-tasks" class="lesson-pill">⚔️ Практика</a>
        <a href="#stage-control" class="lesson-pill">🏆 Проверка</a>
      </nav>
      <div class="mq-newton" id="stage-engage">
        <div class="mq-newton-ava">${newton("explain")}</div>
        <div class="mq-newton-bubble"><b>${esc(GAME.mentor.name)}:</b> ${tp.hook ? esc(tp.hook) : `Новая миссия — «${esc(tp.t)}». Изучи знание, открой формулу и пройди испытания!`}</div>
      </div>
      ${missionArt(key)}
      <h2 class="mq-h">${esc(tp.t)}</h2>
      <div class="th-body" id="stage-body">${blocks}</div>
      ${rem}
      ${trials ? `<div class="mq-trials" id="stage-tasks"><div class="mq-trials-h">⚔️ Испытания</div>${trials}</div>` : ""}
      <div id="stage-control">${controlCta}</div>
      <div class="mq-actions">
        ${completeBtn}
        ${trainerBtn}
        ${forcesLabBtn}
        ${isDone ? nextBtn : ""}
        ${linkCh}
      </div>`;
  }

  /* Итоговый контроль темы: мини-квиз (MC + числовые вопросы), общий результат
     в % и порог «зачёт» (70%). Результат сохраняется навсегда через
     State.saveControlResult — в отличие от обычных тренировок внутри темы. */
  function viewCourseControl() {
    const flat = courseFlat();
    const key = ui.control ? ui.control.key : null;
    const [secId, idxStr] = (key || "").split(":");
    const m = flat.find((x) => x.secId === secId && x.idx === +idxStr);
    if (!m || !m.tp.control || !m.tp.control.length) return viewCourse();
    const items = m.tp.control;

    if (ui.controlDone) {
      const r = ui.controlDone;
      return `
        <div class="mq-mission-top">
          <button class="btn btn-ghost" data-act="control-back" data-key="${key}">← К теме</button>
          <span class="mq-badge">🏆 Проверка</span>
        </div>
        <div class="th-control-result ${r.passed ? "pass" : ""}">
          <div class="th-control-result-ico">${r.passed ? "🏆" : "💪"}</div>
          <div class="th-control-result-h">${r.score} из ${r.total} верно · ${r.pct}%</div>
          <div class="th-control-result-sub">${r.passed
            ? (r.firstPass ? `Тема засчитана! +${r.reward ? r.reward.xp : 40} XP, +${r.reward ? r.reward.coins : 15} монет.` : "Отличный результат — тема уже была засчитана раньше.")
            : "Порог для зачёта — 70%. Повтори теорию выше и попробуй снова."}</div>
          ${r.goal ? (r.goal.reached
            ? `<div class="goal-result reached">🎯 Цель ${r.goal.target}% взята!${r.goal.reward && r.goal.reward.xp ? ` Бонус за смелость: +${r.goal.reward.xp} XP, +${r.goal.reward.coins} монет.` : ""}</div>`
            : `<div class="goal-result missed">🎯 Ты ставил цель ${r.goal.target}% — в этот раз не дотянул. Ничего страшного, попробуй ещё раз, цель остаётся.</div>`) : ""}
          ${(r.passed && m.tp.can && m.tp.can.length) ? `
            <div class="can-block">
              <div class="can-block-h">✨ Теперь ты можешь</div>
              <ul class="can-list">${m.tp.can.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
            </div>` : ""}
          <div class="mq-actions" style="justify-content:center">
            <button class="btn btn-gold" data-act="control-retry" data-key="${key}">↺ Пройти ещё раз</button>
            <button class="btn btn-primary" data-act="control-back" data-key="${key}">К теме</button>
          </div>
        </div>`;
    }

    const rows = items.map((it, i) => {
      const fbKey = key + ":" + i;
      const fb = ui.controlFb[fbKey] || {};
      if (it.kind === "mc") {
        const opts = shuffledOrder(it.options, it.q).map((oi) => {
          const o = it.options[oi];
          let cls = "exam-opt";
          if (fb.answered) {
            if (oi === it.correct) cls += " correct";
            else if (oi === fb.pick) cls += " wrong";
          }
          const attrs = fb.answered ? "" : `data-act="control-mc" data-key="${fbKey}" data-i="${i}" data-idx="${oi}"`;
          return `<button class="${cls}" ${attrs} ${fb.answered ? "disabled" : ""}>${esc(o)}</button>`;
        }).join("");
        const compass = (fb.answered && !fb.ok && it.hint) ? `<div class="compass-hint">🧭 Компас: ${esc(it.hint)}</div>` : "";
        return `<div class="th-ctrl-card"><div class="tr-q">${i + 1}. ${esc(it.q)}</div><div class="th-mistake-opts">${opts}</div>${compass}</div>`;
      }
      return `<div class="th-ctrl-card"><div class="tr-q">${i + 1}. ${esc(it.q)}</div>
          ${fb.answered
            ? `<div class="tr-fb ${fb.ok ? "ok" : "bad"}">${fb.ok ? "✔ Верно" : "✗ Ответ: " + esc(String(it.answer)) + " " + esc(it.unit || "")}</div>${(!fb.ok && it.hint) ? `<div class="compass-hint">🧭 Компас: ${esc(it.hint)}</div>` : ""}`
            : `<div class="answer-row">
                <input id="ctrl-inp-${i}" class="th-drill-input" inputmode="decimal" autocomplete="off" placeholder="Ответ">
                ${it.unit ? `<span class="unit">${esc(it.unit)}</span>` : ""}
                <button class="btn btn-primary btn-sm" data-act="control-num" data-key="${fbKey}" data-i="${i}">✓</button>
              </div>`}
        </div>`;
    }).join("");

    const allAnswered = items.every((_, i) => ui.controlFb[key + ":" + i] && ui.controlFb[key + ":" + i].answered);

    return `
      <div class="mq-mission-top">
        <button class="btn btn-ghost" data-act="control-back" data-key="${key}">← К теме</button>
        <span class="mq-badge">🏆 Проверка</span>
      </div>
      <h2 class="mq-h">${esc(m.tp.t)}</h2>
      <div class="gh-sub">Ответь на все вопросы, затем нажми «Завершить». Порог для зачёта — 70%.</div>
      ${rows}
      ${allAnswered ? `<div class="mq-actions"><button class="btn btn-gold" data-act="control-finish" data-key="${key}">Завершить проверку</button></div>` : ""}`;
  }

  // Склонение «вопрос/вопроса/вопросов»
  function questionWord(n) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a >= 11 && a <= 14) return "вопросов";
    if (b === 1) return "вопрос";
    if (b >= 2 && b <= 4) return "вопроса";
    return "вопросов";
  }

  // Детерминированно выбирает n элементов из массива по строке-затравке —
  // переиспользует уже проверенный ГПСЧ из shuffledOrder. Одна и та же
  // затравка (тема+дата) всегда даёт одну и ту же подборку в течение дня,
  // а на следующий день — уже другую.
  function seededPick(arr, n, seedStr) {
    const order = shuffledOrder(arr, seedStr);
    return order.slice(0, Math.min(n, arr.length)).map((i) => arr[i]);
  }

  /* ============================================================
     ЭКРАН: хаб интервального повторения — что пора освежить
     ============================================================ */
  function viewReviewHub() {
    const due = State.dueForReview();
    const upcoming = State.upcomingReview();
    const flat = courseFlat();
    const topicTitle = (key) => { const f = flat.find((x) => x.key === key); return f ? f.tp.t : key; };

    const dueRows = due.map((d) => `
      <div class="review-row due">
        <div class="review-row-main">
          <div class="review-row-title">${esc(topicTitle(d.key))}</div>
          <div class="review-row-sub">${d.overdueDays === 0 ? "Пора повторить сегодня" : `Ждёт уже ${d.overdueDays} ${dayWord(d.overdueDays)}`}</div>
        </div>
        <button class="btn btn-gold btn-sm" data-act="review-start" data-key="${d.key}">Повторить</button>
      </div>`).join("");

    const upcomingRows = upcoming.slice(0, 8).map((u) => `
      <div class="review-row">
        <div class="review-row-main">
          <div class="review-row-title">${esc(topicTitle(u.key))}</div>
          <div class="review-row-sub">Через ${u.inDays} ${dayWord(u.inDays)}</div>
        </div>
      </div>`).join("");

    return `
      <div class="mq-mission-top">
        <button class="btn btn-ghost" data-act="go" data-view="cabinet">← Профиль</button>
        <span class="mq-badge">🔄 Повторение</span>
      </div>
      <h2 class="mq-h">Что стоит освежить</h2>
      <div class="gh-sub">Регулярное повторение — самый надёжный способ не забыть то, что уже выучил.</div>
      ${due.length
        ? `<div class="review-section-h">🔥 Пора повторить (${due.length})</div>${dueRows}`
        : `<div class="review-empty">Сейчас всё свежо в памяти — загляни сюда позже 👍</div>`}
      ${upcoming.length ? `<div class="review-section-h">📅 Скоро</div>${upcomingRows}` : ""}`;
  }

  /* ============================================================
     ЭКРАН: сама сессия повторения — мини-квиз из подмножества
     уже готовых вопросов control этой темы (новый контент не нужен)
     ============================================================ */
  function viewReviewQuiz() {
    const rv = ui.review;
    if (!rv) return viewReviewHub();
    const flat = courseFlat();
    const m = flat.find((x) => x.key === rv.key);
    if (!m || !m.tp.control || !m.tp.control.length) return viewReviewHub();
    const items = rv.items;

    if (ui.reviewDone) {
      const r = ui.reviewDone;
      return `
        <div class="mq-mission-top">
          <button class="btn btn-ghost" data-act="review-back">← Назад</button>
          <span class="mq-badge">🔄 Повторение</span>
        </div>
        <div class="th-control-result ${r.passed ? "pass" : ""}">
          <div class="th-control-result-ico">${r.passed ? "🔄" : "💪"}</div>
          <div class="th-control-result-h">${r.score} из ${r.total} верно</div>
          <div class="th-control-result-sub">${r.passed
            ? `Отлично! Следующее повторение — через ${r.intervalDays} ${dayWord(r.intervalDays)}.`
            : "Не страшно — вернёмся к этой теме уже завтра, чтобы закрепить получше."}</div>
          <div class="mq-actions" style="justify-content:center">
            <button class="btn btn-primary" data-act="review-back">К списку повторений</button>
          </div>
        </div>`;
    }

    const rows = items.map((it, i) => {
      const fbKey = "review:" + i;
      const fb = ui.reviewFb[fbKey] || {};
      if (it.kind === "mc") {
        const opts = shuffledOrder(it.options, it.q).map((oi) => {
          const o = it.options[oi];
          let cls = "exam-opt";
          if (fb.answered) { if (oi === it.correct) cls += " correct"; else if (oi === fb.pick) cls += " wrong"; }
          const attrs = fb.answered ? "" : `data-act="review-mc" data-i="${i}" data-idx="${oi}"`;
          return `<button class="${cls}" ${attrs} ${fb.answered ? "disabled" : ""}>${esc(o)}</button>`;
        }).join("");
        return `<div class="th-ctrl-card"><div class="tr-q">${i + 1}. ${esc(it.q)}</div><div class="th-mistake-opts">${opts}</div></div>`;
      }
      return `<div class="th-ctrl-card"><div class="tr-q">${i + 1}. ${esc(it.q)}</div>
          ${fb.answered
            ? `<div class="tr-fb ${fb.ok ? "ok" : "bad"}">${fb.ok ? "✔ Верно" : "✗ Ответ: " + esc(String(it.answer)) + " " + esc(it.unit || "")}</div>`
            : `<div class="answer-row">
                <input id="rv-inp-${i}" class="th-drill-input" inputmode="decimal" autocomplete="off" placeholder="Ответ">
                ${it.unit ? `<span class="unit">${esc(it.unit)}</span>` : ""}
                <button class="btn btn-primary btn-sm" data-act="review-num" data-i="${i}">✓</button>
              </div>`}
        </div>`;
    }).join("");

    const allAnswered = items.every((_, i) => ui.reviewFb["review:" + i] && ui.reviewFb["review:" + i].answered);

    return `
      <div class="mq-mission-top">
        <button class="btn btn-ghost" data-act="review-back">← Назад</button>
        <span class="mq-badge">🔄 Повторение</span>
      </div>
      <h2 class="mq-h">${esc(m.tp.t)}</h2>
      <div class="gh-sub">Быстрая проверка — ${items.length} ${questionWord(items.length)}.</div>
      ${rows}
      ${allAnswered ? `<div class="mq-actions"><button class="btn btn-gold" data-act="review-finish">Завершить повторение</button></div>` : ""}`;
  }

  /* Программа = выбор класса. Каждый класс открывает свой раздел (viewGrade),
     где собрано всё: учебник-теория, сюжетные главы и практика. */
  function cabProgram() {
    const flat = courseFlat();
    const courseDone = flat.filter((m) => State.isMissionDone(m.key)).length;
    const courseTotal = flat.length;
    const cards = [
      { g: 7, t: "7 класс", note: "Механика · давление · работа" },
      { g: 8, t: "8 класс", note: "Тепловые и электрические явления" },
      { g: 9, t: "9 класс", note: "Динамика · тяготение · космос" },
    ];
    const cardHTML = cards.map((c) => {
      const chs = (GAME.chapters || []).filter((x) => x.grade === c.g).length;
      const tps = (GAME.topics || []).filter((x) => x.grade === c.g).length;
      const hasCourse = !!(GAME.course && GAME.course["grade" + c.g]);
      const bits = [];
      if (hasCourse) bits.push(`📖 теория: ${courseTotal} тем`);
      if (chs) bits.push(`🎬 ${chs} ${chs === 1 ? "глава" : "глав"}`);
      if (tps) bits.push(`🎯 ${tps} тем практики`);
      if (!bits.length) bits.push("теория добавится из учебника ✍️");
      return `<button class="grade-card" data-act="open-grade" data-grade="${c.g}">
          <div class="gc-badge">${c.g === "math" ? "🔢" : c.g}</div>
          <div class="gc-main">
            <div class="gc-title">${esc(c.t)}</div>
            <div class="gc-note">${esc(c.note)}</div>
            <div class="gc-bits">${bits.join(" · ")}</div>
          </div>
          <div class="gc-go">▶</div>
        </button>`;
    }).join("");
    return `
      <div class="prog-intro">📚 Выбери класс — внутри собрано всё: теория-учебник, сюжетные главы и практика. Учебник на бумаге не нужен.</div>
      <div class="grade-cards">${cardHTML}</div>`;
  }

  // Раздел класса: учебник (теория-RPG) + сюжет + практика — всё в одном месте
  // Главное меню класса: крупные карточки-разделы (каждая ведёт в свой экран)
  function viewGrade() {
    const g = ui.gradeSel;
    const title = g + " класс";
    const flat = courseFlat();
    const chs = (GAME.chapters || []).filter((c) => c.grade === g);
    const hasCourse = !!(GAME.course && GAME.course["grade" + g]);
    const courseDone = flat.filter((m) => State.isMissionDone(m.key)).length;
    const trainCount = Object.keys((typeof window !== "undefined" && window.TRAINER_MAP) || {}).length;
    const probSets = (GAME.problems && GAME.problems["grade" + g]) || [];
    const probCount = probSets.reduce((a, s) => a + s.problems.length, 0);
    const examQs = (GAME.examTheory && GAME.examTheory["grade" + g]) || [];
    const line = newtonHubLine();
    const allCh = (GAME.chapters || []).filter((c) => c.status === "open");
    const src = allCh.length ? Math.round(allCh.filter((c) => State.isChapterDone(c.id)).length / allCh.length * 100) : 0;

    const card = (attrs, cls, ico, name, desc, badge) =>
      `<button class="menu-card ${cls}" ${attrs}>
         <span class="mc-ico">${ico}</span>
         <span class="mc-text"><span class="mc-name">${name}</span><span class="mc-desc">${desc}</span></span>
         ${badge ? `<span class="mc-badge">${badge}</span>` : ""}
         <span class="mc-go">▶</span>
       </button>`;

    const gradeRealms = (GAME.realms || []).filter((r) => (r.grade || 7) === g);
    let cards = "";
    if (hasCourse) {
      cards += card(`data-act="open-course"`, "mc-book", "📖", "Учебник", "Теория, формулы, графики и испытания", `${courseDone}/${flat.length} тем`);
    }
    if (g === 7) {
      const spacingCount = Object.keys(State.data.spacing || {}).length;
      if (spacingCount > 0) {
        const dueCount = State.dueForReview().length;
        const topicWord = (n) => { const a = Math.abs(n) % 100, b = a % 10; if (a >= 11 && a <= 14) return "тем"; if (b === 1) return "тема"; if (b >= 2 && b <= 4) return "темы"; return "тем"; };
        cards += card(`data-act="open-review-hub"`, "mc-forces", "🔄", "Повторение",
          dueCount > 0 ? "Пора освежить пройденное" : "Всё свежо в памяти",
          dueCount > 0 ? `${dueCount} ${topicWord(dueCount)}` : "");
      }
    }
    if (gradeRealms.length) cards += card(`data-act="open-worlds"`, "mc-worlds", "🌌", "Миры", "Лор и интересные факты", `${gradeRealms.length} миров`);
    if (chs.length) cards += card(`data-act="open-chapters"`, "mc-story", "🎬", "Сюжет", "Главы-приключения с боссами", `${chs.length} глав`);
    const trCount = (g === 7) ? trainCount : (g === 8 ? (window.TRAINER_TOPICS_G8 || []).length : (g === 9 ? (window.TRAINER_TOPICS_G9 || []).length : 0));
    if (trCount) cards += card(`data-act="open-practice"`, "mc-train", "🎯", "Тренажёр", "Задачи разных видов, растут по сложности", `${trCount} тем`);
    if (probSets.length) cards += card(`data-act="open-problems"`, "mc-combo", "🧩", "Комплексные задачи", "Сложные задачи сразу на несколько тем", `${probCount} задач`);
    const forceScenarios = (GAME.forceScenarios || []).filter((s) => s.grade === g);
    if (forceScenarios.length) cards += card(`data-act="open-forces"`, "mc-forces", "⚖️", "Расставь силы", "Диаграммы сил: выбери силы из пула", `${forceScenarios.length} сценариев`);
    if (examQs.length) cards += card(`data-act="open-exam"`, "mc-exam", "📝", "Экзамен", "Случайные задачи на очки и время", "режим");
    cards += card(`data-act="go" data-view="cabinet"`, "mc-lab", "🔬", "Лаборатория", "Герой, открытия, достижения", "");

    let note = "";
    if (!hasCourse) note = `<div class="prog-note">Интерактивный учебник и тренажёр ${g} класса добавим позже ✍️</div>`;

    return `
      ${fxDots(14)}
      <div class="hq">
        <div class="hq-newton">${newton(line.mood)}</div>
        <div class="hq-body">
          <div class="hq-title">${esc(title)} · штаб</div>
          <div class="hq-line"><b>${esc(GAME.mentor.name)}:</b> ${esc(line.text)}</div>
          <div class="hq-src"><span class="hq-src-t">🏆 Источник восстановлен</span><div class="hq-bar"><div class="hq-bar-fill" style="width:${src}%"></div></div><b>${src}%</b></div>
        </div>
      </div>
      ${questsBlockHTML()}
      <div class="menu-grid">${cards}</div>
      ${note}`;
  }

  // Экран «Миры»
  function viewWorlds() {
    const cards = (GAME.realms || []).filter((r) => (r.grade || 7) === ui.gradeSel).map((r) =>
      `<button class="realm-card" data-act="open-realm" data-id="${r.id}" style="--r-accent:${r.accent}">
         <span class="rc-cover">${realmArt(r.id)}</span>
         <span class="rc-body"><span class="rc-ico">${r.ico}</span><span class="rc-name">${esc(r.name)}</span></span>
       </button>`).join("");
    return `
      ${fxDots(12)}
      <div class="mq-mission-top"><button class="btn btn-ghost" data-act="open-grade" data-grade="${ui.gradeSel}">← Меню</button><span class="mq-badge">🌌 Миры</span></div>
      <h2 class="mq-h">Миры физики</h2>
      <div class="gh-sub">Загляни в каждый мир: его лор и интересные факты.</div>
      <div class="realm-grid">${cards}</div>`;
  }

  // Экран «Сюжет» (главы класса)
  function viewChapters() {
    const g = ui.gradeSel;
    const chs = (GAME.chapters || []).filter((c) => c.grade === g);
    const chItem = (c) => {
      const done = State.isChapterDone(c.id);
      const lock = false; // все главы открыты
      const tag = done ? "✓ пройдена" : (lock ? "🔒 закрыта" : "▶ играть");
      const attrs = lock ? `data-act="ch-locked"` : `data-act="adv-start" data-ch="${c.id}"`;
      return `<button class="prog-item ch ${lock ? "locked" : ""} ${done ? "done" : ""}" ${attrs}>${c.icon || "📖"} ${esc(c.title)} <span class="prog-tag">${tag}</span></button>`;
    };
    return `
      ${fxDots(12)}
      <div class="mq-mission-top"><button class="btn btn-ghost" data-act="open-grade" data-grade="${g}">← Меню</button><span class="mq-badge">🎬 Сюжет</span></div>
      <h2 class="mq-h">Приключение — ${g} класс</h2>
      <div class="gh-sub">Главы открываются по очереди. Проходи и собирай открытия.</div>
      ${chs.map(chItem).join("")}`;
  }

  // Экран «Тренажёр» (темы с тренажёром)
  function viewPractice() {
    let items;
    if (ui.gradeSel === 7) {
      const flat = courseFlat();
      items = flat.filter((m) => (typeof window !== "undefined" && window.TRAINER_MAP) ? window.TRAINER_MAP[m.key] : false).map((m) => {
        const lvl = State.trainerMaxLevel(m.key);
        return `<button class="prog-item" data-act="open-trainer" data-key="${m.key}">🎯 ${esc(m.tp.t)} <span class="prog-tag">ур. ${lvl}/3</span></button>`;
      }).join("");
    } else {
      const topics = (ui.gradeSel === 8) ? (window.TRAINER_TOPICS_G8 || []) : (ui.gradeSel === 9 ? (window.TRAINER_TOPICS_G9 || []) : []);
      items = topics.map((t) => {
        const lvl = State.trainerMaxLevel(t.key);
        return `<button class="prog-item" data-act="open-trainer" data-key="${t.key}">🎯 ${esc(t.title)} <span class="prog-tag">ур. ${lvl}/3</span></button>`;
      }).join("");
    }
    return `
      ${fxDots(12)}
      <div class="mq-mission-top"><button class="btn btn-ghost" data-act="open-grade" data-grade="${ui.gradeSel}">← Меню</button><span class="mq-badge">🎯 Тренажёр</span></div>
      <h2 class="mq-h">Тренажёр по темам</h2>
      <div class="gh-sub">Реши задачи и открой уровни «Уверенно» и «Вызов».</div>
      ${items}`;
  }

  // Экран «Комплексные задачи»
  function viewProblems() {
    const sets = (GAME.problems && GAME.problems["grade" + ui.gradeSel]) || [];
    const blocks = sets.map((set) => {
      const probs = set.problems.map((p, i) => {
        const given = (p.given || []).join("; ");
        const steps = (p.steps || []).map((x) => `<div class="prob-step">${esc(x)}</div>`).join("");
        return `<div class="prob">
            <div class="prob-q"><span class="prob-n">${i + 1}</span>${esc(p.q)}</div>
            <details class="prob-sol"><summary>Дано · Решение · Ответ</summary>
              <div class="prob-block"><b>Дано:</b> ${esc(given)}</div>
              ${p.find ? `<div class="prob-block"><b>Найти:</b> ${esc(p.find)}</div>` : ""}
              <div class="prob-block"><b>Решение:</b>${steps}</div>
              <div class="prob-ans"><b>Ответ:</b> ${esc(p.answer)}</div>
            </details>
          </div>`;
      }).join("");
      return `<div class="gh-sec"><div class="gh-sec-h">${esc(set.title)}</div><div class="prob-sub">${esc(set.sub || "")}</div>${probs}</div>`;
    }).join("");
    return `
      ${fxDots(12)}
      <div class="mq-mission-top"><button class="btn btn-ghost" data-act="open-grade" data-grade="${ui.gradeSel}">← Меню</button><span class="mq-badge">🧩 Задачи</span></div>
      <h2 class="mq-h">Комплексные задачи</h2>
      <div class="gh-sub">Задачи посложнее — на несколько тем сразу. Сначала попробуй сам, потом открой решение.</div>
      ${blocks}`;
  }

  // ====== Экзамен: случайные задачи из тем, очки и время ======
  let examTimer = null;
  const EXAM_PTS = { 1: 1, 2: 2, 3: 3 };
  const SEC_TITLE = { all: "Все темы", intro: "Введение", matter: "Вещество", mechanics: "Механика", pressure: "Давление и жидкости", work: "Работа и энергия", thermal: "Тепловые явления", dynamics: "Динамика", electricity: "Электричество", magnetism: "Электромагнитные явления", optics: "Оптика" };
  function examGenKeys(scope) {
    if (ui.gradeSel !== 7) return []; // тренажёры пока только у 7 класса
    const all = Object.keys((typeof window !== "undefined" && window.TRAINER_MAP) || {});
    return scope === "all" ? all : all.filter((k) => k.split(":")[0] === scope);
  }
  function examTheoryQs(scope) {
    const qs = (GAME.examTheory && GAME.examTheory["grade" + ui.gradeSel]) || [];
    return scope === "all" ? qs : qs.filter((q) => q.sec === scope);
  }
  function examPickItem(scope) {
    const gk = examGenKeys(scope), tq = examTheoryQs(scope);
    const useTheory = tq.length && (!gk.length || Math.random() < 0.4);
    if (useTheory || !gk.length) { const q = tq[Math.floor(Math.random() * tq.length)]; return { kind: "mc", q: q, topic: SEC_TITLE[q.sec] || "Теория", level: 1 }; }
    const key = gk[Math.floor(Math.random() * gk.length)]; const lv = [1, 2, 2, 3, 3][Math.floor(Math.random() * 5)];
    const flat = courseFlat(); const m = flat.find((x) => x.key === key);
    return { kind: "num", task: trGen(key)(lv), level: lv, topic: m ? m.tp.t : "" };
  }
  function fmtTime(ms) {
    const s = Math.floor(ms / 1000), mm = Math.floor(s / 60), ss = s % 60;
    return mm + ":" + (ss < 10 ? "0" : "") + ss;
  }
  function examTick() {
    if (ui.view !== "exam" || !ui.exam || ui.exam.phase !== "run") { if (examTimer) { clearInterval(examTimer); examTimer = null; } return; }
    const el = document.getElementById("exam-timer"); if (el) el.textContent = fmtTime(Date.now() - ui.exam.t0);
  }
  function examStart(scope, n) {
    if (examTimer) clearInterval(examTimer);
    ui.exam = { phase: "run", scope: scope, n: n, i: 1, score: 0, points: 0, t0: Date.now(), cur: examPickItem(scope), answered: false, ok: false };
    ui.view = "exam"; render(); window.scrollTo(0, 0);
    examTimer = setInterval(examTick, 1000);
  }
  function examFinish() {
    const e = ui.exam;
    if (examTimer) { clearInterval(examTimer); examTimer = null; }
    e.dt = Date.now() - e.t0;
    e.xp = e.points * 3;
    if (!State.data.exam) State.data.exam = { best: 0, taken: 0 };
    State.data.exam.taken = (State.data.exam.taken || 0) + 1;
    e.best = e.points > (State.data.exam.best || 0);
    if (e.best) State.data.exam.best = e.points;
    if (e.xp) State.addXP(e.xp, "exam");
    State.save();
    e.phase = "done";
    render(); window.scrollTo(0, 0);
    updateHUD();
    if (e.score >= Math.ceil(e.n * 0.6)) confetti(44);
  }
  function viewExam() {
    const e = ui.exam;
    if (!e || e.phase === "intro") {
      const best = (State.data.exam && State.data.exam.best) || 0;
      const SEC_META = { intro: "🔭", matter: "🧪", mechanics: "🏃", pressure: "🌊", work: "⚙️", thermal: "🔥", dynamics: "🚀", electricity: "⚡", magnetism: "🧲", optics: "🔬" };
      const theory = (GAME.examTheory && GAME.examTheory["grade" + ui.gradeSel]) || [];
      const secs = theory.map((q) => q.sec).filter((x, i, a) => a.indexOf(x) === i);
      const scopes = [["all", "🎲", "Все темы"]].concat(secs.map((x) => [x, SEC_META[x] || "📘", SEC_TITLE[x] || x]));
      const cards = scopes.map((sc) => `<button class="menu-card mc-exam" data-act="exam-scope" data-scope="${sc[0]}"><span class="mc-ico">${sc[1]}</span><span class="mc-text"><span class="mc-name">${sc[2]}</span><span class="mc-desc">Теория + обычные + сложные</span></span><span class="mc-go">▶</span></button>`).join("");
      return `
        ${fxDots(12)}
        <div class="mq-mission-top"><button class="btn btn-ghost" data-act="open-grade" data-grade="${ui.gradeSel}">← Меню</button><span class="mq-badge">📝 Экзамен</span></div>
        <h2 class="mq-h">Экзамен</h2>
        <div class="gh-sub">Выбери раздел. В каждом — теория (выбор ответа), обычные и сложные задачи.${best ? ` Рекорд: <b>${best}</b> ⭐.` : ""}</div>
        <div class="menu-grid">${cards}</div>`;
    }
    if (e.phase === "len") {
      return `
        ${fxDots(12)}
        <div class="mq-mission-top"><button class="btn btn-ghost" data-act="open-exam">← Разделы</button><span class="mq-badge">📝 ${esc(SEC_TITLE[e.scope] || "Экзамен")}</span></div>
        <div class="exam-card-hero"><div class="exam-hero-ico">📝</div><div class="exam-hero-title">${esc(SEC_TITLE[e.scope] || "Экзамен")}</div><div class="exam-hero-sub">Сколько задач? Теория, обычные и сложные — вперемешку.</div></div>
        <div class="exam-lens">
          <button class="btn btn-primary" data-act="exam-start" data-n="5">Быстрый · 5</button>
          <button class="btn btn-gold" data-act="exam-start" data-n="10">Экзамен · 10</button>
          <button class="btn btn-ghost" data-act="exam-start" data-n="15">Марафон · 15</button>
        </div>`;
    }
    if (e.phase === "run") {
      const it = e.cur;
      let body;
      if (e.answered) {
        if (it.kind === "mc") {
          body = `<div class="tr-fb ${e.ok ? "ok" : "bad"}">${e.ok ? "✅ Верно! +1 очк." : `❌ Верный ответ: <b>${esc(it.q.opts[it.q.correct])}</b>`}</div>
            <button class="btn btn-primary" data-act="exam-next">${e.i >= e.n ? "Итоги →" : "Дальше →"}</button>`;
        } else {
          const t = it.task;
          body = `<div class="tr-fb ${e.ok ? "ok" : "bad"}">${e.ok ? `✅ Верно! +${it.level} очк.` : `❌ Ответ: <b>${esc(ru(String(t.a)))}${t.u ? " " + esc(t.u) : ""}</b>`}</div>
            <div class="tr-sol"><b>Решение.</b> ${esc(ru(t.sol))}</div>
            <button class="btn btn-primary" data-act="exam-next">${e.i >= e.n ? "Итоги →" : "Дальше →"}</button>`;
        }
      } else if (it.kind === "mc") {
        body = `<div class="exam-opts">${shuffledOrder(it.q.opts, it.q.q).map((i2) => `<button class="exam-opt" data-act="exam-mc" data-idx="${i2}">${esc(it.q.opts[i2])}</button>`).join("")}</div>`;
      } else {
        const t = it.task;
        body = `<div class="answer-row"><input id="inp-exam" class="num-input" type="text" inputmode="decimal" autocomplete="off" placeholder="Ответ">${t.u ? `<span class="unit">${esc(t.u)}</span>` : ""}<button class="btn btn-gold" data-act="exam-check">Ответить</button></div>`;
      }
      const qText = it.kind === "mc" ? it.q.q : ru(it.task.q);
      const kindTag = it.kind === "mc" ? "теория" : (it.level >= 3 ? "сложная" : "задача");
      return `
        <div class="exam-top"><span>Вопрос <b>${e.i}</b> / ${e.n}</span><span>⭐ <b>${e.points}</b></span><span>⏱ <b id="exam-timer">0:00</b></span></div>
        <div class="exam-prog"><div class="exam-prog-fill" style="width:${Math.round((e.i - 1) / e.n * 100)}%"></div></div>
        <div class="tr-card"><div class="exam-topic">${esc(it.topic)} · ${kindTag}</div><div class="tr-q">${esc(qText)}</div>${body}</div>`;
    }
    const pct = Math.round(e.score / e.n * 100);
    const mark = pct >= 85 ? "5" : pct >= 65 ? "4" : pct >= 45 ? "3" : "2";
    return `
      ${fxDots(14)}
      <div class="exam-result">
        <div class="exam-hero-ico">${pct >= 65 ? "🏆" : pct >= 45 ? "👍" : "💪"}</div>
        <div class="exam-hero-title">Результат</div>
        <div class="exam-sub2">${esc(SEC_TITLE[e.scope] || "Все темы")}</div>
        <div class="exam-score">${e.score} / ${e.n} верно · ⭐ ${e.points} очков</div>
        <div class="exam-mark">Оценка: <b>${mark}</b></div>
        <div class="exam-meta">Время: ${fmtTime(e.dt)} · +${e.xp} XP${e.best ? " · 🏅 рекорд!" : ""}</div>
        <div class="exam-lens">
          <button class="btn btn-gold" data-act="open-exam">Ещё раз</button>
          <button class="btn btn-ghost" data-act="open-grade" data-grade="${ui.gradeSel}">В меню</button>
        </div>
      </div>`;
  }

  // Страница мира: лор + интересные факты + связанные главы и темы
  function viewRealm() {
    const r = (GAME.realms || []).find((x) => x.id === ui.realmId);
    if (!r) return viewGrade();
    const flat = courseFlat();

    const facts = (r.facts || []).map((f) => `<li>${esc(f)}</li>`).join("");

    // связанные главы истории
    const chBtns = (r.chapters || []).map((cid) => {
      const c = chapter(cid); if (!c) return "";
      const done = State.isChapterDone(c.id);
      const lock = false; // все главы открыты
      const tag = done ? "✓" : (lock ? "🔒" : "▶");
      const actAttr = lock ? `data-act="realm-locked"` : `data-act="adv-start" data-ch="${c.id}"`;
      return `<button class="prog-item ch" ${actAttr}>${c.icon || "📖"} ${esc(c.title)} <span class="prog-tag">${tag}</span></button>`;
    }).join("");

    // связанные темы курса
    const mBtns = (r.missions || []).map((key) => {
      const m = flat.find((x) => x.key === key); if (!m) return "";
      const done = State.isMissionDone(key);
      const [sec, idx] = key.split(":");
      return `<button class="prog-item" data-act="course-mission" data-sec="${sec}" data-idx="${idx}">📘 ${esc(m.tp.t)} <span class="prog-tag">${done ? "✓" : "изучить"}</span></button>`;
    }).join("");

    return `
      ${fxDots(12)}
      <div class="mq-mission-top">
        <button class="btn btn-ghost" data-act="open-worlds">← К мирам</button>
        <span class="mq-badge">🌌 Мир</span>
      </div>
      <div class="realm-hero" style="--r-accent:${r.accent}">
        <div class="realm-cover">${autoPhoto(photoRealm(r.id))}${realmArt(r.id)}</div>
        <div class="realm-hero-name">${r.ico} ${esc(r.name)}</div>
        <div class="realm-hero-tag">${esc(r.tagline)}</div>
        <div class="realm-lore">${esc(r.lore)}</div>
      </div>
      <div class="realm-facts">
        <div class="rf-h">💡 А ты знал?</div>
        <ul>${facts}</ul>
      </div>
      ${chBtns ? `<div class="gh-sec"><div class="gh-sec-h">🎬 Главы в этом мире</div>${chBtns}</div>` : ""}
      ${mBtns ? `<div class="gh-sec"><div class="gh-sec-h">📖 Темы курса</div>${mBtns}</div>` : ""}`;
  }

  // показать числа с запятой (русская десятичная)
  function ru(t) { return String(t).replace(/(\d)\.(\d)/g, "$1,$2"); }
  function trGen(key) { const id = (window.TRAINER_MAP || {})[key]; if (id) return (window.TRAINERS || {})[id]; return (window.TRAINERS || {})[key] || null; }

  // Тренажёр темы: задачи разных видов, растущие по сложности (3 уровня)
  /* ================= «Расставь силы» — практика диаграмм сил (canvas, drag) ================= */
  let activeForceInst = null; // текущий интерактивный canvas-инстанс практики (живёт между чипами, не пересоздаётся на каждый тап)

  function viewForcesList() {
    const g = ui.gradeSel;
    const scenarios = (GAME.forceScenarios || []).filter((s) => s.grade === g);
    const cards = scenarios.map((s) => {
      const done = State.data.forcesDone && State.data.forcesDone[s.id];
      const n = s.correct.length;
      return `<button class="menu-card mc-forces" data-act="forces-pick" data-id="${s.id}">
          <span class="mc-ico">⚖️</span>
          <span class="mc-text"><span class="mc-name">${esc(s.title)}</span><span class="mc-desc">${done ? "Пройдено ✓" : `${n} сил${n === 1 ? "а" : n < 5 ? "ы" : ""}${s.followUp ? " + расчёт" : ""}`}</span></span>
          <span class="mc-go">▶</span>
        </button>`;
    }).join("");
    return `
      ${fxDots(12)}
      <div class="mq-mission-top"><button class="btn btn-ghost" data-act="open-grade" data-grade="${g}">← Меню</button><span class="mq-badge">⚖️ Силы</span></div>
      <h2 class="mq-h">Расставь силы</h2>
      <div class="gh-sub">Выбери из пула только те силы, что реально действуют, и перетащи наконечник каждой стрелки в верном направлении. Некоторые задачи продолжаются расчётом — расстановка сил и правда пригодится для решения.</div>
      ${scenarios.length ? `<div class="menu-grid">${cards}</div>` : `<div class="prog-note">Для ${g} класса сценарии пока не добавлены.</div>`}`;
  }

  function forceChipClass(id, sc, st) {
    let cls = "force-chip";
    if (!st.checked) return cls;
    const isCorrectForce = sc.correct.includes(id);
    const wasPlaced = st.snapshot && Object.prototype.hasOwnProperty.call(st.snapshot, id);
    if (isCorrectForce) {
      const rep = st.result.angleReport[id];
      cls += wasPlaced ? (rep && rep.ok ? " correct" : " wrong-angle") : " missing";
    } else if (wasPlaced) cls += " wrong";
    return cls;
  }

  function renderForceFollowUp(st, sc) {
    if (!sc.followUp || !st.fu) return "";
    const fu = st.fu;
    if (fu.answered) {
      return `<div class="force-followup">
        <div class="tr-q">📐 ${esc(fu.q)}</div>
        <div class="tr-fb ${fu.correct ? "ok" : "bad"}">${fu.correct ? "✅ Верно!" : `❌ Неверно. Правильный ответ: <b>${esc(String(fu.answer))}${fu.unit ? " " + esc(fu.unit) : ""}</b>`}</div>
      </div>`;
    }
    return `<div class="force-followup">
      <div class="tr-q" style="color:var(--star-gold,#ffd166)">${esc(sc.followUp.intro)}</div>
      <div class="tr-q">📐 ${esc(fu.q)}</div>
      <div class="answer-row">
        <input id="inp-forces-fu" class="num-input" type="text" inputmode="decimal" autocomplete="off" placeholder="Ответ">
        ${fu.unit ? `<span class="unit">${esc(fu.unit)}</span>` : ""}
        <button class="btn btn-gold" data-act="forces-fu-check">Проверить</button>
      </div>
    </div>`;
  }

  function viewForces() {
    const st = ui.forces;
    if (!st) return viewForcesList();
    const sc = (GAME.forceScenarios || []).find((s) => s.id === st.scenarioId);
    if (!sc) return viewForcesList();

    const chips = sc.pool.map((id) => {
      const meta = GAME.forceMeta[id];
      return `<button class="${forceChipClass(id, sc, st)}" data-act="forces-toggle" data-id="${id}" style="--chip-color:${meta.color}" ${st.checked ? "disabled" : ""}>${esc(meta.label)}</button>`;
    }).join("");

    let feedback = "";
    if (st.checked) {
      const r = st.result;
      let msg;
      if (r.fullyCorrect) msg = `<div class="tr-fb ok">✅ Отлично! Именно эти силы, и направлены верно.</div>`;
      else {
        const parts = [];
        if (r.missing.length) parts.push(`не хватает: ${r.missing.map((id) => GAME.forceMeta[id].label).join(", ")}`);
        if (r.extra.length) parts.push(`лишние: ${r.extra.map((id) => GAME.forceMeta[id].label).join(", ")}`);
        const wrongAngles = Object.keys(r.angleReport).filter((id) => !r.angleReport[id].ok);
        if (wrongAngles.length) parts.push(`неверное направление: ${wrongAngles.map((id) => GAME.forceMeta[id].label).join(", ")}`);
        msg = `<div class="tr-fb bad">❌ Пока не так — ${esc(parts.join("; ") || "сверься со схемой ниже")}.</div>`;
      }
      feedback = msg + `<div class="tr-sol"><b>Объяснение.</b> ${esc(sc.explain)}</div>`;
    }

    return `
      ${fxDots(10)}
      <div class="mq-mission-top"><button class="btn btn-ghost" data-act="forces-back">← К списку</button><span class="mq-badge">⚖️ Расставь силы</span></div>
      <h2 class="mq-h">${esc(sc.title)}</h2>
      <div class="tr-card">
        <div class="tr-q">${esc(sc.desc)}</div>
        <div class="force-canvas-row">
          <div class="force-canvas-col">
            <div class="force-canvas-label">${st.checked ? "Твоя диаграмма" : "🖐 Перетащи наконечники стрелок"}</div>
            <div class="force-canvas-wrap" id="force-mount-user"></div>
          </div>
          ${st.checked ? `<div class="force-canvas-col">
            <div class="force-canvas-label good">✓ Верная диаграмма</div>
            <div class="force-canvas-wrap" id="force-mount-ref"></div>
          </div>` : ""}
        </div>
        <div class="force-pool">${chips}</div>
        ${st.checked ? "" : `<div class="force-actions"><button class="btn btn-gold" data-act="forces-check">Проверить</button></div>`}
        ${feedback}
        ${st.checked ? renderForceFollowUp(st, sc) : ""}
        ${st.checked ? `<div class="tr-actions"><button class="btn btn-primary" data-act="forces-next">Следующий сценарий →</button><button class="btn btn-ghost" data-act="forces-retry">↺ Ещё раз</button></div>` : ""}
      </div>`;
  }

  /* монтирует живой(ые) canvas после того, как HTML уже вставлен в DOM — вызывается из render() */
  /* ============================================================
     ЭКРАН: карточка для шеринга прогресса (canvas → PNG)
     ============================================================ */
  function viewShareCard() {
    return `
      <div class="mq-mission-top">
        <button class="btn btn-ghost" data-act="go" data-view="cabinet">← Профиль</button>
        <span class="mq-badge">📤 Поделиться</span>
      </div>
      <div class="share-card-wrap">
        <canvas id="share-canvas" width="800" height="450" class="share-canvas"></canvas>
      </div>
      <div class="mq-actions" style="justify-content:center">
        <button class="btn btn-gold" data-act="share-download">⬇️ Скачать картинку</button>
        <button class="btn btn-primary" data-act="share-native">📤 Отправить</button>
      </div>
      <div class="gh-sub" style="text-align:center;margin-top:10px">Сохрани и покажи учителю, родителям или отправь в чат класса.</div>`;
  }

  function mountShareCardIfNeeded() {
    if (ui.view !== "share-card") return;
    const canvas = document.getElementById("share-canvas");
    if (!canvas) return;
    const draw = () => drawShareCard(canvas);
    if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(draw).catch(draw);
    } else {
      draw();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawShareCard(canvas) {
    const hero = State.data.hero;
    if (!hero || !canvas || !canvas.getContext) return;
    const li = State.levelInfo();
    const cls = State.heroClass();
    const s = State.streakInfo();
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#0a0a1f");
    bg.addColorStop(1, "#171a45");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.82, H * 0.12, 10, W * 0.82, H * 0.12, 320);
    glow.addColorStop(0, "rgba(56,225,255,0.28)");
    glow.addColorStop(1, "rgba(56,225,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(255,209,102,0.55)";
    ctx.lineWidth = 3;
    roundRect(ctx, 8, 8, W - 16, H - 16, 18);
    ctx.stroke();

    ctx.fillStyle = "#9aa0c7";
    ctx.font = "600 20px 'Rubik', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("⚛️ ФизМат RPG", 40, 46);

    ctx.font = "112px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(State.equippedAvatarIcon() || "🧑‍🚀", 34, 175);
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = "#eef1ff";
    ctx.font = "800 40px 'Russo One', sans-serif";
    ctx.fillText(hero.name, 200, 108);

    ctx.fillStyle = "#38e1ff";
    ctx.font = "600 21px 'Rubik', sans-serif";
    ctx.fillText(`${cls.icon} ${cls.name} · Уровень ${li.level} — ${li.title}`, 200, 142);

    const barX = 200, barY = 165, barW = 560, barH = 18;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, barX, barY, barW, barH, 9); ctx.fill();
    ctx.fillStyle = "#38e1ff";
    const fillW = li.isMax ? barW : Math.max(12, barW * (li.percent / 100));
    roundRect(ctx, barX, barY, fillW, barH, 9); ctx.fill();
    ctx.fillStyle = "#9aa0c7";
    ctx.font = "14px 'Rubik', sans-serif";
    ctx.fillText(li.isMax ? "Максимальный уровень" : `${li.xpIntoLevel} / ${li.xpForLevel} XP`, barX, barY + barH + 20);

    const stats = [
      { ico: "📚", val: `${State.topicsStudied()}/${State.totalTopics()}`, label: "тем изучено" },
      { ico: "🔥", val: String(s.count), label: (s.status === "broken" || s.status === "none") ? "серия — начни!" : (s.count === 1 ? "день подряд" : "дней подряд") },
      { ico: "🏆", val: String(State.data.achievements.length), label: "достижений" },
    ];
    const boxW = 220, boxGap = 20, boxY = 246, boxH = 128;
    stats.forEach((st, i) => {
      const bx = 40 + i * (boxW + boxGap);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      roundRect(ctx, bx, boxY, boxW, boxH, 16); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      roundRect(ctx, bx, boxY, boxW, boxH, 16); ctx.stroke();
      ctx.textAlign = "center";
      ctx.font = "38px sans-serif";
      ctx.fillStyle = "#eef1ff";
      ctx.fillText(st.ico, bx + boxW / 2, boxY + 46);
      ctx.font = "800 32px 'Russo One', sans-serif";
      ctx.fillStyle = "#ffd166";
      ctx.fillText(st.val, bx + boxW / 2, boxY + 86);
      ctx.font = "14px 'Rubik', sans-serif";
      ctx.fillStyle = "#9aa0c7";
      ctx.fillText(st.label, bx + boxW / 2, boxY + 108);
      ctx.textAlign = "left";
    });

    ctx.fillStyle = "#5a5f80";
    ctx.font = "13px 'Rubik', sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(new Date().toLocaleDateString("ru-RU"), W - 30, H - 20);
    ctx.textAlign = "left";
  }

  function mountForcesIfNeeded() {
    if (ui.view !== "forces" || !ui.forces) return;
    const st = ui.forces;
    const sc = (GAME.forceScenarios || []).find((s) => s.id === st.scenarioId);
    if (!sc) return;
    if (!st.checked) {
      const el = document.getElementById("force-mount-user");
      if (!el) return;
      if (activeForceInst) { try { activeForceInst.destroy(); } catch (e) {} }
      activeForceInst = Forces.mount(el, sc, { readOnly: false });
    } else {
      const elU = document.getElementById("force-mount-user");
      const elR = document.getElementById("force-mount-ref");
      if (activeForceInst) { try { activeForceInst.destroy(); } catch (e) {} activeForceInst = null; }
      if (elU) {
        const snap = Forces.mount(elU, sc, { readOnly: true });
        Object.keys(st.snapshot || {}).forEach((id) => snap.addForce(id, st.snapshot[id]));
        snap.render();
      }
      if (elR) {
        const ref = Forces.mount(elR, sc, { readOnly: true });
        ref.setAllCorrect(); ref.render();
      }
    }
  }

  function forcesPick(id) {
    ui.forces = { scenarioId: id, checked: false, result: null, snapshot: null, fu: null };
    ui.view = "forces"; render(); window.scrollTo(0, 0);
  }
  function forcesToggleChip(node, id) {
    const st = ui.forces; if (!st || st.checked || !activeForceInst) return;
    if (activeForceInst.hasForce(id)) { activeForceInst.removeForce(id); node.classList.remove("on"); }
    else { activeForceInst.addForce(id); node.classList.add("on"); }
    activeForceInst.render();
  }
  function forcesCheck() {
    const st = ui.forces; if (!st || !activeForceInst) return;
    const sc = (GAME.forceScenarios || []).find((s) => s.id === st.scenarioId);
    if (!sc) return;
    const snapshot = {};
    activeForceInst.placedIds().forEach((id) => { snapshot[id] = activeForceInst.angleOf(id); });
    const result = Forces.evaluate(sc, activeForceInst);
    st.snapshot = snapshot; st.result = result; st.checked = true;
    tone(result.fullyCorrect ? "correct" : "wrong");
    if (result.fullyCorrect) {
      if (!State.data.forcesDone) State.data.forcesDone = {};
      if (!State.data.forcesDone[sc.id]) { State.data.forcesDone[sc.id] = true; State.addXP(8, "forces"); }
      State.save();
      confetti(16);
    }
    if (sc.followUp) { const gen = sc.followUp.generate(); st.fu = { q: gen.q, answer: gen.answer, unit: gen.unit, tol: gen.tol != null ? gen.tol : 0.5, answered: false, correct: false }; }
    render();
  }
  function forcesFuCheck() {
    const st = ui.forces; if (!st || !st.fu) return;
    const input = document.getElementById("inp-forces-fu");
    const val = parseFloat(String(input ? input.value : "").replace(",", "."));
    const ok = !isNaN(val) && Math.abs(val - st.fu.answer) <= st.fu.tol;
    st.fu.answered = true; st.fu.correct = ok;
    tone(ok ? "correct" : "wrong");
    if (ok) { State.addXP(5, "forces"); State.save(); }
    render();
  }
  function forcesRetry() {
    const st = ui.forces; if (!st) return;
    ui.forces = { scenarioId: st.scenarioId, checked: false, result: null, snapshot: null, fu: null };
    render();
  }
  function forcesNext() {
    const st = ui.forces; if (!st) return;
    const g = ui.gradeSel;
    const scenarios = (GAME.forceScenarios || []).filter((s) => s.grade === g);
    const idx = scenarios.findIndex((s) => s.id === st.scenarioId);
    const next = scenarios[idx + 1];
    if (next) forcesPick(next.id);
    else { if (activeForceInst) { try { activeForceInst.destroy(); } catch (e) {} activeForceInst = null; } ui.forces = null; render(); window.scrollTo(0, 0); }
  }
  function forcesBack() {
    if (activeForceInst) { try { activeForceInst.destroy(); } catch (e) {} activeForceInst = null; }
    ui.forces = null; render(); window.scrollTo(0, 0);
  }

  function viewTrainer() {
    const key = ui.tr ? ui.tr.key : null;
    const gen = trGen(key);
    if (!gen) return viewCourseMission();
    const flat = courseFlat();
    const m = flat.find((x) => x.key === key);
    let topicTitle = m ? m.tp.t : "Тренажёр";
    if (!m) { const t8 = (window.TRAINER_TOPICS_G8 || []).find((t) => t.key === key); if (t8) topicTitle = t8.title; const t9 = (window.TRAINER_TOPICS_G9 || []).find((t) => t.key === key); if (t9) topicTitle = t9.title; }
    const level = ui.tr.level;
    const maxLevel = State.trainerMaxLevel(key);
    const names = window.TRAINER_LEVELS || ["Разминка", "Уверенно", "Вызов"];
    const fb = ui.trFb, task = ui.tr.task;

    const pills = [1, 2, 3].map((l) => {
      const unlocked = l <= Math.max(maxLevel, level);
      const cls = (l === level ? "on" : "") + (unlocked ? "" : " lock");
      const act = unlocked ? `data-act="trainer-setlevel" data-lvl="${l}"` : `data-act="trainer-locked"`;
      return `<button class="tr-pill ${cls}" ${act}>${l}. ${names[l - 1]}${unlocked ? "" : " 🔒"}</button>`;
    }).join("");

    let bodyHTML;
    if (fb && fb.checked) {
      const ok = fb.correct;
      const canLevelUp = ok && ui.tr.streak >= 3 && level < 3;
      bodyHTML = `
        <div class="tr-card">
          <div class="tr-q">${esc(ru(task.q))}</div>
          <div class="tr-fb ${ok ? "ok" : "bad"}">${ok ? "✅ Верно!" : `❌ Не верно. Правильный ответ: <b>${esc(ru(task.a))}${task.u ? " " + esc(task.u) : ""}</b>`}</div>
          <div class="tr-sol"><b>Решение.</b> ${esc(ru(task.sol))}</div>
          <div class="tr-actions">
            <button class="btn btn-primary" data-act="trainer-next">Следующая задача →</button>
            ${canLevelUp ? `<button class="btn btn-gold" data-act="trainer-levelup">🔓 Уровень ${level + 1}: ${names[level]}</button>` : ""}
          </div>
        </div>`;
    } else {
      bodyHTML = `
        <div class="tr-card">
          <div class="tr-q">${esc(ru(task.q))}</div>
          <div class="answer-row">
            <input id="inp-trainer" class="num-input" type="text" inputmode="decimal" autocomplete="off" placeholder="Ответ">
            ${task.u ? `<span class="unit">${esc(task.u)}</span>` : ""}
            <button class="btn btn-gold" data-act="trainer-check">Проверить</button>
          </div>
        </div>`;
    }

    const streakTxt = level < 3
      ? `Решено верно подряд: <b>${ui.tr.streak}</b> / 3 — до уровня «${names[level]}»`
      : `Уровень «Вызов» — наивысший. Тренируйся сколько хочешь!`;

    return `
      <div class="mq-mission-top">
        <button class="btn btn-ghost" data-act="trainer-back">← К теме</button>
        <span class="mq-badge">🎯 Тренажёр</span>
      </div>
      <h2 class="mq-h">${esc(topicTitle)}</h2>
      <div class="tr-levels">${pills}</div>
      <div class="tr-streak">${streakTxt}</div>
      ${bodyHTML}`;
  }

  function cabHero() {
    const hero = State.data.hero;
    const li = State.levelInfo();
    const cls = State.heroClass();
    const st = State.data.stats;
    const stats = [
      { n: State.topicsStudied(), l: "Тем пройдено" },
      { n: st.correctAnswers, l: "Верных ответов" },
      { n: st.problemsSolved, l: "Задач решено" },
      { n: st.experiments, l: "Экспериментов" },
      { n: st.bossesDefeated, l: "Боссов побеждено" },
      { n: State.data.achievements.length, l: "Достижений" },
    ];
    return `
      <div class="panel">
        <div class="hero-sheet">
          <div class="hs-avatar">${State.equippedAvatarIcon()}</div>
          <div class="hs-info">
            <div class="hs-name">${esc(hero.name)}</div>
            <div class="hs-class">${cls.icon} ${esc(cls.name)} · Ур. ${li.level} — ${esc(li.title)}</div>
            <div class="hs-bonus">${esc(cls.bonusText)}</div>
            <div class="hs-style">🧭 Стиль исследователя: <b>${esc(State.styleLabel())}</b></div>
          </div>
        </div>
        <div style="margin-top:18px">
          <div class="bar-label"><span>Опыт</span><span>${li.isMax ? "МАКС" : li.xpIntoLevel + " / " + li.xpForLevel + " XP"}</span></div>
          <div class="bar bar-xp"><div class="bar-fill" style="width:${li.percent}%"></div></div>
        </div>
        <div class="stat-grid">
          ${stats.map((s) => `<div class="stat-box"><div class="sb-num">${s.n}</div><div class="sb-lbl">${s.l}</div></div>`).join("")}
        </div>
        <button class="btn btn-gold" style="width:100%;margin-top:14px" data-act="open-share-card">📤 Поделиться результатом</button>
        <button class="btn btn-ghost" style="width:100%;margin-top:8px" data-act="replay-tour">🧭 Пересмотреть экскурсию по приложению</button>
      </div>
      <div class="save-card">
        <div class="save-head">💾 Сохранение прогресса</div>
        <div class="save-desc">Перенеси прогресс на другое устройство: выгрузи файл здесь и загрузи его там же.</div>
        <div class="save-btns">
          <button class="btn btn-primary" data-act="export-save">⬇️ Экспорт</button>
          <button class="btn" data-act="import-save">⬆️ Импорт</button>
        </div>
        <div class="save-warn">⚠️ Импорт заменит текущий прогресс.</div>
      </div>`;
  }

  function cabKnowledge() {
    const started = GAME.topics.filter((t) => State.data.progress[t.id] && State.data.progress[t.id].started);
    const weak = State.weakTopics();
    let list;
    if (!started.length) {
      list = `<div class="empty-hint">Ты ещё не начал ни одной темы. Открой карту миров и вперёд!</div>`;
    } else {
      list = started.map((t) => {
        const p = State.data.progress[t.id];
        const sd = State.topicStageDone(t.id);
        const total = 4;
        const doneStages = [sd.theory, sd.experiment, (sd.questions && sd.problems), sd.boss].filter(Boolean).length;
        const state = p.completed
          ? `<span class="kr-state" style="color:var(--bio-green)">✓ Пройдена</span>`
          : `<span class="kr-state" style="color:var(--star-gold)">${doneStages}/${total} этапов</span>`;
        return `<div class="know-row" data-act="open-topic" data-id="${t.id}" style="cursor:pointer">
                  <span class="kr-ico">${t.icon}</span><span class="kr-name">${esc(t.title)}</span>${state}</div>`;
      }).join("");
    }
    const weakBlock = weak.length ? `
      <div class="screen-head" style="margin:22px 0 10px"><h3 style="font-size:18px;color:var(--reaction-pink)">⚠️ Слабые темы</h3>
        <div class="sub">Здесь было больше всего ошибок — стоит повторить.</div></div>
      ${weak.map((t) => `<div class="know-row" data-act="open-topic" data-id="${t.id}" style="cursor:pointer">
          <span class="kr-ico">${t.icon}</span><span class="kr-name">${esc(t.title)}</span>
          <span class="kr-state weak">${State.data.progress[t.id].mistakes} ошибок</span></div>`).join("")}` : "";
    return `<div class="screen-head" style="margin-bottom:10px"><h3 style="font-size:18px">📚 Изучаемые темы</h3></div>${list}${weakBlock}`;
  }

  function buildMissions() {
    const out = [];
    GAME.worlds.filter((w) => w.status === "open").forEach((w) => {
      const topics = State.topicsOfWorld(w.id);
      const next = topics.find((t) => State.isTopicUnlocked(t.id) && !(State.data.progress[t.id] && State.data.progress[t.id].completed));
      if (next) out.push({ ico: next.icon, title: `Заверши тему «${next.title}»`, sub: w.name, done: false, topicId: next.id });
    });
    const st = State.data.stats;
    out.push({ ico: "🎯", title: "Дай 10 верных ответов", sub: `Прогресс: ${Math.min(st.correctAnswers, 10)}/10`, done: st.correctAnswers >= 10 });
    out.push({ ico: "🧮", title: "Реши 15 задач", sub: `Прогресс: ${Math.min(st.problemsSolved, 15)}/15`, done: st.problemsSolved >= 15 });
    out.push({ ico: "⚔️", title: "Победи первого босса", sub: st.bossesDefeated > 0 ? "Выполнено" : "Дойди до финальной задачи темы", done: st.bossesDefeated > 0 });
    return out;
  }
  function cabMissions() {
    const ms = buildMissions();
    return `
      <div class="screen-head" style="margin-bottom:12px"><h3 style="font-size:18px">📋 Текущие миссии</h3>
        <div class="sub">Выполняй задания, чтобы расти быстрее.</div></div>
      ${ms.map((m) => `
        <div class="mission ${m.done ? "done" : ""}" ${m.topicId ? `data-act="open-topic" data-id="${m.topicId}" style="cursor:pointer"` : ""}>
          <span class="m-ico">${m.done ? "✅" : m.ico}</span>
          <div class="m-body"><div class="m-title">${esc(m.title)}</div><div class="m-sub">${esc(m.sub)}</div></div>
        </div>`).join("")}`;
  }

  function cabCollection() {
    const achs = GAME.achievements.map((a) => {
      const got = State.data.achievements.includes(a.id);
      return `<div class="ach ${got ? "got" : ""}">
                <div class="a-ico">${a.icon}</div><div class="a-name">${esc(a.title)}</div>
                <div class="a-desc">${esc(a.desc)}</div>${got ? "" : `<div class="locked-tag">🔒 не открыто</div>`}</div>`;
    }).join("");
    const items = GAME.items.map((it) => {
      const got = State.data.items.includes(it.id);
      return `<div class="col-item ${got ? "got" : ""}">
                <div class="ci-ico">${it.icon}</div><div class="ci-name">${esc(it.name)}</div>
                <div class="ci-desc">${got ? esc(it.desc) : "Победи босса темы, чтобы получить."}</div></div>`;
    }).join("");
    return `
      <div class="screen-head" style="margin-bottom:12px"><h3 style="font-size:18px">🏆 Достижения (${State.data.achievements.length}/${GAME.achievements.length})</h3></div>
      <div class="ach-grid">${achs}</div>
      <div class="screen-head" style="margin:24px 0 12px"><h3 style="font-size:18px">💎 Артефакты (${State.data.items.length}/${GAME.items.length})</h3></div>
      <div class="item-grid">${items}</div>`;
  }

  /* ============================================================
     ЭКРАН: Лавка
     ============================================================ */
  function viewShop() {
    const coins = State.data.hero.coins;
    const avatars = GAME.shop.avatars.map((a) => {
      const owned = State.data.unlocks.avatars.includes(a.id);
      const eq = State.data.equipped.avatar === a.id;
      const action = owned
        ? (eq ? `<div class="tag-eq">✓ Экипировано</div>` : `<button class="btn btn-sm" data-act="equip-avatar" data-id="${a.id}">Надеть</button>`)
        : `<button class="btn btn-primary btn-sm" data-act="buy-avatar" data-id="${a.id}" ${coins < a.price ? "disabled" : ""}>Купить</button>`;
      return `<div class="shop-item ${owned ? "owned" : ""} ${eq ? "equipped" : ""}">
                <div class="si-ico">${a.icon}</div><div class="si-name">${esc(a.name)}</div>
                ${owned ? "" : `<div class="price">🪙 ${a.price}</div>`}
                <div style="margin-top:8px">${action}</div></div>`;
    }).join("");
    const accents = GAME.shop.accents.map((a) => {
      const owned = State.data.unlocks.accents.includes(a.id);
      const eq = State.data.equipped.accent === a.id;
      const action = owned
        ? (eq ? `<div class="tag-eq">✓ Активен</div>` : `<button class="btn btn-sm" data-act="equip-accent" data-id="${a.id}">Выбрать</button>`)
        : `<button class="btn btn-primary btn-sm" data-act="buy-accent" data-id="${a.id}" ${coins < a.price ? "disabled" : ""}>Купить</button>`;
      return `<div class="shop-item ${owned ? "owned" : ""} ${eq ? "equipped" : ""}">
                <div class="swatch" style="background:${a.color}"></div><div class="si-name">${esc(a.name)}</div>
                ${owned ? "" : `<div class="price">🪙 ${a.price}</div>`}
                <div style="margin-top:8px">${action}</div></div>`;
    }).join("");
    return `
      <div class="screen-head"><h2>🛒 Лавка артефактов</h2>
        <div class="sub">Трать монеты на облик героя. У тебя: <span class="coins">🪙 ${coins}</span></div></div>
      <div class="shop-section"><h3 style="font-size:18px">🧑‍🚀 Аватары</h3><div class="shop-grid">${avatars}</div></div>
      <div class="shop-section"><h3 style="font-size:18px">🎨 Цвет энергии</h3><div class="shop-grid">${accents}</div></div>`;
  }

  /* ============================================================
     ЭКРАН: кабинет учителя (демонстрация-задел)
     ============================================================ */
  // PIN-замок кабинета учителя
  function cabTeacherLock() {
    return `
      <div class="screen-head"><h2>👩‍🏫 Кабинет учителя</h2><div class="sub">Раздел защищён PIN-кодом.</div></div>
      <div class="pin-card">
        <div class="pin-ico">🔒</div>
        <div class="pin-title">Введите PIN учителя</div>
        <input id="teacher-pin" class="pin-input" type="password" inputmode="numeric" maxlength="8" placeholder="••••" autocomplete="off">
        <button class="btn btn-primary" data-act="teacher-unlock">Войти</button>
        <div class="pin-hint">Для учеников этот раздел закрыт.</div>
      </div>`;
  }

  // Онбординг для новичков (показывается один раз)
  /* ============================================================
     ЭКСКУРСИЯ ПО ПРИЛОЖЕНИЮ (аппарат ориентировки).
     Каждый шаг может: подсвечивать реальный элемент интерфейса
     (sel — CSS-селектор), требовать определённого экрана (view),
     и объяснять «что это и зачем». Если элемент на экране не найден,
     шаг показывается обычной карточкой по центру — без подсветки.
     ============================================================ */
  const ONB = [
    {
      ico: "🚀", title: "Что здесь можно делать",
      text: "Это помощник по физике за 7 класс. Здесь ты разбираешь темы сам: читаешь понятные объяснения, решаешь задачи и возвращаешься к старым темам, чтобы не забыть их к контрольной. Сейчас проведу по приложению и покажу, где что лежит.",
      go: { view: "grade" },
    },
    {
      ico: "📖", title: "Учебник — отсюда всё начинается",
      text: "Вот эта кнопка. Внутри — все темы курса: объяснения без заумных слов, разобранные примеры и задачи. Сюда ты будешь заходить чаще всего.",
      go: { view: "grade" }, sel: '[data-act="open-course"]',
    },
    {
      ico: "🗺️", title: "Карта тем",
      text: "Так выглядит список тем. Проходишь их по очереди, но можно зайти в любую — ничего не заблокировано, если захочешь заглянуть вперёд.",
      go: { view: "course" }, sel: ".mq-progress, .mq-hero",
    },
    {
      ico: "🧭", title: "Внутри темы — 4 шага",
      text: "Вот эта полоска наверху. Старт → Исследуем → Практика → Проверка. Это твой путь по теме. Нажми на любой шаг — сразу перепрыгнешь к нему.",
      go: { view: "course-mission", mission: { sec: "mechanics", idx: 6 } }, sel: ".lesson-rail",
    },
    {
      ico: "🔍", title: "Сначала угадай сам",
      text: "В теме будет вопрос ещё ДО объяснения. Просто предположи наугад — тут можно ошибаться, это даже полезно: так лучше запомнится то, что идёт следом. Опыт дадут за саму попытку, даже если не угадал.",
      go: { view: "course-mission", mission: { sec: "mechanics", idx: 6 } }, sel: ".th-explore",
    },
    {
      ico: "❌", title: "Чужие ошибки",
      text: "Красные карточки вроде этой. Показано неправильное решение — найди, где спрятался подвох. Это ошибки, на которых спотыкаются чаще всего: увидишь заранее — сам так не сделаешь.",
      go: { view: "course-mission", mission: { sec: "mechanics", idx: 6 } }, sel: ".th-mistake",
    },
    {
      ico: "🌙", title: "Особое испытание",
      text: "Фиолетовая карточка — задачка похитрее. Ситуация непохожая на примеры выше: проверяет, понял ты тему или просто запомнил образец. Не вышло — открой разбор, там всё по шагам.",
      go: { view: "course-mission", mission: { sec: "mechanics", idx: 6 } }, sel: ".th-transfer",
    },
    {
      ico: "⚔️", title: "Задачи посильнее и попроще",
      text: "У задач есть пометки: База, Средний, Повышенный. Тема новая — начинай с базы. Пошло легко — бери выше. Застрял — открой решение и посмотри, как надо.",
      go: { view: "course-mission", mission: { sec: "mechanics", idx: 6 } }, sel: "#stage-tasks",
    },
    {
      ico: "🎯", title: "Сам ставишь себе планку",
      text: "Перед проверкой сам решаешь, на какой результат идёшь. Замахнёшься выше — получишь больше за смелость. Не дотянешь — ничего не потеряешь, тема всё равно засчитается от 70%.",
      go: { view: "course-mission", mission: { sec: "mechanics", idx: 6 } }, sel: ".goal-block",
    },
    {
      ico: "🏆", title: "Финальная проверка",
      text: "8 вопросов, нужно набрать хотя бы 70%. Пока не пройдёшь — тема не засчитается. Не получилось с первого раза — пробуй ещё, попытки не заканчиваются.",
      go: { view: "course-mission", mission: { sec: "mechanics", idx: 6 } }, sel: "#stage-control",
    },
    {
      ico: "🔄", title: "Повторение",
      text: "Через пару дней сданная тема сама всплывёт вот здесь. Короткий тест на пару минут. Чем дольше помнишь — тем реже появляется. Так к концу года ничего не забывается.",
      go: { view: "grade" }, sel: '[data-act="open-review-hub"], [data-act="open-course"]',
    },
    {
      ico: "🔥", title: "Огонёк — дни подряд",
      text: "Счётчик наверху: сколько дней подряд ты занимаешься. Пропустишь день — сгорит, начнёшь заново. Чтобы удержать, хватит пары задач в день.",
      go: { view: "grade" }, sel: ".hud-chip.streak-active, .hud-chip.streak-risk, .hud-chip.streak-off",
    },
    {
      ico: "🔬", title: "Лаборатория — всё про тебя",
      text: "Твой герой, награды, шпаргалка с формулами и раздел «Мои ошибки» — все задачи, где ошибся, с разбором. Загляни туда перед контрольной.",
      go: { view: "cabinet" }, sel: ".subtabs, .screen-head",
    },
    {
      ico: "✅", title: "Всё, можно начинать",
      text: "Коротко: Учебник → тема по четырём шагам → проверка → через пару дней повторение. Захочешь пересмотреть экскурсию — она в Лаборатории.",
      go: { view: "grade" },
    },
  ];

  function showOnboarding(step) {
    step = step || 0;
    if (step >= ONB.length) { closeOnboarding(); return; }
    const s = ONB[step];
    ui.onbStep = step;

    // Экскурсия сама водит по приложению: переключает нужный экран,
    // ждёт отрисовки и только потом подсвечивает элемент.
    if (s.go && State.data.hero) {
      const needView = s.go.view;
      const needMission = s.go.mission;
      const viewChanged = ui.view !== needView;
      const missionChanged = needMission && (!ui.mission || ui.mission.sec !== needMission.sec || ui.mission.idx !== needMission.idx);
      if (viewChanged || missionChanged) {
        if (needMission) ui.mission = { sec: needMission.sec, idx: needMission.idx };
        ui.view = needView;
        render();
        // Даём кадр на отрисовку, затем рисуем подсветку поверх нового экрана
        setTimeout(() => paintOnboarding(step), 60);
        return;
      }
    }
    paintOnboarding(step);
  }

  function paintOnboarding(step) {
    const s = ONB[step], last = step === ONB.length - 1;
    let el = document.getElementById("onboarding");
    if (!el) {
      el = document.createElement("div"); el.id = "onboarding"; el.className = "onb-overlay";
      document.body.appendChild(el);
      el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-onb]"); if (!b) return;
        const a = b.getAttribute("data-onb");
        if (a === "next") showOnboarding((ui.onbStep || 0) + 1);
        else if (a === "prev") showOnboarding(Math.max(0, (ui.onbStep || 0) - 1));
        else if (a === "skip") closeOnboarding();
        else if (a === "done") { closeOnboarding(); confetti(40); }
      });
    }

    // Ищем элемент для подсветки среди перечисленных селекторов —
    // берём первый, который реально виден на экране.
    let target = null;
    if (s.sel) {
      const sels = s.sel.split(",").map((x) => x.trim());
      for (const one of sels) {
        let cand = null;
        try { cand = document.querySelector(one); } catch (_) { cand = null; }
        if (cand) {
          const cr = cand.getBoundingClientRect();
          if (cr.width > 0 && cr.height > 0) { target = cand; break; }
        }
      }
    }

    // Если элемент за пределами видимой области — подкручиваем к нему
    if (target) {
      const r0 = target.getBoundingClientRect();
      if (r0.top < 60 || r0.bottom > window.innerHeight - 60) {
        try { target.scrollIntoView({ block: "center", behavior: "auto" }); } catch (_) {}
      }
    }

    const r = target ? target.getBoundingClientRect() : null;
    const visible = r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;

    let spotlight = "", cardPos = "";
    if (visible) {
      const pad = 8;
      const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
      const w = Math.min(window.innerWidth - x - 4, r.width + pad * 2);
      const h = r.height + pad * 2;
      spotlight = `<div class="onb-spot" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`;
      const below = r.top < window.innerHeight * 0.5;
      cardPos = below
        ? `style="top:${Math.min(window.innerHeight - 250, r.bottom + 16)}px"`
        : `style="bottom:${Math.min(window.innerHeight - 250, window.innerHeight - r.top + 16)}px"`;
    }

    el.className = "onb-overlay" + (visible ? " has-spot" : "");
    el.innerHTML = `
      ${spotlight}
      <div class="onb-card ${visible ? "onb-card-anchored" : ""}" ${cardPos}>
        <div class="onb-ico">${s.ico}</div>
        <div class="onb-title">${esc(s.title)}</div>
        <div class="onb-text">${esc(s.text)}</div>
        <div class="onb-dots">${ONB.map((_, i) => `<span class="onb-dot ${i === step ? "on" : ""}"></span>`).join("")}</div>
        <div class="onb-btns">
          ${step > 0 ? `<button class="btn btn-ghost btn-sm" data-onb="prev">← Назад</button>` : ""}
          ${last ? "" : `<button class="btn btn-ghost btn-sm" data-onb="skip">Пропустить</button>`}
          <button class="btn btn-primary" data-onb="${last ? "done" : "next"}">${last ? "Начать!" : "Далее ▶"}</button>
        </div>
        <div class="onb-counter">${step + 1} из ${ONB.length}</div>
      </div>`;
  }
  function closeOnboarding() { const el = document.getElementById("onboarding"); if (el) el.remove(); State.data.settings.onboarded = true; State.save(); }

  function viewTeacher() {
    const students = (typeof window !== "undefined" && window.TEACHER_DEMO) || [];
    const avg = (t) => Math.round(t.reduce((a, x) => a + x.p, 0) / Math.max(1, t.length));

    if (ui.teacherSel) {
      const st = students.find((s) => s.id === ui.teacherSel);
      if (st) {
        const bars = st.topics.map((t) =>
          `<div class="ts-topic"><span class="ts-topic-n">${esc(t.n)}</span><div class="ts-bar"><div class="ts-bar-fill" style="width:${t.p}%"></div></div><span class="ts-topic-p">${t.p}%</span></div>`).join("");
        const modal = ui.assignFor === st.id ? assignModal(st) : "";
        return `
          <div class="mq-mission-top"><button class="btn btn-ghost" data-act="teacher-back">← К классу</button><span class="mq-badge">👤 Ученик</span></div>
          <div class="ts-head"><div class="ts-ava">${st.emoji}</div><div><div class="ts-name">${esc(st.name)}</div><div class="ts-meta">Уровень ${st.level} · ${st.xp} XP · был(а): ${esc(st.last)}</div></div></div>
          <div class="ts-stats">
            <div class="ts-stat"><div class="ts-stat-v">${avg(st.topics)}%</div><div class="ts-stat-l">курс пройден</div></div>
            <div class="ts-stat"><div class="ts-stat-v">${st.errors}</div><div class="ts-stat-l">ошибок</div></div>
            <div class="ts-stat"><div class="ts-stat-v">${st.time}<span class="ts-stat-u"> мин</span></div><div class="ts-stat-l">в игре</div></div>
          </div>
          <div class="ts-sec-h">Прогресс по темам</div>
          ${bars}
          <button class="btn btn-gold ts-assign" data-act="teacher-assign" data-id="${st.id}">🎯 Назначить задание</button>
          ${modal}`;
      }
    }

    const rows = students.map((s) => {
      const p = avg(s.topics);
      return `<button class="ts-card" data-act="teacher-open" data-id="${s.id}">
          <span class="ts-card-ava">${s.emoji}</span>
          <span class="ts-card-main"><span class="ts-card-name">${esc(s.name)}</span><span class="ts-card-sub">Уровень ${s.level} · ${p}% курса</span><span class="ts-card-bar"><span class="ts-card-bar-fill" style="width:${p}%"></span></span></span>
          <span class="ts-card-go">▶</span>
        </button>`;
    }).join("");
    return `
      <div class="screen-head"><h2>👩‍🏫 Кабинет учителя</h2><div class="sub">Демо для школ: класс из ${students.length} учеников. <button class="btn btn-sm" data-act="teacher-lock">🔒 Заблокировать</button></div></div>
      <div class="demo-banner">⚙️ Демо на локальных данных. Тапни ученика — увидишь прогресс, ошибки и время; можно «назначить задание».</div>
      <div class="ts-list">${rows}</div>`;
  }

  function assignModal(st) {
    const topics = ["Движение", "Плотность", "Силы", "Давление", "Архимед", "Работа и энергия", "Сила трения"];
    const btns = topics.map((t) => `<button class="ts-topic-btn" data-act="teacher-assign-pick" data-id="${st.id}" data-topic="${esc(t)}">${esc(t)}</button>`).join("");
    return `<div class="ts-modal" data-act="teacher-assign-close">
        <div class="ts-modal-panel" data-act="noop">
          <div class="ts-modal-h">🎯 Назначить задание</div>
          <div class="ts-modal-sub">Ученику: <b>${esc(st.name)}</b>. Выбери тему:</div>
          <div class="ts-modal-topics">${btns}</div>
          <button class="btn btn-ghost ts-modal-cancel" data-act="teacher-assign-close">Отмена</button>
        </div>
      </div>`;
  }

  /* ============================================================
     Ньютончик — рисованный персонаж (SVG), выражения по настроению.
     Без внешних картинок: всё рисуется кодом, работает из файла.
     moods: explain (по умолч.), happy, surprised, thinking, worried
     ============================================================ */
  function newton(mood) {
    const m = mood || "explain";
    const skin = "#ffd7b0", skinShade = "#eab98f", hair = "#6f4630",
      coat = "#f4f6ff", coatShade = "#ccd5f5", frame = "#38e1ff",
      line = "#2b2f55", lens = "#dff4ff";
    let brows, eyes, mouth, extra = "";
    if (m === "happy") {
      brows = `<path d="M34 28 Q38.5 26 43 28" /><path d="M57 28 Q61.5 26 66 28" />`;
      eyes = `<path d="M37 43 Q41 39 45 43" stroke="${line}" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M55 43 Q59 39 63 43" stroke="${line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
      mouth = `<path d="M42 52 Q50 61 58 52" stroke="${line}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    } else if (m === "surprised") {
      brows = `<path d="M34 26 Q38.5 23 43 26" /><path d="M57 26 Q61.5 23 66 26" />`;
      eyes = `<circle cx="41" cy="42" r="3.2" fill="${line}"/><circle cx="59" cy="42" r="3.2" fill="${line}"/>`;
      mouth = `<ellipse cx="50" cy="55" rx="3.6" ry="4.6" fill="${line}"/>`;
      extra = `<text x="75" y="24" font-family="Russo One, sans-serif" font-size="14" fill="${frame}">!</text>`;
    } else if (m === "thinking") {
      brows = `<path d="M34 31 Q38.5 30 43 31" /><path d="M57 28 Q61.5 26 66 28" />`;
      eyes = `<circle cx="42" cy="39" r="2.4" fill="${line}"/><circle cx="60" cy="39" r="2.4" fill="${line}"/>`;
      mouth = `<path d="M45 55 Q50 53 55 55" stroke="${line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
      extra = `<text x="74" y="26" font-family="Russo One, sans-serif" font-size="13" fill="${frame}">?</text>`;
    } else if (m === "worried") {
      brows = `<path d="M34 31 Q38.5 28 43 30" /><path d="M57 30 Q61.5 28 66 31" />`;
      eyes = `<circle cx="41" cy="42" r="2.5" fill="${line}"/><circle cx="59" cy="42" r="2.5" fill="${line}"/>`;
      mouth = `<path d="M44 56 Q47 53 50 56 Q53 59 56 56" stroke="${line}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
    } else { // explain
      brows = `<path d="M34 30 Q38.5 28 43 30" /><path d="M57 30 Q61.5 28 66 30" />`;
      eyes = `<circle cx="41" cy="42" r="2.6" fill="${line}"/><circle cx="59" cy="42" r="2.6" fill="${line}"/>`;
      mouth = `<path d="M44 53 Q50 58 56 53" stroke="${line}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    }
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="newton-svg" aria-label="Ньютончик">
      <path d="M20 100 V86 C20 74 30 70 40 68 L60 68 C70 70 80 74 80 86 V100 Z" fill="${coat}" stroke="${coatShade}" stroke-width="1.5"/>
      <path d="M41 68 L50 80 L59 68" fill="none" stroke="${frame}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M50 80 l-3.2 7 3.2 8 3.2 -8 Z" fill="${frame}"/>
      <rect x="46" y="57" width="8" height="12" rx="3" fill="${skinShade}"/>
      <ellipse cx="50" cy="40" rx="20" ry="21" fill="${skin}"/>
      <circle cx="30" cy="42" r="3.4" fill="${skin}"/><circle cx="70" cy="42" r="3.4" fill="${skin}"/>
      <path d="M30 36 C30 18 40 14 50 14 C60 14 70 18 70 36 C64 27 57 29 53 31 C50 24 44 24 41 31 C37 29 34 28 30 36 Z" fill="${hair}"/>
      <g stroke="${hair}" stroke-width="2.5" fill="none" stroke-linecap="round">${brows}</g>
      <circle cx="41" cy="42" r="8" fill="${lens}" fill-opacity="0.5" stroke="${frame}" stroke-width="2.5"/>
      <circle cx="59" cy="42" r="8" fill="${lens}" fill-opacity="0.5" stroke="${frame}" stroke-width="2.5"/>
      <line x1="49" y1="42" x2="51" y2="42" stroke="${frame}" stroke-width="2.5"/>
      <path d="M33 40 l-4 -1" stroke="${frame}" stroke-width="2" stroke-linecap="round"/>
      <path d="M67 40 l4 -1" stroke="${frame}" stroke-width="2" stroke-linecap="round"/>
      ${eyes}
      ${mouth}
      ${extra}
    </svg>`;
  }

  function newtonHubLine() {
    const chs = (GAME.chapters || []).filter((c) => c.status === "open" && (c.grade || 7) === ui.gradeSel);
    if (chs.length && chs.every((c) => State.isChapterDone(c.id)))
      return { mood: "happy", text: "Источник Знаний восстановлен! Ты прошёл все миры — настоящий Хранитель науки. Можно перепройти любую главу или отточить темы в практике." };
    const a = State.data.adventure || {};
    // продолжение уже начатой главы
    const cur = chs.find((c) => c.id === a.current && (a.scene || 0) > 0 && !State.isChapterDone(c.id));
    if (cur) return { mood: "explain", text: `С возвращением, напарник! Глава «${cur.title}» ещё не закончена — продолжим?` };
    // следующая доступная непройденная глава
    const next = chs.find((c) => !State.isChapterDone(c.id) && (!c.requires || State.isChapterDone(c.requires)));
    if (next) return { mood: next.hubMood || "surprised", text: hubOf(next) || `Впереди — глава «${next.title}». Берёмся?` };
    return { mood: "explain", text: "Продолжим путь?" };
  }

  /* ============================================================
     ЭКРАН: список глав (визуальная новелла)
     ============================================================ */
  function viewAdventure() {
    const hub = newtonHubLine();
    const greeting = `
      <div class="hub-greet">
        <div class="hub-portrait">${newton(hub.mood)}</div>
        <div class="hub-bubble"><div class="hub-name">Ньютончик</div><div class="hub-text">${esc(hub.text)}</div></div>
      </div>`;
    const chs = sortChaptersByStory((GAME.chapters || []).filter((c) => (c.grade || 7) === ui.gradeSel));
    const cards = chs.map((c) => {
      const soon = c.status !== "open";
      const reqLock = !chaptersFree() && c.requires && !State.isChapterDone(c.requires);
      const done = State.isChapterDone(c.id);
      const started = State.data.adventure.current === c.id && (State.data.adventure.scene || 0) > 0 && !done;
      const cls = (soon || reqLock) ? "locked" : done ? "done" : "open";
      let act;
      if (soon) {
        act = `<span class="ch-soon">🔒 Скоро</span>`;
      } else if (reqLock) {
        const prev = chapter(c.requires);
        act = `<span class="ch-soon">🔒 Сначала: ${esc(prev ? prev.title : "предыдущая глава")}</span>`;
      } else {
        const label = done ? "Пройти заново" : (started ? "Продолжить" : "Играть");
        act = `<button class="btn btn-primary btn-sm" data-act="adv-start" data-ch="${c.id}">${label} ▶</button>`;
      }
      return `
        <div class="ch-card ${cls}" style="--w-accent:${c.accent || "#38e1ff"}">
          <div class="ch-ico">${c.icon}</div>
          <div class="ch-body">
            <div class="ch-sub">${esc(c.subtitle || "")}</div>
            <div class="ch-title">${esc(c.title)}${done ? ` <span class="ch-done">✓</span>` : ""}</div>
            <div class="ch-blurb">${esc(blurbOf(c))}</div>
          </div>
          <div class="ch-act">${act}</div>
        </div>`;
    }).join("");
    return `
      <div class="mq-mission-top"><button class="btn btn-ghost" data-act="open-grade" data-grade="${ui.gradeSel}">← Меню</button><span class="mq-badge">🎬 Сюжет</span></div>
      ${greeting}
      <div class="screen-head">
        <h2>${curScenario().ico} ${esc(curScenario().head)}</h2>
        <div class="sub">${esc(curScenario().intro)}</div>
        <div class="scen-pick">${SCENARIOS.map((sn) => `<button class="scen-btn ${sn.id === scenId() ? "active" : ""}" data-act="pick-scenario" data-scen="${sn.id}">${sn.ico} ${esc(sn.name)}</button>`).join("")}</div>
        <div class="scen-pick mode-pick"><span class="scen-label">Доступ к главам:</span><button class="scen-btn ${chaptersFree() ? "active" : ""}" data-act="set-chmode" data-mode="free">🔓 Все открыты</button><button class="scen-btn ${!chaptersFree() ? "active" : ""}" data-act="set-chmode" data-mode="story">🧭 По порядку</button></div>
      </div>
      <div class="ch-list">${cards}</div>`;
  }

  /* ============================================================
     ЭКРАН: сцена главы (проигрыватель новеллы)
     ============================================================ */
  // ===== Сеттинги сюжета: выбор сценария-обёртки =====
  const SCENARIOS = [
    { id: "worlds", name: "Путешествие по мирам", ico: "🌌", head: "Путешествие по мирам",
      intro: "Хаос расколол Вселенную Физики на отдельные миры и заморозил в каждом его закон. Ты — Хранитель: иди из мира в мир и оживляй закон за законом." },
    { id: "city", name: "Механополис", ico: "🏙️", head: "Восстановление Механополиса",
      intro: "Механополис — город, что жил механикой, замер под натиском Хаоса. Оживляй его по шагам: цех за цехом, машину за машиной." },
    { id: "space", name: "Космос", ico: "🚀", head: "Космическая экспедиция «Архимед»",
      intro: "Звёздный корабль «Архимед» потерял ход: законы физики сбоят отсек за отсеком. Восстанови их и верни кораблю движение." },
  ];
  function scenId() { return (State.data.settings && State.data.settings.scenario) || "worlds"; }
  function chaptersFree() { return !(State.data.settings && State.data.settings.freeChapters === false); }
  function curScenario() { return SCENARIOS.find((x) => x.id === scenId()) || SCENARIOS[0]; }
  function scSet(c) { return (c && c.sets && c.sets[scenId()]) || null; }
  function blurbOf(c) { const z = scSet(c); return (z && z.blurb) || (c && c.blurb) || ""; }
  function hubOf(c) { const z = scSet(c); return (z && z.hub) || (c && c.hub); }
  function outroOf(c) { const z = scSet(c); return (z && z.outro) || (c && c.outro) || {}; }
  function sBy(sc, base) { return (sc && sc.by && sc.by[scenId()] != null) ? sc.by[scenId()] : base; }

  function viewScene() {
    const ch = chapter(ui.chId);
    if (!ch || !ch.scenes) {
      return `<div class="screen-head"><h2>История</h2></div>
        <div class="vn-empty">Глава недоступна. <a data-act="go" data-view="adventure">← Вернуться к главам</a></div>`;
    }
    let idx = State.sceneIndex(ch.id);
    if (idx >= ch.scenes.length) idx = ch.scenes.length - 1;
    const sc = ch.scenes[idx];

    // портрет и имя говорящего
    const isNewton = sc.type !== "boss" && (sc.speaker === "Ньютончик" || sc.speaker === GAME.mentor.name);
    const portrait = isNewton ? newton(sc.mood) : (sc.emoji || GAME.mentor.avatar);
    const portraitCls = isNewton ? "vn-portrait has-char" : "vn-portrait";
    const name = sc.type === "boss" ? (sc.title || "Испытание") : (sc.speaker || GAME.mentor.name);
    const baseText = sc.type === "boss" ? sc.story : (sc.type === "practice" ? sc.intro : sc.text);
    const mainText = sBy(sc, baseText);

    let body = "";
    if (sc.type === "line") body = sceneLine(sc);
    else if (sc.type === "concept") body = sceneConcept(sc);
    else if (sc.type === "practice") body = scenePractice(sc);
    else if (sc.type === "boss") body = sceneBoss(sc, ch);

    return `
      <div class="scene" style="--w-accent:${ch.accent || "#38e1ff"}">
        <div class="vn-top">
          <a class="vn-back" data-act="go" data-view="adventure">← К главам</a>
          <span class="vn-progress">${esc(ch.title)} · сцена ${idx + 1} из ${ch.scenes.length}</span>
        </div>
        <div class="vn-stage">
          <div class="${portraitCls}">${portrait}</div>
          <div class="vn-box">
            <div class="vn-name">${esc(name)}</div>
            ${mainText ? `<div class="vn-text">${esc(mainText)}</div>` : ""}
            ${body}
          </div>
        </div>
      </div>`;
  }

  // — реплика: «Дальше» или narrative-выборы —
  function sceneLine(sc) {
    if (sc.choices && sc.choices.length) {
      const opts = sc.choices.map((o, i) => {
        const label = typeof o === "string" ? o : o.text;
        return `<button class="vn-choice" data-act="scene-choice" data-idx="${i}">${esc(label)}</button>`;
      }).join("");
      return `<div class="vn-choices">${opts}</div>`;
    }
    return `<div class="vn-actions"><button class="btn btn-primary" data-act="scene-next">Дальше ▶</button></div>`;
  }

  // — концепт: разбор ошибок по каждому неверному варианту —
  function sceneConcept(sc) {
    const fb = ui.fb.concept || {};
    const solved = !!fb.solved;
    const opts = shuffledOrder(sc.options, sc.q).map((i) => {
      const o = sc.options[i];
      let c = "";
      if (solved && i === sc.correct) c = "correct";
      else if (!solved && fb.wrong === i) c = "wrong";
      return `<button class="option ${c}" ${solved ? "disabled" : ""} data-act="scene-concept" data-idx="${i}">${esc(o)}</button>`;
    }).join("");
    let feed = "";
    if (solved) feed = `<div class="vn-feedback ok"><b>✔ </b>${esc(sc.explain)}</div>`;
    else if (fb.wrong != null) feed =
      `<div class="vn-feedback bad"><span class="vn-mini-name">${esc(GAME.mentor.name)}:</span> ${esc(sc.analysis[fb.wrong] || "Хм, не совсем. Подумай ещё раз.")}</div>`;
    const next = solved ? `<div class="vn-actions"><button class="btn btn-primary" data-act="scene-next">Дальше ▶</button></div>` : "";
    const graph = sc.svg ? `<div class="vn-graph">${sc.svg}</div>` : "";
    return `${graph}<div class="vn-q">${esc(sc.q)}</div><div class="options">${opts}</div>${feed}${next}`;
  }

  // — практика: набор задач ОГЭ-формата —
  function scenePractice(sc) {
    const itemsHTML = sc.items.map((it, i) => {
      const f = ui.fb["it:" + i] || {};
      const solved = !!f.solved;
      let inner = "";
      if (it.kind === "mc") {
        inner = `<div class="options">${shuffledOrder(it.options, it.q).map((oi) => {
          const o = it.options[oi];
          let c = "";
          if (solved && oi === it.correct) c = "correct";
          else if (!solved && f.wrong === oi) c = "wrong";
          return `<button class="option ${c}" ${solved ? "disabled" : ""} data-act="scene-practice" data-i="${i}" data-kind="mc" data-idx="${oi}">${esc(o)}</button>`;
        }).join("")}</div>`;
      } else {
        inner = `<div class="answer-row">
            <input id="inp-sc-${i}" class="num-input" type="text" inputmode="decimal" autocomplete="off" placeholder="Ответ" ${solved ? "disabled" : ""} value="${solved && f.val != null ? esc(f.val) : ""}">
            ${it.unit ? `<span class="unit">${esc(it.unit)}</span>` : ""}
            ${solved ? `<span class="ok-badge">✓</span>` : `<button class="btn btn-primary btn-sm" data-act="scene-practice" data-i="${i}" data-kind="num">Проверить</button>`}
          </div>`;
      }
      let sol = "";
      if (solved) sol = `<div class="vn-feedback ok"><b>✔ </b>${esc(it.solution || "")}</div>`;
      else if (f.wrong != null) sol = it.hint
        ? `<div class="compass-hint">🧭 Компас: ${esc(it.hint)}</div>`
        : `<div class="vn-feedback bad">Пока не сходится — проверь формулу и единицы, попробуй ещё.</div>`;
      return `<div class="task-card ${solved ? "solved" : ""}">
          <div class="task-q">${esc(it.q)}</div>
          ${it.svg ? `<div class="task-svg">${it.svg}</div>` : ""}
          ${inner}${sol}
        </div>`;
    }).join("");
    const allSolved = sc.items.every((_, i) => ui.fb["it:" + i] && ui.fb["it:" + i].solved);
    const next = allSolved
      ? `<div class="vn-actions"><span class="vn-done">✓ Калибровка завершена</span><button class="btn btn-primary" data-act="scene-next">Дальше ▶</button></div>`
      : "";
    return `<div class="vn-practice">${sc.title ? `<div class="vn-ptitle">${esc(sc.title)}</div>` : ""}${itemsHTML}</div>${next}`;
  }

  // — босс: финальная задача главы —
  function sceneBoss(sc, ch) {
    const fb = ui.fb.boss || {};
    if (fb.solved) {
      const law = (GAME.discoveries || []).find((d) => d.chapterId === ch.id)
        || (GAME.discoveries || []).find((d) => d.topicId === ch.topicId);
      const lawLine = law ? `<div class="vn-lawget">📓 Открытие записано в Лабораторию: <b>${esc(law.formula)}</b></div>` : "";
      const ot = outroOf(ch);
      return `
        <div class="vn-feedback ok"><b>🏆 </b>${esc(sc.solution || "")}</div>
        ${lawLine}
        <div class="vn-outro">
          <div class="vn-outro-title">${esc(ot.title || "Глава пройдена!")}</div>
          <div class="vn-outro-sub">${esc(ot.sub || "Ты восстановил ещё одну часть Источника Знаний.")}</div>
          ${(ch.can && ch.can.length) ? `
            <div class="can-block">
              <div class="can-block-h">✨ Теперь ты можешь</div>
              <ul class="can-list">${ch.can.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
            </div>` : ""}
          <div class="vn-actions">
            <button class="btn btn-primary" data-act="go" data-view="adventure">К списку глав</button>
            ${ch.topicId ? `<button class="btn btn-ghost" data-act="open-topic" data-id="${esc(ch.topicId)}">Тренировка по теме</button>` : ""}
          </div>
        </div>`;
    }
    const hintHTML = fb.wrong != null
      ? `<div class="vn-feedback bad"><span class="vn-mini-name">${esc(GAME.mentor.name)}:</span> ${esc(sc.hint || "Пересчитай внимательно.")}</div>`
      : "";
    // Концептуальный босс (выбор) — для тем без числового ответа
    const mcOpts = sc.options || sc.choices;
    if (mcOpts) {
      const opts = shuffledOrder(mcOpts, sc.q).map((i) => {
        const o = mcOpts[i];
        const c = (fb.wrong === i) ? "wrong" : "";
        return `<button class="option ${c}" data-act="scene-boss-mc" data-idx="${i}">${esc(o)}</button>`;
      }).join("");
      return `<div class="boss-panel">${sc.svg?`<div class="vn-graph">${sc.svg}</div>`:""}<div class="vn-q">${esc(sc.q)}</div><div class="options">${opts}</div>${hintHTML}</div>`;
    }
    // Числовой босс
    return `
      <div class="boss-panel">
        ${sc.svg?`<div class="vn-graph">${sc.svg}</div>`:""}
        <div class="vn-q">${esc(sc.q)}</div>
        <div class="answer-row">
          <input id="inp-sboss" class="num-input" type="text" inputmode="decimal" autocomplete="off" placeholder="Ответ">
          ${sc.unit ? `<span class="unit">${esc(sc.unit)}</span>` : ""}
          <button class="btn btn-gold" data-act="scene-boss-check">⚔️ Запустить</button>
        </div>
        ${hintHTML}
      </div>`;
  }

  /* ============================================================
     Сборка экрана
     ============================================================ */
  function render() {
    if (!State.data.hero) {
      root.innerHTML = creationReady ? viewCreation() : viewPrologue();
      window.scrollTo(0, 0); return;
    }
    let screen = "";
    if (ui.view === "adventure") screen = viewAdventure();
    else if (ui.view === "scene") screen = viewScene();
    else if (ui.view === "map") screen = viewMap();
    else if (ui.view === "world") screen = viewWorld();
    else if (ui.view === "topic") screen = viewTopic();
    else if (ui.view === "cabinet") screen = viewCabinet();
    else if (ui.view === "grade") screen = viewGrade();
    else if (ui.view === "worlds") screen = viewWorlds();
    else if (ui.view === "chapters") screen = viewAdventure();
    else if (ui.view === "practice") screen = viewPractice();
    else if (ui.view === "problems") screen = viewProblems();
    else if (ui.view === "forces") screen = viewForces();
    else if (ui.view === "exam") screen = viewExam();
    else if (ui.view === "realm") screen = viewRealm();
    else if (ui.view === "course") screen = viewCourse();
    else if (ui.view === "course-mission") screen = viewCourseMission();
    else if (ui.view === "course-control") screen = viewCourseControl();
    else if (ui.view === "review-hub") screen = viewReviewHub();
    else if (ui.view === "review-quiz") screen = viewReviewQuiz();
    else if (ui.view === "trainer") screen = viewTrainer();
    else if (ui.view === "shop") screen = viewShop();
    else if (ui.view === "teacher") screen = viewTeacher();
    else if (ui.view === "share-card") screen = viewShareCard();
    const prevFill = root.querySelector(".bar-xp .bar-fill");
    const prevW = prevFill ? prevFill.style.width : null;
    root.innerHTML = hudHTML() + tabsHTML() + `<main class="screen">${screen}</main>`;
    mountForcesIfNeeded();
    mountShareCardIfNeeded();
    const newFill = root.querySelector(".bar-xp .bar-fill");
    if (newFill) {
      const target = newFill.style.width;
      if (prevW != null && prevW !== target) { newFill.style.width = prevW; requestAnimationFrame(() => { newFill.style.width = target; }); }
    }
  }

  function go(view, opts) {
    tone("nav");
    ui.view = view;
    if (opts && opts.worldId) ui.worldId = opts.worldId;
    if (opts && opts.topicId) ui.topicId = opts.topicId;
    if (view === "topic") { ui.stage = "theory"; ui.fb = {}; }
    render();
    window.scrollTo(0, 0);
  }

  /* обновить отметки «пройдено» на трекере этапов без полной перерисовки */
  function refreshStageTabs() {
    const t = topic(ui.topicId);
    if (!t) return;
    const sd = State.topicStageDone(t.id);
    const map = { theory: sd.theory, experiment: sd.experiment, training: sd.questions && sd.problems, boss: sd.boss };
    root.querySelectorAll(".stage-tab").forEach((tab) => {
      const s = tab.getAttribute("data-stage");
      tab.classList.toggle("done", !!map[s]);
    });
  }

  /* ============================================================
     Делегирование событий (один обработчик на корень)
     ============================================================ */
  root.addEventListener("click", (e) => {
    const node = e.target.closest("[data-act]");
    if (!node) return;
    const act = node.getAttribute("data-act");

    /* --- создание героя --- */
    if (act === "pick-class") {
      selectedClass = node.getAttribute("data-id");
      root.querySelectorAll(".class-card").forEach((c) => c.classList.remove("selected"));
      node.classList.add("selected");
      return;
    }
    if (act === "create-hero") {
      const input = document.getElementById("hero-name");
      const name = (input.value || "").trim();
      if (!name) { input.focus(); input.style.borderColor = "var(--reaction-pink)"; toast({ ico: "✍️", strong: "Введи имя героя", cls: "pink" }); return; }
      if (!selectedClass) { toast({ ico: "🧭", strong: "Выбери класс героя", cls: "pink" }); return; }
      State.createHero(name, selectedClass);
      setAccent();
      ui.gradeSel = 7; go("grade");
      if (!State.data.settings.onboarded) setTimeout(() => showOnboarding(0), 500);
      else setTimeout(() => { mentorSay(pick(GAME.mentor.lines.greet)); greeted = true; }, 500);
      return;
    }

    /* --- пролог (холодный старт сценой) --- */
    if (act === "intro-next") {
      introStep++;
      if (introStep >= (GAME.prologue || []).length) creationReady = true;
      render(); window.scrollTo(0, 0);
      return;
    }
    if (act === "intro-skip") { creationReady = true; render(); window.scrollTo(0, 0); return; }

    /* --- навигация --- */
    if (act === "go") { go(node.getAttribute("data-view"), { worldId: node.getAttribute("data-id"), topicId: node.getAttribute("data-id") }); return; }
    if (act === "export-save") { doExport(); return; }
    if (act === "import-save") { doImport(); return; }
    if (act === "set-chmode") { State.data.settings.freeChapters = (node.getAttribute("data-mode") === "free"); State.save(); try { tone("correct"); } catch (e) {} toast({ ico: chaptersFree() ? "🔓" : "🧭", strong: chaptersFree() ? "Все главы открыты" : "Режим: по порядку", ttl: 1600 }); render(); return; }
    if (act === "pick-scenario") { State.data.settings.scenario = node.getAttribute("data-scen"); State.save(); try { tone("correct"); } catch (e) {} toast({ ico: "🎬", strong: "Сеттинг сменён", ttl: 1400 }); render(); return; }
    if (act === "toggle-sound") { State.toggleSound(); if (State.data.settings.sound) tone("correct"); updateHUD(); return; }
    if (act === "streak-info") {
      const s = State.streakInfo();
      if (s.status === "active") {
        toast({ ico: "🔥", strong: `Серия: ${s.count} ${dayWord(s.count)} подряд!`, sub: s.best > s.count ? `Рекорд — ${s.best}. Так держать!` : "Это твой личный рекорд!", cls: "gold", ttl: 3200 });
      } else if (s.status === "at_risk") {
        toast({ ico: "⚠️", strong: `Не потеряй серию из ${s.count} ${dayWord(s.count)}!`, sub: "Сегодня ты ещё не занимался — реши хоть одну задачу.", ttl: 3600 });
      } else {
        toast({ ico: "🔥", strong: s.best > 0 ? `Начни новую серию! Рекорд — ${s.best} ${dayWord(s.best)}.` : "Начни свою первую серию дней подряд!", sub: "Занимайся каждый день, чтобы она росла.", ttl: 3400 });
      }
      return;
    }
    if (act === "open-share-card") { ui.view = "share-card"; render(); window.scrollTo(0, 0); return; }
    if (act === "replay-tour") { showOnboarding(0); return; }
    if (act === "set-goal") {
      const key = node.getAttribute("data-key");
      const target = +node.getAttribute("data-target");
      State.setGoal(key, target);
      tone("flip");
      render();
      return;
    }
    if (act === "share-download") {
      const canvas = document.getElementById("share-canvas");
      if (!canvas || !canvas.toBlob) { toast({ ico: "⚠️", strong: "Не удалось создать картинку", ttl: 2400 }); return; }
      canvas.toBlob((blob) => {
        if (!blob) { toast({ ico: "⚠️", strong: "Не удалось создать картинку", ttl: 2400 }); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const safeName = (State.data.hero ? State.data.hero.name : "progress").replace(/[^\wа-яА-ЯёЁ]+/g, "_");
        a.href = url; a.download = `fizmat-progress-${safeName}.png`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (_) {} }, 150);
        toast({ ico: "✅", strong: "Картинка сохранена!", sub: a.download, cls: "green", ttl: 2800 });
      }, "image/png");
      return;
    }
    if (act === "share-native") {
      const canvas = document.getElementById("share-canvas");
      if (!canvas || !canvas.toBlob) return;
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const li = State.levelInfo();
        const shareText = `Мой прогресс в ФизМат RPG: уровень ${li.level}, изучено тем ${State.topicsStudied()}/${State.totalTopics()}!`;
        const file = new File([blob], "fizmat-progress.png", { type: "image/png" });
        if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
          try { await navigator.share({ files: [file], title: "Мой прогресс в ФизМат RPG", text: shareText }); }
          catch (e) { /* пользователь отменил шеринг — это нормально, ничего не показываем */ }
        } else {
          toast({ ico: "ℹ️", strong: "Прямая отправка недоступна в этом браузере", sub: "Картинка скачана — отправь её вручную", ttl: 3400 });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = "fizmat-progress.png";
          document.body.appendChild(a); a.click();
          setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (_) {} }, 150);
        }
      }, "image/png");
      return;
    }
    if (act === "toggle-music") { const on = State.toggleMusic(); if (on) Music.start(); else Music.stop(); updateHUD(); return; }

    if (act === "open-world") { go("world", { worldId: node.getAttribute("data-id") }); return; }
    if (act === "locked-world") { toast({ ico: "🔒", strong: "Мир скоро откроется", sub: "Следи за обновлениями!", ttl: 2600 }); return; }

    if (act === "full-topic") { if (window.FullTopic) FullTopic.open(node.getAttribute("data-id")); return; }
    if (act === "open-topic") { go("topic", { topicId: node.getAttribute("data-id") }); State.markStarted(ui.topicId); return; }
    if (act === "locked-topic") { toast({ ico: "🔒", strong: "Тема закрыта", sub: "Сначала пройди предыдущую тему", ttl: 2600 }); return; }

    if (act === "stage") { ui.stage = node.getAttribute("data-stage"); ui.fb = {}; render(); window.scrollTo(0, 0); return; }
    if (act === "teacher-unlock") {
      const inp = document.getElementById("teacher-pin");
      const pin = inp ? (inp.value || "").trim() : "";
      const correct = String((window.FIZMAT_CONFIG && window.FIZMAT_CONFIG.teacherPin) || "2468");
      if (pin === correct) { State.data.settings.teacherUnlocked = true; State.save(); toast({ ico: "🔓", strong: "Доступ открыт", cls: "green", ttl: 1600 }); render(); }
      else { toast({ ico: "⚠️", strong: "Неверный PIN", ttl: 2200 }); if (inp) { inp.value = ""; inp.focus(); } }
      return;
    }
    if (act === "teacher-lock") { State.data.settings.teacherUnlocked = false; State.save(); ui.teacherSel = null; ui.assignFor = null; toast({ ico: "🔒", strong: "Кабинет заблокирован", ttl: 1600 }); render(); return; }
    if (act === "teacher-open") { ui.teacherSel = node.getAttribute("data-id"); ui.assignFor = null; render(); window.scrollTo(0, 0); return; }
    if (act === "teacher-back") { ui.teacherSel = null; ui.assignFor = null; render(); window.scrollTo(0, 0); return; }
    if (act === "teacher-assign") { ui.assignFor = node.getAttribute("data-id"); render(); return; }
    if (act === "teacher-assign-close") { ui.assignFor = null; render(); return; }
    if (act === "teacher-assign-pick") {
      const st = ((typeof window !== "undefined" && window.TEACHER_DEMO) || []).find((x) => x.id === node.getAttribute("data-id"));
      const topic = node.getAttribute("data-topic");
      toast({ ico: "✅", strong: "Задание назначено", sub: (st ? st.name : "Ученику") + " · тема «" + topic + "»", ttl: 2800 });
      ui.assignFor = null; render(); return;
    }
    if (act === "noop") { return; }
    if (act === "cab") { ui.cab = node.getAttribute("data-tab"); ui.view = "cabinet"; render(); window.scrollTo(0, 0); return; }
    if (act === "formula-copy") {
      const f = node.getAttribute("data-f") || "";
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(f); }
        else { const ta = document.createElement("textarea"); ta.value = f; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); }
        toast({ ico: "📋", strong: "Формула скопирована", ttl: 1500 });
      } catch (e) { toast({ ico: "📋", strong: "Скопировать не вышло", sub: "Формулу можно переписать вручную", ttl: 2200 }); }
      return;
    }

    /* --- курс-кампания (теория-RPG) --- */
    if (act === "open-grade") {
      const v = node.getAttribute("data-grade");
      ui.gradeSel = (v === "math") ? "math" : Number(v);
      ui.view = "grade"; render(); window.scrollTo(0, 0);
      return;
    }
    if (act === "open-course") { ui.view = "course"; render(); window.scrollTo(0, 0); return; }
    if (act === "open-realm") { ui.realmId = node.getAttribute("data-id"); ui.view = "realm"; render(); window.scrollTo(0, 0); return; }
    if (act === "open-worlds") { ui.view = "worlds"; render(); window.scrollTo(0, 0); return; }
    if (act === "open-chapters") { ui.view = "adventure"; render(); window.scrollTo(0, 0); return; }
    if (act === "open-practice") { ui.view = "practice"; render(); window.scrollTo(0, 0); return; }
    if (act === "open-problems") { ui.view = "problems"; render(); window.scrollTo(0, 0); return; }
    if (act === "open-forces") { ui.forces = null; ui.view = "forces"; render(); window.scrollTo(0, 0); return; }
    if (act === "forces-pick") { forcesPick(node.getAttribute("data-id")); return; }
    if (act === "forces-toggle") { forcesToggleChip(node, node.getAttribute("data-id")); return; }
    if (act === "forces-check") { forcesCheck(); return; }
    if (act === "forces-fu-check") { forcesFuCheck(); return; }
    if (act === "forces-retry") { forcesRetry(); return; }
    if (act === "forces-next") { forcesNext(); return; }
    if (act === "forces-back") { forcesBack(); return; }
    if (act === "open-exam") { if (examTimer) { clearInterval(examTimer); examTimer = null; } ui.exam = { phase: "intro" }; ui.view = "exam"; render(); window.scrollTo(0, 0); return; }
    if (act === "exam-scope") { if (!ui.exam) ui.exam = {}; ui.exam.scope = node.getAttribute("data-scope"); ui.exam.phase = "len"; render(); window.scrollTo(0, 0); return; }
    if (act === "exam-start") { examStart((ui.exam && ui.exam.scope) || "all", +node.getAttribute("data-n")); return; }
    if (act === "exam-check") {
      const e = ui.exam; if (!e || e.answered || e.cur.kind !== "num") return;
      const t = e.cur.task; const inp = document.getElementById("inp-exam");
      const ok = checkNum(parseNum(inp ? inp.value : ""), t.a, t.tol || 0.01);
      e.answered = true; e.ok = ok;
      if (ok) { e.score++; e.points += (EXAM_PTS[e.cur.level] || 1); tone("correct"); bumpQuest("exam", 1); } else { tone("wrong"); }
      render();
      return;
    }
    if (act === "exam-mc") {
      const e = ui.exam; if (!e || e.answered || e.cur.kind !== "mc") return;
      const ok = (+node.getAttribute("data-idx")) === e.cur.q.correct;
      e.answered = true; e.ok = ok;
      if (ok) { e.score++; e.points += 1; tone("correct"); bumpQuest("exam", 1); } else { tone("wrong"); }
      render();
      return;
    }
    if (act === "exam-next") {
      const e = ui.exam; if (!e) return;
      if (e.i >= e.n) { examFinish(); return; }
      e.i++; e.cur = examPickItem(e.scope); e.answered = false; e.ok = false;
      render(); window.scrollTo(0, 0);
      const inp = document.getElementById("inp-exam"); if (inp) inp.focus();
      return;
    }
    if (act === "ch-locked") { toast({ ico: "🔒", strong: "Глава закрыта", sub: "Сначала пройди предыдущие главы", ttl: 2400 }); return; }
    if (act === "realm-locked") { toast({ ico: "🔒", strong: "Глава закрыта", sub: "Сначала пройди предыдущие главы", ttl: 2400 }); return; }
    if (act === "course-locked") { toast({ ico: "🔒", strong: "Миссия закрыта", sub: "Сначала заверши предыдущую миссию", ttl: 2600 }); return; }
    if (act === "course-mission") {
      const sec = node.getAttribute("data-sec"), idx = +node.getAttribute("data-idx");
      const same = ui.mission && ui.mission.sec === sec && ui.mission.idx === idx;
      ui.mission = { sec, idx };
      if (!same) ui.drillFb = {}; // новая миссия — чистое состояние тренировок
      ui.view = "course-mission"; render(); window.scrollTo(0, 0);
      return;
    }
    if (act === "course-complete") {
      const sec = node.getAttribute("data-sec"); const idx = +node.getAttribute("data-idx");
      const key = sec + ":" + idx;
      // Защита не только визуальная (кнопка скрыта) — проверяем и здесь,
      // на случай устаревшего экрана: без пройденной проверки миссию не завершить.
      const flatCheck = courseFlat();
      const mCheck = flatCheck.find((x) => x.key === key);
      if (mCheck && mCheck.tp.control && mCheck.tp.control.length) {
        const best = State.controlBest(key);
        if (!best || !best.passed) {
          toast({ ico: "🔒", strong: "Сначала пройди финальную проверку", sub: "Нужно набрать 70%, чтобы завершить тему", ttl: 2800 });
          return;
        }
      }
      const res = State.completeMission(key, MISSION_REWARD);
      flushEvents(); render(); window.scrollTo(0, 0);
      if (!res.already) { tone("win"); confetti(); floatXP(res.xp); }
      return;
    }
    if (act === "course-drill-check") {
      const fbKey = node.getAttribute("data-key");
      const flat = courseFlat();
      const m = ui.mission ? flat.find((x) => x.secId === ui.mission.sec && x.idx === ui.mission.idx) : null;
      if (!m) return;
      const blockIdx = +fbKey.split(":").pop();
      const block = (m.tp.b || [])[blockIdx];
      if (!block || !block.drill) return;
      const inp = node.parentNode.querySelector('input[data-drillkey="' + fbKey + '"]');
      const val = parseNum(inp ? inp.value : "");
      const correct = checkNum(val, block.drill.answer, block.drill.tol != null ? block.drill.tol : 0.05);
      if (!ui.drillFb) ui.drillFb = {};
      ui.drillFb[fbKey] = { checked: true, correct };
      tone(correct ? "correct" : "wrong");
      if (correct) { State.addXP(8, "problem"); State.save(); updateHUD(); }
      render();
      return;
    }
    if (act === "course-drill-retry") {
      const fbKey = node.getAttribute("data-key");
      if (ui.drillFb) delete ui.drillFb[fbKey];
      render();
      return;
    }
    if (act === "course-mistake-check") {
      const fbKey = node.getAttribute("data-key");
      const correctIdx = +node.getAttribute("data-correct");
      const pick = +node.getAttribute("data-pick");
      if (!ui.drillFb) ui.drillFb = {};
      const ok = pick === correctIdx;
      ui.drillFb[fbKey] = { checked: true, correct: ok, pick };
      tone(ok ? "correct" : "wrong");
      if (ok) { State.addXP(10, "problem"); State.save(); updateHUD(); }
      render();
      return;
    }
    if (act === "course-explore-check") {
      // Фаза "Исследуй" (Explore, 5E): здесь угадать неверно — нормально и ценно,
      // это часть открытия, а не ошибка. Поэтому звук нейтральный (не "wrong"),
      // и небольшая награда даётся за само предсказание, а не за угаданный ответ.
      const fbKey = node.getAttribute("data-key");
      const correctIdx = +node.getAttribute("data-correct");
      const pick = +node.getAttribute("data-pick");
      if (!ui.drillFb) ui.drillFb = {};
      const ok = pick === correctIdx;
      ui.drillFb[fbKey] = { checked: true, correct: ok, pick };
      tone("flip");
      State.addXP(5, "problem"); State.save(); updateHUD();
      render();
      return;
    }
    if (act === "course-transfer-mc") {
      // Фаза "Перенос" (Transfer): теория уже пройдена, здесь проверяем
      // настоящее понимание на НОВОЙ ситуации — правильность имеет значение,
      // награда больше, чем за обычную тренировку внутри темы.
      const fbKey = node.getAttribute("data-key");
      const correctIdx = +node.getAttribute("data-correct");
      const pick = +node.getAttribute("data-pick");
      if (!ui.drillFb) ui.drillFb = {};
      const ok = pick === correctIdx;
      ui.drillFb[fbKey] = { checked: true, correct: ok, pick };
      tone(ok ? "correct" : "wrong");
      if (ok) { State.addXP(15, "problem"); State.save(); updateHUD(); }
      render();
      return;
    }
    if (act === "course-transfer-num") {
      const fbKey = node.getAttribute("data-key");
      const inpId = node.getAttribute("data-inp");
      const inp = document.getElementById(inpId);
      const flat = courseFlat();
      const [sec, mIdx, blockIdx] = fbKey.split(":");
      const m = flat.find((x) => x.secId === sec && x.idx === +mIdx);
      if (!m) return;
      const block = (m.tp.b || [])[+blockIdx];
      if (!block || !block.transfer) return;
      const tr = block.transfer;
      const ok = checkNum(parseNum(inp ? inp.value : ""), tr.answer, tr.tol != null ? tr.tol : 0.05);
      if (!ui.drillFb) ui.drillFb = {};
      ui.drillFb[fbKey] = { checked: true, correct: ok };
      tone(ok ? "correct" : "wrong");
      if (ok) { State.addXP(15, "problem"); State.save(); updateHUD(); }
      render();
      return;
    }
    if (act === "open-control") {
      ui.control = { key: node.getAttribute("data-key") };
      ui.controlFb = {}; ui.controlDone = null;
      ui.view = "course-control"; render(); window.scrollTo(0, 0);
      return;
    }
    if (act === "control-back") {
      const key = node.getAttribute("data-key");
      const [sec, idx] = key.split(":");
      ui.mission = { sec, idx: +idx };
      ui.view = "course-mission"; ui.control = null; ui.controlDone = null;
      render(); window.scrollTo(0, 0);
      return;
    }
    if (act === "control-retry") {
      ui.controlFb = {}; ui.controlDone = null;
      render(); window.scrollTo(0, 0);
      return;
    }
    if (act === "control-mc") {
      const fbKey = node.getAttribute("data-key");
      const i = +node.getAttribute("data-i");
      const idx = +node.getAttribute("data-idx");
      const flat = courseFlat();
      const [sec, mIdx] = fbKey.split(":");
      const m = flat.find((x) => x.secId === sec && x.idx === +mIdx);
      const it = m.tp.control[i];
      const ok = idx === it.correct;
      ui.controlFb[fbKey] = { answered: true, pick: idx, ok };
      tone(ok ? "correct" : "wrong");
      render();
      return;
    }
    if (act === "control-num") {
      const fbKey = node.getAttribute("data-key");
      const i = +node.getAttribute("data-i");
      const inp = document.getElementById("ctrl-inp-" + i);
      const flat = courseFlat();
      const [sec, mIdx] = fbKey.split(":");
      const m = flat.find((x) => x.secId === sec && x.idx === +mIdx);
      const it = m.tp.control[i];
      const ok = checkNum(parseNum(inp ? inp.value : ""), it.answer, it.tol != null ? it.tol : 0.05);
      ui.controlFb[fbKey] = { answered: true, ok };
      tone(ok ? "correct" : "wrong");
      render();
      return;
    }
    if (act === "control-finish") {
      const key = node.getAttribute("data-key");
      const flat = courseFlat();
      const [sec, idx] = key.split(":");
      const m = flat.find((x) => x.secId === sec && x.idx === +idx);
      const items = m.tp.control;
      let score = 0;
      items.forEach((_, i) => { if (ui.controlFb[key + ":" + i] && ui.controlFb[key + ":" + i].ok) score++; });
      const res = State.saveControlResult(key, score, items.length);
      const goalRes = State.claimGoal(key, res.pct);
      ui.controlDone = { score, total: items.length, pct: res.pct, passed: res.passed, firstPass: res.firstPass, reward: res.reward, goal: goalRes };
      flushEvents(); updateHUD();
      if (res.passed) { tone("win"); confetti(res.firstPass ? 40 : 20); }
      else tone("wrong");
      render(); window.scrollTo(0, 0);
      return;
    }
    if (act === "open-review-hub") {
      ui.view = "review-hub"; render(); window.scrollTo(0, 0);
      return;
    }
    if (act === "review-start") {
      const key = node.getAttribute("data-key");
      const flat = courseFlat();
      const m = flat.find((x) => x.key === key);
      if (!m || !m.tp.control || !m.tp.control.length) return;
      // Затравка = тема + сегодняшняя дата: одна и та же подборка вопросов
      // весь день, а на следующей сессии повторения (другой день) — уже другая.
      const todaySeed = new Date().toISOString().slice(0, 10);
      const items = seededPick(m.tp.control, Math.min(5, m.tp.control.length), key + "|" + todaySeed);
      ui.review = { key, items };
      ui.reviewFb = {}; ui.reviewDone = null;
      ui.view = "review-quiz"; render(); window.scrollTo(0, 0);
      return;
    }
    if (act === "review-back") {
      ui.view = "review-hub"; ui.review = null; ui.reviewFb = {}; ui.reviewDone = null;
      render(); window.scrollTo(0, 0);
      return;
    }
    if (act === "review-mc") {
      if (!ui.review) return;
      const i = +node.getAttribute("data-i");
      const idx = +node.getAttribute("data-idx");
      const it = ui.review.items[i];
      const ok = idx === it.correct;
      ui.reviewFb["review:" + i] = { answered: true, pick: idx, ok };
      tone(ok ? "correct" : "wrong");
      render();
      return;
    }
    if (act === "review-num") {
      if (!ui.review) return;
      const i = +node.getAttribute("data-i");
      const inp = document.getElementById("rv-inp-" + i);
      const it = ui.review.items[i];
      const ok = checkNum(parseNum(inp ? inp.value : ""), it.answer, it.tol != null ? it.tol : 0.05);
      ui.reviewFb["review:" + i] = { answered: true, ok };
      tone(ok ? "correct" : "wrong");
      render();
      return;
    }
    if (act === "review-finish") {
      if (!ui.review) return;
      const items = ui.review.items;
      let score = 0;
      items.forEach((_, i) => { if (ui.reviewFb["review:" + i] && ui.reviewFb["review:" + i].ok) score++; });
      const pct = Math.round((score / items.length) * 100);
      const passed = pct >= 70;
      const res = State.recordReviewResult(ui.review.key, passed);
      ui.reviewDone = { score, total: items.length, passed, intervalDays: res.intervalDays, reward: res.reward };
      flushEvents(); updateHUD();
      if (passed) { tone("win"); confetti(20); } else tone("wrong");
      render(); window.scrollTo(0, 0);
      return;
    }

    /* --- тренажёр темы --- */
    if (act === "open-trainer") {
      const key = node.getAttribute("data-key"); const gen = trGen(key);
      if (!gen) return;
      const lvl = State.trainerMaxLevel(key);
      ui.trFrom = ui.view;
      ui.tr = { key, level: lvl, task: gen(lvl), streak: 0 };
      ui.trFb = null; ui.view = "trainer"; render(); window.scrollTo(0, 0);
      return;
    }
    if (act === "trainer-check") {
      const t = ui.tr.task; const inp = document.getElementById("inp-trainer");
      const correct = checkNum(parseNum(inp ? inp.value : ""), t.a, t.tol || 0.01);
      ui.trFb = { checked: true, correct };
      let gained = 0;
      if (correct) { ui.tr.streak++; const rr = State.trainerSolved(); gained = rr.gained || 5; tone("correct"); bumpQuest("solve", 1); }
      else { ui.tr.streak = 0; tone("wrong"); }
      render();
      if (correct) floatXP(gained);
      return;
    }
    if (act === "trainer-next") {
      const gen = trGen(ui.tr.key); ui.tr.task = gen(ui.tr.level); ui.trFb = null; render();
      const inp = document.getElementById("inp-trainer"); if (inp) inp.focus();
      return;
    }
    if (act === "trainer-levelup") {
      if (ui.tr.streak >= 3 && ui.tr.level < 3) {
        ui.tr.level++; State.unlockTrainerLevel(ui.tr.key, ui.tr.level); ui.tr.streak = 0;
        ui.tr.task = trGen(ui.tr.key)(ui.tr.level); ui.trFb = null;
        const names = window.TRAINER_LEVELS || []; toast({ ico: "🔓", strong: "Новый уровень!", sub: names[ui.tr.level - 1] || "", cls: "green", ttl: 2600 });
        tone("win"); render(); confetti(20);
      }
      return;
    }
    if (act === "trainer-setlevel") {
      const l = +node.getAttribute("data-lvl");
      if (l <= Math.max(State.trainerMaxLevel(ui.tr.key), ui.tr.level)) {
        ui.tr.level = l; ui.tr.streak = 0; ui.tr.task = trGen(ui.tr.key)(l); ui.trFb = null; render();
      }
      return;
    }
    if (act === "trainer-locked") { toast({ ico: "🔒", strong: "Уровень закрыт", sub: "Реши 3 задачи подряд на текущем уровне", ttl: 2600 }); return; }
    if (act === "trainer-back") { ui.view = ui.trFrom || "course-mission"; ui.tr = null; ui.trFb = null; render(); window.scrollTo(0, 0); return; }

    /* --- история: запуск / продолжение главы --- */
    if (act === "adv-start") {
      const chId = node.getAttribute("data-ch");
      const ch = chapter(chId);
      if (!ch || ch.status !== "open") { toast({ ico: "🔒", strong: "Глава скоро откроется", ttl: 2400 }); return; }
      ui.chId = chId;
      ui.fb = {};
      State.startChapter(chId);
      go("scene");
      return;
    }

    /* --- история: следующая сцена --- */
    if (act === "scene-next") {
      ui.fb = {};
      State.advanceScene(ui.chId);
      render(); window.scrollTo(0, 0);
      return;
    }

    /* --- история: нарративный выбор (может задавать стиль исследователя) --- */
    if (act === "scene-choice") {
      const ch = chapter(ui.chId); const sc = ch.scenes[State.sceneIndex(ui.chId)];
      const opt = sc && sc.choices ? sc.choices[+node.getAttribute("data-idx")] : null;
      if (opt && typeof opt === "object" && opt.style) {
        State.recordStyle(opt.style);
        const ack = {
          experiment: "Люблю проверять руками! Отличный подход.",
          formula: "Сначала теория — мыслишь как настоящий учёный.",
          risk: "Смелость тоже ведёт к открытиям. Проверим!",
        };
        mentorSay(ack[opt.style] || "Принято!");
        tone("correct");
      }
      ui.fb = {};
      State.advanceScene(ui.chId);
      render(); window.scrollTo(0, 0);
      return;
    }

    /* --- история: вопрос на понимание (с разбором ошибок) --- */
    if (act === "scene-concept") {
      const ch = chapter(ui.chId); const sc = ch.scenes[State.sceneIndex(ui.chId)];
      if (ui.fb.concept && ui.fb.concept.solved) return;
      const idx = +node.getAttribute("data-idx");
      const mkey = "concept:" + ui.chId + ":" + State.sceneIndex(ui.chId);
      if (idx === sc.correct) {
        ui.fb.concept = { solved: true };
        State.clearMistake(mkey);
        const g = State.awardStory(20, 5, "question");
        flushEvents(); updateHUD(); grantToast(g); tone("correct"); bumpQuest("solve", 1);
      } else {
        ui.fb.concept = { wrong: idx };
        State.logMistake(mkey, { kind: "concept", chId: ui.chId, chTitle: ch.title, grade: ch.grade || 7,
          question: sc.q, wrong: sc.options[idx], correct: sc.options[sc.correct], explain: sc.explain });
        tone("wrong");
      }
      render();
      return;
    }

    /* --- история: практика (числовой ответ / выбор) --- */
    if (act === "scene-practice") {
      const ch = chapter(ui.chId); const sc = ch.scenes[State.sceneIndex(ui.chId)];
      const i = +node.getAttribute("data-i");
      const kind = node.getAttribute("data-kind");
      const it = sc.items[i];
      const key = "it:" + i;
      const mkey = "practice:" + ui.chId + ":" + State.sceneIndex(ui.chId) + ":" + i;
      if (ui.fb[key] && ui.fb[key].solved) return;
      let correct = false, val = null;
      if (kind === "num") {
        const inp = document.getElementById("inp-sc-" + i);
        val = inp ? inp.value : "";
        correct = checkNum(parseNum(val), it.answer, it.tol);
      } else {
        const oi = +node.getAttribute("data-idx");
        correct = oi === it.correct;
        if (!correct) ui.fb[key] = { wrong: oi };
      }
      if (correct) {
        ui.fb[key] = { solved: true, val: kind === "num" ? val : null };
        State.clearMistake(mkey);
        const r = sc.reward || { xp: 30, coins: 10 };
        const g = State.awardStory(r.xp, r.coins, "problem");
        flushEvents(); updateHUD(); grantToast(g); tone("correct"); bumpQuest("solve", 1);
      } else {
        if (kind === "num") ui.fb[key] = { wrong: true };
        State.logMistake(mkey, { kind: "practice", chId: ui.chId, chTitle: ch.title, grade: ch.grade || 7,
          question: it.q, wrong: kind === "num" ? val : it.options[+node.getAttribute("data-idx")], correct: kind === "num" ? (it.answer + (it.unit ? " " + it.unit : "")) : it.options[it.correct], explain: it.solution });
        tone("wrong");
      }
      render();
      return;
    }

    /* --- история: финальный босс главы (числовой) --- */
    if (act === "scene-boss-check") {
      const ch = chapter(ui.chId); const sc = ch.scenes[State.sceneIndex(ui.chId)];
      const inp = document.getElementById("inp-sboss");
      const correct = checkNum(parseNum(inp ? inp.value : ""), sc.answer, sc.tol);
      const mkey = "boss:" + ui.chId;
      if (correct) {
        ui.fb.boss = { solved: true };
        State.clearMistake(mkey);
        State.completeChapter(ui.chId); // награда + достижение + событие chapterComplete
        flushEvents(); updateHUD(); tone("win"); confetti(44); bumpQuest("boss", 1);
      } else {
        ui.fb.boss = { wrong: true };
        State.logMistake(mkey, { kind: "boss", chId: ui.chId, chTitle: ch.title, grade: ch.grade || 7,
          question: sc.q || sc.story, wrong: inp ? inp.value : "", correct: sc.answer + (sc.unit ? " " + sc.unit : ""), explain: sc.solution });
        mentorSay(sc.hint ? "🧭 " + sc.hint : pick(GAME.mentor.lines.wrong));
        tone("wrong");
      }
      render();
      return;
    }

    /* --- история: финальный босс главы (выбор, концептуальный) --- */
    if (act === "scene-boss-mc") {
      const ch = chapter(ui.chId); const sc = ch.scenes[State.sceneIndex(ui.chId)];
      const idx = +node.getAttribute("data-idx");
      if (idx === sc.correct) {
        ui.fb.boss = { solved: true };
        State.completeChapter(ui.chId);
        flushEvents(); updateHUD(); tone("win"); confetti(44); bumpQuest("boss", 1);
      } else {
        ui.fb.boss = { wrong: idx };
        mentorSay(sc.hint ? "🧭 " + sc.hint : pick(GAME.mentor.lines.wrong));
        tone("wrong");
      }
      render();
      return;
    }


    /* --- теория: переворот карточки (без полной перерисовки) --- */
    if (act === "flip") {
      const card = node;
      card.classList.toggle("flipped");
      tone("flip");
      const i = +card.getAttribute("data-card");
      if (card.classList.contains("flipped")) {
        const g = State.readTheoryCard(ui.topicId, i);
        if (g) { card.classList.add("read"); flushEvents(); updateHUD(); grantToast(g); tone("correct"); bumpQuest("solve", 1); refreshStageTabs(); }
      }
      return;
    }

    /* --- эксперимент: контрольный вопрос --- */
    if (act === "answer-predict") {
      const t = topic(ui.topicId);
      const idx = +node.getAttribute("data-idx");
      const correct = idx === t.experiment.predict.correct;
      if (correct) { delete ui.fb["predict"]; const g = State.doExperiment(t.id); flushEvents(); updateHUD(); grantToast(g); tone("correct"); bumpQuest("solve", 1); }
      else { ui.fb["predict"] = { choice: idx }; tone("wrong"); }
      render();
      return;
    }

    /* --- тренировка: вопрос с выбором --- */
    if (act === "answer-q") {
      const t = topic(ui.topicId);
      const qi = +node.getAttribute("data-q");
      const oi = +node.getAttribute("data-idx");
      const correct = oi === t.questions[qi].correct;
      const res = State.answerQuestion(t.id, qi, correct);
      if (correct) { delete ui.fb["q:" + qi]; flushEvents(); updateHUD(); grantToast(res); tone("correct"); }
      else { ui.fb["q:" + qi] = { choice: oi }; tone("wrong"); }
      render();
      return;
    }

    /* --- тренировка: задача (числовой ответ) --- */
    if (act === "check-problem") {
      const t = topic(ui.topicId);
      const i = +node.getAttribute("data-idx");
      const inp = document.getElementById("inp-p-" + i);
      const val = parseNum(inp ? inp.value : "");
      const pr = t.problems[i];
      const correct = checkNum(val, pr.answer, pr.tol);
      const res = State.solveProblem(t.id, i, correct);
      if (correct) { delete ui.fb["p:" + i]; flushEvents(); updateHUD(); grantToast(res); tone("correct"); }
      else { ui.fb["p:" + i] = { wrong: true }; tone("wrong"); }
      render();
      return;
    }

    /* --- босс --- */
    if (act === "check-boss") {
      const t = topic(ui.topicId);
      const inp = document.getElementById("inp-boss");
      const val = parseNum(inp ? inp.value : "");
      const correct = checkNum(val, t.boss.answer, t.boss.tol);
      const res = State.defeatBoss(t.id, correct);
      if (correct) { delete ui.fb["boss"]; flushEvents(); updateHUD(); /* празднование и артефакт — через события */ tone("win"); }
      else { ui.fb["boss"] = { wrong: true }; mentorSay(pick(GAME.mentor.lines.wrong)); tone("wrong"); }
      render();
      return;
    }

    /* --- Лавка --- */
    if (act === "buy-avatar") { if (State.buyAvatar(node.getAttribute("data-id"))) { toast({ ico: "🛒", strong: "Покупка совершена!", cls: "green" }); updateHUD(); render(); } return; }
    if (act === "equip-avatar") { State.equipAvatar(node.getAttribute("data-id")); updateHUD(); render(); return; }
    if (act === "buy-accent") { if (State.buyAccent(node.getAttribute("data-id"))) { toast({ ico: "🎨", strong: "Цвет разблокирован!", cls: "green" }); setAccent(); updateHUD(); render(); } return; }
    if (act === "equip-accent") { State.equipAccent(node.getAttribute("data-id")); setAccent(); updateHUD(); render(); return; }
  });

  /* Enter в числовых полях = проверить */
  // Мобильное: при фокусе на поле ввода — подвинуть его в зону видимости (клавиатура не перекрывает)
  root.addEventListener("focusin", (e) => {
    const el = e.target;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
      setTimeout(() => { try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {} }, 300);
    }
  });

  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const id = e.target.id || "";
    if (id.indexOf("inp-p-") === 0) { const i = id.slice(6); const btn = root.querySelector(`[data-act="check-problem"][data-idx="${i}"]`); if (btn) btn.click(); }
    else if (id.indexOf("inp-sc-") === 0) { const i = id.slice(7); const btn = root.querySelector(`[data-act="scene-practice"][data-i="${i}"][data-kind="num"]`); if (btn) btn.click(); }
    else if (id === "inp-sboss") { const btn = root.querySelector(`[data-act="scene-boss-check"]`); if (btn) btn.click(); }
    else if (id === "inp-trainer") { const btn = root.querySelector(`[data-act="trainer-check"]`); if (btn) btn.click(); }
    else if (id === "inp-exam") { const btn = root.querySelector(`[data-act="exam-check"]`); if (btn) btn.click(); }
    else if (id.indexOf("ctrl-inp-") === 0) {
      const i = id.slice(9);
      const btn = root.querySelector(`[data-act="control-num"][data-i="${i}"]`);
      if (btn) btn.click();
    }
    else if (id.indexOf("rv-inp-") === 0) {
      const i = id.slice(7);
      const btn = root.querySelector(`[data-act="review-num"][data-i="${i}"]`);
      if (btn) btn.click();
    }
    else if (id.indexOf("tr-inp-") === 0) {
      const btn = root.querySelector(`[data-act="course-transfer-num"][data-inp="${id}"]`);
      if (btn) btn.click();
    }
    else if (e.target.classList && e.target.classList.contains("th-drill-input")) {
      const key = e.target.getAttribute("data-drillkey");
      const btn = root.querySelector(`[data-act="course-drill-check"][data-key="${key}"]`);
      if (btn) btn.click();
    }
    else if (id === "inp-boss") { const btn = root.querySelector(`[data-act="check-boss"]`); if (btn) btn.click(); }
    else if (id === "hero-name") { const btn = root.querySelector(`[data-act="create-hero"]`); if (btn) btn.click(); }
    else if (id === "teacher-pin") { const btn = root.querySelector(`[data-act="teacher-unlock"]`); if (btn) btn.click(); }
  });

  // Горячие клавиши для ПК (Esc / ← → / Enter / Ctrl+S)
  root.addEventListener("keydown", (e) => {
    const inInput = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");

    // Ctrl+S или Cmd+S — экспорт сохранения
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      if (typeof doExport === "function") doExport();
      return;
    }

    // Esc — закрыть модалку → подсказку наставника → тосты → снять фокус
    if (e.key === "Escape") {
      if (ui.assignFor) { ui.assignFor = null; render(); return; }
      const mp = document.getElementById("mentor-pop"); if (mp) { mp.remove(); return; }
      const tb = document.getElementById("toasts"); if (tb && tb.firstChild) { tb.innerHTML = ""; return; }
      if (inInput && e.target.blur) e.target.blur();
      return;
    }

    if (inInput) return; // в полях ввода стрелки двигают курсор

    // ← / → — переключение этапов темы, либо следующая сцена
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const tabs = Array.prototype.slice.call(root.querySelectorAll(".stage-tab"));
      if (tabs.length) {
        let idx = tabs.findIndex((t) => t.classList.contains("active"));
        if (idx < 0) idx = 0;
        idx += (e.key === "ArrowRight" ? 1 : -1);
        if (idx >= 0 && idx < tabs.length) { tabs[idx].click(); e.preventDefault(); }
        return;
      }
      if (e.key === "ArrowRight") { const nx = root.querySelector('[data-act="scene-next"]'); if (nx) { nx.click(); e.preventDefault(); } }
      return;
    }

    // Enter вне поля — продвинуть сцену
    if (e.key === "Enter") {
      const nx = root.querySelector('[data-act="scene-next"]'); if (nx) { nx.click(); e.preventDefault(); }
      return;
    }
  });

  /* ============================================================
     Запуск
     ============================================================ */
  // Нормализация концептов: если в analysis лишний ведущий "" (5 при 4 вариантах) —
  // убрать его, чтобы обратная связь на неверный ответ совпадала с выбранным вариантом.
  (GAME.chapters || []).forEach((ch) => {
    (ch.scenes || []).forEach((sc) => {
      if (sc.type === "concept" && Array.isArray(sc.analysis) && Array.isArray(sc.options) &&
          sc.analysis.length === sc.options.length + 1 && sc.analysis[0] === "") {
        sc.analysis = sc.analysis.slice(1);
      }
    });
  });
  State.load();
  setAccent();
  if (State.data.hero) {
    ui.gradeSel = 7; ui.view = "grade";
    render();
    if (!greeted) { setTimeout(() => { mentorSay(pick(GAME.mentor.lines.greet)); greeted = true; }, 600); }
    if (!State.data.settings.onboarded) setTimeout(() => showOnboarding(0), 700);
  } else {
    render(); // экран создания
  }

  /* для отладки из консоли */
  window.FizMatApp = { ui, render, reset: () => { State.reset(); selectedClass = null; greeted = false; introStep = 0; creationReady = false; setAccent(); render(); }, forcesPick, forcesToggleChip, forcesCheck, forcesFuCheck, forcesRetry, forcesNext, forcesBack, viewForces, viewForcesList, mountForcesIfNeeded, getActiveForceInst: () => activeForceInst };
  if (State.data.hero) setTimeout(function () { bumpQuest("login", 1); }, 500);
  document.addEventListener("click", function musicUnlock() { startMusicIfEnabled(); }, { once: true });
  // Параллакс звёзд при прокрутке (плавно, через rAF; уважает «меньше движения»)
  (function () {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const stars = document.querySelector(".stars"); if (!stars) return;
    let ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () { stars.style.transform = "translateY(" + (-window.scrollY * 0.12) + "px)"; ticking = false; });
    }, { passive: true });
  })();
})();

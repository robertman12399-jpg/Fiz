/* ============================================================
   ФизМат RPG — forces.js (v2)
   Интерактивная практика «Расставь силы» — ТЕПЕРЬ через canvas
   с настоящим перетаскиванием: ученик добавляет силу из пула (она
   появляется под случайным углом) и САМ вращает её наконечник до
   нужного направления. Проверяется честно: (а) набор сил совпадает
   с правильным без лишних/недостающих, (б) угол каждой поставленной
   силы совпадает с физически верным в пределах допуска. После
   проверки показывается эталонный чертёж — можно сверить визуально.
   Часть сценариев продолжается числовым расчётом (используя те же
   силы) — так расстановка сил становится реальным шагом решения
   задачи, а не отдельным упражнением.
   ============================================================ */
(function () {
  window.GAME = window.GAME || {};

  function D(deg) { const r = deg * Math.PI / 180; return { dx: Math.cos(r), dy: Math.sin(r) }; }
  function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function rndf(min, max, digits) { const v = min + Math.random() * (max - min); const p = Math.pow(10, digits == null ? 1 : digits); return Math.round(v * p) / p; }

  const FORCE_META = {
    gravity:  { label: "Сила тяжести (mg)",              short: "mg",  color: "#ff5d8f" },
    normal:   { label: "Сила реакции опоры (N)",          short: "N",   color: "#4ade80" },
    friction: { label: "Сила трения (Fтр)",                short: "Fтр", color: "#ffb84d" },
    tension:  { label: "Сила натяжения нити (T)",          short: "T",   color: "#38e1ff" },
    tension2: { label: "Натяжение второй нити (T₂)",       short: "T₂",  color: "#c792ff" },
    applied:  { label: "Внешняя приложенная сила (F)",     short: "F",   color: "#a06bff" },
    applied2: { label: "Вторая внешняя сила (F₂)",         short: "F₂",  color: "#ff8ac2" },
    buoyancy: { label: "Архимедова (выталкивающая) сила",  short: "FA",  color: "#2ee6c5" },
    air:      { label: "Сопротивление воздуха/среды",       short: "Fс",  color: "#ffd166" },
    spring:   { label: "Сила упругости пружины (Fупр)",    short: "Fупр",color: "#7ee787" },
  };
  window.GAME.forceMeta = FORCE_META;

  /* ---------- рисование фона сцены (canvas, координаты — доли w×h) ---------- */
  const MUTE = "#6b7099";
  function groundLine(ctx, w, h, yFrac) {
    const y = h * yFrac;
    ctx.strokeStyle = MUTE; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w * 0.05, y); ctx.lineTo(w * 0.95, y); ctx.stroke();
    ctx.lineWidth = 1.5;
    for (let x = w * 0.05; x < w * 0.95; x += w * 0.045) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - w * 0.025, y + h * 0.06); ctx.stroke();
    }
  }
  function box(ctx, cx, cy, bw, bh) {
    ctx.fillStyle = "rgba(56,225,255,0.16)"; ctx.strokeStyle = "#38e1ff"; ctx.lineWidth = 2.5;
    roundRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, 6); ctx.fill(); ctx.stroke();
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function ball(ctx, cx, cy, r) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(56,225,255,0.22)"; ctx.fill(); ctx.strokeStyle = "#38e1ff"; ctx.lineWidth = 2.5; ctx.stroke();
  }
  function water(ctx, w, h, yFrac) {
    const y = h * yFrac;
    ctx.beginPath(); ctx.moveTo(w * 0.05, y);
    for (let x = w * 0.05; x < w * 0.95; x += w * 0.09) ctx.quadraticCurveTo(x + w * 0.045, y - h * 0.035, x + w * 0.09, y);
    ctx.strokeStyle = "#2ee6c5"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "rgba(46,230,197,0.14)"; ctx.fillRect(w * 0.05, y, w * 0.9, h - y);
  }
  function incline(ctx, w, h, deg, riseRight) {
    // riseRight: true — склон поднимается слева направо
    const baseY = h * 0.84;
    const p1 = { x: w * 0.08, y: baseY };
    const p2 = { x: w * 0.92, y: baseY };
    const top = riseRight ? { x: p2.x, y: baseY - (p2.x - p1.x) * Math.tan(deg * Math.PI / 180) } : { x: p1.x, y: baseY - (p2.x - p1.x) * Math.tan(deg * Math.PI / 180) };
    ctx.strokeStyle = MUTE; ctx.lineWidth = 3;
    ctx.beginPath();
    if (riseRight) { ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(top.x, top.y); }
    else { ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(top.x, top.y); }
    ctx.stroke();
    return { baseY, top };
  }
  function rope(ctx, x1, y1, x2, y2, color) { ctx.strokeStyle = color || "#38e1ff"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function wall(ctx, w, h, x) { ctx.strokeStyle = MUTE; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, h * 0.06); ctx.lineTo(x, h * 0.96); ctx.stroke(); }

  /* ---------- сценарии ---------- */
  const S = [];
  const INC = 30; // стандартный угол наклонной плоскости для всех сценариев с горкой
  const upSlope = D(-INC);      // вдоль склона вверх (склон поднимается слева направо)
  const downSlope = D(180 - INC); // вдоль склона вниз
  const inclineNormal = D(-90 - INC); // перпендикуляр к склону, наружу (вверх-влево)

  /* ===================== 7 КЛАСС ===================== */
  S.push({
    id: "box_table", grade: 7, title: "Ящик стоит на столе",
    desc: "Ящик массой m неподвижно стоит на горизонтальном столе. Какие силы на него действуют?",
    draw(ctx, w, h) { groundLine(ctx, w, h, 0.82); box(ctx, w * 0.5, h * 0.62, w * 0.24, h * 0.22); },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.62 }),
    dirs: { gravity: D(90), normal: D(-90), friction: D(180), applied: D(0) },
    correct: ["gravity", "normal"],
    pool: ["gravity", "normal", "friction", "applied"],
    explain: "Ящик неподвижен и ни к чему не прикреплён: тяжесть (вниз) и реакция опоры стола (вверх) уравновешивают друг друга. Трения нет — нет тенденции к скольжению; приложенной силы нет вовсе.",
  });

  S.push({
    id: "box_pulled_uniform", grade: 7, title: "Ящик тянут по столу равномерно",
    desc: "Ящик тянут за верёвку горизонтально, и он скользит по столу с ПОСТОЯННОЙ скоростью. Какие силы действуют?",
    draw(ctx, w, h) { groundLine(ctx, w, h, 0.82); box(ctx, w * 0.55, h * 0.62, w * 0.24, h * 0.22); rope(ctx, w * 0.3, h * 0.62, w * 0.43, h * 0.62); },
    anchor: (w, h) => ({ x: w * 0.55, y: h * 0.62 }),
    dirs: { gravity: D(90), normal: D(-90), friction: D(0), tension: D(180), buoyancy: D(-90) },
    correct: ["gravity", "normal", "friction", "tension"],
    pool: ["gravity", "normal", "friction", "tension", "buoyancy"],
    explain: "Скорость постоянна ⟹ силы уравновешены по обеим осям: тяжесть/опора по вертикали, а по горизонтали — натяжение (вперёд) и трение скольжения (назад) равны по модулю.",
    followUp: {
      intro: "Раз силы уравновешены, сила трения равна силе натяжения. Используй это:",
      generate() {
        const T = rnd(8, 40);
        return { q: `Ящик тянут равномерно с силой натяжения ${T} Н. Чему равна сила трения?`, answer: T, unit: "Н", tol: 0.3 };
      },
    },
  });

  S.push({
    id: "hanging_weight", grade: 7, title: "Груз висит на нити неподвижно",
    desc: "Груз висит в покое на вертикальной нити. Какие силы на него действуют?",
    draw(ctx, w, h) { rope(ctx, w * 0.5, h * 0.1, w * 0.5, h * 0.42); ball(ctx, w * 0.5, h * 0.55, Math.min(w, h) * 0.11); },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.55 }),
    dirs: { gravity: D(90), tension: D(-90), normal: D(-90), friction: D(180) },
    correct: ["gravity", "tension"],
    pool: ["gravity", "tension", "normal", "friction"],
    explain: "Груз ни на что не опирается — только висит на нити. Тяжесть (вниз) и натяжение нити (вверх) равны по модулю, раз груз неподвижен.",
    followUp: {
      intro: "Раз груз неподвижен, натяжение нити равно силе тяжести:",
      generate() {
        const m = rnd(1, 12);
        return { q: `Масса груза ${m} кг (g≈10 м/с²). Чему равно натяжение нити?`, answer: m * 10, unit: "Н", tol: 0.5 };
      },
    },
  });

  S.push({
    id: "box_accelerating_smooth", grade: 7, title: "Ящик толкают по гладкому полу — он разгоняется",
    desc: "Ящик толкают горизонтальной силой по ГЛАДКОМУ (без трения) полу, и он ускоряется. Какие силы действуют?",
    draw(ctx, w, h) { groundLine(ctx, w, h, 0.82); box(ctx, w * 0.55, h * 0.62, w * 0.24, h * 0.22); rope(ctx, w * 0.22, h * 0.62, w * 0.43, h * 0.62, "#a06bff"); },
    anchor: (w, h) => ({ x: w * 0.55, y: h * 0.62 }),
    dirs: { gravity: D(90), normal: D(-90), applied: D(0), friction: D(180) },
    correct: ["gravity", "normal", "applied"],
    pool: ["gravity", "normal", "applied", "friction"],
    explain: "Пол гладкий — трения нет. Значит по горизонтали действует только приложенная сила, а по вертикали — тяжесть и опора (они уравновешены, ящик не взлетает и не проваливается).",
    followUp: {
      intro: "Второй закон Ньютона: F = ma. Используй его:",
      generate() {
        const m = rnd(2, 15), F = rnd(6, 60);
        return { q: `Масса ящика ${m} кг, приложенная сила ${F} Н, пол гладкий. Найди ускорение.`, answer: Math.round((F / m) * 100) / 100, unit: "м/с²", tol: 0.05 };
      },
    },
  });

  S.push({
    id: "box_static_friction", grade: 7, title: "Ящик толкают, но он не двигается",
    desc: "Ящик пытаются сдвинуть горизонтальной силой, но он остаётся неподвижным (сила трения покоя удерживает его). Какие силы действуют?",
    draw(ctx, w, h) { groundLine(ctx, w, h, 0.82); box(ctx, w * 0.55, h * 0.62, w * 0.24, h * 0.22); rope(ctx, w * 0.22, h * 0.62, w * 0.43, h * 0.62, "#a06bff"); },
    anchor: (w, h) => ({ x: w * 0.55, y: h * 0.62 }),
    dirs: { gravity: D(90), normal: D(-90), applied: D(0), friction: D(180), tension: D(-90) },
    correct: ["gravity", "normal", "applied", "friction"],
    pool: ["gravity", "normal", "applied", "friction", "tension"],
    explain: "Ящик неподвижен, но его толкают — значит трение покоя ТОЧНО компенсирует приложенную силу (равно ей по модулю, направлено противоположно). Четыре силы: тяжесть, опора, приложенная сила и трение покоя.",
    followUp: {
      intro: "Ящик неподвижен ⟹ трение покоя равно приложенной силе:",
      generate() {
        const F = rnd(10, 50);
        return { q: `Ящик толкают силой ${F} Н, но он не двигается. Чему равна сила трения покоя?`, answer: F, unit: "Н", tol: 0.3 };
      },
    },
  });

  S.push({
    id: "spring_hanging_weight", grade: 7, title: "Груз висит на пружинных весах",
    desc: "Груз подвешен в покое на пружине (пружинных весах). Какие силы на него действуют?",
    draw(ctx, w, h) {
      const x = w * 0.5, y1 = h * 0.08, y2 = h * 0.4;
      ctx.strokeStyle = "#7ee787"; ctx.lineWidth = 2.5; ctx.beginPath();
      const coils = 7;
      for (let i = 0; i <= coils; i++) { const yy = y1 + (y2 - y1) * (i / coils); const xx = x + (i % 2 === 0 ? -w * 0.035 : w * 0.035); if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(xx, yy); }
      ctx.lineTo(x, y2); ctx.stroke();
      ball(ctx, x, h * 0.55, Math.min(w, h) * 0.11);
    },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.55 }),
    dirs: { gravity: D(90), spring: D(-90), normal: D(-90), tension: D(-90) },
    correct: ["gravity", "spring"],
    pool: ["gravity", "spring", "normal", "tension"],
    explain: "Пружина растягивается и тянет груз вверх с силой упругости — она играет ту же роль, что и натяжение нити, но подчиняется закону Гука. Тяжесть (вниз) и сила упругости (вверх) уравновешены.",
    followUp: {
      intro: "Закон Гука: Fупр = k·x. Груз в покое ⟹ Fупр = mg:",
      generate() {
        const k = rnd(20, 100), x = rndf(0.02, 0.15, 2);
        const F = Math.round(k * x * 10) / 10;
        return { q: `Жёсткость пружины k=${k} Н/м, удлинение x=${x} м. Чему равна сила тяжести груза (она равна силе упругости в покое)?`, answer: F, unit: "Н", tol: Math.max(0.3, F * 0.03) };
      },
    },
  });

  S.push({
    id: "box_two_pulls_balanced", grade: 7, title: "Ящик тянут с двух сторон — он неподвижен",
    desc: "Двое тянут ящик за верёвки в противоположные стороны, и он остаётся неподвижным. Какие силы действуют?",
    draw(ctx, w, h) { groundLine(ctx, w, h, 0.82); box(ctx, w * 0.5, h * 0.62, w * 0.22, h * 0.2); rope(ctx, w * 0.2, h * 0.62, w * 0.39, h * 0.62, "#38e1ff"); rope(ctx, w * 0.8, h * 0.62, w * 0.61, h * 0.62, "#c792ff"); },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.62 }),
    dirs: { gravity: D(90), normal: D(-90), tension: D(180), tension2: D(0), friction: D(180) },
    correct: ["gravity", "normal", "tension", "tension2"],
    pool: ["gravity", "normal", "tension", "tension2", "friction"],
    explain: "Ящик неподвижен, значит натяжения обеих верёвок равны по модулю и противоположны по направлению — они компенсируют друг друга без участия трения.",
  });

  S.push({
    id: "box_free_fall", grade: 7, title: "Тело только что отпустили — свободное падение",
    desc: "Тело отпустили без начальной скорости, оно падает; сопротивлением воздуха пренебрегаем. Какие силы действуют?",
    draw(ctx, w, h) { ball(ctx, w * 0.5, h * 0.35, Math.min(w, h) * 0.1); ctx.strokeStyle = MUTE; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.48); ctx.lineTo(w * 0.5, h * 0.85); ctx.stroke(); ctx.setLineDash([]); },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.35 }),
    dirs: { gravity: D(90), applied: D(90), normal: D(-90), air: D(-90) },
    correct: ["gravity"],
    pool: ["gravity", "applied", "normal", "air"],
    explain: "Тело ни к чему не прикреплено и ни на что не опирается — сопротивлением пренебрегаем по условию. Значит действует только сила тяжести.",
    followUp: {
      intro: "Свободное падение: v = gt, h = gt²/2 (g≈10 м/с²):",
      generate() {
        const t = rndf(0.5, 2.5, 1);
        return { q: `Тело падает свободно ${t} с. Найди скорость в этот момент (g≈10 м/с²).`, answer: Math.round(10 * t * 10) / 10, unit: "м/с", tol: 0.3 };
      },
    },
  });

  /* ===================== 8 КЛАСС ===================== */
  S.push({
    id: "box_incline_smooth", grade: 8, title: "Ящик скользит по гладкой наклонной плоскости",
    desc: "Ящик соскальзывает вниз по наклонной плоскости (30°) БЕЗ трения. Какие силы действуют?",
    draw(ctx, w, h) { const r = incline(ctx, w, h, INC, true); box(ctx, w * 0.55, r.baseY - (w * 0.55 - w * 0.08) * Math.tan(INC * Math.PI / 180) - h * 0.07, w * 0.18, h * 0.14); },
    anchor: (w, h) => { const baseY = h * 0.84; return { x: w * 0.55, y: baseY - (w * 0.55 - w * 0.08) * Math.tan(INC * Math.PI / 180) - h * 0.07 }; },
    dirs: { gravity: D(90), normal: inclineNormal, friction: upSlope, tension: downSlope },
    correct: ["gravity", "normal"],
    pool: ["gravity", "normal", "friction", "tension"],
    explain: "Трения нет по условию, нити тоже нет — остаются тяжесть (строго вниз) и реакция опоры (перпендикулярно плоскости). Их равнодействующая и «толкает» ящик вниз по склону.",
    followUp: {
      intro: "На гладкой наклонной плоскости ускорение вдоль склона: a = g·sin(α):",
      generate() {
        return { q: `Угол наклона 30°, трения нет (g≈10 м/с²). Найди ускорение ящика вдоль склона.`, answer: 5, unit: "м/с²", tol: 0.3 };
      },
    },
  });

  S.push({
    id: "box_incline_friction_static", grade: 8, title: "Ящик неподвижно лежит на шероховатой наклонной плоскости",
    desc: "Ящик покоится на наклонной плоскости (30°) благодаря трению. Какие силы действуют?",
    draw(ctx, w, h) { incline(ctx, w, h, INC, true); box(ctx, w * 0.55, h * 0.84 - (w * 0.55 - w * 0.08) * Math.tan(INC * Math.PI / 180) - h * 0.07, w * 0.18, h * 0.14); },
    anchor: (w, h) => ({ x: w * 0.55, y: h * 0.84 - (w * 0.55 - w * 0.08) * Math.tan(INC * Math.PI / 180) - h * 0.07 }),
    dirs: { gravity: D(90), normal: inclineNormal, friction: upSlope, tension: downSlope },
    correct: ["gravity", "normal", "friction"],
    pool: ["gravity", "normal", "friction", "tension"],
    explain: "Ящик неподвижен ⟹ трение покоя направлено вдоль склона ВВЕРХ, компенсируя скатывающую составляющую тяжести. Три силы: тяжесть, реакция опоры (⊥ склону) и трение покоя (вдоль склона).",
  });

  S.push({
    id: "box_incline_pulled_up", grade: 8, title: "Ящик тянут вверх по наклонной плоскости равномерно",
    desc: "Ящик тянут за верёвку ВДОЛЬ склона (30°) вверх, и он движется равномерно (с трением). Какие силы действуют?",
    draw(ctx, w, h) {
      incline(ctx, w, h, INC, true);
      const ax = w * 0.55, ay = h * 0.84 - (w * 0.55 - w * 0.08) * Math.tan(INC * Math.PI / 180) - h * 0.07;
      box(ctx, ax, ay, w * 0.18, h * 0.14);
      rope(ctx, ax + w * 0.2 * upSlope.dx, ay + w * 0.2 * upSlope.dy, ax + w * 0.09 * upSlope.dx, ay + w * 0.09 * upSlope.dy, "#38e1ff");
    },
    anchor: (w, h) => ({ x: w * 0.55, y: h * 0.84 - (w * 0.55 - w * 0.08) * Math.tan(INC * Math.PI / 180) - h * 0.07 }),
    dirs: { gravity: D(90), normal: inclineNormal, friction: downSlope, tension: upSlope, applied: upSlope },
    correct: ["gravity", "normal", "friction", "tension"],
    pool: ["gravity", "normal", "friction", "tension", "applied"],
    explain: "Движение вверх по склону ⟹ кинетическое трение направлено вниз по склону (против движения). Натяжение тянет вдоль склона вверх. Итого четыре силы, две из них — вдоль наклонной плоскости в противоположные стороны.",
    followUp: {
      intro: "Движение равномерное ⟹ вдоль склона силы уравновешены: T = mg·sin(30°) + Fтр:",
      generate() {
        const m = rnd(2, 10), Ftr = rnd(3, 15);
        const T = Math.round((m * 10 * 0.5 + Ftr) * 10) / 10;
        return { q: `Масса ящика ${m} кг, угол 30°, сила трения ${Ftr} Н, движение равномерное (g≈10 м/с²). Найди натяжение верёвки.`, answer: T, unit: "Н", tol: Math.max(0.5, T * 0.03) };
      },
    },
  });

  S.push({
    id: "box_incline_pulled_down", grade: 8, title: "Ящик тянут вниз по наклонной плоскости",
    desc: "Ящик тянут за верёвку вдоль склона (30°) ВНИЗ, двигаясь равномерно (с трением). Какие силы действуют?",
    draw(ctx, w, h) {
      incline(ctx, w, h, INC, true);
      const ax = w * 0.4, ay = h * 0.84 - (w * 0.4 - w * 0.08) * Math.tan(INC * Math.PI / 180) - h * 0.07;
      box(ctx, ax, ay, w * 0.18, h * 0.14);
      rope(ctx, ax + w * 0.2 * downSlope.dx, ay + w * 0.2 * downSlope.dy, ax + w * 0.09 * downSlope.dx, ay + w * 0.09 * downSlope.dy, "#38e1ff");
    },
    anchor: (w, h) => ({ x: w * 0.4, y: h * 0.84 - (w * 0.4 - w * 0.08) * Math.tan(INC * Math.PI / 180) - h * 0.07 }),
    dirs: { gravity: D(90), normal: inclineNormal, friction: upSlope, tension: downSlope, applied: downSlope },
    correct: ["gravity", "normal", "friction", "tension"],
    pool: ["gravity", "normal", "friction", "tension", "applied"],
    explain: "Движение вниз по склону ⟹ трение направлено вверх по склону (против движения), а натяжение тянет вниз по склону — они действуют в противоположные стороны вдоль плоскости.",
  });

  S.push({
    id: "pendulum_swing", grade: 8, title: "Шарик маятника в момент качания",
    desc: "Шарик на нити отклонён от вертикали и движется (маятник качается). Какие силы на него действуют в этот момент?",
    draw(ctx, w, h) { rope(ctx, w * 0.4, h * 0.08, w * 0.58, h * 0.42); ball(ctx, w * 0.58, h * 0.52, Math.min(w, h) * 0.095); },
    anchor: (w, h) => ({ x: w * 0.58, y: h * 0.52 }),
    dirs: { gravity: D(90), tension: D(-115), normal: D(-90), applied: D(0) },
    correct: ["gravity", "tension"],
    pool: ["gravity", "tension", "normal", "applied"],
    explain: "И в отклонённом положении на шарик действуют только тяжесть (вниз) и натяжение нити (вдоль нити, к точке подвеса) — направление натяжения меняется вместе с положением шарика, других сил не добавляется.",
  });

  S.push({
    id: "floating_box", grade: 8, title: "Ящик плавает на поверхности воды",
    desc: "Лёгкий ящик плавает, частично погрузившись в воду, в покое. Какие силы действуют?",
    draw(ctx, w, h) { box(ctx, w * 0.5, h * 0.55, w * 0.26, h * 0.24); water(ctx, w, h, 0.62); },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.55 }),
    dirs: { gravity: D(90), buoyancy: D(-90), normal: D(-90), friction: D(180) },
    correct: ["gravity", "buoyancy"],
    pool: ["gravity", "buoyancy", "normal", "friction"],
    explain: "Ящик ни на что не опирается — вокруг только вода и воздух, опоры и трения нет. Плавание в покое означает, что тяжесть (вниз) и архимедова сила (вверх) точно уравновешены.",
    followUp: {
      intro: "В покое архимедова сила равна тяжести: FA = mg = ρ·V·g:",
      generate() {
        const m = rnd(2, 8);
        return { q: `Ящик массой ${m} кг плавает в покое. Чему равна архимедова сила (g≈10 м/с²)?`, answer: m * 10, unit: "Н", tol: 0.5 };
      },
    },
  });

  S.push({
    id: "sunk_box", grade: 8, title: "Тяжёлый предмет лежит на дне сосуда под водой",
    desc: "Предмет плотнее воды полностью погружён и лежит на дне сосуда. Какие силы действуют?",
    draw(ctx, w, h) { groundLine(ctx, w, h, 0.82); box(ctx, w * 0.5, h * 0.68, w * 0.24, h * 0.2); water(ctx, w, h, 0.3); },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.68 }),
    dirs: { gravity: D(90), buoyancy: D(-90), normal: D(-90), friction: D(180), tension: D(-90) },
    correct: ["gravity", "buoyancy", "normal"],
    pool: ["gravity", "buoyancy", "normal", "friction", "tension"],
    explain: "Предмет тяжелее вытесненной воды — одной архимедовой силы не хватает для равновесия, недостающую часть компенсирует реакция опоры дна. Три силы: тяжесть, архимедова сила, реакция опоры (все вертикальны).",
  });

  S.push({
    id: "box_against_wall", grade: 8, title: "Ящик прижат к стене горизонтальной силой",
    desc: "Ящик прижимают к вертикальной стене горизонтальной силой; он неподвижно висит, не падая. Какие силы действуют?",
    draw(ctx, w, h) { wall(ctx, w, h, w * 0.28); box(ctx, w * 0.46, h * 0.5, w * 0.22, h * 0.24); rope(ctx, w * 0.75, h * 0.5, w * 0.58, h * 0.5, "#a06bff"); },
    anchor: (w, h) => ({ x: w * 0.46, y: h * 0.5 }),
    dirs: { gravity: D(90), applied: D(180), normal: D(0), friction: D(-90), tension: D(-90) },
    correct: ["gravity", "applied", "normal", "friction"],
    pool: ["gravity", "applied", "normal", "friction", "tension"],
    explain: "Четыре силы: тяжесть (вниз), приложенная сила ладони (горизонтально, к стене), реакция стены (горизонтально, от стены) и трение о стену (вертикально вверх — именно оно не даёт ящику упасть).",
    followUp: {
      intro: "Чтобы ящик не падал, трение (максимум μN) должно уравновесить тяжесть: μF ≥ mg:",
      generate() {
        const m = rnd(1, 6), mu = rndf(0.3, 0.6, 2);
        const Fmin = Math.round((m * 10 / mu) * 10) / 10;
        return { q: `Масса ящика ${m} кг, коэффициент трения о стену μ=${mu} (g≈10 м/с²). Какая минимальная прижимающая сила F нужна, чтобы ящик не соскользнул (F=mg/μ)?`, answer: Fmin, unit: "Н", tol: Math.max(0.5, Fmin * 0.04) };
      },
    },
  });

  S.push({
    id: "ball_thrown", grade: 8, title: "Мяч летит после броска (без сопротивления воздуха)",
    desc: "Мяч бросили, и он свободно летит по воздуху (рука уже отпустила его). Сопротивлением воздуха пренебрегаем. Какие силы действуют?",
    draw(ctx, w, h) {
      ball(ctx, w * 0.55, h * 0.4, Math.min(w, h) * 0.08);
      ctx.strokeStyle = MUTE; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(w * 0.15, h * 0.75); ctx.quadraticCurveTo(w * 0.55, h * 0.12, w * 0.9, h * 0.6); ctx.stroke(); ctx.setLineDash([]);
    },
    anchor: (w, h) => ({ x: w * 0.55, y: h * 0.4 }),
    dirs: { gravity: D(90), applied: D(-25), normal: D(-90), air: D(155) },
    correct: ["gravity"],
    pool: ["gravity", "applied", "normal", "air"],
    explain: "Частая ошибка — рисовать «силу броска», якобы продолжающую толкать мяч. На деле рука уже не касается мяча: действует ТОЛЬКО тяжесть (сопротивление воздуха по условию не учитываем). Поэтому траектория — парабола свободного падения.",
  });

  S.push({
    id: "two_ropes", grade: 8, title: "Груз висит на двух нитях",
    desc: "Груз неподвижно висит, удерживаемый двумя нитями, расходящимися вверх и в стороны под 30° от вертикали. Какие силы действуют?",
    draw(ctx, w, h) { rope(ctx, w * 0.28, h * 0.08, w * 0.5, h * 0.42, "#38e1ff"); rope(ctx, w * 0.72, h * 0.08, w * 0.5, h * 0.42, "#c792ff"); ball(ctx, w * 0.5, h * 0.53, Math.min(w, h) * 0.095); },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.53 }),
    dirs: { gravity: D(90), tension: D(-120), tension2: D(-60), normal: D(-90) },
    correct: ["gravity", "tension", "tension2"],
    pool: ["gravity", "tension", "tension2", "normal"],
    explain: "Две нити — это ДВЕ разные силы натяжения (каждая вдоль своей нити к точке подвеса), плюс тяжесть. Все три силы уравновешены, раз груз неподвижен.",
  });

  S.push({
    id: "object_held_underwater", grade: 8, title: "Мяч удерживают под водой рукой",
    desc: "Лёгкий мяч, который сам всплыл бы, удерживают полностью под водой, толкая вниз рукой. Мяч неподвижен. Какие силы действуют?",
    draw(ctx, w, h) { ball(ctx, w * 0.5, h * 0.55, Math.min(w, h) * 0.1); water(ctx, w, h, 0.25); ctx.strokeStyle = "#a06bff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.15); ctx.lineTo(w * 0.5, h * 0.4); ctx.stroke(); },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.55 }),
    dirs: { gravity: D(90), buoyancy: D(-90), applied: D(90), normal: D(-90) },
    correct: ["gravity", "buoyancy", "applied"],
    pool: ["gravity", "buoyancy", "applied", "normal"],
    explain: "Мяч легче воды — архимедова сила больше тяжести, поэтому нужна ДОПОЛНИТЕЛЬНАЯ сила руки, направленная вниз, чтобы удержать его в равновесии под водой. Итого три силы: тяжесть, архимедова сила (обе вертикальны) и рука (тоже вниз).",
  });

  S.push({
    id: "two_blocks_connected", grade: 8, title: "Два бруска на столе тянут за передний (система)",
    desc: "Два бруска соединены нитью и лежат на столе с трением; передний брусок тянут вперёд второй верёвкой, система движется равномерно. Рассмотрим ПЕРЕДНИЙ брусок.",
    draw(ctx, w, h) {
      groundLine(ctx, w, h, 0.82);
      box(ctx, w * 0.28, h * 0.62, w * 0.16, h * 0.2);
      box(ctx, w * 0.6, h * 0.62, w * 0.16, h * 0.2);
      rope(ctx, w * 0.36, h * 0.62, w * 0.52, h * 0.62, "#c792ff");
      rope(ctx, w * 0.68, h * 0.62, w * 0.85, h * 0.62, "#38e1ff");
    },
    anchor: (w, h) => ({ x: w * 0.6, y: h * 0.62 }),
    dirs: { gravity: D(90), normal: D(-90), tension: D(0), tension2: D(180), friction: D(180), applied: D(0) },
    correct: ["gravity", "normal", "tension", "tension2", "friction"],
    pool: ["gravity", "normal", "tension", "tension2", "friction", "applied"],
    explain: "У переднего бруска ПЯТЬ сил: тяжесть, реакция опоры, натяжение главной верёвки (тянет вперёд), натяжение соединительной верёвки ко второму бруску (тянет НАЗАД — по третьему закону Ньютона) и трение о стол (назад, против движения). Это уже настоящая система с несколькими силами вдоль одной оси.",
  });

  /* ===================== 9 КЛАСС ===================== */
  S.push({
    id: "skydiver_terminal", grade: 9, title: "Парашютист падает с постоянной скоростью",
    desc: "Парашютист (с раскрытым парашютом) падает вертикально с ПОСТОЯННОЙ скоростью. Какие силы действуют?",
    draw(ctx, w, h) {
      ball(ctx, w * 0.5, h * 0.55, Math.min(w, h) * 0.09);
      ctx.strokeStyle = "#38e1ff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(w * 0.32, h * 0.25); ctx.quadraticCurveTo(w * 0.5, h * 0.05, w * 0.68, h * 0.25); ctx.stroke();
      rope(ctx, w * 0.34, h * 0.26, w * 0.45, h * 0.46); rope(ctx, w * 0.66, h * 0.26, w * 0.55, h * 0.46);
    },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.55 }),
    dirs: { gravity: D(90), air: D(-90), normal: D(-90), tension: D(-90) },
    correct: ["gravity", "air"],
    pool: ["gravity", "air", "normal", "tension"],
    explain: "Скорость постоянна ⟹ равнодействующая равна нулю ⟹ тяжесть (вниз) и сопротивление воздуха (вверх, против движения) равны по модулю.",
    followUp: {
      intro: "Постоянная скорость ⟹ сопротивление воздуха равно тяжести:",
      generate() {
        const m = rnd(60, 95);
        return { q: `Масса парашютиста со снаряжением ${m} кг, скорость постоянна (g≈10 м/с²). Чему равна сила сопротивления воздуха?`, answer: m * 10, unit: "Н", tol: 5 };
      },
    },
  });

  S.push({
    id: "rocket_ascending", grade: 9, title: "Ракета разгоняется вертикально вверх",
    desc: "Двигатель ракеты создаёт тягу больше силы тяжести, и ракета ускоряется вертикально вверх. Какие силы действуют?",
    draw(ctx, w, h) {
      ctx.fillStyle = "rgba(56,225,255,0.16)"; ctx.strokeStyle = "#38e1ff"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(w * 0.46, h * 0.2); ctx.lineTo(w * 0.54, h * 0.2); ctx.lineTo(w * 0.57, h * 0.6); ctx.lineTo(w * 0.43, h * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ffb84d"; ctx.beginPath(); ctx.moveTo(w * 0.43, h * 0.6); ctx.lineTo(w * 0.57, h * 0.6); ctx.lineTo(w * 0.5, h * 0.75); ctx.closePath(); ctx.fill();
    },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.45 }),
    dirs: { gravity: D(90), applied: D(-90), normal: D(-90), air: D(90) },
    correct: ["gravity", "applied"],
    pool: ["gravity", "applied", "normal", "air"],
    explain: "Ракета уже не опирается на землю. На неё действуют тяжесть (вниз) и тяга двигателя (вверх, вдоль корпуса) — тяга больше тяжести, поэтому равнодействующая направлена вверх.",
    followUp: {
      intro: "Второй закон Ньютона: a = (Fтяги − mg) / m:",
      generate() {
        const m = rnd(500, 2000), Fт = m * 10 + rnd(1000, 5000);
        const a = Math.round(((Fт - m * 10) / m) * 10) / 10;
        return { q: `Масса ракеты ${m} кг, сила тяги ${Fт} Н (g≈10 м/с²). Найди ускорение.`, answer: a, unit: "м/с²", tol: Math.max(0.2, a * 0.04) };
      },
    },
  });

  S.push({
    id: "car_braking", grade: 9, title: "Автомобиль тормозит на горизонтальной дороге",
    desc: "Автомобиль едет вперёд и тормозит (скорость уменьшается), дорога горизонтальна. Какие силы действуют?",
    draw(ctx, w, h) { groundLine(ctx, w, h, 0.82); roundRect(ctx, w * 0.32, h * 0.55, w * 0.36, h * 0.16, 8); ctx.fillStyle = "rgba(56,225,255,0.16)"; ctx.fill(); ctx.strokeStyle = "#38e1ff"; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(w * 0.4, h * 0.74, Math.min(w, h) * 0.045, 0, Math.PI * 2); ctx.strokeStyle = MUTE; ctx.stroke();
      ctx.beginPath(); ctx.arc(w * 0.6, h * 0.74, Math.min(w, h) * 0.045, 0, Math.PI * 2); ctx.stroke(); },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.63 }),
    dirs: { gravity: D(90), normal: D(-90), friction: D(180), applied: D(0) },
    correct: ["gravity", "normal", "friction"],
    pool: ["gravity", "normal", "friction", "applied"],
    explain: "При торможении сила трения (тормозные колодки через колёса о дорогу) направлена НАЗАД, против движения, и замедляет автомобиль. Тяги двигателя при торможении нет — только тяжесть, реакция опоры и трение (торможение).",
    followUp: {
      intro: "Тормозной путь: v² = 2·a·s, где a = μg (g≈10 м/с²):",
      generate() {
        const v = rnd(10, 25), mu = rndf(0.4, 0.8, 2);
        const s = Math.round((v * v) / (2 * mu * 10) * 10) / 10;
        return { q: `Скорость перед торможением ${v} м/с, коэффициент трения μ=${mu}. Найди тормозной путь.`, answer: s, unit: "м", tol: Math.max(0.5, s * 0.04) };
      },
    },
  });

  S.push({
    id: "car_accelerating_forward", grade: 9, title: "Автомобиль разгоняется вперёд",
    desc: "Двигатель разгоняет автомобиль вперёд по горизонтальной дороге; действует и сопротивление воздуха. Какие силы действуют?",
    draw(ctx, w, h) { groundLine(ctx, w, h, 0.82); roundRect(ctx, w * 0.32, h * 0.55, w * 0.36, h * 0.16, 8); ctx.fillStyle = "rgba(56,225,255,0.16)"; ctx.fill(); ctx.strokeStyle = "#38e1ff"; ctx.lineWidth = 2.5; ctx.stroke(); },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.63 }),
    dirs: { gravity: D(90), normal: D(-90), applied: D(0), air: D(180), friction: D(180) },
    correct: ["gravity", "normal", "applied", "air"],
    pool: ["gravity", "normal", "applied", "air", "friction"],
    explain: "Здесь тяга двигателя (вперёд, через сцепление колёс с дорогой — в модели считаем её общей приложенной силой) больше сопротивления воздуха (назад), поэтому машина разгоняется. Отдельно трение качения обычно не выделяют — им уже описано сопротивление движению.",
    followUp: {
      intro: "F = ma, равнодействующая = тяга − сопротивление воздуха:",
      generate() {
        const m = rnd(900, 1800), Fdr = rnd(2000, 5000), Fair = rnd(200, 900);
        const a = Math.round(((Fdr - Fair) / m) * 100) / 100;
        return { q: `Масса автомобиля ${m} кг, сила тяги ${Fdr} Н, сопротивление воздуха ${Fair} Н. Найди ускорение.`, answer: a, unit: "м/с²", tol: Math.max(0.05, a * 0.04) };
      },
    },
  });

  S.push({
    id: "elevator_up", grade: 9, title: "Человек в лифте, ускоряющемся ВВЕРХ",
    desc: "Человек стоит на полу лифта, который начинает движение вверх с ускорением (набирает скорость). Какие силы на него действуют?",
    draw(ctx, w, h) {
      ctx.strokeStyle = MUTE; ctx.lineWidth = 3; roundRect(ctx, w * 0.32, h * 0.12, w * 0.36, h * 0.72, 4); ctx.stroke();
      ball(ctx, w * 0.5, h * 0.55, Math.min(w, h) * 0.08); box(ctx, w * 0.5, h * 0.7, w * 0.14, h * 0.16);
    },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.5 }),
    dirs: { gravity: D(90), normal: D(-90), applied: D(0), tension: D(-90) },
    correct: ["gravity", "normal"],
    pool: ["gravity", "normal", "applied", "tension"],
    explain: "На человека действуют только тяжесть и реакция опоры пола лифта — как обычно. НО раз лифт ускоряется вверх, реакция опоры N больше mg (это и создаёт ускорение вверх, и ощущение «тяжелее»). Набор сил тот же, что и на неподвижном полу — важно направление, а не появление новых сил.",
    followUp: {
      intro: "Для ускорения вверх: N − mg = ma ⟹ N = m(g + a):",
      generate() {
        const m = rnd(50, 90), a = rndf(0.5, 3, 1);
        const N = Math.round(m * (10 + a) * 10) / 10;
        return { q: `Масса человека ${m} кг, лифт ускоряется вверх с a=${a} м/с² (g≈10 м/с²). Найди силу реакции опоры пола (вес человека в лифте).`, answer: N, unit: "Н", tol: Math.max(2, N * 0.03) };
      },
    },
  });

  S.push({
    id: "elevator_down", grade: 9, title: "Человек в лифте, ускоряющемся ВНИЗ",
    desc: "Лифт начинает движение вниз с ускорением (набирает скорость вниз). Какие силы действуют на стоящего в нём человека?",
    draw(ctx, w, h) { ctx.strokeStyle = MUTE; ctx.lineWidth = 3; roundRect(ctx, w * 0.32, h * 0.12, w * 0.36, h * 0.72, 4); ctx.stroke(); ball(ctx, w * 0.5, h * 0.55, Math.min(w, h) * 0.08); box(ctx, w * 0.5, h * 0.7, w * 0.14, h * 0.16); },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.5 }),
    dirs: { gravity: D(90), normal: D(-90), applied: D(0), tension: D(-90) },
    correct: ["gravity", "normal"],
    pool: ["gravity", "normal", "applied", "tension"],
    explain: "Силы те же: тяжесть и реакция опоры. Но при ускорении лифта ВНИЗ реакция опоры N МЕНЬШЕ mg (ощущение «легче», при свободном падении лифта N=0 вовсе).",
    followUp: {
      intro: "Для ускорения вниз: mg − N = ma ⟹ N = m(g − a):",
      generate() {
        const m = rnd(50, 90), a = rndf(0.5, 3, 1);
        const N = Math.round(m * (10 - a) * 10) / 10;
        return { q: `Масса человека ${m} кг, лифт ускоряется вниз с a=${a} м/с² (g≈10 м/с²). Найди силу реакции опоры пола.`, answer: N, unit: "Н", tol: Math.max(2, N * 0.03) };
      },
    },
  });

  S.push({
    id: "atwood_machine", grade: 9, title: "Груз в системе с блоком (машина Атвуда)",
    desc: "Два груза разной массы соединены нитью через неподвижный блок без трения. Рассмотрим груз m₁ (он движется вниз, более тяжёлый).",
    draw(ctx, w, h) {
      ctx.beginPath(); ctx.arc(w * 0.5, h * 0.15, Math.min(w, h) * 0.07, 0, Math.PI * 2); ctx.strokeStyle = MUTE; ctx.lineWidth = 3; ctx.stroke();
      rope(ctx, w * 0.44, h * 0.15, w * 0.32, h * 0.5); rope(ctx, w * 0.56, h * 0.15, w * 0.68, h * 0.42);
      box(ctx, w * 0.32, h * 0.6, w * 0.14, h * 0.18); box(ctx, w * 0.68, h * 0.5, w * 0.12, h * 0.14);
    },
    anchor: (w, h) => ({ x: w * 0.32, y: h * 0.6 }),
    dirs: { gravity: D(90), tension: D(-90), normal: D(-90), friction: D(0) },
    correct: ["gravity", "tension"],
    pool: ["gravity", "tension", "normal", "friction"],
    explain: "Груз висит на нити и ни на что не опирается — на него действуют только тяжесть (вниз) и натяжение нити (вверх), даже несмотря на то, что вся система движется (нить нерастяжима, блок без трения, поэтому набор сил не меняется).",
    followUp: {
      intro: "Для системы Атвуда: a = (m₁−m₂)g/(m₁+m₂), T = 2m₁m₂g/(m₁+m₂):",
      generate() {
        const m1 = rnd(4, 10), m2 = rnd(1, m1 - 1);
        const a = Math.round(((m1 - m2) / (m1 + m2)) * 10 * 100) / 100;
        return { q: `Массы грузов m₁=${m1} кг и m₂=${m2} кг (g≈10 м/с²). Найди ускорение системы.`, answer: a, unit: "м/с²", tol: Math.max(0.05, a * 0.04) };
      },
    },
  });

  S.push({
    id: "loop_top", grade: 9, title: "Шарик в верхней точке мёртвой петли",
    desc: "Шарик движется по внутренней стороне вертикальной петли и проходит её САМУЮ ВЕРХНЮЮ точку. Какие силы действуют на него в этот момент?",
    draw(ctx, w, h) {
      ctx.strokeStyle = MUTE; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.55, Math.min(w, h) * 0.32, 0, Math.PI * 2); ctx.stroke();
      ball(ctx, w * 0.5, h * 0.23, Math.min(w, h) * 0.07);
    },
    anchor: (w, h) => ({ x: w * 0.5, y: h * 0.23 }),
    dirs: { gravity: D(90), normal: D(90), applied: D(0), air: D(180) },
    correct: ["gravity", "normal"],
    pool: ["gravity", "normal", "applied", "air"],
    explain: "Частая ошибка — считать, что опора «всегда толкает вверх». На самом деле нормальная реакция направлена от поверхности К центру окружности — а в верхней точке петли центр находится НИЖЕ шарика. Поэтому обе силы, тяжесть и реакция опоры, направлены вниз (обе — к центру петли).",
    followUp: {
      intro: "Минимальная скорость наверху петли (когда N→0): v_min = √(gr):",
      generate() {
        const r = rnd(2, 12);
        const v = Math.round(Math.sqrt(10 * r) * 100) / 100;
        return { q: `Радиус мёртвой петли ${r} м (g≈10 м/с²). Найди минимальную скорость в верхней точке, при которой шарик не оторвётся от петли.`, answer: v, unit: "м/с", tol: Math.max(0.1, v * 0.04) };
      },
    },
  });

  S.push({
    id: "conical_pendulum", grade: 9, title: "Шарик на нити описывает горизонтальный круг",
    desc: "Шарик на нити равномерно вращается по горизонтальной окружности (нить описывает конус). Какие силы действуют?",
    draw(ctx, w, h) { rope(ctx, w * 0.5, h * 0.1, w * 0.65, h * 0.5); ball(ctx, w * 0.65, h * 0.58, Math.min(w, h) * 0.08);
      ctx.strokeStyle = MUTE; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.6, w * 0.16, h * 0.04, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); },
    anchor: (w, h) => ({ x: w * 0.65, y: h * 0.58 }),
    dirs: { gravity: D(90), tension: D(-115), normal: D(-90), applied: D(0) },
    correct: ["gravity", "tension"],
    pool: ["gravity", "tension", "normal", "applied"],
    explain: "На шарик действуют только тяжесть (вниз) и натяжение нити (вдоль нити, к точке подвеса). Их равнодействующая как раз и является центростремительной силой, направленной к центру окружности вращения.",
  });

  window.GAME.forceScenarios = S;

  /* ============================================================
     Движок практики: canvas + честное перетаскивание.
     Добавленная сила стартует под СЛУЧАЙНЫМ углом — ученик обязан
     сам довести наконечник до верного направления, перетаскивая
     его вокруг точки приложения (единственной для всех сил —
     модель материальной точки, как и полагается в чертеже сил).
     ============================================================ */
  const ARROW_LEN_FRAC = 0.24; // доля min(w,h) — длина стрелки
  const HANDLE_R = 30;         // радиус захвата наконечника (px canvas-координат)
  const ANGLE_TOL = 16;        // допуск по углу, градусы

  function angleDiff(a, b) { let d = Math.abs(a - b) % 360; if (d > 180) d = 360 - d; return d; }
  function dirToDeg(dir) { return Math.atan2(dir.dy, dir.dx) * 180 / Math.PI; }

  function wrapCanvasText(ctx, text, cx, cy, maxWidth, color, size, weight) {
    ctx.font = `${weight || 600} ${size || 12}px Rubik, sans-serif`;
    ctx.fillStyle = color; ctx.textAlign = "center";
    const words = String(text).split(" ");
    const lines = []; let cur = "";
    words.forEach((wd) => {
      const test = cur ? cur + " " + wd : wd;
      if (cur && ctx.measureText(test).width > maxWidth) { lines.push(cur); cur = wd; } else cur = test;
    });
    if (cur) lines.push(cur);
    const lh = (size || 12) + 5;
    const startY = cy - (lines.length - 1) * lh / 2;
    lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lh));
    return lines.length;
  }

  function drawArrow(ctx, x, y, dx, dy, len, color, label) {
    const nx = x + dx * len, ny = y + dy * len;
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
    const ang = Math.atan2(dy, dx), ah = 8;
    ctx.beginPath(); ctx.moveTo(nx, ny);
    ctx.lineTo(nx - ah * Math.cos(ang - 0.4), ny - ah * Math.sin(ang - 0.4));
    ctx.lineTo(nx - ah * Math.cos(ang + 0.4), ny - ah * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    if (label) { const lx = x + dx * (len + 15), ly = y + dy * (len + 15); ctx.font = "700 12px Rubik, sans-serif"; ctx.fillStyle = color; ctx.textAlign = "center"; ctx.fillText(label, lx, ly); }
    return { x: nx, y: ny };
  }

  /* mount(container, scenario, opts) — opts.readOnly=true рисует ЭТАЛОННУЮ (верную) диаграмму
     без интерактивности; иначе — интерактивную практику с перетаскиванием. */
  function mount(container, scenario, opts) {
    opts = opts || {};
    const readOnly = !!opts.readOnly;
    const w = Math.max(260, Math.min(560, container.clientWidth || 420));
    const h = Math.round(w * 0.64);
    container.innerHTML = `<canvas class="force-canvas" width="${w}" height="${h}"></canvas>`;
    const canvas = container.querySelector(".force-canvas");
    const ctx = canvas.getContext("2d");
    const anchor = scenario.anchor(w, h);
    const armLen = Math.min(w, h) * ARROW_LEN_FRAC;

    const placed = {}; // forceId -> { angleDeg, handle:{x,y} }

    function addForce(id, angleDeg) {
      placed[id] = { angleDeg: angleDeg != null ? angleDeg : Math.random() * 360 };
    }
    function removeForce(id) { delete placed[id]; if (dragId === id) dragId = null; }
    function hasForce(id) { return !!placed[id]; }
    function setAllCorrect() { scenario.correct.forEach((id) => addForce(id, dirToDeg(scenario.dirs[id]))); }

    function render() {
      ctx.clearRect(0, 0, w, h);
      scenario.draw(ctx, w, h);
      Object.keys(placed).forEach((id) => {
        const meta = GAME.forceMeta[id]; if (!meta) return;
        const rec = placed[id];
        const rad = rec.angleDeg * Math.PI / 180;
        const dx = Math.cos(rad), dy = Math.sin(rad);
        rec.handle = drawArrow(ctx, anchor.x, anchor.y, dx, dy, armLen, meta.color, meta.short);
        if (!readOnly) {
          ctx.beginPath(); ctx.arc(rec.handle.x, rec.handle.y, 9, 0, Math.PI * 2);
          ctx.strokeStyle = meta.color; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
        }
      });
      if (!readOnly && Object.keys(placed).length) {
        ctx.beginPath(); ctx.arc(anchor.x, anchor.y, armLen, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 1; ctx.stroke();
      }
    }

    let dragId = null;
    function posFromEvt(e) {
      const r = canvas.getBoundingClientRect();
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
      return { x: cx * (canvas.width / r.width), y: cy * (canvas.height / r.height) };
    }
    function findHandle(p) {
      let best = null, bd = HANDLE_R * HANDLE_R;
      Object.keys(placed).forEach((id) => {
        const hd = placed[id].handle; if (!hd) return;
        const d = (p.x - hd.x) ** 2 + (p.y - hd.y) ** 2;
        if (d < bd) { bd = d; best = id; }
      });
      return best;
    }
    function onDown(e) { const p = posFromEvt(e); dragId = findHandle(p); if (dragId) e.preventDefault(); }
    function onMove(e) {
      if (!dragId) return;
      const p = posFromEvt(e);
      placed[dragId].angleDeg = Math.atan2(p.y - anchor.y, p.x - anchor.x) * 180 / Math.PI;
      render();
      e.preventDefault();
    }
    function onUp() { dragId = null; }
    if (!readOnly) {
      canvas.addEventListener("mousedown", onDown); canvas.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
      canvas.addEventListener("touchstart", onDown, { passive: false }); canvas.addEventListener("touchmove", onMove, { passive: false }); window.addEventListener("touchend", onUp);
    }

    render();
    return {
      render, addForce, removeForce, hasForce, setAllCorrect,
      placedIds: () => Object.keys(placed),
      angleOf: (id) => (placed[id] ? placed[id].angleDeg : null),
      destroy() {
        if (readOnly) return;
        canvas.removeEventListener("mousedown", onDown); canvas.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp);
        canvas.removeEventListener("touchstart", onDown); canvas.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp);
      },
    };
  }

  /* Честная проверка: (а) набор сил точно совпадает, (б) угол каждой верно
     определённой силы — в пределах допуска ANGLE_TOL. Возвращает подробный разбор. */
  function evaluate(scenario, inst) {
    const placedIds = inst.placedIds().slice().sort();
    const correctIds = scenario.correct.slice().sort();
    const setOk = placedIds.length === correctIds.length && placedIds.every((id, i) => id === correctIds[i]);
    const missing = correctIds.filter((id) => !placedIds.includes(id));
    const extra = placedIds.filter((id) => !correctIds.includes(id));
    const angleReport = {};
    let anglesOk = true;
    correctIds.forEach((id) => {
      if (!inst.hasForce(id)) return;
      const target = dirToDeg(scenario.dirs[id]);
      const actual = inst.angleOf(id);
      const diff = angleDiff(target, actual);
      const ok = diff <= ANGLE_TOL;
      angleReport[id] = { diff: Math.round(diff), ok };
      if (!ok) anglesOk = false;
    });
    return { setOk, missing, extra, angleReport, anglesOk, fullyCorrect: setOk && anglesOk };
  }

  window.Forces = { mount, evaluate, wrapCanvasText, ANGLE_TOL };
})();

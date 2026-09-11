/* quests.js — Задача 5: ежедневные квесты. Подключать до state.js. */
(function () {
  if (typeof window === "undefined") return;
  window.QUEST_DEFS = [
    { id: "solve5", icon: "✅", label: "Реши 5 задач", metric: "solve", target: 5, xp: 40, coins: 20 },
    { id: "exam3", icon: "📝", label: "Ответь верно на 3 вопроса в экзамене", metric: "exam", target: 3, xp: 35, coins: 20 },
    { id: "boss1", icon: "⚔️", label: "Победи одного босса", metric: "boss", target: 1, xp: 60, coins: 30 },
    { id: "login1", icon: "📅", label: "Загляни в игру сегодня", metric: "login", target: 1, xp: 15, coins: 15 },
  ];
})();

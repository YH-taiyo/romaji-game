'use strict';

const App = (() => {
  // ---- 定数 ----
  const TIMER_MS    = 15000;
  const TICK_MS     = 100;
  const FEEDBACK_MS = 900;

  // エンドレスモード定数
  const GROUND_H         = 35;    // 地面高さ（px）
  const TANK_W           = 85;    // 戦車表示幅（近似）
  const ZOMBIE_W         = 36;    // ゾンビ衝突判定幅（px）
  const ZOMBIE_SPEED     = 0.81;  // 前進速度（px/tick）※1.3×1.5×1.3×0.8倍
  const SPAWN_MS_INIT    = 7000;  // 初期スポーン間隔（ms）
  const SPAWN_MS_MIN     = 2500;  // 最小スポーン間隔（ms）
  const SPAWN_MS_DECREASE= 500;   // 15秒ごとに短縮（ms）
  const PROJ_MS          = 260;   // 砲弾アニメーション（ms）

  const LEVELS = [
    { min: 95, emoji: '🐉', name: 'ドラゴン', level: 6 },
    { min: 80, emoji: '🦁', name: 'ライオン', level: 5 },
    { min: 60, emoji: '🐺', name: 'オオカミ', level: 4 },
    { min: 40, emoji: '🦝', name: 'タヌキ',   level: 3 },
    { min: 20, emoji: '🐰', name: 'ウサギ',   level: 2 },
    { min:  0, emoji: '🐜', name: 'アリ',     level: 1 },
  ];

  // ---- 状態 ----
  let state         = 'TITLE';
  let mode          = 5;
  let endlessMode   = false;
  let charMode      = false;    // 1文字モードフラグ
  let hardMode      = false;    // むずかしいモードフラグ
  let questionList  = [];
  let questionIndex = 0;
  let totalScore    = 0;
  let answeredCount = 0;
  let timerInterval = null;
  let remainingMs   = TIMER_MS;
  let answered      = false;

  // エンドレスモード状態
  let tankLeft       = 0;
  let zombies        = [];       // { id, x, el }
  let endlessTimer   = null;
  let spawnCountdown = SPAWN_MS_INIT;
  let currentSpawnMs = SPAWN_MS_INIT;
  let difficultyTicks= 0;
  let zombieIdCount  = 0;
  let gzGameOver     = false;    // 命名維持（既存フラグと共用）

  // ---- DOM キャッシュ ----
  const screens = {};
  const $ = id => document.getElementById(id);

  // ---- ユーティリティ ----
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function getLevel(scoreRate) {
    return LEVELS.find(l => scoreRate >= l.min);
  }

  // 1文字・むずかしいモードは制限時間 3/4
  function getTimerMs() {
    return (charMode || hardMode) ? Math.round(TIMER_MS * 0.75) : TIMER_MS;
  }

  // モード別ハイスコアキー
  function getModeKey() {
    if (endlessMode) return 'hs_endless';
    if (hardMode)    return `hs_hard_${mode}`;
    return `hs_${charMode ? 'char' : 'word'}_${mode}`;
  }

  // ---- 画面遷移 ----
  function transitionTo(newState) {
    if (screens[state]) screens[state].hidden = true;
    state = newState;
    if (screens[state]) screens[state].hidden = false;
  }

  // ---- 問題生成 ----
  function buildQuestionList() {
    const list = hardMode ? HARD_CHARS : (charMode ? CHARS : WORDS);
    return shuffle([...list]).slice(0, endlessMode ? list.length : mode);
  }

  function generateChoices(correct) {
    const pool       = hardMode ? HARD_CHARS : (charMode ? CHARS : WORDS);
    const notCorrect = pool.filter(w => w.id !== correct.id);

    if (charMode || hardMode) {
      // 1文字・むずかしいモード: 同行（同カテゴリ）優先で3択
      const sameCat  = shuffle(notCorrect.filter(w => w.category === correct.category));
      const otherCat = shuffle(notCorrect.filter(w => w.category !== correct.category));
      return shuffle([correct, ...[...sameCat, ...otherCat].slice(0, 3)]);
    }

    // 言葉モード: 一文字目一致ロジック
    const firstChar  = correct.label.charAt(0);

    // 一文字目が正解と同じ候補（最低1つ確保したい）
    const sameFirst  = shuffle(notCorrect.filter(w => w.label.charAt(0) === firstChar));
    // 同カテゴリで一文字目が違う候補
    const sameCatDiff = shuffle(notCorrect.filter(w =>
      w.category === correct.category && w.label.charAt(0) !== firstChar));
    // その他
    const rest = shuffle(notCorrect.filter(w =>
      w.category !== correct.category && w.label.charAt(0) !== firstChar));

    const wrongs = [];

    // ① 一文字目が同じ選択肢を必ず1つ含める
    if (sameFirst.length > 0) wrongs.push(sameFirst[0]);

    // ② 残り2枠：同カテゴリ → その他 → 一文字目同じの残り の順で補充
    const fillPool = [...sameCatDiff, ...rest, ...sameFirst.slice(1)];
    for (const w of fillPool) {
      if (wrongs.length >= 3) break;
      wrongs.push(w);
    }

    return shuffle([correct, ...wrongs]);
  }

  // ---- タイマー ----
  function startTimer() {
    remainingMs = getTimerMs();
    updateTimerBar();
    timerInterval = setInterval(() => {
      remainingMs -= TICK_MS;
      updateTimerBar();
      if (remainingMs <= 0) {
        remainingMs = 0;
        stopTimer();
        handleAnswer(null);
      }
    }, TICK_MS);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function updateTimerBar() {
    const bar = $('timer-bar');
    if (!bar) return;
    const pct = (remainingMs / getTimerMs()) * 100;
    bar.style.width = pct + '%';
    bar.classList.toggle('low', remainingMs <= 3000);
  }

  // ---- 問題表示 ----
  function showQuestion(idx) {
    if (gzGameOver) return;
    answered = false;

    if (endlessMode && idx >= questionList.length) {
      questionList  = shuffle([...(charMode ? CHARS : WORDS)]);
      questionIndex = 0;
      idx = 0;
    }

    const word = questionList[idx];
    $('progress-text').textContent  = endlessMode
      ? `${answeredCount + 1} もんめ`
      : `${idx + 1} / ${mode} もん`;
    $('score-text').textContent     = `スコア: ${totalScore}`;
    $('romaji-display').textContent = word.romaji;

    const choices = generateChoices(word);
    const grid    = $('choices-grid');
    grid.innerHTML = '';
    choices.forEach(choice => {
      const card = document.createElement('button');
      card.className  = 'choice-card';
      card.dataset.id = choice.id;
      const lbl = document.createElement('span');
      lbl.className   = 'choice-label';
      lbl.textContent = choice.label;
      card.append(lbl);
      card.addEventListener('click', () => handleAnswer(choice.id));
      grid.appendChild(card);
    });

    startTimer();
  }

  // ---- 解答処理 ----
  function handleAnswer(selectedId) {
    if (answered || gzGameOver) return;
    answered = true;
    stopTimer();
    answeredCount++;

    const correct   = questionList[questionIndex];
    const isCorrect = selectedId === correct.id;

    if (isCorrect) {
      const bonus = Math.floor((remainingMs / getTimerMs()) * 50);
      totalScore += 100 + bonus;
    }

    document.querySelectorAll('.choice-card').forEach(card => {
      if (card.dataset.id === correct.id) {
        card.classList.add('correct');
      } else if (card.dataset.id === selectedId && !isCorrect) {
        card.classList.add('wrong');
      }
    });

    const overlay = $('feedback-overlay');
    overlay.textContent = isCorrect ? '〇' : '×';
    overlay.className   = 'feedback-overlay ' + (isCorrect ? 'overlay-correct' : 'overlay-wrong');
    overlay.hidden = false;

    // エンドレスモード：正解時のみ最前列撃破
    if (endlessMode && isCorrect) {
      fireAtFront();
    }

    setTimeout(() => {
      if (gzGameOver) return;
      overlay.hidden = true;
      questionIndex++;
      if (!endlessMode && questionIndex >= mode) {
        showResult(false);
      } else {
        showQuestion(questionIndex);
      }
    }, FEEDBACK_MS);
  }

  // ---- エンドレスモード：ゾンビスポーン ----
  function spawnZombie() {
    const stageEl = $('battle-stage');
    if (!stageEl) return;

    const el = document.createElement('img');
    el.src       = 'images/zombie.svg';
    el.alt       = 'ゾンビ';
    el.className = 'zombie-sprite';
    el.style.left   = '0px';
    el.style.bottom = GROUND_H + 'px';
    stageEl.appendChild(el);

    const id = zombieIdCount++;
    zombies.push({ id, x: 0, el });
  }

  // ---- エンドレスモード：全ゾンビ前進 ----
  function moveZombies() {
    for (const z of zombies) {
      if (!z.dying) {
        z.x += ZOMBIE_SPEED;
        if (z.el) z.el.style.left = z.x + 'px';
        if (z.x + ZOMBIE_W >= tankLeft) {
          triggerGameOver();
          return;
        }
      }
    }
  }

  // ---- エンドレスモード：メインtick ----
  function endlessTick() {
    if (gzGameOver) return;

    moveZombies();

    // ② 生存ゾンビが0体なら即スポーン
    const living = zombies.filter(z => !z.dying);
    if (living.length === 0) {
      spawnZombie();
      spawnCountdown = currentSpawnMs;
    } else {
      spawnCountdown -= TICK_MS;
      if (spawnCountdown <= 0) {
        spawnZombie();
        spawnCountdown = currentSpawnMs;
      }
    }

    difficultyTicks++;
    if (difficultyTicks % 150 === 0) {
      currentSpawnMs = Math.max(SPAWN_MS_MIN, currentSpawnMs - SPAWN_MS_DECREASE);
    }
  }

  // ---- エンドレスモード：ゾンビ撃破 ----
  function zombieDie(z) {
    if (!z || z.dying) return;
    z.dying = true;
    if (z.el) z.el.classList.add('zombie-dying');
    setTimeout(() => {
      if (z.el && z.el.parentNode) z.el.parentNode.removeChild(z.el);
      zombies = zombies.filter(zb => zb.id !== z.id);
    }, 500);
  }

  // ---- エンドレスモード：砲撃 → 最前列撃破 ----
  function fireAtFront() {
    const proj = $('projectile');
    if (!proj) return;

    // 最前列（x最大）のゾンビを探す
    const living = zombies.filter(z => !z.dying);
    const target = living.length > 0
      ? living.reduce((a, b) => a.x > b.x ? a : b)
      : null;

    const targetLeft = target
      ? Math.max(0, target.x + ZOMBIE_W / 2 - 6)
      : Math.max(0, tankLeft / 2);

    proj.style.transition = 'none';
    proj.style.left       = (tankLeft - 10) + 'px';
    proj.hidden = false;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        proj.style.transition = `left ${PROJ_MS}ms linear`;
        proj.style.left = targetLeft + 'px';
      });
    });

    setTimeout(() => {
      proj.hidden = true;
      proj.style.transition = 'none';
      if (target) zombieDie(target);
    }, PROJ_MS + 50);
  }

  // ---- エンドレスモード：ゲームオーバー（画面切替なし） ----
  function triggerGameOver() {
    if (gzGameOver) return;
    gzGameOver = true;
    stopTimer();
    stopEndless();
    const feedback = $('feedback-overlay');
    if (feedback) feedback.hidden = true;

    setTimeout(() => showGameOverOverlay(), 400);
  }

  function showGameOverOverlay() {
    const denominator = Math.max(answeredCount, 1) * 150;
    const rate = Math.min(100, Math.round((totalScore / denominator) * 100));
    const lv   = getLevel(rate);

    $('gameover-score-text').textContent = `${totalScore} てん`;
    $('gameover-answered').textContent   = `${answeredCount} もん　せいかいりつ ${rate}%`;

    const saved = Storage.get(getModeKey());
    const isNew = !saved || totalScore > saved.score;
    if (isNew) {
      Storage.set(getModeKey(), { score: totalScore, scoreRate: rate, date: new Date().toISOString() });
      $('gameover-hs').textContent = `🎉 しんきろく！  ${lv.emoji} Lv.${lv.level} ${lv.name}`;
    } else {
      const hvl = getLevel(saved.scoreRate);
      $('gameover-hs').textContent = `ハイスコア: ${saved.score}てん  ${hvl.emoji} Lv.${hvl.level} ${hvl.name}`;
    }

    $('gameover-overlay').hidden = false;
  }

  // ---- エンドレスモード：初期化・停止 ----
  function startEndless() {
    const stageEl = $('battle-stage');
    if (!stageEl) return;

    tankLeft       = stageEl.clientWidth - TANK_W - 8;
    zombies        = [];
    gzGameOver     = false;
    spawnCountdown = SPAWN_MS_INIT;
    currentSpawnMs = SPAWN_MS_INIT;
    difficultyTicks= 0;
    zombieIdCount  = 0;

    const tankEl = $('tank-sprite');
    if (tankEl) {
      tankEl.style.left   = tankLeft + 'px';
      tankEl.style.bottom = GROUND_H + 'px';
    }

    // ① ゲームスタートと同時に1体即出現
    spawnZombie();
    spawnCountdown = currentSpawnMs;

    endlessTimer = setInterval(endlessTick, TICK_MS);
  }

  function stopEndless() {
    clearInterval(endlessTimer);
    endlessTimer = null;
    // 残ったゾンビ要素を削除
    zombies.forEach(z => { if (z.el && z.el.parentNode) z.el.parentNode.removeChild(z.el); });
    zombies = [];
  }

  // ---- 結果表示 ----
  function showResult(isGameOver) {
    stopEndless();
    transitionTo('RESULT');

    const denominator = endlessMode
      ? Math.max(answeredCount, 1) * 150
      : mode * 150;
    const rate = Math.min(100, Math.round((totalScore / denominator) * 100));
    const lv   = getLevel(rate);

    const heading = $('result-heading');
    if (heading) {
      heading.textContent = isGameOver ? '💀 ゲームオーバー！' : 'けっか';
      heading.className   = isGameOver ? 'gameover' : '';
    }

    $('result-animal-emoji').textContent = lv.emoji;
    $('result-level-text').textContent   = `Lv.${lv.level}　${lv.name}`;
    $('result-score').textContent        = `${totalScore} てん`;
    $('result-rate').textContent         = endlessMode
      ? `${answeredCount} もん　せいかいりつ ${rate}%`
      : `${totalScore} / ${denominator} てん（${rate}%）`;

    const saved = Storage.get(getModeKey());
    const isNew = !saved || totalScore > saved.score;
    const badge = $('new-record-badge');

    if (isNew) {
      Storage.set(getModeKey(), { score: totalScore, scoreRate: rate, date: new Date().toISOString() });
      badge.hidden = false;
      $('highscore-block').hidden = false;
      $('highscore-score').textContent = `${totalScore} てん`;
      $('highscore-level').textContent = `${lv.emoji} Lv.${lv.level} ${lv.name}`;
    } else {
      badge.hidden = true;
      $('highscore-block').hidden = false;
      const hvl = getLevel(saved.scoreRate);
      $('highscore-score').textContent = `${saved.score} てん`;
      $('highscore-level').textContent = `${hvl.emoji} Lv.${hvl.level} ${hvl.name}`;
    }
  }

  // ---- タイトル画面のハイスコア表示（全モード中の最高点） ----
  function updateTitleHighscore() {
    const allKeys = [
      'hs_char_5','hs_char_10','hs_char_15',
      'hs_word_5','hs_word_10','hs_word_15',
      'hs_hard_5','hs_hard_10','hs_hard_15',
      'hs_endless',
    ];
    const best = allKeys
      .map(k => Storage.get(k))
      .filter(Boolean)
      .reduce((a, b) => (!a || b.score > a.score) ? b : a, null);

    const block = $('title-highscore');
    if (best) {
      const lv = getLevel(best.scoreRate);
      $('title-hs-score').textContent = `${best.score} てん`;
      $('title-hs-level').textContent = `${lv.emoji} Lv.${lv.level} ${lv.name}`;
      block.hidden = false;
    } else {
      block.hidden = true;
    }
  }

  // ---- 初期化 ----
  function init() {
    ['TITLE', 'MODE_SELECT', 'PLAYING', 'RESULT'].forEach(s => {
      screens[s] = $('screen-' + s.toLowerCase().replace('_', '-'));
    });

    $('btn-play').addEventListener('click', () => transitionTo('MODE_SELECT'));

    $('btn-char-5').addEventListener('click',  () => startGame(5,  false, true));
    $('btn-char-10').addEventListener('click', () => startGame(10, false, true));
    $('btn-char-15').addEventListener('click', () => startGame(15, false, true));
    $('btn-mode-5').addEventListener('click',  () => startGame(5,  false, false));
    $('btn-mode-10').addEventListener('click', () => startGame(10, false, false));
    $('btn-mode-15').addEventListener('click', () => startGame(15, false, false));
    $('btn-hard-5').addEventListener('click',  () => startGame(5,  false, false, true));
    $('btn-hard-10').addEventListener('click', () => startGame(10, false, false, true));
    $('btn-hard-15').addEventListener('click', () => startGame(15, false, false, true));
    $('btn-mode-gz').addEventListener('click', () => startGame(0,  true,  false));

    $('btn-back').addEventListener('click', () => {
      stopEndless();
      transitionTo('TITLE');
      updateTitleHighscore();
    });

    $('btn-playing-back').addEventListener('click', () => {
      stopTimer();
      stopEndless();
      const goOverlay = $('gameover-overlay');
      if (goOverlay) goOverlay.hidden = true;
      transitionTo('TITLE');
      updateTitleHighscore();
    });

    $('btn-retry').addEventListener('click',       () => startGame(mode, endlessMode, charMode));
    $('btn-go-retry').addEventListener('click', () => {
      $('gameover-overlay').hidden = true;
      startGame(mode, endlessMode, charMode);
    });
    $('btn-go-title').addEventListener('click', () => {
      $('gameover-overlay').hidden = true;
      transitionTo('TITLE');
      updateTitleHighscore();
    });
    $('btn-mode-select').addEventListener('click', () => transitionTo('MODE_SELECT'));
    $('btn-to-title').addEventListener('click',    () => {
      transitionTo('TITLE');
      updateTitleHighscore();
    });

    updateTitleHighscore();
    transitionTo('TITLE');
  }

  function startGame(m, isEndless, isChar = false, isHard = false) {
    stopEndless();
    stopTimer();
    const goOverlay = $('gameover-overlay');
    if (goOverlay) goOverlay.hidden = true;

    mode          = m;
    endlessMode   = isEndless;
    charMode      = isChar;
    hardMode      = isHard;
    totalScore    = 0;
    questionIndex = 0;
    answeredCount = 0;
    gzGameOver    = false;
    questionList  = buildQuestionList();

    transitionTo('PLAYING');

    const panel = $('endless-panel');
    if (panel) panel.hidden = !isEndless;

    if (isEndless) startEndless();

    showQuestion(0);
  }

  document.addEventListener('DOMContentLoaded', init);
})();

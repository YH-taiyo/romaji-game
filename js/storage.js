'use strict';

const Storage = (() => {
  const KEY = 'romaji_highscore';

  function get() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function set(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // ストレージ書き込み失敗は無視
    }
  }

  return { get, set };
})();

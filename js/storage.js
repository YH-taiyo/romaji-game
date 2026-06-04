'use strict';

const Storage = (() => {
  function get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function set(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // ストレージ書き込み失敗は無視
    }
  }

  return { get, set };
})();

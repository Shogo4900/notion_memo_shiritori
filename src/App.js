import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  DB_MAP,
  isKanjiOrAlphabet,
  classifyKana,
  queryDatabase,
  searchAllDatabases,
  addEntry,
  deletePage,
  updateEntry,
  prefetchAllDatabases,
  invalidateAllCache,
  flexMatch,
} from "./notionApi";
import "./App.css";

const STORAGE_KEY = "notion_memo_token";

function containsKanjiOrAlphabet(word) {
  if (!word) return false;
  return [...word].some((c) => isKanjiOrAlphabet(c));
}

// ひらがな↔カタカナ正規化（どちらで入力しても同じ文字として比較）
function normalizeKana(s) {
  if (!s) return "";
  return s.replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// 言葉の「実質的な先頭文字」を返す
// 漢字/英字始まりなら読み方の先頭、それ以外は言葉の先頭
function effectiveFirst(entry) {
  if (!entry.言葉) return "";
  // 読み方があれば読み方の先頭（カタカナ語も含む）、なければ言葉の先頭
  if (entry.読み方) return entry.読み方[0];
  return entry.言葉[0];
}

// 全ひらがな（清音+濁音+半濁音）一覧
const KANA_ROWS = [
  { row: "あ行", chars: ["あ","い","う","え","お"] },
  { row: "か行", chars: ["か","き","く","け","こ","が","ぎ","ぐ","げ","ご"] },
  { row: "さ行", chars: ["さ","し","す","せ","そ","ざ","じ","ず","ぜ","ぞ"] },
  { row: "た行", chars: ["た","ち","つ","て","と","だ","ぢ","づ","で","ど"] },
  { row: "な行", chars: ["な","に","ぬ","ね","の"] },
  { row: "は行", chars: ["は","ひ","ふ","へ","ほ","ば","び","ぶ","べ","ぼ","ぱ","ぴ","ぷ","ぺ","ぽ"] },
  { row: "ま行", chars: ["ま","み","む","め","も"] },
  { row: "や行", chars: ["や","ゆ","よ"] },
  { row: "ら行", chars: ["ら","り","る","れ","ろ"] },
  { row: "わ行", chars: ["わ","を","ん"] },
];

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [tokenInput, setTokenInput] = useState("");
  const [isAuthed, setIsAuthed] = useState(!!localStorage.getItem(STORAGE_KEY));

  const [activeTab, setActiveTab] = useState("add");
  const [selectedRow, setSelectedRow] = useState("あ行");

  const [form, setForm] = useState({ 言葉: "", 読み方: "", 意味: "" });
  const [autoRow, setAutoRow] = useState("あ行");
  const [addStatus, setAddStatus] = useState(null);
  const [addError, setAddError] = useState("");

  // 検索
  const [searchMode, setSearchMode] = useState("word"); // "word" | "meaning" | "advanced"
  const [searchKeyword, setSearchKeyword] = useState("");
  const [advFirst, setAdvFirst] = useState("");  // 頭文字
  const [advLast, setAdvLast] = useState("");    // 末尾文字
  const [advTarget, setAdvTarget] = useState("reading"); // "reading" | "word"
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);

  const [allData, setAllData] = useState({});
  const [loadingRows, setLoadingRows] = useState(new Set());

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [missingFilter, setMissingFilter] = useState("reading");

  // ── loadRow ──────────────────────────────────
  const loadRow = useCallback(async (row) => {
    setLoadingRows((prev) => {
      if (prev.has(row)) return prev;
      const next = new Set(prev);
      next.add(row);
      return next;
    });
    try {
      const data = await queryDatabase(token, DB_MAP[row]);
      setAllData((prev) => ({ ...prev, [row]: data }));
    } catch (err) {
      console.error(`${row} 取得失敗:`, err);
    } finally {
      setLoadingRows((prev) => {
        const next = new Set(prev);
        next.delete(row);
        return next;
      });
    }
  }, [token]);

  useEffect(() => {
    if (!isAuthed || !token) return;
    prefetchAllDatabases(token);
    Object.keys(DB_MAP).forEach((row) => loadRow(row));
  }, [isAuthed, token, loadRow]);

  useEffect(() => {
    if (token) localStorage.setItem(STORAGE_KEY, token);
  }, [token]);

  useEffect(() => {
    setAutoRow(classifyKana(form.言葉, form.読み方));
  }, [form.言葉, form.読み方]);

  const updateEntryInState = useCallback((pageId, updated) => {
    setAllData((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((row) => {
        if (next[row]) next[row] = next[row].map((p) => p.id === pageId ? { ...p, ...updated } : p);
      });
      return next;
    });
    setSearchResults((prev) =>
      prev ? prev.map((p) => (p.id === pageId ? { ...p, ...updated } : p)) : prev
    );
  }, []);

  // ── 認証 ─────────────────────────────────────
  const handleAuth = (e) => {
    e.preventDefault();
    const t = tokenInput.trim();
    if (!t) return;
    setToken(t);
    setIsAuthed(true);
  };

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEY);
    invalidateAllCache();
    setToken(""); setTokenInput(""); setIsAuthed(false); setAllData({});
  };

  // ── 追加 ─────────────────────────────────────
  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.言葉.trim()) return;
    setAddStatus("loading"); setAddError("");
    try {
      const dbId = DB_MAP[autoRow];
      await addEntry(token, dbId, { 言葉: form.言葉.trim(), 読み方: form.読み方.trim(), 意味: form.意味.trim() });
      setAddStatus("success");
      setForm({ 言葉: "", 読み方: "", 意味: "" });
      const updated = await queryDatabase(token, dbId);
      setAllData((prev) => ({ ...prev, [autoRow]: updated }));
      setTimeout(() => setAddStatus(null), 3000);
    } catch (err) {
      setAddStatus("error"); setAddError(err.message);
    }
  };

  // ── 検索 ─────────────────────────────────────
  const allLoaded = useMemo(
    () => Object.keys(DB_MAP).every((row) => !!allData[row]),
    [allData]
  );

  const allEntries = useMemo(() => {
    const results = [];
    Object.entries(allData).forEach(([rowName, pages]) => {
      pages?.forEach((p) => results.push({ ...p, _row: rowName }));
    });
    return results;
  }, [allData]);

  const searchInCache = useCallback((keyword, mode, first, last, target = "reading") => {
    if (mode === "advanced") {
      const f = normalizeKana(first.trim());
      const l = normalizeKana(last.trim());
      // target は引数から受け取る（"reading" or "word"）
      return allEntries.filter((p) => {
        // 検索対象文字列を決定
        const getTarget = () => {
          if (target === "word") return normalizeKana(p.言葉 || "");
          // reading: 読み方がある場合は読み方、なければ言葉をひらがな正規化
          const reading = normalizeKana(p.読み方 || "");
          const word = normalizeKana(p.言葉 || "");
          return reading || word;
        };
        const str = getTarget();
        if (f && !str.startsWith(f)) return false;
        if (l && !str.endsWith(l)) return false;
        return true;
      });
    }
    return allEntries.filter((p) =>
      mode === "meaning"
        ? flexMatch(p.意味, keyword)
        : flexMatch(p.言葉, keyword) || flexMatch(p.読み方, keyword)
    );
  }, [allEntries]);

  const handleSearchFast = async (e) => {
    e.preventDefault();
    if (searchMode === "advanced") {
      if (!advFirst.trim() && !advLast.trim()) return;
      setSearchResults(searchInCache("", "advanced", advFirst, advLast, advTarget));
      return;
    }
    if (!searchKeyword.trim()) return;
    if (allLoaded) {
      setSearchResults(searchInCache(searchKeyword.trim(), searchMode, "", ""));
    } else {
      setIsSearching(true); setSearchResults(null);
      try {
        const results = await searchAllDatabases(token, searchKeyword.trim(), searchMode);
        setSearchResults(results);
      } catch (err) {
        alert("検索エラー: " + err.message); setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }
  };

  const handleModeChange = (mode) => { setSearchMode(mode); setSearchResults(null); };

  // ── 削除 ─────────────────────────────────────
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const rowName = Object.keys(DB_MAP).find((row) =>
        allData[row]?.some((p) => p.id === deleteTarget.id)
      );
      await deletePage(token, deleteTarget.id, rowName ? DB_MAP[rowName] : undefined);
      setAllData((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((row) => {
          if (next[row]) next[row] = next[row].filter((p) => p.id !== deleteTarget.id);
        });
        return next;
      });
      setSearchResults((prev) => prev ? prev.filter((p) => p.id !== deleteTarget.id) : prev);
      setDeleteTarget(null);
    } catch (err) {
      alert("削除エラー: " + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  // ── 派生値 ───────────────────────────────────
  const browseData = allData[selectedRow] ?? [];
  const isBrowseLoading = loadingRows.has(selectedRow);

  const missingEntries = useMemo(() => {
    const results = [];
    Object.entries(allData).forEach(([rowName, pages]) => {
      pages?.forEach((p) => {
        let hit = false;
        if (missingFilter === "reading") hit = containsKanjiOrAlphabet(p.言葉) && (!p.読み方 || containsKanjiOrAlphabet(p.読み方));
        if (missingFilter === "meaning") hit = !p.意味;
        if (missingFilter === "word")    hit = !p.言葉;
        if (hit) results.push({ ...p, _row: rowName });
      });
    });
    return results;
  }, [allData, missingFilter]);

  // 要確認タブ用: 全エントリの中から重複グループを抽出
  const duplicateGroups = useMemo(() => {
    // 「実質的な読み」= 漢字/英字始まりなら読み方、それ以外は言葉をひらがな正規化したもの
    // これで「あああ」と「嗚呼あ（読み：あああ）」が同じキーになる
    const effectiveReading = (p) => {
      if (!p.言葉) return normalizeKana(p.読み方 || "");
      if (containsKanjiOrAlphabet(p.言葉[0]) && p.読み方) return normalizeKana(p.読み方);
      return normalizeKana(p.言葉);
    };

    const readingMap = {};
    allEntries.forEach((p) => {
      const key = effectiveReading(p);
      if (!key) return;
      if (!readingMap[key]) readingMap[key] = [];
      readingMap[key].push(p);
    });

    const groups = [];
    Object.entries(readingMap).forEach(([key, entries]) => {
      if (entries.length < 2) return;
      // 代表ラベル: グループ内の言葉を列挙
      const label = entries.map((e) => e.言葉 || "（空）").join(" / ");
      groups.push({ label, entries });
    });
    return groups;
  }, [allEntries]);

  // 追加フォームの重複チェック（言葉 or 読み方が完全一致）
  const duplicateCandidates = useMemo(() => {
    if (!allLoaded) return [];
    const word = form.言葉.trim();
    const reading = form.読み方.trim();
    if (!word && !reading) return [];
    return allEntries.filter((p) => {
      const wordMatch    = word    && normalizeKana(p.言葉)  === normalizeKana(word);
      const readingMatch = reading && normalizeKana(p.読み方) === normalizeKana(reading);
      return wordMatch || readingMatch;
    });
  }, [allEntries, form.言葉, form.読み方, allLoaded]);

  const totalMissing = useMemo(() => {
    let count = 0;
    Object.values(allData).forEach((pages) => {
      pages?.forEach((p) => {
        if ((containsKanjiOrAlphabet(p.言葉) && (!p.読み方 || containsKanjiOrAlphabet(p.読み方))) || !p.意味 || !p.言葉) count++;
      });
    });
    return count + duplicateGroups.length;
  }, [allData, duplicateGroups]);

  // 文字別単語数（統計）
  const charStats = useMemo(() => {
    const map = {};
    allEntries.forEach((p) => {
      const ch = normalizeKana(effectiveFirst(p));
      if (ch) map[ch] = (map[ch] || 0) + 1;
    });
    return map;
  }, [allEntries]);

  const needsReadingWarning = containsKanjiOrAlphabet(form.言葉) && !form.読み方.trim();

  // ── 認証画面 ─────────────────────────────────
  if (!isAuthed) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-icon">📝</div>
          <h1>「ル」メモ管理</h1>
          <p className="auth-desc">Notion Integration Token を入力してください</p>
          <form onSubmit={handleAuth}>
            <input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
              className="token-input" autoComplete="off" />
            <button type="submit" className="btn-primary" disabled={!tokenInput.trim()}>接続する</button>
          </form>
          <p className="auth-help">
            <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer">Integrationの作成はこちら →</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="header-icon">📝</span>
          <h1>「ル」メモ管理</h1>
        </div>
        <div className="header-right">
          {!allLoaded && <span className="loading-badge">読込中…</span>}
          <button className="btn-logout" onClick={handleLogout}>ログアウト</button>
        </div>
      </header>

      <nav className="tab-nav">
        {[
          { key: "add",     label: "＋ 追加" },
          { key: "search",  label: "🔍 検索" },
          { key: "browse",  label: "📋 一覧" },
          { key: "stats",   label: "📊 統計" },
          { key: "missing", label: totalMissing > 0 ? `⚠️ 要確認 (${totalMissing})` : "⚠️ 要確認" },
        ].map((t) => (
          <button key={t.key} className={`tab-btn ${activeTab === t.key ? "active" : ""}`} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="main-content">

        {/* ── 追加タブ ── */}
        {activeTab === "add" && (
          <div className="tab-panel">
            <div className="panel-header">
              <h2>新しい言葉を追加</h2>
              <p>「言葉」の頭文字でデータベースが自動選択されます</p>
            </div>
            <form onSubmit={handleAdd} className="add-form">
              <div className="form-group">
                <label>言葉 <span className="required">*</span></label>
                <input type="text" value={form.言葉} onChange={(e) => setForm({ ...form, 言葉: e.target.value })} required />
              </div>
              {form.言葉 && (
                <div className="auto-classify">
                  <span className="classify-label">分類先：</span>
                  <span className="classify-badge">{autoRow}</span>
                </div>
              )}
              <div className="form-group">
                <label>漢字または英字の読み方</label>
                <input type="text" value={form.読み方} onChange={(e) => setForm({ ...form, 読み方: e.target.value })} />
              </div>
              <div className="form-group">
                <label>意味</label>
                <textarea value={form.意味} onChange={(e) => setForm({ ...form, 意味: e.target.value })} rows={4} />
              </div>
              {needsReadingWarning && (
                <div className="status-message warning">⚠️ 漢字または英字が含まれていますが「読み方」が入力されていません。このまま追加しますか？</div>
              )}
              {duplicateCandidates.length > 0 && (
                <div className="duplicate-warning">
                  <div className="duplicate-warning-title">⚠️ 似た言葉が {duplicateCandidates.length} 件あります</div>
                  {duplicateCandidates.map((p) => (
                    <div key={p.id} className="duplicate-item">
                      <span className="duplicate-word">{p.言葉}</span>
                      {p.読み方 && <span className="duplicate-reading">（{p.読み方}）</span>}
                      {p._row && <span className="entry-row-badge">{p._row}</span>}
                    </div>
                  ))}
                </div>
              )}
              <button type="submit" className="btn-primary" disabled={!form.言葉.trim() || addStatus === "loading"}>
                {addStatus === "loading" ? "追加中…" : "追加する"}
              </button>
              {addStatus === "success" && <div className="status-message success">✓ 「{autoRow}」に追加しました！</div>}
              {addStatus === "error" && <div className="status-message error">✗ エラー: {addError}</div>}
            </form>
          </div>
        )}

        {/* ── 検索タブ ── */}
        {activeTab === "search" && (
          <div className="tab-panel">
            <div className="panel-header"><h2>検索</h2></div>

            <div className="filter-selector" style={{ marginBottom: "1rem" }}>
              {[
                { key: "word",     label: "言葉・読み方" },
                { key: "meaning",  label: "意味" },
                { key: "advanced", label: "詳細検索" },
              ].map((m) => (
                <button key={m.key} className={`row-btn ${searchMode === m.key ? "active" : ""}`} onClick={() => handleModeChange(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>

            {searchMode !== "advanced" ? (
              <form onSubmit={handleSearchFast} className="search-form">
                <div className="search-input-row">
                  <input type="text" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder={searchMode === "meaning" ? "意味のキーワードを入力…" : "言葉・読み方のキーワードを入力…"} />
                  <button type="submit" className="btn-primary" disabled={!searchKeyword.trim() || isSearching}>
                    {isSearching ? "検索中…" : "検索"}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleSearchFast} className="search-form">
                <div className="filter-selector" style={{ marginBottom: "0.75rem" }}>
                  <button type="button" className={`row-btn ${advTarget === "reading" ? "active" : ""}`} onClick={() => setAdvTarget("reading")}>読み方</button>
                  <button type="button" className={`row-btn ${advTarget === "word" ? "active" : ""}`} onClick={() => setAdvTarget("word")}>言葉</button>
                </div>
                <p className="search-hint">
                  {advTarget === "reading" ? "漢字/英字の言葉は読み方で、それ以外は言葉で判定します" : "言葉フィールドをそのまま判定します"}
                </p>
                <div className="advanced-search-grid">
                  <div className="form-group">
                    <label>頭文字</label>
                    <input type="text" value={advFirst} onChange={(e) => setAdvFirst(e.target.value)}
                      className="char-input" />
                  </div>
                  <div className="advanced-sep">→</div>
                  <div className="form-group">
                    <label>末尾文字</label>
                    <input type="text" value={advLast} onChange={(e) => setAdvLast(e.target.value)}
                      className="char-input" />
                  </div>
                </div>
                <p className="search-hint">複数文字の前方一致・後方一致。ひらがな・カタカナは同一視します。</p>
                <button type="submit" className="btn-primary" disabled={!advFirst.trim() && !advLast.trim()}>検索</button>
              </form>
            )}

            {isSearching && <div className="loading">全データベースを検索中…</div>}
            {!isSearching && searchResults !== null && searchResults.length > 0 && (
              <div className="results-section">
                <div className="results-count">{searchResults.length} 件</div>
                <div className="entry-list">
                  {searchResults.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} showRow token={token} onDelete={() => setDeleteTarget(entry)} onUpdate={updateEntryInState} />
                  ))}
                </div>
              </div>
            )}
            {!isSearching && searchResults !== null && searchResults.length === 0 && (
              <div className="empty-state">一致する言葉が見つかりませんでした</div>
            )}
          </div>
        )}

        {/* ── 一覧タブ ── */}
        {activeTab === "browse" && (
          <div className="tab-panel">
            <div className="panel-header"><h2>一覧</h2></div>
            <div className="row-selector">
              {Object.keys(DB_MAP).map((row) => (
                <button key={row} className={`row-btn ${selectedRow === row ? "active" : ""}`} onClick={() => setSelectedRow(row)}>
                  {row}{loadingRows.has(row) && <span className="row-loading">…</span>}
                </button>
              ))}
            </div>
            {isBrowseLoading && <div className="loading">読み込み中…</div>}
            {!isBrowseLoading && browseData.length > 0 && (
              <div className="results-section">
                <div className="results-count">{browseData.length} 件</div>
                <div className="entry-list">
                  {browseData.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} token={token} onDelete={() => setDeleteTarget(entry)} onUpdate={updateEntryInState} />
                  ))}
                </div>
              </div>
            )}
            {!isBrowseLoading && browseData.length === 0 && <div className="empty-state">データがありません</div>}
          </div>
        )}

        {/* ── 統計タブ ── */}
        {activeTab === "stats" && (
          <div className="tab-panel">
            <div className="panel-header">
              <h2>文字別単語数</h2>
              <p>全 {allEntries.length} 語（{allLoaded ? "読込完了" : "読込中…"}）</p>
            </div>
            <div className="stats-container">
              {KANA_ROWS.map(({ row, chars }) => (
                <div key={row} className="stats-row">
                  <div className="stats-row-label">{row}</div>
                  <div className="stats-chars">
                    {chars.map((ch) => {
                      const count = charStats[ch] || 0;
                      return (
                        <div key={ch} className={`stats-cell ${count > 0 ? "has-count" : "zero"}`}>
                          <span className="stats-char">{ch}</span>
                          <span className="stats-count">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 要確認タブ ── */}
        {activeTab === "missing" && (
          <div className="tab-panel">
            <div className="panel-header"><h2>要確認リスト</h2></div>
            <div className="filter-selector">
              {[
                { key: "reading",   label: "読み方なし" },
                { key: "meaning",   label: "意味なし" },
                { key: "word",      label: "言葉なし" },
                { key: "duplicate", label: `重複 (${duplicateGroups.length})` },
              ].map((f) => (
                <button key={f.key} className={`row-btn ${missingFilter === f.key ? "active" : ""}`} onClick={() => setMissingFilter(f.key)}>
                  {f.label}
                </button>
              ))}
            </div>
            <p className="search-hint" style={{ marginBottom: "1rem" }}>
              {missingFilter === "reading"   && "漢字または英字を含むのに「読み方」が未入力、または読み方に漢字・英字が含まれるエントリ"}
              {missingFilter === "meaning"   && "「意味」が未入力のエントリ"}
              {missingFilter === "word"      && "「言葉」が未入力のエントリ"}
              {missingFilter === "duplicate" && "「言葉」または「読み方」が同じエントリのグループ"}
            </p>
            {!allLoaded && <div className="loading">読み込み中…</div>}
            {allLoaded && missingFilter !== "duplicate" && missingEntries.length === 0 && <div className="empty-state">✓ 該当するエントリはありません</div>}
            {allLoaded && missingFilter === "duplicate" && duplicateGroups.length === 0 && <div className="empty-state">✓ 重複するエントリはありません</div>}
            {missingFilter !== "duplicate" && missingEntries.length > 0 && (
              <div className="results-section">
                <div className="results-count">{missingEntries.length} 件</div>
                <div className="entry-list">
                  {missingEntries.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} showRow token={token} onDelete={() => setDeleteTarget(entry)} onUpdate={updateEntryInState} />
                  ))}
                </div>
              </div>
            )}
            {missingFilter === "duplicate" && duplicateGroups.length > 0 && (
              <div className="results-section">
                <div className="results-count">{duplicateGroups.length} グループ</div>
                {duplicateGroups.map((group, i) => (
                  <div key={i} className="duplicate-group">
                    <div className="duplicate-group-label">{group.label}</div>
                    <div className="entry-list">
                      {group.entries.map((entry) => (
                        <EntryCard key={entry.id} entry={entry} showRow token={token} onDelete={() => setDeleteTarget(entry)} onUpdate={updateEntryInState} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => !isDeleting && setDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>削除の確認</h3>
            <p>「<strong>{deleteTarget.言葉}</strong>」を削除しますか？この操作は取り消せません。</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>キャンセル</button>
              <button className="btn-danger" onClick={handleDeleteConfirm} disabled={isDeleting}>
                {isDeleting ? "削除中…" : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EntryCard({ entry, showRow, token, onDelete, onUpdate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ 言葉: entry.言葉, 読み方: entry.読み方, 意味: entry.意味 });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const handleEdit = () => { setEditForm({ 言葉: entry.言葉, 読み方: entry.読み方, 意味: entry.意味 }); setSaveError(""); setIsEditing(true); };
  const handleCancel = () => { setIsEditing(false); setSaveError(""); };

  const handleSave = async () => {
    if (!editForm.言葉.trim()) return;
    setIsSaving(true); setSaveError("");
    try {
      await updateEntry(token, entry.id, { 言葉: editForm.言葉.trim(), 読み方: editForm.読み方.trim(), 意味: editForm.意味.trim() });
      onUpdate(entry.id, { 言葉: editForm.言葉.trim(), 読み方: editForm.読み方.trim(), 意味: editForm.意味.trim() });
      setIsEditing(false);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className="entry-card editing">
        <div className="entry-main">
          {showRow && entry._row && <div className="entry-row-badge" style={{ marginBottom: "0.5rem" }}>{entry._row}</div>}
          <div className="edit-form-group">
            <label>言葉</label>
            <input type="text" value={editForm.言葉} onChange={(e) => setEditForm({ ...editForm, 言葉: e.target.value })} />
          </div>
          <div className="edit-form-group">
            <label>読み方</label>
            <input type="text" value={editForm.読み方} onChange={(e) => setEditForm({ ...editForm, 読み方: e.target.value })} />
          </div>
          <div className="edit-form-group">
            <label>意味</label>
            <textarea value={editForm.意味} onChange={(e) => setEditForm({ ...editForm, 意味: e.target.value })} rows={3} />
          </div>
          {saveError && <div className="status-message error" style={{ marginTop: "0.5rem" }}>✗ {saveError}</div>}
          <div className="edit-actions">
            <button className="btn-secondary" onClick={handleCancel} disabled={isSaving}>キャンセル</button>
            <button className="btn-primary" onClick={handleSave} disabled={!editForm.言葉.trim() || isSaving}>
              {isSaving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="entry-card">
      <div className="entry-main">
        <div className="entry-header">
          <span className="entry-word">{entry.言葉}</span>
          {showRow && entry._row && <span className="entry-row-badge">{entry._row}</span>}
        </div>
        {entry.読み方 && <div className="entry-reading">{entry.読み方}</div>}
        {entry.意味 && <div className="entry-meaning">{entry.意味}</div>}
      </div>
      <div className="entry-actions">
        <button className="btn-edit" onClick={handleEdit} title="編集" aria-label="編集">✏️</button>
        <button className="btn-delete" onClick={onDelete} title="削除" aria-label="削除">🗑</button>
      </div>
    </div>
  );
}

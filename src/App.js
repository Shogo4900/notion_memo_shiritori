import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  DB_MAP,
  classifyKana,
  queryDatabase,
  searchAllDatabases,
  addEntry,
  deletePage,
  prefetchAllDatabases,
  invalidateAllCache,
} from "./notionApi";
import "./App.css";

const STORAGE_KEY = "notion_memo_token";

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

  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);

  // 全DBのデータをまとめて保持 { "あ行": [...], ... }
  const [allData, setAllData] = useState({});
  const [loadingRows, setLoadingRows] = useState(new Set());

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ログイン後すぐに全DB並列取得を開始
  useEffect(() => {
    if (!isAuthed || !token) return;
    prefetchAllDatabases(token);

    // 表示中の行（あ行）を優先的にロード
    loadRow("あ行");
    // 残りはバックグラウンドで非同期に
    Object.keys(DB_MAP).forEach((row) => {
      if (row !== "あ行") loadRow(row);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, token]);

  const loadRow = useCallback(async (row) => {
    if (allData[row]) return; // キャッシュ済みならスキップ
    setLoadingRows((prev) => new Set(prev).add(row));
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
  }, [token, allData]);

  useEffect(() => {
    if (token) localStorage.setItem(STORAGE_KEY, token);
  }, [token]);

  useEffect(() => {
    setAutoRow(classifyKana(form.言葉, form.読み方));
  }, [form.言葉, form.読み方]);

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
    setToken("");
    setTokenInput("");
    setIsAuthed(false);
    setAllData({});
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.言葉.trim()) return;
    setAddStatus("loading");
    setAddError("");
    try {
      const dbId = DB_MAP[autoRow];
      await addEntry(token, dbId, {
        言葉: form.言葉.trim(),
        読み方: form.読み方.trim(),
        意味: form.意味.trim(),
      });
      setAddStatus("success");
      setForm({ 言葉: "", 読み方: "", 意味: "" });
      // キャッシュが更新されたので allData も再反映
      const updated = await queryDatabase(token, dbId);
      setAllData((prev) => ({ ...prev, [autoRow]: updated }));
      setTimeout(() => setAddStatus(null), 3000);
    } catch (err) {
      setAddStatus("error");
      setAddError(err.message);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchKeyword.trim()) return;
    setIsSearching(true);
    setSearchResults(null);
    try {
      const results = await searchAllDatabases(token, searchKeyword.trim());
      setSearchResults(results);
    } catch (err) {
      alert("検索エラー: " + err.message);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      // どの行のDBに属するか特定
      const rowName = Object.entries(DB_MAP).find(
        ([, dbId]) => allData[Object.keys(DB_MAP).find((r) => DB_MAP[r] === dbId)]
          ?.some((p) => p.id === deleteTarget.id)
      )?.[0] ?? selectedRow;
      await deletePage(token, deleteTarget.id, DB_MAP[rowName]);
      // allData から除去
      setAllData((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((row) => {
          if (next[row]) next[row] = next[row].filter((p) => p.id !== deleteTarget.id);
        });
        return next;
      });
      setSearchResults((prev) =>
        prev ? prev.filter((p) => p.id !== deleteTarget.id) : prev
      );
      setDeleteTarget(null);
    } catch (err) {
      alert("削除エラー: " + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const browseData = allData[selectedRow] ?? [];
  const isBrowseLoading = loadingRows.has(selectedRow);

  // 検索はキャッシュ済みデータからインメモリで即時実行する補助関数
  const searchInCache = useCallback((keyword) => {
    const results = [];
    Object.entries(allData).forEach(([rowName, pages]) => {
      pages?.forEach((p) => {
        if (p.言葉?.includes(keyword) || p.読み方?.includes(keyword)) {
          results.push({ ...p, _row: rowName });
        }
      });
    });
    return results;
  }, [allData]);

  // 全DB読み込み済みかどうか
  const allLoaded = useMemo(
    () => Object.keys(DB_MAP).every((row) => !!allData[row]),
    [allData]
  );

  const handleSearchFast = async (e) => {
    e.preventDefault();
    if (!searchKeyword.trim()) return;
    if (allLoaded) {
      // キャッシュ済みなら即座に結果表示
      setSearchResults(searchInCache(searchKeyword.trim()));
    } else {
      // まだ取得中ならAPIへ
      setIsSearching(true);
      setSearchResults(null);
      try {
        const results = await searchAllDatabases(token, searchKeyword.trim());
        setSearchResults(results);
      } catch (err) {
        alert("検索エラー: " + err.message);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }
  };

  if (!isAuthed) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-icon">📝</div>
          <h1>「ル」メモ管理</h1>
          <p className="auth-desc">Notion Integration Token を入力してください</p>
          <form onSubmit={handleAuth}>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="secret_xxxxxxxxxxxx"
              className="token-input"
              autoComplete="off"
            />
            <button type="submit" className="btn-primary" disabled={!tokenInput.trim()}>
              接続する
            </button>
          </form>
          <p className="auth-help">
            <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer">
              Integrationの作成はこちら →
            </a>
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
          {!allLoaded && (
            <span className="loading-badge">読込中…</span>
          )}
          <button className="btn-logout" onClick={handleLogout}>ログアウト</button>
        </div>
      </header>

      <nav className="tab-nav">
        {[
          { key: "add", label: "＋ 追加" },
          { key: "search", label: "🔍 検索" },
          { key: "browse", label: "📋 一覧" },
        ].map((t) => (
          <button
            key={t.key}
            className={`tab-btn ${activeTab === t.key ? "active" : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="main-content">

        {/* ── 追加 ── */}
        {activeTab === "add" && (
          <div className="tab-panel">
            <div className="panel-header">
              <h2>新しい言葉を追加</h2>
              <p>「言葉」の頭文字でデータベースが自動選択されます</p>
            </div>
            <form onSubmit={handleAdd} className="add-form">
              <div className="form-group">
                <label>言葉 <span className="required">*</span></label>
                <input
                  type="text"
                  value={form.言葉}
                  onChange={(e) => setForm({ ...form, 言葉: e.target.value })}
                  placeholder="例：ルービックキューブ"
                  required
                />
              </div>

              {form.言葉 && (
                <div className="auto-classify">
                  <span className="classify-label">分類先：</span>
                  <span className="classify-badge">{autoRow}</span>
                </div>
              )}

              <div className="form-group">
                <label>漢字または英字の読み方</label>
                <input
                  type="text"
                  value={form.読み方}
                  onChange={(e) => setForm({ ...form, 読み方: e.target.value })}
                  placeholder="例：るーびっくきゅーぶ"
                />
              </div>

              <div className="form-group">
                <label>意味</label>
                <textarea
                  value={form.意味}
                  onChange={(e) => setForm({ ...form, 意味: e.target.value })}
                  placeholder="例：6面体のパズル。1974年にルービック・エルノーが発明。"
                  rows={4}
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={!form.言葉.trim() || addStatus === "loading"}
              >
                {addStatus === "loading" ? "追加中…" : "追加する"}
              </button>

              {addStatus === "success" && (
                <div className="status-message success">✓ 「{autoRow}」に追加しました！</div>
              )}
              {addStatus === "error" && (
                <div className="status-message error">✗ エラー: {addError}</div>
              )}
            </form>
          </div>
        )}

        {/* ── 検索 ── */}
        {activeTab === "search" && (
          <div className="tab-panel">
            <div className="panel-header">
              <h2>検索</h2>
              <p>全データベースの「言葉」「読み方」を検索します</p>
            </div>
            <form onSubmit={handleSearchFast} className="search-form">
              <div className="search-input-row">
                <input
                  type="text"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  placeholder="キーワードを入力…"
                />
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!searchKeyword.trim() || isSearching}
                >
                  {isSearching ? "検索中…" : "検索"}
                </button>
              </div>
            </form>

            {isSearching && <div className="loading">全データベースを検索中…</div>}

            {!isSearching && searchResults !== null && searchResults.length > 0 && (
              <div className="results-section">
                <div className="results-count">{searchResults.length} 件</div>
                <div className="entry-list">
                  {searchResults.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} showRow onDelete={() => setDeleteTarget(entry)} />
                  ))}
                </div>
              </div>
            )}

            {!isSearching && searchResults !== null && searchResults.length === 0 && (
              <div className="empty-state">一致する言葉が見つかりませんでした</div>
            )}
          </div>
        )}

        {/* ── 一覧 ── */}
        {activeTab === "browse" && (
          <div className="tab-panel">
            <div className="panel-header">
              <h2>一覧</h2>
            </div>
            <div className="row-selector">
              {Object.keys(DB_MAP).map((row) => (
                <button
                  key={row}
                  className={`row-btn ${selectedRow === row ? "active" : ""}`}
                  onClick={() => setSelectedRow(row)}
                >
                  {row}
                  {loadingRows.has(row) && <span className="row-loading">…</span>}
                </button>
              ))}
            </div>

            {isBrowseLoading && <div className="loading">読み込み中…</div>}

            {!isBrowseLoading && browseData.length > 0 && (
              <div className="results-section">
                <div className="results-count">{browseData.length} 件</div>
                <div className="entry-list">
                  {browseData.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} onDelete={() => setDeleteTarget(entry)} />
                  ))}
                </div>
              </div>
            )}

            {!isBrowseLoading && browseData.length === 0 && (
              <div className="empty-state">データがありません</div>
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
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
                キャンセル
              </button>
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

function EntryCard({ entry, showRow, onDelete }) {
  return (
    <div className="entry-card">
      <div className="entry-main">
        <div className="entry-header">
          <span className="entry-word">{entry.言葉}</span>
          {showRow && entry._row && (
            <span className="entry-row-badge">{entry._row}</span>
          )}
        </div>
        {entry.読み方 && <div className="entry-reading">{entry.読み方}</div>}
        {entry.意味 && <div className="entry-meaning">{entry.意味}</div>}
      </div>
      <button className="btn-delete" onClick={onDelete} title="削除" aria-label="削除">🗑</button>
    </div>
  );
}

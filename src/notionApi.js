// ひらがな↔カタカナ相互変換して両方にマッチするか判定
export function flexMatch(text, keyword) {
  if (!text || !keyword) return false;
  if (text.includes(keyword)) return true;
  // ひらがな→カタカナ変換
  const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  // カタカナ→ひらがな変換
  const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  return text.includes(toKata(keyword)) || text.includes(toHira(keyword));
}

const PROXY = "/api/notion";

export const DB_MAP = {
  あ行: "2788b900-6adc-80c2-90b0-d4be36265c28",
  か行: "2788b900-6adc-808a-9388-f3686e8c7ef0",
  さ行: "2788b900-6adc-800b-958e-f0416d9a3281",
  "た・な行": "2788b900-6adc-8071-8730-f466dde336de",
  は行: "2788b900-6adc-80cc-b312-d3b80a3734b5",
  "ま・や行": "2788b900-6adc-8015-969e-c0b668a4a06a",
  "ら・わ行": "2788b900-6adc-802b-8674-c5ec699817e6",
};

// ── 分類ロジック ──────────────────────────────
export function isKanjiOrAlphabet(char) {
  if (!char) return false;
  const code = char.charCodeAt(0);
  const isAlphabet = (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
  const isKanji = code >= 0x4e00 && code <= 0x9fff;
  return isAlphabet || isKanji;
}

function rowFromChar(char) {
  if (!char) return "あ行";
  if ("あいうえおアイウエオ".includes(char)) return "あ行";
  if ("かきくけこがぎぐげごカキクケコガギグゲゴ".includes(char)) return "か行";
  if ("さしすせそざじずぜぞサシスセソザジズゼゾ".includes(char)) return "さ行";
  if ("たちつてとだぢづでどタチツテトダヂヅデドなにぬねのナニヌネノ".includes(char)) return "た・な行";
  if ("はひふへほばびぶべぼぱぴぷぺぽハヒフヘホバビブベボパピプペポ".includes(char)) return "は行";
  if ("まみむめもマミムメモやゆよヤユヨ".includes(char)) return "ま・や行";
  if ("らりるれろラリルレロわをんヲンワ".includes(char)) return "ら・わ行";
  return "あ行";
}

export function classifyKana(word, reading) {
  if (!word) return "あ行";
  if (isKanjiOrAlphabet(word[0]) && reading) return rowFromChar(reading[0]);
  return rowFromChar(word[0]);
}

// ── Notion APIへのリクエスト ──────────────────
async function notionFetch(token, notionPath, method = "POST", body = null) {
  const url = `${PROXY}?path=${encodeURIComponent(notionPath)}`;
  const opts = {
    method,
    headers: { "Content-Type": "application/json", "x-notion-token": token },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTPエラー ${res.status}`);
  }
  return res.json();
}

// ── 1DBの全件取得（ページネーション対応）─────
async function fetchAllPages(token, dbId) {
  const allPages = [];
  let cursor = undefined;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notionFetch(token, `/databases/${dbId}/query`, "POST", body);
    data.results.forEach((p) => allPages.push(parseNotionPage(p)));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return allPages;
}

// ── キャッシュ ────────────────────────────────
// { dbId: Promise<page[]> } の形で保持。Promiseごとキャッシュすることで
// 同じDBへの並行リクエストが重複しない。
const cache = {};

export function invalidateCache(dbId) {
  delete cache[dbId];
}

export function invalidateAllCache() {
  Object.keys(cache).forEach((k) => delete cache[k]);
}

// キャッシュがあればそれを返し、なければfetchしてキャッシュする
function getCached(token, dbId) {
  if (!cache[dbId]) {
    cache[dbId] = fetchAllPages(token, dbId);
  }
  return cache[dbId];
}

// ── 公開API ───────────────────────────────────

// 全DBを並列で事前取得（ログイン後すぐ呼ぶ）
export function prefetchAllDatabases(token) {
  Object.values(DB_MAP).forEach((dbId) => getCached(token, dbId));
}

// 1DBの全件取得（キャッシュ利用）
export async function queryDatabase(token, dbId) {
  return getCached(token, dbId);
}

// 検索：全DBを並列取得してフィルタ
export async function searchAllDatabases(token, keyword, mode = "word") {
  const entries = await Promise.all(
    Object.entries(DB_MAP).map(async ([rowName, dbId]) => {
      try {
        const pages = await getCached(token, dbId);
        return pages
          .filter((p) => {
            if (mode === "meaning") return flexMatch(p.意味, keyword);
            return flexMatch(p.言葉, keyword) || flexMatch(p.読み方, keyword);
          })
          .map((p) => ({ ...p, _row: rowName }));
      } catch (e) {
        console.error(`${rowName} 検索失敗:`, e);
        return [];
      }
    })
  );
  return entries.flat();
}

// 追加：Notionに書き込んだあとキャッシュを更新
export async function addEntry(token, dbId, { 言葉, 読み方, 意味 }) {
  const result = await notionFetch(token, "/pages", "POST", {
    parent: { database_id: dbId },
    properties: {
      言葉: { title: [{ text: { content: 言葉 } }] },
      漢字または英字の読み方: { rich_text: [{ text: { content: 読み方 || "" } }] },
      意味: { rich_text: [{ text: { content: 意味 || "" } }] },
    },
  });
  // キャッシュに新エントリを追加
  if (cache[dbId]) {
    cache[dbId] = cache[dbId].then((pages) => [
      ...pages,
      parseNotionPage(result),
    ]);
  }
  return result;
}

// 削除：Notionでアーカイブしたあとキャッシュから除去
export async function deletePage(token, pageId, dbId) {
  const result = await notionFetch(token, `/pages/${pageId}`, "PATCH", { archived: true });
  if (dbId && cache[dbId]) {
    cache[dbId] = cache[dbId].then((pages) => pages.filter((p) => p.id !== pageId));
  }
  return result;
}

function parseNotionPage(page) {
  const props = page.properties;
  return {
    id: page.id,
    言葉: props.言葉?.title?.[0]?.plain_text || "",
    読み方: props["漢字または英字の読み方"]?.rich_text?.[0]?.plain_text || "",
    意味: props.意味?.rich_text?.[0]?.plain_text || "",
  };
}

// エントリ更新
export async function updateEntry(token, pageId, { 言葉, 読み方, 意味 }) {
  return notionFetch(token, `/pages/${pageId}`, "PATCH", {
    properties: {
      言葉: { title: [{ text: { content: 言葉 } }] },
      漢字または英字の読み方: { rich_text: [{ text: { content: 読み方 || "" } }] },
      意味: { rich_text: [{ text: { content: 意味 || "" } }] },
    },
  });
}

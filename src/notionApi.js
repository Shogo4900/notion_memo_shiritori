// Vercel Serverless Function経由でNotion APIを呼び出す
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

export function classifyKana(word) {
  if (!word) return "あ行";
  const first = word[0];
  if ("あいうえおアイウエオ".includes(first)) return "あ行";
  if ("かきくけこがぎぐげごカキクケコガギグゲゴ".includes(first)) return "か行";
  if ("さしすせそざじずぜぞサシスセソザジズゼゾ".includes(first)) return "さ行";
  if ("たちつてとだぢづでどタチツテトダヂヅデドなにぬねのナニヌネノ".includes(first)) return "た・な行";
  if ("はひふへほばびぶべぼぱぴぷぺぽハヒフヘホバビブベボパピプペポ".includes(first)) return "は行";
  if ("まみむめもマミムメモやゆよヤユヨ".includes(first)) return "ま・や行";
  if ("らりるれろラリルレロわをんヲンワ".includes(first)) return "ら・わ行";
  return "あ行"; // 英字・数字・その他はあ行
}

async function notionFetch(token, notionPath, method = "POST", body = null) {
  const url = `${PROXY}?path=${encodeURIComponent(notionPath)}`;
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-notion-token": token,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTPエラー ${res.status}`);
  }
  return res.json();
}

export async function queryDatabase(token, dbId) {
  const data = await notionFetch(
    token,
    `/databases/${dbId}/query`,
    "POST",
    { page_size: 100 }
  );
  return data.results.map(parseNotionPage);
}

// 検索：言葉・読み方のみ対象
export async function searchAllDatabases(token, keyword) {
  const results = [];
  for (const [rowName, dbId] of Object.entries(DB_MAP)) {
    try {
      const pages = await queryDatabase(token, dbId);
      const filtered = pages.filter(
        (p) =>
          p.言葉?.includes(keyword) ||
          p.読み方?.includes(keyword)
      );
      filtered.forEach((p) => results.push({ ...p, _row: rowName }));
    } catch (e) {
      console.error(`${rowName} 検索失敗:`, e);
    }
  }
  return results;
}

export async function addEntry(token, dbId, { 言葉, 読み方, 意味 }) {
  return notionFetch(token, "/pages", "POST", {
    parent: { database_id: dbId },
    properties: {
      言葉: { title: [{ text: { content: 言葉 } }] },
      漢字または英字の読み方: { rich_text: [{ text: { content: 読み方 || "" } }] },
      意味: { rich_text: [{ text: { content: 意味 || "" } }] },
    },
  });
}

export async function deletePage(token, pageId) {
  return notionFetch(token, `/pages/${pageId}`, "PATCH", { archived: true });
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

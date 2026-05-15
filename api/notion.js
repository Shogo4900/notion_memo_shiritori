// Vercel Serverless Function - Notion APIプロキシ
// /api/notion?path=/databases/xxx/query などで呼び出す

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export default async function handler(req, res) {
  // CORSヘッダー
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-notion-token");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const token = req.headers["x-notion-token"];
  if (!token) {
    return res.status(401).json({ error: "x-notion-token header required" });
  }

  // クエリパラメータからNotionのパスを取得 例: ?path=/databases/xxx/query
  const notionPath = req.query.path;
  if (!notionPath) {
    return res.status(400).json({ error: "path query parameter required" });
  }

  const url = `${NOTION_API_BASE}${notionPath}`;

  const fetchOptions = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
  };

  if (req.method !== "GET" && req.body) {
    fetchOptions.body = JSON.stringify(req.body);
  }

  try {
    const notionRes = await fetch(url, fetchOptions);
    const data = await notionRes.json();
    return res.status(notionRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

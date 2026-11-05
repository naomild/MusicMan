import { suno, json, callbackUrl } from "./_suno.mjs";

// POST { prompt } -> start lyrics task.  GET ?taskId= -> poll lyrics task.
export default async (req) => {
  if (req.method === "GET") {
    const taskId = new URL(req.url).searchParams.get("taskId");
    if (!taskId || !/^[\w-]{1,128}$/.test(taskId)) return json({ code: 400, msg: "Missing or invalid taskId" }, 400);
    return suno("/api/v1/lyrics/record-info?taskId=" + encodeURIComponent(taskId));
  }
  if (req.method !== "POST") return json({ code: 405, msg: "Method not allowed" }, 405);
  let input;
  try { input = await req.json(); } catch { return json({ code: 400, msg: "Invalid JSON body" }, 400); }
  const prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 200) : "";
  if (!prompt) return json({ code: 400, msg: "Describe what the lyrics should be about." }, 400);
  return suno("/api/v1/lyrics", { method: "POST", body: { prompt, callBackUrl: callbackUrl(req) } });
};

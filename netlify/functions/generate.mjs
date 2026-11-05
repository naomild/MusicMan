import { suno, json, callbackUrl } from "./_suno.mjs";

const MODELS = ["V6", "V6_WILD", "V6_MINI"];
const clamp01 = (v) => Math.round(Math.min(1, Math.max(0, Number(v))) * 100) / 100;
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export default async (req) => {
  if (req.method !== "POST") return json({ code: 405, msg: "Method not allowed" }, 405);
  let input;
  try { input = await req.json(); } catch { return json({ code: 400, msg: "Invalid JSON body" }, 400); }

  const customMode = !!input.customMode;
  const instrumental = !!input.instrumental;
  const model = MODELS.includes(input.model) ? input.model : "V6";
  const body = { customMode, instrumental, model, callBackUrl: callbackUrl(req) };

  if (!customMode) {
    // Simple mode: describe the song, lyrics are written automatically.
    const prompt = str(input.prompt, 3000);
    const style = str(input.style, 1000);
    if (!prompt && !style) return json({ code: 400, msg: "Describe the song you want (or give a style)." }, 400);
    if (prompt) body.prompt = prompt;
    if (style) body.style = style;
  } else {
    const style = str(input.style, 1000);
    const lyrics = instrumental ? "" : str(input.lyrics, 5000);
    const negativeTags = str(input.negativeTags, 1000);
    const title = str(input.title, 80);
    if (!style && !lyrics && !negativeTags) {
      return json({ code: 400, msg: "Custom mode needs at least a style, lyrics, or styles to avoid." }, 400);
    }
    if (style) body.style = style;
    if (lyrics) body.lyrics = lyrics;
    if (negativeTags) body.negativeTags = negativeTags;
    if (title) body.title = title;
    if (input.vocalGender === "m" || input.vocalGender === "f") body.vocalGender = input.vocalGender;
    if (input.duration != null && input.duration !== "") {
      const d = Math.round(Number(input.duration));
      if (Number.isFinite(d)) body.duration = Math.min(360, Math.max(10, d));
    }
    if (input.styleWeight != null) body.styleWeight = clamp01(input.styleWeight);
    if (input.weirdnessConstraint != null) body.weirdnessConstraint = clamp01(input.weirdnessConstraint);
    if (input.variety != null) body.variety = Math.min(4, Math.max(0, Math.round(Number(input.variety))));
  }

  return suno("/api/v1/generate", { method: "POST", body });
};

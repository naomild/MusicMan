# MusicMan 🎵

A web app for generating AI music with [SunoAPI.org](https://docs.sunoapi.org/).

- **Simple mode:** describe a song and AI writes the lyrics and music.
- **Custom mode:** write your own lyrics (or have AI draft them), then set the title, styles to avoid, vocal gender, length, style adherence, weirdness and variety.
- Choose a model: V6, V6 Wild or V6 Mini. You can also make instrumentals.
- Each request returns two versions. You can stream a version as soon as it's ready and download the MP3 when it's finished.
- Your song history is kept in the browser, and your remaining credits show in the header.

## How it's built

- `public/` is a static frontend (plain HTML/CSS/JS with no build step).
- `netlify/functions/` holds the serverless functions that call SunoAPI. **The API key stays on the server** and never reaches the browser.
  - `generate`: `POST /api/v1/generate`
  - `status`: `GET /api/v1/generate/record-info` (the app polls this every 10s)
  - `lyrics`: `POST /api/v1/lyrics` and `GET /api/v1/lyrics/record-info`
  - `credits`: `GET /api/v1/generate/credit`
  - `callback`: a no-op endpoint used as the required `callBackUrl`
- `netlify.toml` maps `/api/*` to the functions.

## Deploy on Netlify

1. In Netlify, choose **Add new site → Import from Git** and pick this repo. You don't need a build command. `netlify.toml` sets the publish directory (`public`) and the functions directory.
2. Go to **Site configuration → Environment variables** and add:
   - `SUNO_API_KEY` = your SunoAPI.org key
3. Redeploy so the functions pick up the variable.

Never commit your API key to the repo.

## Run locally

```bash
npm i -g netlify-cli
SUNO_API_KEY=your_key netlify dev
```

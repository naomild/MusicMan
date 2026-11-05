// SunoAPI requires a callback URL. The app polls for results, so this just
// acknowledges the notification.
export default async () => new Response(JSON.stringify({ code: 200, msg: "ok" }), {
  headers: { "content-type": "application/json" },
});

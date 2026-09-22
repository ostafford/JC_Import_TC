export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 560px; margin: 4rem auto; padding: 0 1.25rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  label { display: block; margin: 1rem 0 0.25rem; font-weight: 600; }
  input[type=email], input[type=text], input[type=url], input[type=password] {
    width: 100%; padding: 0.5rem; font-size: 1rem; box-sizing: border-box; border: 1px solid #bbb; border-radius: 6px;
  }
  button { margin-top: 1.25rem; padding: 0.55rem 1.1rem; font-size: 1rem; border: none; border-radius: 6px; background: #1a1a1a; color: #fff; cursor: pointer; }
  .hint { color: #666; font-size: 0.9rem; }
  .notice { background: #eef7ee; border: 1px solid #b6dab6; padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; }
  .error { background: #fbeaea; border: 1px solid #e3b3b3; padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; }
  .status { margin: 0 0 1.5rem; }
  .top { display: flex; justify-content: space-between; align-items: baseline; }
  form.inline { display: inline; }
  .top button.link { background: none; color: #666; text-decoration: underline; padding: 0; font-size: 0.9rem; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shows only the last 4 characters, for redisplaying an already-saved secret. */
export function maskSecret(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return "*".repeat(value.length - 4) + value.slice(-4);
}

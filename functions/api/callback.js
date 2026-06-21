// Cloudflare Pages Function: GitHub OAuth 代理
// 路由: /api/callback
// 同时处理：发起认证 和 GitHub 回调

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  const CLIENT_ID = env.GITHUB_CLIENT_ID;
  const CLIENT_SECRET = env.GITHUB_CLIENT_SECRET;

  // Step 1: 无 code → 重定向到 GitHub 授权页
  if (!code) {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: `${url.origin}/api/callback`,
      scope: 'repo',
      state: crypto.randomUUID(),
    });
    return Response.redirect(
      `https://github.com/login/oauth/authorize?${params}`,
      302
    );
  }

  // Step 2: 有 code → 换取 access_token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
    }),
  });
  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    return new Response('Authentication failed', { status: 401 });
  }

  // Step 3: 返回 HTML，通过 Netlify Identity 协议与 Decap CMS 完成认证握手
  const token = tokenData.access_token;
  const html = `<!DOCTYPE html>
<html><body>
<script>
(function() {
  var ORIGIN = window.location.origin;

  // 第 1 步: 通知父窗口开始授权
  if (!window.opener) return;
  window.opener.postMessage("authorizing:github", ORIGIN);

  // 第 2 步: 等待父窗口确认后，发送 token
  function onMessage(e) {
    if (e.origin !== ORIGIN) return;
    if (e.data === "authorizing:github") {
      window.removeEventListener("message", onMessage);
      var payload = JSON.stringify({
        token: "${token}",
        provider: "github"
      });
      window.opener.postMessage(
        "authorization:github:success:" + payload,
        ORIGIN
      );
      setTimeout(function() { window.close(); }, 500);
    }
  }
  window.addEventListener("message", onMessage);
})();
</script>
<p>Authenticating...</p>
</body></html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

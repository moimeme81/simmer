# Reverse proxy and HTTPS

Simmer speaks plain HTTP. Put it behind a reverse proxy (Nginx Proxy Manager, Caddy, Traefik) before exposing it to the internet, and use HTTPS: installing on a phone, the Home Assistant panel and the web photo search all work best that way.

**Nginx Proxy Manager**
1. Proxy host → domain `simmer.example.com`, scheme `http`, forward host/port `SERVER-IP` / `3000`.
2. SSL tab → request a certificate, enable *Force SSL*.
3. Nothing else is needed. Simmer reads `X-Forwarded-Proto` to mark its cookie `Secure`.

**Showing Simmer inside Home Assistant** (sidebar panel or the companion app): the proxy must not send `X-Frame-Options` or a `frame-ancestors` Content-Security-Policy for the Simmer host. If Home Assistant is on `https`, Simmer must be too.

**Uploads**: backups can be large. If a big import fails behind the proxy, raise its body limit (NPM → Advanced: `client_max_body_size 300m;`).

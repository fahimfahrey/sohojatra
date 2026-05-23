import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

const SWAGGER_VERSION = "5.17.14";
const SWAGGER_CSS = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css`;
const SWAGGER_BUNDLE = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js`;
const SWAGGER_PRESET = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-standalone-preset.js`;

const SWAGGER_CSS_SRI =
  "sha384-wxLW6kwyHktdDGr6Pv1zgm/VGJh99lfUbzSn6HNHBENZlCN7W602k9VkGdxuFvPn";
const SWAGGER_BUNDLE_SRI =
  "sha384-wmyclcVGX/WhUkdkATwhaK1X1JtiNrr2EoYJ+diV3vj4v6OC5yCeSu+yW13SYJep";
const SWAGGER_PRESET_SRI =
  "sha384-2YH8WDRaj7V2OqU/trsmzSagmk/E2SutiCsGkdgoQwC9pNUJV1u/141DHB6jgs8t";

const HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="robots" content="noindex,nofollow" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Sohojatra API — Reference</title>
    <link rel="stylesheet" href="${SWAGGER_CSS}" integrity="${SWAGGER_CSS_SRI}" crossorigin="anonymous" />
    <style>
      html, body { margin: 0; padding: 0; background: #fafafa; }
      .topbar { display: none; }
      .info .title small.version-stamp { display: none; }
      #swagger-ui { max-width: 1200px; margin: 0 auto; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_BUNDLE}" integrity="${SWAGGER_BUNDLE_SRI}" crossorigin="anonymous"></script>
    <script src="${SWAGGER_PRESET}" integrity="${SWAGGER_PRESET_SRI}" crossorigin="anonymous"></script>
    <script>
      window.addEventListener('load', function () {
        window.ui = SwaggerUIBundle({
          url: '/api/docs/openapi.json',
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset
          ],
          plugins: [SwaggerUIBundle.plugins.DownloadUrl],
          layout: 'StandaloneLayout',
          tryItOutEnabled: false,
          supportedSubmitMethods: [],
          defaultModelsExpandDepth: 0,
          docExpansion: 'list',
          syntaxHighlight: { theme: 'agate' }
        });
      });
    </script>
  </body>
</html>`;

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: https://cdn.jsdelivr.net",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join("; ");

export function GET() {
  return new NextResponse(HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, must-revalidate",
      "Content-Security-Policy": CSP,
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}


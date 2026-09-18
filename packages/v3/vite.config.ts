import { defineConfig } from "vite";
import http from "node:http";
import loadVersion from "vite-plugin-package-version";
import { viteSingleFile } from "vite-plugin-singlefile";
import stripBanner from "rollup-plugin-strip-banner";
import replace from "@rollup/plugin-replace";
import compress from "../../scripts/vite-plugin-compress";
import minifyHtml from "../../scripts/vite-plugin-minify-html";
import minifyLiterals from "../../scripts/vite-plugin-minify-literals";

const proxy_target = process.env.PROXY_TARGET || "http://192.168.101.111";
const target_host = new URL(proxy_target).hostname;
const target_port = Number(new URL(proxy_target).port || 80);

// Entity domains the REST API uses.
const domains = [
  "light",
  "select",
  "cover",
  "switch",
  "button",
  "fan",
  "lock",
  "number",
  "climate",
  "text",
  "date",
  "time",
  "valve",
  "water_heater",
  "infrared",
];

// The esp-idf HTTP server refuses POSTs that arrive without a Content-Length
// header, and Vite's proxy will not send one. Handle those requests here
// instead, forwarding them with Node's own HTTP client.
function espCommandForwarder() {
  return {
    name: "esp-command-forwarder",
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.method !== "POST") return next();

        const path = (req.url || "").split("?")[0];
        const first = path.split("/")[1];
        if (!domains.includes(first)) return next();

        const upstream = http.request(
          {
            host: target_host,
            port: target_port,
            method: "POST",
            path: req.url,
            headers: {
              "Content-Length": "0",
              Accept: "*/*",
            },
          },
          (up: any) => {
            let body = "";
            up.on("data", (c: any) => (body += c.toString()));
            up.on("end", () => {
              console.log("[esp]", up.statusCode, req.url, body.trim());
              res.statusCode = up.statusCode || 500;
              res.setHeader("Access-Control-Allow-Origin", "*");
              res.end(body);
            });
          },
        );

        upstream.on("error", (err: any) => {
          console.log("[esp] forward failed:", req.url, err.message);
          res.statusCode = 502;
          res.end();
        });

        upstream.end();
      });
    },
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [
    espCommandForwarder(),
    stripBanner(),
    loadVersion(),
    minifyLiterals(),
    replace({
      "@license": "license",
      "Value passed to 'css' function must be a 'css' function result:":
        "use css function",
      "Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.":
        "Use unsafeCSS",
      delimiters: ["", ""],
      preventAssignment: true,
    }),
    // deleteInlinedFiles: false keeps the standalone www.js on disk after it
    // has been inlined into index.html. It is published to the CDN and users
    // point `js_url` at it instead of embedding the page in the firmware.
    viteSingleFile({ deleteInlinedFiles: false }),
    minifyHtml(),
    compress(/\.(js|css|html|svg)$/),
  ],
  build: {
    reportCompressedSize: false,
    // cssCodeSplit: true,
    outDir: "../../_static/v3",
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        chunkFileNames: "[name].js",
        assetFileNames: "www[extname]",
        entryFileNames: "www.js",
      },
    },
  },
  server: {
    open: "/", // auto open browser in dev mode
    host: true, // dev on local and network
    port: 5001,
    strictPort: true,
    proxy: {
      "/events": proxy_target,
    },
  },
});

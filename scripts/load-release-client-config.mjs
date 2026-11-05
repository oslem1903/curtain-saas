import { writeFile } from "node:fs/promises";

// Windows packaging needs only the same PUBLIC client settings served to browsers.
// Never fetch admin credentials or database keys for a desktop build.
const origin = "https://oslem1903-curtain-saas.vercel.app/";
const read = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Public release config: HTTP ${response.status}`);
    return response.text();
};
const html = await read(origin);
let config;
for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const url = new URL(match[1], origin);
    if (url.origin !== new URL(origin).origin) continue;
    const source = await read(url);
    const urls = [...new Set(source.match(/https:\/\/[a-z0-9]+\.supabase\.co/g))];
    const keys = [...new Set(source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g))].filter(key => {
        try { return JSON.parse(Buffer.from(key.split(".")[1], "base64url")).role === "anon"; }
        catch { return false; }
    });
    if (urls.length === 1 && keys.length === 1) config = { url: urls[0], key: keys[0] };
}
if (!config || new URL(config.url).hostname !== "ffhmzlcsgsgjonqqhgqq.supabase.co") {
    throw new Error("Beklenen PerdePRO projesinin public client ayarları doğrulanamadı.");
}
await writeFile(".env.local", `VITE_SUPABASE_URL=${config.url}\nVITE_SUPABASE_ANON_KEY=${config.key}\n`);
console.log("PerdePRO public client ayarları doğrulandı; gizli sunucu anahtarı kullanılmadı.");

// HaxBall's built-in stadiums and the community futsal map, as templates
// (bundled by Vite).
const files = import.meta.glob("./vendor/haxball/shared/stadiums/*.hbs", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const ORDER = ["classic", "easy", "small", "big", "rounded", "hockey", "big-hockey", "big-easy", "big-rounded", "huge", "futsal-bazinga"];
export const TEMPLATES = ORDER.map((id) => ({ id, text: files[`./vendor/haxball/shared/stadiums/${id}.hbs`] })).filter((t) => t.text);

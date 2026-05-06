// BASE_URL в Astro приходит с trailing slash: '/crimea/'.
// Эта функция строит чистый URL без двойных слэшей.
export function url(path: string = ""): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, "");
  if (!path) return base + "/";
  const cleanPath = "/" + path.replace(/^\/+/, "");
  return base + cleanPath;
}

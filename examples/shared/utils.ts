/** Generates a random ID with an optional prefix */
export function generateId(prefix?: string): string {
  const id = Math.random().toString(36).substring(2, 15);
  return prefix ? `${prefix}-${id}` : id;
}

export function getUrlParam(key: string): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get(key);
}

export function setUrlParam(key: string, value: string): string {
  const params = new URLSearchParams(window.location.search);
  params.set(key, value);
  window.location.search = params.toString();

  return value;
}

// Turn a submitted form into the plain object a Server Action parses.
//
// Picks ONLY the named fields. Next adds its own hidden `$ACTION_…` inputs to
// every form, and the actions' strict schemas reject unknown keys — so a form
// passes exactly its own fields, while an action called any other way still
// rejects anything extra. Files are dropped: no auth or profile field takes one.

export function pickFields<K extends string>(
  formData: FormData,
  keys: readonly K[],
): Partial<Record<K, string>> {
  const picked: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === 'string') picked[key] = value;
  }
  return picked;
}

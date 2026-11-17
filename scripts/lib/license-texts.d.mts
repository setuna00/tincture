export function resolveLicenseTexts<T extends { name: string; version: string; licenseText?: string | null }>(
  deps: T[],
  directory: string,
): (T & { licenseText: string | null })[]

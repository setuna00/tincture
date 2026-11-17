import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

function hasLicenseText(text) {
  return typeof text === 'string' && text.trim().length > 0
    && !/\(the package has no license file\)/i.test(text)
    && !/see the licen[cs]e file/i.test(text)
}

export function resolveLicenseTexts(deps, directory) {
  const missing = []
  const resolved = deps.map((dep) => {
    let text = dep.licenseText
    if (!hasLicenseText(text)) {
      const file = path.join(directory, `${dep.name}@${dep.version}.txt`)
      text = existsSync(file) ? readFileSync(file, 'utf8') : null
      if (text && !/^Source: https:\/\/\S+\r?\n/.test(text)) text = null
      if (!hasLicenseText(text?.replace(/^Source:[^\n]*\n/, ''))) missing.push(`${dep.name}@${dep.version}`)
    }
    return { ...dep, licenseText: text }
  })
  if (missing.length) throw new Error(`Missing license text for bundled packages:\n${missing.sort().map((name) => `  - ${name}`).join('\n')}\nAdd versioned upstream license texts in ${directory}.`)
  return resolved
}

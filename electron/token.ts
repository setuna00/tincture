// Electron safeStorage uses Windows DPAPI, so token ciphertext is bound to the Windows account.
// Keep token ciphertext outside the library because library folders may be shared or backed up.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface Cipher {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export class TokenStore {
  private file: string
  private cipher: Cipher

  constructor(file: string, cipher: Cipher) {
    this.file = file
    this.cipher = cipher
  }

  /** A different Windows account or damaged ciphertext may prevent decryption; treat the token as absent. */
  get(): string {
    if (!existsSync(this.file)) return ''
    try {
      return this.cipher.decrypt(readFileSync(this.file))
    } catch {
      return ''
    }
  }

  /** Fail when system encryption is unavailable; a plaintext fallback would expose the token. */
  set(token: string) {
    if (!token) {
      // Node 24 rmSync can silently leave paths containing Chinese characters; unlink the file directly.
      if (existsSync(this.file)) unlinkSync(this.file)
      return
    }
    if (!this.cipher.available()) throw new Error('系统加密不可用')
    mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, this.cipher.encrypt(token))
    renameSync(tmp, this.file)
  }
}

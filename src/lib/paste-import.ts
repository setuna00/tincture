export type OpenDialog = 'none' | 'import' | 'ai' | 'other'

export interface PasteInfo {
  handled: boolean
  /** Word/Excel clipboard text also includes a rendered image; prefer the text to avoid importing that image. */
  hasText: boolean
  images: number
  dialog: OpenDialog
}

export const pasteImports = ({ handled, hasText, images, dialog }: PasteInfo) => !handled && !hasText && images > 0 && (dialog === 'none' || dialog === 'import')

export const pasteAiReply = ({ handled, aiReply, dialog, onEditor }: { handled: boolean; aiReply: boolean; dialog: OpenDialog; onEditor: boolean }) =>
  !handled && aiReply && onEditor && (dialog === 'none' || dialog === 'ai')

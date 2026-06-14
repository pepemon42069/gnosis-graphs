/**
 * Pure record transforms for bundle migration. Must stay import-free of db.ts.
 */

/** The inline payload shape that existed through schema v2 (pre file/link refs). */
interface InlinePayloadV2 {
  format: 'markdown' | 'plaintext' | 'code' | 'link'
  content: string
  language?: string
}

/** Schema v1 payloads had 'json' as a standalone format. */
interface InlinePayloadV1 {
  format: 'markdown' | 'plaintext' | 'json' | 'link'
  content: string
}

/** v1 → v2: the 'json' format folds into 'code' with language 'json'. */
export function migratePayloadV2(payload: InlinePayloadV1 | InlinePayloadV2): InlinePayloadV2 {
  if (payload.format !== 'json') return payload as InlinePayloadV2
  return { format: 'code', content: payload.content, language: 'json' }
}

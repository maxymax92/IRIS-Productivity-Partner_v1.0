/** Serialised shape stored in the `conversation_messages.attachments` JSONB column. */
export interface PersistedAttachment {
  storagePath: string
  mediaType: string
  filename: string
}

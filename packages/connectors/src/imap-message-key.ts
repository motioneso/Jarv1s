const IMAP_EXTERNAL_ID_PREFIX = "imap:";

export interface ImapMessageIdentity {
  readonly folder: string;
  readonly uidValidity: string;
  readonly uid: number;
}

/**
 * Encode an IMAP message's (folder, UIDVALIDITY, UID) identity into the flat `external_id`
 * text column. The folder is percent-encoded so a folder name containing ":" cannot be
 * confused with the field separator.
 */
export function encodeImapExternalId(identity: ImapMessageIdentity): string {
  return `${IMAP_EXTERNAL_ID_PREFIX}${encodeURIComponent(identity.folder)}:${identity.uidValidity}:${identity.uid}`;
}

export function decodeImapExternalId(externalId: string): ImapMessageIdentity | null {
  if (!externalId.startsWith(IMAP_EXTERNAL_ID_PREFIX)) return null;
  const rest = externalId.slice(IMAP_EXTERNAL_ID_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) return null;
  const [encodedFolder, uidValidity, uidStr] = parts;
  if (encodedFolder === undefined || uidValidity === undefined || uidStr === undefined) return null;
  const uid = Number(uidStr);
  if (!Number.isInteger(uid) || uidValidity.length === 0) return null;
  return { folder: decodeURIComponent(encodedFolder), uidValidity, uid };
}

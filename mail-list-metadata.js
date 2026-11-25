const MAX_MIME_DEPTH = 32;

/** Count downloadable attachments from an IMAP BODYSTRUCTURE tree without fetching message bodies. */
export function countAttachments(bodyStructure) {
  let count = 0;

  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > MAX_MIME_DEPTH || count >= 100) return;

    const disposition = String(node.disposition || '').trim().toLowerCase();
    const dispositionParameters = node.dispositionParameters && typeof node.dispositionParameters === 'object'
      ? node.dispositionParameters
      : {};
    const contentParameters = node.parameters && typeof node.parameters === 'object' ? node.parameters : {};
    const filename = String(
      dispositionParameters.filename || dispositionParameters.name || contentParameters.name || ''
    ).trim();
    const isAttachment = disposition === 'attachment' || Boolean(filename);

    if (isAttachment && disposition !== 'inline') {
      count += 1;
      // An attached RFC822 message may itself contain child parts; count the attached message once.
      if (String(node.type || '').toLowerCase() === 'message/rfc822') return;
    }

    for (const child of Array.isArray(node.childNodes) ? node.childNodes : []) visit(child, depth + 1);
  };

  visit(bodyStructure);
  return count;
}

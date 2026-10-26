/**
 * Kill switches for features shipped ahead of the 11 November meetup. Off = the app behaves exactly
 * as before: a tap on a row opens the dialog, and no catalog card is shown.
 */

/** «Що видно в рядку — редагується в рядку»: InlineNumberCell / InlineTextCell in estimate,
 *  catalog and template rows. */
export const INLINE_ITEM_EDITING: boolean = true;

/** The quiet «Ціни відрізняються від каталогу» card at the bottom of an estimate. Independent of
 *  {@link INLINE_ITEM_EDITING} so it can be switched off on its own. */
export const CATALOG_SYNC_CARD: boolean = true;

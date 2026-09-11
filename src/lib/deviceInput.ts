/**
 * Is the PRIMARY input on this device a finger — a phone or a tablet rather than a desktop?
 *
 * <p>`pointer: coarse` is the proxy. A touchscreen laptop reports `fine` (its primary pointer is
 * the trackpad), which is the answer we want there: it is a desktop, whatever its screen can do.
 * Absent `matchMedia` → `false`, so a device we cannot classify is treated as a desktop.</p>
 *
 * <p>This is the one place the proxy lives; the callers below say what they each mean by it.</p>
 */
export function isHandheld(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/**
 * Is the keyboard this device types with an ON-SCREEN one — a phone or a tablet, where the keyboard
 * carries its own microphone?
 *
 * <p>There is no API for "can the OS dictate Ukrainian into a text field", so this is a proxy: the
 * class of device whose keyboard is drawn on the screen with a 🎤 on it is exactly the handheld one.</p>
 *
 * <p>Why it matters: <b>Windows voice typing has no Ukrainian at all</b> (verified 2026-09-03 —
 * it refuses with «Голосовий ввід недоступний для поточної мови»), so on a desktop the dictation
 * entry point would be an invitation the OS cannot honour. We would rather not offer it than offer
 * it where it cannot work.</p>
 */
export function hasOnScreenKeyboard(): boolean {
  return isHandheld();
}

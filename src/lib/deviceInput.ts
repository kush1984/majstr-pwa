/**
 * Is the keyboard this device types with an ON-SCREEN one — a phone or a tablet, where the keyboard
 * carries its own microphone?
 *
 * <p>There is no API for "can the OS dictate Ukrainian into a text field", so this is a proxy, and
 * a deliberate one: `pointer: coarse` means the PRIMARY input is a finger, which is exactly the
 * class of device whose keyboard is drawn on the screen with a 🎤 on it. A touchscreen laptop
 * reports `fine` (its primary pointer is the trackpad), which is the answer we want there.</p>
 *
 * <p>Why it matters: <b>Windows voice typing has no Ukrainian at all</b> (verified 2026-09-03 —
 * it refuses with «Голосовий ввід недоступний для поточної мови»), so on a desktop the dictation
 * entry point would be an invitation the OS cannot honour. Absent `matchMedia` → `false`: we would
 * rather not offer it than offer it where it cannot work.</p>
 */
export function hasOnScreenKeyboard(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

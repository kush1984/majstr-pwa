/**
 * True inside an app's own built-in browser — Facebook, Instagram, TikTok, Telegram, LINE and friends.
 * Google refuses its sign-in there (`disallowed_useragent`), and a good part of our traffic arrives
 * exactly that way, so «Увійти через Google» is not offered in one.
 */
export function isInAppBrowser(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Bytedance|Telegram|Line\/|; wv\)/i.test(ua);
}

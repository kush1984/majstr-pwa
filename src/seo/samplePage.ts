import './seo.css';
import { captureFirstTouch, captureRefFromUrl, captureUtmFromUrl } from '@/lib/referral.ts';

// The sample is printed at build time; the only thing this page does is remember where the visitor
// came from, like every other first page (V178), so a master who registers later is not counted as «direct».
captureRefFromUrl(window.location.search);
captureUtmFromUrl(window.location.search);
captureFirstTouch(document.referrer, window.location.pathname, window.location.hostname);

export type Locale = 'he' | 'en';

export const LOCALES: Locale[] = ['he', 'en'];
export const DEFAULT_LOCALE: Locale = 'he';

export function isLocale(value: unknown): value is Locale {
  return value === 'he' || value === 'en';
}

/** Document direction for a locale. The concept room is the only bilingual surface. */
export function direction(locale: Locale) {
  return locale === 'he' ? 'rtl' : 'ltr';
}

type Strings = {
  brand: string;
  brandNote: string;
  languageName: string;
  languageSwitchTo: string;
  languageSwitchLabel: string;
  identityQuestion: string;
  identityHelp: string;
  identityEnter: string;
  identityChange: string;
  identityAdvisorName: string;
  people: Record<'honi' | 'itzik' | 'advisor' | 'editor', string>;
  tabs: Record<'pending' | 'approved' | 'rejected', string>;
  categories: Record<'film-long' | 'film-short' | 'film' | 'series' | 'digital' | 'podcast', string>;
  empty: Record<'pending' | 'approved' | 'rejected', string>;
  open: string;
  close: string;
  prevPage: string;
  nextPage: string;
  pageOf: (current: number, total: number) => string;
  zoomIn: string;
  zoomOut: string;
  loadingDocument: string;
  documentFailed: string;
  decideHere: string;
  decisionMarker: string;
  returnToPending: string;
  returning: string;
  returned: string;
  decisionFor: string;
  decisionNote: string;
  decisionNoteOptional: string;
  decisionSave: string;
  decisionSaving: string;
  decisionSaved: string;
  decisionSavedLocal: string;
  decisionFailed: string;
  decisionNeedsIdentity: string;
  lastDecision: string;
  noDecisionYet: string;
  historyTitle: string;
  manage: string;
  demoNotice: string;
  liveNotice: string;
  loadFailed: string;
  missingInEnglish: string;
  skipToContent: string;
  documents: (count: number) => string;
};

const he: Strings = {
  brand: 'חדר הקונספטים',
  brandNote: 'SINAI',
  languageName: 'עברית',
  languageSwitchTo: 'EN',
  languageSwitchLabel: 'Switch to English',
  identityQuestion: 'מי נכנס/ת?',
  identityHelp: 'הבחירה מופיעה ליד ההחלטות שלך.',
  identityEnter: 'כניסה',
  identityChange: 'החלפת זהות',
  identityAdvisorName: 'שם היועץ/ת',
  people: { honi: 'חוני', itzik: 'איציק', advisor: 'יועץ/ת', editor: 'עורך/ת תוכן' },
  tabs: { pending: 'ממתינים', approved: 'מאושרים', rejected: 'נדחו' },
  categories: {
    'film-long': 'סרט ארוך · 30 דק׳',
    'film-short': 'סרט קצר',
    film: 'סרט',
    series: 'סדרה',
    digital: 'דיגיטל ורטיקלי',
    podcast: 'פודקאסט',
  },
  empty: {
    pending: 'אין קונספטים שממתינים להחלטה.',
    approved: 'עוד לא אושר אף קונספט.',
    rejected: 'לא נדחה אף קונספט.',
  },
  open: 'פתיחה',
  close: 'סגירה',
  prevPage: 'העמוד הקודם',
  nextPage: 'העמוד הבא',
  pageOf: (current, total) => `${current} מתוך ${total}`,
  zoomIn: 'הגדלה',
  zoomOut: 'הקטנה',
  loadingDocument: 'טוען מסמך…',
  documentFailed: 'לא הצלחנו לפתוח את המסמך.',
  decideHere: 'הכרעה',
  decisionMarker: 'הכרעה',
  returnToPending: 'החזרה לממתינים',
  returning: 'מחזיר…',
  returned: 'הוחזר לממתינים.',
  decisionFor: 'ההחלטה שלך על',
  decisionNote: 'הערה לצוות',
  decisionNoteOptional: 'לא חובה',
  decisionSave: 'שמירת החלטה',
  decisionSaving: 'שומר…',
  decisionSaved: 'ההחלטה נשמרה.',
  decisionSavedLocal: 'ההחלטה נשמרה במכשיר הזה.',
  decisionFailed: 'השמירה נכשלה.',
  decisionNeedsIdentity: 'כדי לשמור החלטה, בוחרים קודם מי אתם.',
  lastDecision: 'ההחלטה האחרונה',
  noDecisionYet: 'ממתין להחלטה',
  historyTitle: 'היסטוריית החלטות',
  manage: 'העלאת מסמכים',
  demoNotice: 'מצב הדגמה — ההחלטות נשמרות רק בדפדפן הזה.',
  liveNotice: '',
  loadFailed: 'לא הצלחנו לטעון את הקונספטים. מוצגת תצוגת הדגמה.',
  missingInEnglish: 'ארבעה קונספטים מוצגים בעברית בלבד, כי אין להם מסמך אנגלי מאושר.',
  skipToContent: 'דילוג לתוכן',
  documents: (count) => (count === 1 ? 'מסמך אחד' : `${count} מסמכים`),
};

const en: Strings = {
  brand: 'Concept Room',
  brandNote: 'SINAI',
  languageName: 'English',
  languageSwitchTo: 'עב',
  languageSwitchLabel: 'מעבר לעברית',
  identityQuestion: "Who's reviewing?",
  identityHelp: 'Your name appears next to your decisions.',
  identityEnter: 'Enter',
  identityChange: 'Change reviewer',
  identityAdvisorName: 'Advisor name',
  people: { honi: 'Honi', itzik: 'Itzik', advisor: 'Advisor', editor: 'Content editor' },
  tabs: { pending: 'Pending', approved: 'Approved', rejected: 'Declined' },
  categories: {
    'film-long': 'Long film · 30 min',
    'film-short': 'Short film',
    film: 'Film',
    series: 'Series',
    digital: 'Vertical digital',
    podcast: 'Podcast',
  },
  empty: {
    pending: 'Nothing is waiting for a decision.',
    approved: 'No concept has been approved yet.',
    rejected: 'No concept has been declined.',
  },
  open: 'Open',
  close: 'Close',
  prevPage: 'Previous page',
  nextPage: 'Next page',
  pageOf: (current, total) => `${current} of ${total}`,
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  loadingDocument: 'Loading document…',
  documentFailed: 'We could not open this document.',
  decideHere: 'Decide',
  decisionMarker: 'Decide',
  returnToPending: 'Move back to pending',
  returning: 'Moving…',
  returned: 'Moved back to pending.',
  decisionFor: 'Your decision on',
  decisionNote: 'Note for the team',
  decisionNoteOptional: 'optional',
  decisionSave: 'Save decision',
  decisionSaving: 'Saving…',
  decisionSaved: 'Decision saved.',
  decisionSavedLocal: 'Decision saved on this device.',
  decisionFailed: 'Saving failed.',
  decisionNeedsIdentity: 'Choose who you are before saving a decision.',
  lastDecision: 'Latest decision',
  noDecisionYet: 'Awaiting a decision',
  historyTitle: 'Decision history',
  manage: 'Upload documents',
  demoNotice: 'Demo mode — decisions stay in this browser only.',
  liveNotice: '',
  loadFailed: 'We could not load the concepts. Showing the demo set.',
  missingInEnglish: 'Four concepts are Hebrew-only, because no approved English document exists for them.',
  skipToContent: 'Skip to content',
  documents: (count) => (count === 1 ? '1 document' : `${count} documents`),
};

export const STRINGS: Record<Locale, Strings> = { he, en };

export function t(locale: Locale) {
  return STRINGS[locale];
}

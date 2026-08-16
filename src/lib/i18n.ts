export type Locale = 'he' | 'en';

export const LOCALES: Locale[] = ['en', 'he'];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return value === 'he' || value === 'en';
}

export function direction(locale: Locale) {
  return locale === 'he' ? 'rtl' : 'ltr';
}

export type ReviewerRole = 'management' | 'content_editor' | 'advisor';

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
  people: Record<ReviewerRole, string>;
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
  decisionFor: string;
  decisionHelp: string;
  decisionContinue: string;
  decisionSaving: string;
  decisionSaved: string;
  decisionSavedLocal: string;
  decisionFailed: string;

  decisionNeedsIdentity: string;
  lastDecision: string;
  noDecisionYet: string;
  manage: string;
  demoNotice: string;
  liveNotice: string;
  loadFailed: string;
  missingInEnglish: string;
  skipToContent: string;
  documents: (count: number) => string;
  gridView: string;
  listView: string;
  documentView: string;
  commentsView: string;
  commentsTitle: string;
  commentsEmpty: string;
  commentsHelp: string;
  commentsOptional: string;
  commentsPlaceholder: string;
  saveDecision: string;
  addComment: string;
  saveComment: string;
  editComment: string;
  editedComment: string;
  commentSaved: string;
  chooseDecisionFirst: string;
  commentsAction: (count: number) => string;
  viewDocument: string;
  resetDecision: string;
  resetTitle: string;
  resetHelp: string;
  resetKeepNotes: string;
  resetClearNotes: string;
  resetSubmit: string;
  resetCancel: string;
  resetSaving: string;
  resetSaved: string;
  resetFailed: string;
  commentsLocked: string;
  approvedSortLabel: string;
  approvedSorts: Record<'default' | 'speed' | 'budget' | 'viability', string>;
  assessment: {
    productionSpeed: string;
    budget: string;
    edit: string;
    save: string;
    saving: string;
    saved: string;
    failed: string;
    unassessed: string;
    speed: Record<'fast' | 'medium' | 'slow', string>;
    budgetValues: Record<'low' | 'medium' | 'high', string>;
  };
};

const en: Strings = {
  brand: 'Concept Room',
  brandNote: 'SINAI',
  languageName: 'English',
  languageSwitchTo: 'עברית',
  languageSwitchLabel: 'Switch to Hebrew',
  identityQuestion: "What's your role?",
  identityHelp: 'Your role is shown beside your decisions and comments.',
  identityEnter: 'Enter room',
  identityChange: 'Change role',
  identityAdvisorName: 'Your name (optional)',
  people: { management: 'Management', content_editor: 'Content editor', advisor: 'Advisor' },
  tabs: { pending: 'Pending', approved: 'Approved', rejected: 'Not approved' },
  categories: {
    'film-long': '30-minute film',
    'film-short': 'Short film',
    film: 'Film',
    series: 'Series',
    digital: 'Digital film',
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
  decideHere: 'Decision',
  decisionMarker: 'Decision',
  decisionFor: 'Choose a decision for',
  decisionHelp: 'After choosing, you can add a comment before saving.',
  decisionContinue: 'Continue to comments',
  decisionSaving: 'Saving…',
  decisionSaved: 'Decision saved.',
  decisionSavedLocal: 'Decision saved on this device.',
  decisionFailed: 'Saving failed.',

  decisionNeedsIdentity: 'Choose your role before saving a decision.',
  lastDecision: 'Latest decision',
  noDecisionYet: 'Awaiting a decision',
  manage: 'Upload concepts',
  demoNotice: 'Demo mode — decisions stay in this browser only.',
  liveNotice: '',
  loadFailed: 'We could not load the concepts.',
  missingInEnglish: 'Some concepts are Hebrew-only because no approved English document exists.',
  skipToContent: 'Skip to content',
  documents: (count) => (count === 1 ? '1 document' : `${count} documents`),
  gridView: 'Grid',
  listView: 'List',
  documentView: 'Concept document',
  commentsView: 'Comments',
  commentsTitle: 'Decision and comments',
  commentsEmpty: 'No comments yet.',
  commentsHelp: 'A comment is optional for every decision. You can also add or revise your own comment later.',
  commentsOptional: 'Optional',
  commentsPlaceholder: 'Write a clear note for the team…',
  saveDecision: 'Save decision',
  addComment: 'Add a comment',
  saveComment: 'Save comment',
  editComment: 'Edit my comment',
  editedComment: 'Edited',
  commentSaved: 'Comment saved.',
  chooseDecisionFirst: 'Choose a decision first.',
  commentsAction: (count) => (count ? `Comments (${count})` : 'Add a comment'),
  viewDocument: 'View concept document',
  resetDecision: 'Reset decision',
  resetTitle: 'Reset this decision?',
  resetHelp: 'The concept will return to Pending. Choose what should happen to its comments.',
  resetKeepNotes: 'Keep the comments',
  resetClearNotes: 'Reset the comments too',
  resetSubmit: 'Reset decision',
  resetCancel: 'Cancel',
  resetSaving: 'Resetting…',
  resetSaved: 'The concept is back in Pending.',
  resetFailed: 'Reset failed.',
  commentsLocked: 'Choose a new decision before adding or editing comments.',
  approvedSortLabel: 'Sort approved concepts',
  approvedSorts: { default: 'Default order', speed: 'Production speed', budget: 'Budget', viability: 'Best viability' },
  assessment: {
    productionSpeed: 'Production speed', budget: 'Budget', edit: 'Edit estimate',
    save: 'Save estimate', saving: 'Saving…', saved: 'Estimate saved.',
    failed: 'Could not save the estimate.', unassessed: 'Not yet estimated',
    speed: { fast: 'Fast', medium: 'Medium', slow: 'Slow' },
    budgetValues: { low: 'Low', medium: 'Medium', high: 'High' },
  },
};

const he: Strings = {
  brand: 'חדר הקונספטים',
  brandNote: 'SINAI',
  languageName: 'עברית',
  languageSwitchTo: 'English',
  languageSwitchLabel: 'Switch to English',
  identityQuestion: 'מה התפקיד שלך?',
  identityHelp: 'התפקיד מופיע לצד ההחלטות וההערות שלך.',
  identityEnter: 'כניסה לחדר',
  identityChange: 'החלפת תפקיד',
  identityAdvisorName: 'השם שלך (לא חובה)',
  people: { management: 'הנהלה', content_editor: 'עורך/ת תוכן', advisor: 'יועץ/ת' },
  tabs: { pending: 'ממתינים', approved: 'מאושרים', rejected: 'לא אושרו' },
  categories: {
    'film-long': 'סרט של 30 דק׳',
    'film-short': 'סרט קצר',
    film: 'סרט',
    series: 'סדרה',
    digital: 'סרט דיגיטל',
    podcast: 'פודקאסט',
  },
  empty: {
    pending: 'אין קונספטים שממתינים להחלטה.',
    approved: 'עוד לא אושר אף קונספט.',
    rejected: 'אין קונספטים שלא אושרו.',
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
  decideHere: 'החלטה',
  decisionMarker: 'החלטה',
  decisionFor: 'בחירת החלטה עבור',
  decisionHelp: 'אחרי הבחירה ייפתח מקום להערה לפני השמירה.',
  decisionContinue: 'המשך להערות',
  decisionSaving: 'שומר…',
  decisionSaved: 'ההחלטה נשמרה.',
  decisionSavedLocal: 'ההחלטה נשמרה במכשיר הזה.',
  decisionFailed: 'השמירה נכשלה.',

  decisionNeedsIdentity: 'כדי לשמור החלטה, בוחרים קודם תפקיד.',
  lastDecision: 'ההחלטה האחרונה',
  noDecisionYet: 'ממתין להחלטה',
  manage: 'העלאת קונספטים',
  demoNotice: 'מצב הדגמה — ההחלטות נשמרות רק בדפדפן הזה.',
  liveNotice: '',
  loadFailed: 'לא הצלחנו לטעון את הקונספטים.',
  missingInEnglish: 'חלק מהקונספטים קיימים בעברית בלבד כי אין להם מסמך אנגלי מאושר.',
  skipToContent: 'דילוג לתוכן',
  documents: (count) => (count === 1 ? 'מסמך אחד' : `${count} מסמכים`),
  gridView: 'גריד',
  listView: 'רשימה',
  documentView: 'מסמך הקונספט',
  commentsView: 'הערות',
  commentsTitle: 'החלטה והערות',
  commentsEmpty: 'עדיין אין הערות.',
  commentsHelp: 'אפשר להוסיף הערה בכל אחת מההחלטות, וגם להוסיף או לערוך הערה שלך מאוחר יותר.',
  commentsOptional: 'לא חובה',
  commentsPlaceholder: 'כתבו הערה ברורה לצוות…',
  saveDecision: 'שמירת החלטה',
  addComment: 'הוספת הערה',
  saveComment: 'שמירת הערה',
  editComment: 'עריכת ההערה שלי',
  editedComment: 'נערכה',
  commentSaved: 'ההערה נשמרה.',
  chooseDecisionFirst: 'צריך לבחור החלטה קודם.',
  commentsAction: (count) => (count ? `הערות (${count})` : 'הוספת הערה'),
  viewDocument: 'צפייה במסמך הקונספט',
  resetDecision: 'איפוס החלטה',
  resetTitle: 'לאפס את ההחלטה?',
  resetHelp: 'הקונספט יחזור לממתינים. בחרו מה לעשות עם ההערות שלו.',
  resetKeepNotes: 'לשמור את ההערות',
  resetClearNotes: 'לאפס גם את ההערות',
  resetSubmit: 'איפוס ההחלטה',
  resetCancel: 'ביטול',
  resetSaving: 'מאפס…',
  resetSaved: 'הקונספט חזר לממתינים.',
  resetFailed: 'האיפוס נכשל.',
  commentsLocked: 'כדי להוסיף או לערוך הערות צריך לבחור החלטה חדשה.',
  approvedSortLabel: 'סידור קונספטים מאושרים',
  approvedSorts: { default: 'סדר רגיל', speed: 'מהירות הפקה', budget: 'תקציב', viability: 'כדאיות' },
  assessment: {
    productionSpeed: 'מהירות הפקה', budget: 'תקציב', edit: 'עריכת הערכה',
    save: 'שמירת הערכה', saving: 'שומר…', saved: 'ההערכה נשמרה.',
    failed: 'שמירת ההערכה נכשלה.', unassessed: 'טרם הוערך',
    speed: { fast: 'מהיר', medium: 'בינוני', slow: 'איטי' },
    budgetValues: { low: 'נמוך', medium: 'בינוני', high: 'גבוה' },
  },
};

export const STRINGS: Record<Locale, Strings> = { he, en };
export function t(locale: Locale) { return STRINGS[locale]; }

// Local demo catalogue. Never a source of truth for real approvals — it exists so the room
// is usable and reviewable when the public Supabase build variables are absent.
// The English set is deliberately shorter: a concept exists in a language only when an
// approved document exists for it.

const he = [
  {
    id: 'future-of-work',
    title: 'כשהעבודה עוברת לצד השני של המסך',
    description: 'סדרת מפגשים קצרה עם אנשים שכבר עובדים לצד סוכנים חכמים — החלטות קטנות, הרגלים חדשים, ומה עדיין נשאר אנושי.',
    section: 'queue',
    priority: 1,
    locale: 'he',
    bannerUrl: '',
    pdfUrl: 'demo/concept-demo.pdf',
    reviews: [
      { reviewerId: 'demo-honi', reviewerName: 'חוני', decision: 'priority-approved', notes: '', createdAt: '2026-08-02T11:00:00Z' },
    ],
  },
  {
    id: 'one-street',
    title: 'רחוב אחד, מאה שנים',
    description: 'פורמט ארכיוני־עכשווי שמרכיב היסטוריה מקומית דרך רחוב יחיד: חלונות ראווה, דיירים, קולות והחלטות ששינו את המרחב.',
    section: 'queue',
    priority: 2,
    locale: 'he',
    bannerUrl: '',
    pdfUrl: 'demo/concept-demo.pdf',
    reviews: [
      { reviewerId: 'demo-honi', reviewerName: 'חוני', decision: 'wait', notes: '', createdAt: '2026-08-03T08:30:00Z' },
    ],
  },
  {
    id: 'night-shift',
    title: 'משמרת לילה',
    description: 'דיוקנאות שקטים של האנשים שמחזיקים את העיר ערה בזמן שרובנו ישנים — מבקרת רכבות, אופה, רופא ומפעילת חדר בקרה.',
    section: 'library',
    priority: 3,
    locale: 'he',
    bannerUrl: '',
    pdfUrl: 'demo/concept-demo.pdf',
    reviews: [],
  },
  {
    id: 'quiet-archive',
    title: 'הארכיון השקט',
    description: 'סדרה קצרה על חומרים שנשמרו במקרה — קלטות, מכתבים וסלילים שמספרים סיפור אחר על אותה תקופה.',
    section: 'library',
    priority: 4,
    locale: 'he',
    bannerUrl: '',
    pdfUrl: 'demo/concept-demo.pdf',
    reviews: [
      { reviewerId: 'demo-itzik', reviewerName: 'איציק', decision: 'canceled', notes: '', createdAt: '2026-08-04T09:15:00Z' },
    ],
  },
];

const en = [
  {
    id: 'future-of-work',
    title: 'When Work Moves to the Other Side of the Screen',
    description: 'A short documentary series about people already working alongside capable agents — small decisions, new habits, and what stays human.',
    section: 'queue',
    priority: 1,
    locale: 'en',
    bannerUrl: '',
    pdfUrl: 'demo/concept-demo.pdf',
    reviews: [
      { reviewerId: 'demo-honi', reviewerName: 'Honi', decision: 'priority-approved', notes: '', createdAt: '2026-08-02T11:00:00Z' },
    ],
  },
  {
    id: 'one-street',
    title: 'One Street, a Hundred Years',
    description: 'An archive-meets-present format that assembles local history through a single street: shopfronts, residents, voices and the decisions that reshaped it.',
    section: 'queue',
    priority: 2,
    locale: 'en',
    bannerUrl: '',
    pdfUrl: 'demo/concept-demo.pdf',
    reviews: [
      { reviewerId: 'demo-honi', reviewerName: 'Honi', decision: 'wait', notes: '', createdAt: '2026-08-03T08:30:00Z' },
    ],
  },
  {
    id: 'night-shift',
    title: 'Night Shift',
    description: 'Quiet portraits of the people who keep the city awake while most of us sleep — a train inspector, a baker, a doctor, a control-room operator.',
    section: 'library',
    priority: 3,
    locale: 'en',
    bannerUrl: '',
    pdfUrl: 'demo/concept-demo.pdf',
    reviews: [],
  },
];

export const demoConceptsByLocale = { he, en };
export const demoConcepts = he;

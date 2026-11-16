/**
 * The shapes the API sends and receives. They match the app's types (src/lib/types.ts there)
 * so the app can use server data without converting it. Money is in euros, dates are ISO strings.
 */

export type Person = {
  id: string;
  firstName: string;
  fatherName: string;
  lastName: string;
  createdAt: string;
};

export type PersonInput = Pick<Person, 'firstName' | 'fatherName' | 'lastName'>;

export type TicketKind = 'annual' | 'payment';
export type TicketStatus = 'paid' | 'unpaid';

export type Ticket = {
  id: string;
  /** Sequential receipt number shown on printed tickets. */
  number: number;
  personId: string;
  kind: TicketKind;
  /** Season start year, e.g. 2027 means Oct 2027 – Sep 2028. */
  season: number;
  amount: number;
  /** For annual tickets: the yearly fee at the time the ticket was created. */
  due?: number;
  reasons: string[];
  status: TicketStatus;
  note?: string;
  createdAt: string;
  paidAt?: string;
};

export type SeasonRecord = {
  year: number;
  /** 0 = January … 9 = October */
  month: number;
  startedAt: string;
};

export type PaperWidth = 58 | 80;

export type Settings = {
  adminName: string;
  organization: string;
  goal: number;
  annualFee: number;
  seasonStartMonth: number;
  seasonStartYear: number;
  reasons: string[];
  paperWidth: PaperWidth;
};

/** Everything the app keeps on the device, in the same shape as its persisted store. */
export type Snapshot = {
  people: Person[];
  tickets: Ticket[];
  settings: Settings;
  seasons: SeasonRecord[];
  nextTicketNumber: number;
  /** "personId:season" keys of yearly tickets that were deleted on purpose. */
  dismissedAnnual: string[];
};

export type User = {
  id: string;
  username: string;
  displayName: string;
};
